"""
Tests de HKO Météo : moteur de fusion, lecture des sources, collecte, API.

    python manage.py test meteo_app

Les fichiers de test (mosaïque radar, masque nuageux, GeoTIFF AROME) sont
fabriqués à la volée, en petit, avec la même structure que les vrais
produits. Aucun accès réseau, aucune clé d'API.
"""

import gzip
import io
import json
import math
import shutil
import tarfile
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from django.core.management import call_command
from django.test import Client, TestCase, override_settings

INSTANT = datetime(2026, 11, 17, 14, 55, tzinfo=timezone.utc)


def forme():
    from meteo_app.sources import grille
    return (grille.NY, grille.NX)


def plein(valeur):
    return np.full(forme(), valeur, dtype=np.float32)


def radar_uniforme(couverture=1.0, pluie=0.0, intensite=0.0, maximum=None, age=2):
    return {
        "couverture": plein(couverture), "pluie": plein(pluie),
        "intensite": plein(intensite), "maximum": plein(intensite if maximum is None else maximum),
        "age": age,
    }


def satellite_uniforme(opaque=0.0, partiel=0.0, valide=1.0, age=5):
    clair = max(0.0, 1 - opaque - partiel)
    return {"valide": plein(valide), "opaque": plein(opaque), "partiel": plein(partiel),
            "clair": plein(clair), "neige": plein(0), "age": age}


# ---------------------------------------------------------------------------
# Moteur de fusion
# ---------------------------------------------------------------------------

class FusionTests(TestCase):
    def fusion(self, **sources):
        from meteo_app import fusion
        return fusion.fusionner(INSTANT, **sources)

    def categorie(self, resultat, j=115, i=170):
        from meteo_app.fusion import CATEGORIES
        return CATEGORIES[resultat["categorie"][j, i]]

    def test_ciel_degage_observe(self):
        r = self.fusion(radar=radar_uniforme(), satellite=satellite_uniforme(opaque=0.05))
        self.assertEqual(self.categorie(r), "soleil")
        self.assertEqual(r["confiance"][115, 170], 3)

    def test_classes_de_nebulosite(self):
        attendus = [(0.25, "peu_nuageux"), (0.5, "eclaircies"), (0.8, "tres_nuageux"), (0.95, "couvert")]
        for n, nom in attendus:
            r = self.fusion(radar=radar_uniforme(), satellite=satellite_uniforme(opaque=n))
            self.assertEqual(self.categorie(r), nom, n)

    def test_intensites_de_pluie(self):
        sat = satellite_uniforme(opaque=1.0)
        for intensite, nom in [(1.0, "pluie_faible"), (4.0, "pluie_moderee"), (10.0, "pluie_forte")]:
            r = self.fusion(radar=radar_uniforme(pluie=1.0, intensite=intensite), satellite=sat)
            self.assertEqual(self.categorie(r), nom)

    def test_pas_de_mesure_radar_n_est_pas_du_sec(self):
        r = self.fusion(radar=radar_uniforme(couverture=0.0), satellite=satellite_uniforme(opaque=0.0))
        self.assertTrue(np.isnan(r["intensite"][115, 170]))
        # Ciel connu par le satellite, précipitations inconnues : confiance partielle
        self.assertEqual(r["confiance"][115, 170], 2)

    def test_source_trop_ancienne_ignoree(self):
        r = self.fusion(radar=radar_uniforme(pluie=1.0, intensite=5.0, age=90))
        self.assertEqual(self.categorie(r), "inconnu")
        self.assertEqual(r["confiance"][115, 170], 0)

    def test_modele_seul_confiance_faible(self):
        arome = {"precipitation": plein(3.0), "nebulosite": plein(1.0), "temperature": plein(8.0), "ecart": 20}
        r = self.fusion(arome=arome)
        self.assertEqual(self.categorie(r), "pluie_moderee")
        self.assertEqual(r["confiance"][115, 170], 1)

    def test_arome_trop_eloigne_ignore(self):
        arome = {"precipitation": plein(3.0), "nebulosite": plein(1.0), "ecart": 180}
        r = self.fusion(arome=arome)
        self.assertEqual(self.categorie(r), "inconnu")

    def test_neige_selon_la_temperature(self):
        stations = {"temperature": plein(0.2), "age": 5}
        r = self.fusion(radar=radar_uniforme(pluie=1.0, intensite=2.0),
                        satellite=satellite_uniforme(opaque=1.0), stations=stations)
        self.assertEqual(self.categorie(r), "neige")

        stations = {"temperature": plein(6.0), "age": 5}
        r = self.fusion(radar=radar_uniforme(pluie=1.0, intensite=2.0),
                        satellite=satellite_uniforme(opaque=1.0), stations=stations)
        self.assertEqual(self.categorie(r), "pluie_faible")

    def test_desaccord_radar_satellite(self):
        r = self.fusion(radar=radar_uniforme(pluie=1.0, intensite=1.0), satellite=satellite_uniforme(opaque=0.0))
        self.assertTrue(r["desaccord"][115, 170])
        self.assertEqual(r["confiance"][115, 170], 1)
        # La pluie mesurée est gardée, le ciel est refermé sous la pluie
        self.assertEqual(self.categorie(r), "pluie_faible")
        self.assertGreaterEqual(r["nebulosite"][115, 170], 0.75)

    def test_averses_cellules_isolees(self):
        radar = radar_uniforme()
        radar["pluie"][110:113, 168:171] = 1.0
        radar["intensite"][110:113, 168:171] = 6.0
        radar["maximum"][110:113, 168:171] = 8.0
        r = self.fusion(radar=radar, satellite=satellite_uniforme(opaque=0.2))
        self.assertEqual(self.categorie(r, 111, 169), "averses")

    def test_orage_exige_deux_indices(self):
        radar = radar_uniforme(pluie=1.0, intensite=30.0, maximum=40.0)
        sat = satellite_uniforme(opaque=1.0)
        r = self.fusion(radar=radar, satellite=sat)
        self.assertNotEqual(self.categorie(r), "orage")

        arome = {"foudre": plein(0.0), "ecart": 10}
        arome["foudre"][115, 171] = 0.3
        r = self.fusion(radar=radar, satellite=sat, arome=arome)
        self.assertEqual(self.categorie(r), "orage")

    def test_brouillard_mesure(self):
        stations = {"visibilite": plein(400.0), "age": 5}
        r = self.fusion(radar=radar_uniforme(), satellite=satellite_uniforme(opaque=1.0), stations=stations)
        self.assertEqual(self.categorie(r), "brouillard")

    def test_prevision_n_utilise_que_arome(self):
        arome = {"nebulosite": plein(0.1), "precipitation": plein(0.0), "ecart": 0}
        r = self.fusion(radar=radar_uniforme(pluie=1.0, intensite=9.0), arome=arome, mode="prevision")
        self.assertEqual(self.categorie(r), "soleil")
        self.assertEqual(int(r["sources"][115, 170]) & 1, 0)

    def test_encodage(self):
        from meteo_app import fusion
        r = self.fusion(radar=radar_uniforme(), satellite=satellite_uniforme(opaque=0.5))
        contenu = fusion.encoder(r, INSTANT, "observation", {})
        import base64
        octets = base64.b64decode(contenu["champs"]["nebulosite"])
        self.assertEqual(len(octets), contenu["grille"]["nx"] * contenu["grille"]["ny"])
        self.assertEqual(octets[115 * contenu["grille"]["nx"] + 170], 50)

    def test_voisinage(self):
        from meteo_app.fusion import voisinage
        t = np.zeros((5, 5)); t[2, 2] = 9
        self.assertAlmostEqual(voisinage(t, 1)[2, 2], 1.0)
        self.assertEqual(voisinage(t, 1, "maximum")[1, 1], 9)
        t[0, 0] = np.nan
        self.assertTrue(np.isfinite(voisinage(t, 1)[0, 0]))


# ---------------------------------------------------------------------------
# Radar
# ---------------------------------------------------------------------------

PROJDEF = "+proj=stere +lat_0=90 +lon_0=0 +lat_ts=45 +ellps=WGS84 +x_0=619652.07 +y_0=5262818.34 +datum=WGS84"


def fabriquer_odim(chemin, instant=INSTANT, taille=400, pas=5000.0, pluie_paris=600):
    """Petite mosaïque ODIM_H5 (même structure que T_IPRN20, maille de 5 km)."""
    import h5py
    from pyproj import CRS, Transformer

    vers = Transformer.from_crs("EPSG:4326", CRS.from_proj4(PROJDEF), always_xy=True)
    inverse = Transformer.from_crs(CRS.from_proj4(PROJDEF), "EPSG:4326", always_xy=True)
    cx, cy = vers.transform(2.5, 46.5)
    xg, yh = cx - taille * pas / 2, cy + taille * pas / 2

    donnees = np.full((taille, taille), 65534, dtype=np.uint16)       # mesuré, sec
    donnees[:, : taille // 10] = 65535                                  # hors couverture
    x, y = vers.transform(2.35, 48.85)
    c, l = int((x - xg) / pas), int((yh - y) / pas)
    donnees[l - 3:l + 4, c - 3:c + 4] = pluie_paris                    # 6 mm en 5 min

    debut = instant - timedelta(minutes=5)
    with h5py.File(chemin, "w") as f:
        f.attrs["Conventions"] = np.bytes_("ODIM_H5/V2_3")
        w = f.create_group("where")
        w.attrs["projdef"] = np.bytes_(PROJDEF)
        w.attrs["xscale"] = pas
        w.attrs["yscale"] = pas
        coins = {"UL": (xg, yh), "UR": (xg + taille * pas, yh),
                 "LL": (xg, yh - taille * pas), "LR": (xg + taille * pas, yh - taille * pas)}
        for nom, (cx_, cy_) in coins.items():
            lon, lat = inverse.transform(cx_, cy_)
            w.attrs[f"{nom}_lon"] = lon
            w.attrs[f"{nom}_lat"] = lat
        q = f.create_group("what")
        q.attrs["date"] = np.bytes_(instant.strftime("%Y%m%d"))
        q.attrs["time"] = np.bytes_(instant.strftime("%H%M%S"))
        q.attrs["source"] = np.bytes_("CMT:ACRR_composite_metropole500_OPER")
        h = f.create_group("how")
        h.attrs["nodes"] = np.bytes_("WMO:07145,WMO:07168")
        h.attrs["missing_nodes"] = np.bytes_("WMO:07005")
        d = f.create_group("dataset1")
        dw = d.create_group("what")
        dw.attrs["startdate"] = np.bytes_(debut.strftime("%Y%m%d"))
        dw.attrs["starttime"] = np.bytes_(debut.strftime("%H%M%S"))
        dw.attrs["enddate"] = np.bytes_(instant.strftime("%Y%m%d"))
        dw.attrs["endtime"] = np.bytes_(instant.strftime("%H%M%S"))
        d1 = d.create_group("data1")
        d1.create_dataset("data", data=donnees)
        qw = d1.create_group("what")
        qw.attrs["quantity"] = np.bytes_("ACRR")
        qw.attrs["gain"] = 0.01
        qw.attrs["offset"] = 0.0
        qw.attrs["nodata"] = 65535.0
        qw.attrs["undetect"] = 65534.0
    return chemin


class DossierTemporaire:
    """Données HKO dans un dossier temporaire, le temps d'un test."""

    def setUp(self):
        super().setUp()
        self.temporaire = Path(tempfile.mkdtemp(prefix="hko_test_"))
        self.reglages = override_settings(HKO_DONNEES=str(self.temporaire / "donnees"))
        self.reglages.enable()

    def tearDown(self):
        self.reglages.disable()
        shutil.rmtree(self.temporaire, ignore_errors=True)
        super().tearDown()


class RadarTests(DossierTemporaire, TestCase):
    def test_lecture_et_unites(self):
        from meteo_app import radar
        m = radar.lire_mosaique(fabriquer_odim(self.temporaire / "T_IPRN20_C_LFPW_20261117145500.h5"))
        self.assertEqual(m["unite"], "mm/h")
        self.assertEqual(m["periode_minutes"], 5)
        self.assertLess(m["ecart_coins_max"], 1)
        self.assertAlmostEqual(float(m["intensite"].max()), 72.0, places=3)   # 6 mm en 5 min
        self.assertFalse(m["mesure"][:, 0].any())                              # nodata
        self.assertTrue(m["mesure"][:, -1].all())                              # undetect = mesuré
        self.assertEqual(m["radars_absents"], ["WMO:07005"])

    def test_sur_grille_paris(self):
        from meteo_app import radar
        from meteo_app.sources import grille
        m = radar.lire_mosaique(fabriquer_odim(self.temporaire / "T_IPRN20_C_LFPW_20261117145500.h5"))
        g = radar.sur_grille(m)
        j = int((grille.NORD - 48.85) / grille.PAS)
        i = int((2.35 - grille.OUEST) / grille.PAS)
        self.assertGreater(g["pluie"][j, i], 0.9)
        self.assertGreater(g["intensite"][j, i], 50)
        # Une zone mesurée sans pluie vaut 0, pas NaN
        self.assertEqual(g["pluie"][j + 40, i + 40], 0)

    def test_collecte_depuis_un_paquet_et_doublon(self):
        from meteo_app.models import JournalCollecte, ProduitMeteo
        h5 = fabriquer_odim(self.temporaire / "T_IPRN20_C_LFPW_20261117145500.h5")
        paquet = self.temporaire / "paquet.tar.gz"
        with tarfile.open(paquet, "w:gz") as archive:
            archive.add(h5, arcname=h5.name)

        call_command("collecter_radar", "--fichier", str(paquet), "--sans-fusion", stdout=io.StringIO())
        self.assertEqual(ProduitMeteo.objects.filter(source="radar").count(), 1)

        call_command("collecter_radar", "--fichier", str(paquet), "--sans-fusion", stdout=io.StringIO())
        self.assertEqual(ProduitMeteo.objects.filter(source="radar").count(), 1)
        self.assertEqual(JournalCollecte.objects.filter(source="radar").first().statut, "rien_de_neuf")

        publie = Path(self.temporaire / "donnees" / "publication" / "radar" / "radar.json")
        self.assertTrue(publie.exists())
        meta = json.loads(publie.read_text(encoding="utf-8"))
        self.assertTrue((publie.parent / meta["image"]).exists())


# ---------------------------------------------------------------------------
# Satellite
# ---------------------------------------------------------------------------

def fabriquer_clm(chemin, instant=INSTANT, n=300, inverser_x=True):
    """
    Petit masque nuageux au format MTG (disque complet, n x n pixels).
    Le jour et la nuit sont calculés pour l'instant donné ; inverser_x
    reproduit la convention constatée dans les vrais fichiers.
    """
    import h5py
    from pyproj import CRS, Transformer

    h = 35786400.0
    crs = CRS.from_proj4(f"+proj=geos +h={h} +a=6378137 +b=6356752 +lon_0=0 +sweep=y +units=m")
    inverse = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)

    echelle = 0.15561952 * 2 / n
    brut = np.arange(1, n + 1)
    # Valeurs écrites dans le fichier (convention des vrais produits)
    x_fichier = -echelle * brut + 0.15561952 + echelle / 2
    y_fichier = echelle * brut - 0.15561952 - echelle / 2
    x_reel = -x_fichier if inverser_x else x_fichier

    xx, yy = np.meshgrid(x_reel * h, y_fichier * h)
    lon, lat = inverse.transform(xx, yy)
    sur_terre = np.isfinite(lon) & (np.abs(lon) < 360)

    from meteo_app.conditions import hauteur_soleil

    hauteurs = np.full(lon.shape, np.nan)
    for j, i in zip(*np.where(sur_terre)):
        hauteurs[j, i] = hauteur_soleil(instant, float(lat[j, i]), float(lon[j, i]))

    eclairement = np.where(~sur_terre, 0, np.where(hauteurs > 5, 3, np.where(hauteurs < -5, 1, 2))).astype(np.int8)
    classes = np.where(sur_terre, 3, 0).astype(np.int8)
    qualite = np.where(sur_terre, 1, 0).astype(np.int8)

    with h5py.File(chemin, "w") as f:
        f.attrs["time_coverage_start"] = np.bytes_((instant - timedelta(minutes=10)).strftime("%Y%m%d%H%M%S"))
        f.attrs["time_coverage_end"] = np.bytes_(instant.strftime("%Y%m%d%H%M%S"))
        f.attrs["platform"] = np.bytes_("MTI1")
        f.attrs["product_id"] = np.bytes_("FCI2CLMFDHSI")
        f.attrs["date_created"] = np.bytes_(instant.strftime("%Y%m%d%H%M%S"))
        f.attrs["license"] = np.bytes_("https://www.eumetsat.int/legal-framework/data-policy")
        p = f.create_dataset("mtg_geos_projection", data=np.int32(0))
        p.attrs["perspective_point_height"] = np.array([h])
        p.attrs["semi_major_axis"] = np.array([6378137.0])
        p.attrs["semi_minor_axis"] = np.array([6356752.0])
        p.attrs["longitude_of_projection_origin"] = np.array([0.0])
        p.attrs["sweep_angle_axis"] = np.bytes_("y")
        for nom, valeurs in (("x", x_fichier), ("y", y_fichier)):
            v = f.create_dataset(nom, data=brut.astype(np.int16))
            premier = valeurs[0] - (valeurs[1] - valeurs[0])
            v.attrs["scale_factor"] = np.array([valeurs[1] - valeurs[0]])
            v.attrs["add_offset"] = np.array([premier])
        f.create_dataset("cloud_state", data=classes)
        f.create_dataset("quality_illumination", data=eclairement)
        f.create_dataset("quality_overall_processing", data=qualite)
        for nom in ("product_completeness", "product_timeliness"):
            f.create_dataset(nom, data=np.int8(100))
    return chemin


class SatelliteTests(TestCase):
    def setUp(self):
        self.temporaire = Path(tempfile.mkdtemp(prefix="hko_sat_"))

    def tearDown(self):
        shutil.rmtree(self.temporaire, ignore_errors=True)

    def test_orientation_conforme(self):
        from meteo_app.sources import satellite
        m = satellite.lire_masque(fabriquer_clm(self.temporaire / "clm.nc"), region=(-20, 30, 30, 60))
        resultat = satellite.controler_orientation(m, pas=4)
        self.assertEqual(resultat["controle"], "conforme")

    def test_orientation_inversee_refusee(self):
        from meteo_app.sources import satellite
        chemin = fabriquer_clm(self.temporaire / "clm.nc", inverser_x=False)
        m = satellite.lire_masque(chemin, region=(-20, 30, 30, 60))
        with self.assertRaises(satellite.ErreurSatellite):
            satellite.controler_orientation(m, pas=4)

    def test_nom_du_produit(self):
        from meteo_app.sources.satellite import instants_depuis_nom
        debut, fin = instants_depuis_nom(
            "W_XX-EUMETSAT-Darmstadt,IMG+SAT,MTI1+FCI-2-CLM--FD------NC4E_C_EUMT_20261117145438"
            "_L2PF_OPE_20261117144000_20261117145000_N__O_0089_0000.nc")
        self.assertEqual(fin, datetime(2026, 11, 17, 14, 50, tzinfo=timezone.utc))
        self.assertEqual(debut, datetime(2026, 11, 17, 14, 40, tzinfo=timezone.utc))


# ---------------------------------------------------------------------------
# AROME
# ---------------------------------------------------------------------------

def geotiff(valeurs, ouest, nord, pas):
    """GeoTIFF float32 minimal (étiquettes ModelPixelScale et ModelTiepoint)."""
    from PIL import Image, TiffImagePlugin

    info = TiffImagePlugin.ImageFileDirectory_v2()
    info[33550] = (pas, pas, 0.0)
    info.tagtype[33550] = 12
    info[33922] = (0.0, 0.0, 0.0, ouest, nord, 0.0)
    info.tagtype[33922] = 12
    info[42113] = "-9999"
    tampon = io.BytesIO()
    Image.fromarray(valeurs.astype(np.float32), mode="F").save(tampon, format="TIFF", tiffinfo=info)
    return tampon.getvalue()


class AromeTests(TestCase):
    def test_catalogue(self):
        from meteo_app.sources import arome
        xml = "".join(
            f"<wcs:CoverageId>{p['indicateur']}___2026-11-17T{h}.00.00Z{p.get('suffixe', '')}</wcs:CoverageId>"
            for p in arome.PARAMETRES.values() for h in ("09", "12")
        ) + "<wcs:CoverageId>TEMPERATURE__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND___2026-11-17T15.00.00Z</wcs:CoverageId>"
        catalogue = arome.lire_catalogue(xml)
        self.assertEqual(arome.dernier_cycle_complet(catalogue), datetime(2026, 11, 17, 12, tzinfo=timezone.utc))
        self.assertEqual(
            arome.identifiant("precipitation", datetime(2026, 11, 17, 12, tzinfo=timezone.utc)),
            "TOTAL_PRECIPITATION__GROUND_OR_WATER_SURFACE___2026-11-17T12.00.00Z_PT1H",
        )

    def test_description(self):
        from meteo_app.sources import arome
        xml = """<wcs:CoverageDescriptions xmlns:wcs="http://www.opengis.net/wcs/2.0"
            xmlns:gml="http://www.opengis.net/gml/3.2" xmlns:gmlrgrid="http://www.opengis.net/gml/3.3/rgrid"
            xmlns:swe="http://www.opengis.net/swe/2.0"><wcs:CoverageDescription>
            <gml:boundedBy><gml:Envelope axisLabels="lat long height time">
            <gml:lowerCorner>37.5 -12 2 0</gml:lowerCorner><gml:upperCorner>55.4 16 10 183600</gml:upperCorner>
            </gml:Envelope></gml:boundedBy>
            <gmlrgrid:GeneralGridAxis><gmlrgrid:coefficients>2 10 20</gmlrgrid:coefficients>
            <gmlrgrid:gridAxesSpanned>height</gmlrgrid:gridAxesSpanned></gmlrgrid:GeneralGridAxis>
            <gmlrgrid:GeneralGridAxis><gmlrgrid:coefficients>0 3600 7200</gmlrgrid:coefficients>
            <gmlrgrid:gridAxesSpanned>time</gmlrgrid:gridAxesSpanned></gmlrgrid:GeneralGridAxis>
            <swe:uom code="K"/><swe:nilValue>9999</swe:nilValue>
            </wcs:CoverageDescription></wcs:CoverageDescriptions>"""
        d = arome.lire_description(xml)
        self.assertEqual(d["axes"], ["lat", "long", "height", "time"])
        self.assertEqual(d["hauteurs"], [2.0, 10.0, 20.0])
        self.assertEqual(d["echeances"], [0, 3600, 7200])
        self.assertEqual(d["unite"], "K")

    def test_geotiff_et_grille(self):
        from meteo_app.sources import arome, grille
        lon = np.arange(-6.5, 11.0, 0.01)
        lat = np.arange(52.0, 40.5, -0.01)
        valeurs = 273.15 + np.tile(lon, (lat.size, 1))      # température = longitude (°C)
        lu, ouest, nord, pas_lon, pas_lat, nodata = arome.lire_geotiff(geotiff(valeurs, -6.5, 52.0, 0.01))
        self.assertAlmostEqual(ouest, -6.5)
        self.assertAlmostEqual(nord, 52.0)
        self.assertEqual(nodata, -9999)
        champ = arome.normaliser({"temperature": arome.sur_grille(lu, ouest, nord, pas_lon, pas_lat)})["temperature"]
        i = int(round((2.35 - grille.OUEST) / grille.PAS))      # cellule 2,35° - 2,40° E
        self.assertAlmostEqual(float(champ[100, i]), 2.37, delta=0.011)

    def test_echeances(self):
        from meteo_app.management.commands.collecter_arome import echeances_a_collecter
        cycle = datetime(2026, 11, 17, 12, tzinfo=timezone.utc)
        validites = echeances_a_collecter(cycle, instant=datetime(2026, 11, 17, 15, 20, tzinfo=timezone.utc))
        self.assertIn(datetime(2026, 11, 17, 15, tzinfo=timezone.utc), validites)
        self.assertIn(datetime(2026, 11, 18, 14, tzinfo=timezone.utc), validites)   # demain 15 h à Paris
        self.assertTrue(all(cycle <= v <= cycle + timedelta(hours=51) for v in validites))


# ---------------------------------------------------------------------------
# Outils communs et API
# ---------------------------------------------------------------------------

class CommunTests(DossierTemporaire, TestCase):
    def test_verrou_exclusif(self):
        from meteo_app.sources.commun import DejaEnCours, verrou
        with verrou("essai"):
            with self.assertRaises(DejaEnCours):
                with verrou("essai"):
                    pass
        with verrou("essai"):
            pass

    def test_verrou_abandonne_repris(self):
        import os
        import time
        from meteo_app.sources.commun import dossier, verrou
        chemin = dossier("verrous") / "vieux.lock"
        chemin.write_text("1")
        ancien = time.time() - 3600
        os.utime(chemin, (ancien, ancien))
        with verrou("vieux", duree_max_secondes=60):
            pass

    def test_cle_absente(self):
        from meteo_app.sources.commun import CleManquante, lire_cle
        with self.assertRaises(CleManquante):
            lire_cle("HKO_CLE_QUI_N_EXISTE_PAS")


class ApiTests(DossierTemporaire, TestCase):
    def test_conditions_absentes(self):
        reponse = Client().get("/meteo/api/conditions/?jour=2026-11-17")
        self.assertEqual(reponse.status_code, 404)
        self.assertIn("erreur", reponse.json())

    def test_conditions_publiees(self):
        from meteo_app.models import ProduitMeteo
        from meteo_app.sources.commun import chemin_archive, relatif
        chemin = chemin_archive("fusion", INSTANT, "essai.json.gz")
        chemin.write_bytes(gzip.compress(b'{"version": 1}'))
        ProduitMeteo.objects.create(source="fusion", nature="prevision",
                                    instant=datetime(2026, 11, 18, 14, tzinfo=timezone.utc),
                                    reference=datetime(2026, 11, 17, 12, tzinfo=timezone.utc),
                                    fichier=relatif(chemin))
        with override_settings(USE_TZ=True):
            from unittest import mock
            from django.utils import timezone as tz
            with mock.patch.object(tz, "localdate", return_value=datetime(2026, 11, 17).date()):
                reponse = Client().get("/meteo/api/conditions/?jour=2026-11-18")
        self.assertEqual(reponse.status_code, 200)
        self.assertEqual(reponse["Content-Encoding"], "gzip")

    def test_fichier_radar_refuse_les_noms_inconnus(self):
        self.assertEqual(Client().get("/meteo/donnees/radar/settings.py").status_code, 404)
        self.assertEqual(Client().get("/meteo/donnees/radar/radar.json").status_code, 404)  # absent
        from meteo_app.views import FICHIERS_RADAR
        for nom in ("radar.json", "radar.png", "radar_couverture.png",
                    "radar_20261117T1455Z.png", "radar_20261117T1455Z_couverture.png"):
            self.assertTrue(FICHIERS_RADAR.match(nom), nom)
        for nom in ("../radar.json", "radar.py", "radar_2026.png"):
            self.assertFalse(FICHIERS_RADAR.match(nom), nom)

    def test_etat(self):
        reponse = Client().get("/meteo/api/etat/")
        self.assertEqual(reponse.status_code, 200)
        self.assertIn("radar", reponse.json()["sources"])
