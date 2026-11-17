"""
HKO Météo — masque nuageux Meteosat Third Generation (FCI, Cloud Mask).

Produit EUMETSAT Data Store EO:EUM:DAT:0678, toutes les 10 minutes,
environ 2 km au nadir. Fichier netCDF4 (lisible par h5py), variable
cloud_state en classes :

    0  non traité (hors disque, données absentes)
    1  ciel clair (ni nuage, ni neige, ni glace)
    2  nuage partiel ou semi-transparent
    3  nuage opaque
    4  poussière partielle     5  poussière opaque
    6  cendres partielles      7  cendres opaques
    8  neige ou glace au sol
    9  indéfini

Indicateurs conservés : quality_illumination (nuit, crépuscule, jour,
reflet du soleil), quality_overall_processing (bonne qualité ou faible
confiance), product_completeness / product_quality / product_timeliness.

Projection : géostationnaire, lon_0 = 0°, axe de balayage y. Les
coordonnées x, y sont en radians (x = brut * scale_factor + add_offset),
à multiplier par la hauteur du satellite.

ORIENTATION — vérifiée sur le produit du 17 novembre 2026, 14 h 40 UTC :
les valeurs x écrites dans le fichier doivent être inversées (multipliées
par -1). Avec les axes tels quels, les pixels marqués « nuit » auraient
un soleil à 49° au-dessus de l'horizon et la neige détectée tomberait en
Atlantique ; avec l'axe x inversé, la nuit correspond à un soleil à -7,5°
et la neige se trouve sur les Alpes (7,6° E, 45,9° N). Ce contrôle est
refait à chaque image (controler_orientation) : si EUMETSAT change de
convention, la collecte s'arrête au lieu de publier une carte décalée.

Le masque nuageux dit où il y a des nuages. Il ne dit pas s'il pleut,
s'il y a du brouillard ou un orage.
"""

import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

CLASSES = {
    0: "non_traite", 1: "clair", 2: "partiel", 3: "opaque",
    4: "poussiere_partielle", 5: "poussiere_opaque",
    6: "cendres_partielles", 7: "cendres_opaques",
    8: "neige_glace", 9: "indefini",
}

ECLAIREMENT = {0: "espace", 1: "nuit", 2: "crepuscule", 3: "jour", 4: "reflet"}

# Le fichier écrit x dans le sens inverse de la convention géostationnaire
# (voir le contrôle ci-dessus).
SIGNE_X = -1
SIGNE_Y = 1


class ErreurSatellite(Exception):
    pass


def _date(texte):
    texte = str(texte or "").strip()
    for format_date in ("%Y%m%d%H%M%S", "%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ"):
        try:
            return datetime.strptime(texte, format_date).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _attr(objet, nom, defaut=None):
    valeur = objet.attrs.get(nom, defaut)
    if isinstance(valeur, bytes):
        return valeur.decode("utf-8", "replace")
    if isinstance(valeur, np.ndarray) and valeur.size == 1:
        return valeur.reshape(-1)[0].item()
    return valeur


def extraire_netcdf(chemin_zip, dossier_cible):
    """Extrait le seul fichier .nc utile d'une archive du Data Store."""
    with zipfile.ZipFile(chemin_zip) as archive:
        noms = [n for n in archive.namelist() if n.endswith(".nc") and "CLM" in n]
        if not noms:
            raise ErreurSatellite("Aucun fichier netCDF CLM dans l'archive.")
        nom = noms[0]
        cible = Path(dossier_cible) / Path(nom).name
        with archive.open(nom) as source, open(cible, "wb") as sortie:
            while bloc := source.read(1 << 20):
                sortie.write(bloc)
    return cible


def instants_depuis_nom(nom):
    """Début et fin de la période lus dans le nom normalisé du produit."""
    trouve = re.search(r"_(\d{14})_(\d{14})_N_", nom)
    if not trouve:
        return None, None
    return _date(trouve.group(1)), _date(trouve.group(2))


def lire_masque(chemin_nc, region=(-12.0, 34.0, 20.0, 58.0)):
    """
    Lit le masque nuageux et ne garde que la région utile (ouest, sud,
    est, nord). Renvoie un dictionnaire avec les classes, l'éclairement,
    la qualité, la géométrie et les indicateurs globaux.
    """
    import h5py
    from pyproj import CRS, Transformer

    with h5py.File(chemin_nc, "r") as f:
        for nom in ("cloud_state", "x", "y", "mtg_geos_projection"):
            if nom not in f:
                raise ErreurSatellite(f"Variable {nom} absente du fichier.")

        p = f["mtg_geos_projection"]
        hauteur_sat = float(_attr(p, "perspective_point_height"))
        a = float(_attr(p, "semi_major_axis"))
        b = float(_attr(p, "semi_minor_axis"))
        lon_0 = float(_attr(p, "longitude_of_projection_origin", 0.0))
        balayage = _attr(p, "sweep_angle_axis", "y")

        def axe(nom, signe):
            v = f[nom]
            return signe * (
                v[()].astype(np.float64) * float(_attr(v, "scale_factor", 1.0))
                + float(_attr(v, "add_offset", 0.0))
            ) * hauteur_sat

        x = axe("x", SIGNE_X)
        y = axe("y", SIGNE_Y)

        crs = CRS.from_proj4(
            f"+proj=geos +h={hauteur_sat} +a={a} +b={b} +lon_0={lon_0} "
            f"+sweep={balayage} +units=m +no_defs"
        )
        vers_geos = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
        vers_geo = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)

        # Région utile : rectangle de pixels englobant la zone demandée
        ouest, sud, est, nord = region
        lon_bord = np.concatenate([np.linspace(ouest, est, 60), np.linspace(ouest, est, 60),
                                   np.full(60, ouest), np.full(60, est)])
        lat_bord = np.concatenate([np.full(60, sud), np.full(60, nord),
                                   np.linspace(sud, nord, 60), np.linspace(sud, nord, 60)])
        xb, yb = vers_geos.transform(lon_bord, lat_bord)
        ok = np.isfinite(xb) & np.isfinite(yb)
        if not ok.any():
            raise ErreurSatellite("La région demandée n'est pas visible du satellite.")

        def plage(axe_valeurs, mini, maxi):
            indices = np.where((axe_valeurs >= mini) & (axe_valeurs <= maxi))[0]
            if indices.size == 0:
                raise ErreurSatellite("Région hors de la grille du produit.")
            return int(indices.min()), int(indices.max()) + 1

        c0, c1 = plage(x, xb[ok].min(), xb[ok].max())
        l0, l1 = plage(y, yb[ok].min(), yb[ok].max())

        def couper(nom):
            if nom not in f:
                return None
            return f[nom][l0:l1, c0:c1]

        classes = couper("cloud_state")
        eclairement = couper("quality_illumination")
        qualite = couper("quality_overall_processing")

        # Disque entier, sous-échantillonné, pour le contrôle d'orientation :
        # la seule région utile ne suffit pas (l'Europe est à cheval sur le
        # méridien 0, son image miroir lui ressemble trop).
        pas_disque = max(1, x.size // 350)
        disque = None
        if "quality_illumination" in f:
            disque = {
                "eclairement": f["quality_illumination"][::pas_disque, ::pas_disque],
                "x": x[::pas_disque], "y": y[::pas_disque],
            }

        globaux = {
            nom: _attr(f, nom) for nom in (
                "time_coverage_start", "time_coverage_end", "platform",
                "product_id", "date_created", "license",
            )
        }
        indicateurs = {}
        for nom in ("product_completeness", "product_quality", "product_timeliness"):
            if nom in f:
                brut = f[nom][()]
                facteur = float(_attr(f[nom], "scale_factor", 1.0))
                indicateurs[nom] = None if brut == -127 else round(float(brut) * facteur, 2)

    debut = _date(globaux["time_coverage_start"])
    fin = _date(globaux["time_coverage_end"])

    return {
        "chemin": str(chemin_nc),
        "classes": np.asarray(classes, dtype=np.int8),
        "eclairement": None if eclairement is None else np.asarray(eclairement, dtype=np.int8),
        "qualite": None if qualite is None else np.asarray(qualite, dtype=np.int8),
        "x": x[c0:c1], "y": y[l0:l1],
        "disque": disque,
        "crs": crs, "vers_geos": vers_geos, "vers_geo": vers_geo,
        "debut": debut, "fin": fin,
        # Instant représentatif : le balayage de l'Europe a lieu en fin de
        # répétition ; on retient la fin de la période couverte.
        "instant": fin or debut,
        "plateforme": globaux["platform"],
        "produit": globaux["product_id"],
        "licence": globaux["license"],
        "indicateurs": indicateurs,
    }


def controler_orientation(masque, pas=6):
    """
    Vérifie la géolocalisation : la hauteur du soleil, calculée pour chaque
    pixel, doit être négative là où le produit dit « nuit » et positive là
    où il dit « jour ». Renvoie un résumé ; lève ErreurSatellite si le
    contrôle échoue franchement.
    """
    from meteo_app.conditions import hauteur_soleil

    source = masque.get("disque") or {
        "eclairement": masque["eclairement"], "x": masque["x"], "y": masque["y"],
    }
    eclairement = source["eclairement"]
    if eclairement is None:
        return {"controle": "impossible (pas d'indicateur d'éclairement)"}

    if masque.get("disque"):
        pas = 1
    lignes = np.arange(0, eclairement.shape[0], pas)
    colonnes = np.arange(0, eclairement.shape[1], pas)
    xx, yy = np.meshgrid(source["x"][colonnes], source["y"][lignes])
    lon, lat = masque["vers_geo"].transform(xx, yy)
    classes = eclairement[np.ix_(lignes, colonnes)]

    ok = np.isfinite(lon) & (np.abs(lon) < 360)
    instant = masque["instant"]

    hauteurs = {}
    for code, nom in ((1, "nuit"), (3, "jour")):
        choix = ok & (classes == code)
        if choix.sum() < 20:
            continue
        indices = np.argwhere(choix)
        if len(indices) > 400:
            indices = indices[np.linspace(0, len(indices) - 1, 400).astype(int)]
        valeurs = [hauteur_soleil(instant, float(lat[i, j]), float(lon[i, j])) for i, j in indices]
        hauteurs[nom] = float(np.median(valeurs))

    resultat = {"hauteur_soleil_mediane": hauteurs}

    if "nuit" in hauteurs and hauteurs["nuit"] > 3:
        raise ErreurSatellite(
            f"Géolocalisation incohérente : soleil à {hauteurs['nuit']:.1f}° "
            "là où le produit indique la nuit. Image non publiée."
        )
    if "jour" in hauteurs and hauteurs["jour"] < 0:
        raise ErreurSatellite(
            f"Géolocalisation incohérente : soleil à {hauteurs['jour']:.1f}° "
            "là où le produit indique le jour. Image non publiée."
        )

    resultat["controle"] = "conforme" if hauteurs else "non concluant (zone sans nuit ni jour franc)"
    return resultat


def sur_grille(masque):
    """
    Ramène le masque sur la grille commune. Tableaux (NY, NX) :

        valide       part des points avec une classe exploitable (1, 2, 3, 8)
        clair        part de ciel clair (neige au sol comptée comme clair)
        partiel      part de nuages partiels ou semi-transparents
        opaque       part de nuages opaques
        neige        part de neige ou glace au sol
        nuit         part des points de nuit (confiance moindre)
        fiable       part des points de bonne qualité
    """
    from . import grille

    lon, lat = grille.points_echantillon()
    x, y = masque["vers_geos"].transform(lon, lat)

    def indice(axe_valeurs, valeurs):
        # Les axes peuvent être croissants ou décroissants
        pas = axe_valeurs[1] - axe_valeurs[0]
        i = np.round((valeurs - axe_valeurs[0]) / pas)
        valide = np.isfinite(i) & (i >= 0) & (i < axe_valeurs.size)
        return np.where(valide, i, 0).astype(np.int64), valide

    colonne, ok_c = indice(masque["x"], x)
    ligne, ok_l = indice(masque["y"], y)
    dedans = ok_c & ok_l

    classes = np.where(dedans, masque["classes"][ligne, colonne], 0)
    n = classes.shape[2]

    exploitable = np.isin(classes, (1, 2, 3, 8))
    nb = exploitable.sum(axis=2)

    def part(masque_points):
        with np.errstate(invalid="ignore", divide="ignore"):
            return np.where(nb > 0, masque_points.sum(axis=2) / np.maximum(nb, 1), np.nan).astype(np.float32)

    resultat = {
        "valide": (nb / n).astype(np.float32),
        "clair": part((classes == 1) | (classes == 8)),
        "partiel": part(classes == 2),
        "opaque": part(classes == 3),
        "neige": part(classes == 8),
    }

    if masque["eclairement"] is not None:
        ecl = np.where(dedans, masque["eclairement"][ligne, colonne], 0)
        resultat["nuit"] = part(exploitable & (ecl == 1))
    if masque["qualite"] is not None:
        qual = np.where(dedans, masque["qualite"][ligne, colonne], 0)
        resultat["fiable"] = part(exploitable & (qual == 1))

    return resultat
