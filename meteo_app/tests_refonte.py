"""
Tests de la refonte technique : ressources dérivées (images satellite
adaptées, vidéos H.264 par heure, trames OPERA binaires), API et fichiers.

    python manage.py test meteo_app.tests_refonte

Les images sont petites (profils réduits le temps des tests) : les essais
restent rapides. Les tests vidéo sont sautés si FFmpeg est introuvable.
"""

import gzip
import json
from datetime import date, datetime, timedelta, timezone
from unittest import mock, skipUnless

import numpy as np
from django.template import Context, Template
from django.test import Client, TestCase

from meteo_app.sources import derives
from meteo_app.tests import DossierTemporaire

PETITS_PROFILS = {
    "haute": {"taille": (64, 74), "emprise": (-9.5, 37.0, 14.5, 56.0), "qualite": 80, "crf": 23, "niveau": "4.1"},
    "standard": {"taille": (64, 66), "emprise": derives.EMPRISE_GEOCOLOUR, "qualite": 80, "crf": 23, "niveau": "4.1"},
    "leger": {"taille": (32, 34), "emprise": derives.EMPRISE_GEOCOLOUR, "qualite": 80, "crf": 23, "niveau": "4.1"},
}


def ffmpeg_present():
    try:
        return bool(derives.ffmpeg())
    except Exception:
        return False


class AvecProfilsReduits(DossierTemporaire):
    def setUp(self):
        super().setUp()
        self.profils = mock.patch.dict(derives.PROFILS_SATELLITE, PETITS_PROFILS)
        self.profils.start()

    def tearDown(self):
        self.profils.stop()
        super().tearDown()

    def original(self, instant, teinte=100):
        from PIL import Image
        dossier = derives.dossier_publication("geocolour")
        chemin = dossier / f"geocolour_{instant:%Y%m%dT%H%M}Z.webp"
        image = np.full((80, 78, 3), teinte, np.uint8)
        image[:, : 10] = 30
        Image.fromarray(image).save(chemin, "WEBP", quality=90)
        return chemin


class CorrectionTests(TestCase):
    def test_gris_moyen(self):
        # contrast 1,10 · saturate 1,15 · brightness 1,06 · matrice (1,02 ; 0,96 ; 1,04) ;
        # la netteté ne change pas un aplat
        sortie = derives.corriger_satellite(np.full((5, 5, 3), 128, np.uint8))
        self.assertEqual(sortie.dtype, np.uint8)
        self.assertEqual(list(sortie[2, 2]), [138, 130, 141])

    def test_bornes(self):
        noir = derives.corriger_satellite(np.zeros((3, 3, 3), np.uint8))
        blanc = derives.corriger_satellite(np.full((3, 3, 3), 255, np.uint8))
        self.assertEqual(noir.max(), 0)
        self.assertEqual(int(blanc[1, 1, 0]), 255)


class JourneeTests(TestCase):
    def test_changements_d_heure(self):
        heures = lambda j: (derives.bornes_jour(j)[1] - derives.bornes_jour(j)[0]) / timedelta(hours=1)
        self.assertEqual(heures(date(2026, 3, 29)), 23)
        self.assertEqual(heures(date(2026, 10, 25)), 25)
        self.assertEqual(heures(date(2026, 11, 18)), 24)

    def test_boite_haute(self):
        g, h, d, b = derives.boite_originale((-9.5, 37.0, 14.5, 56.0))
        self.assertAlmostEqual(d - g, 2513.7, places=0)
        self.assertGreater(b - h, 2900)


class PlanTests(AvecProfilsReduits, TestCase):
    def test_images_tenues_et_lacune(self):
        jour = date(2026, 11, 18)
        for minute in (0, 10, 20):
            self.original(datetime(2026, 11, 18, 12, minute, tzinfo=timezone.utc))
        self.original(datetime(2026, 11, 18, 13, 30, tzinfo=timezone.utc))
        plan = derives.plan_du_jour(jour)
        self.assertEqual([h.hour for h, _ in plan], [12, 13])
        images = plan[0][1]
        self.assertEqual(len(images), 24)
        # Image n° 4 (12 h 10) : l'observation de 12 h 10 ; n° 5 (12 h 12 min 30) : toujours elle
        self.assertTrue(images[4][0][1].name.endswith("1210Z.webp"))
        self.assertTrue(images[5][0][1].name.endswith("1210Z.webp"))
        # Pendant la lacune (13 h 00), l'image de 12 h 20 est tenue
        self.assertTrue(plan[1][1][0][0][1].name.endswith("1220Z.webp"))
        self.assertTrue(all(t == 0 for _, _, t in images))      # pas de fondu par défaut


@skipUnless(ffmpeg_present(), "FFmpeg introuvable")
class VideoTests(AvecProfilsReduits, TestCase):
    def test_assemblage_index_et_reprise(self):
        jour = date(2026, 11, 18)
        for minute in (0, 10, 20, 30):
            self.original(datetime(2026, 11, 18, 12, minute, tzinfo=timezone.utc), 90 + minute)
        index = derives.assembler_jour("leger", jour, journal=lambda *_: None)
        dossier = derives.dossier_video("leger", jour)
        self.assertTrue((dossier / index["video"]).is_file())
        self.assertEqual(index["images"], 24)
        self.assertEqual([o["image"] for o in index["observations"]], [0, 4, 8, 12])
        self.assertEqual(index["debut"], "2026-11-18T12:00:00Z")

        # Relance : rien n'est réencodé
        segment = dossier / "seg_20261118T12Z.mp4"
        avant = segment.stat().st_mtime_ns
        derives.assembler_jour("leger", jour, journal=lambda *_: None)
        self.assertEqual(segment.stat().st_mtime_ns, avant)

        # Observation tardive dans une nouvelle heure : seule cette heure est encodée
        self.original(datetime(2026, 11, 18, 13, 5, tzinfo=timezone.utc))
        index2 = derives.assembler_jour("leger", jour, journal=lambda *_: None)
        self.assertEqual(segment.stat().st_mtime_ns, avant)
        self.assertNotEqual(index2["video"], index["video"])
        self.assertEqual(index2["images"], 48)
        # Aucun fichier temporaire laissé
        self.assertFalse(list(dossier.glob(".tmp_*")))

    def test_api_satellite_et_plage(self):
        jour = date(2026, 11, 18)
        for minute in (0, 10):
            self.original(datetime(2026, 11, 18, 12, minute, tzinfo=timezone.utc))
        derives.assembler_jour("standard", jour, journal=lambda *_: None)
        reponse = Client().get("/meteo/api/satellite/?jour=2026-11-18")
        self.assertEqual(reponse.status_code, 200)
        donnees = json.loads(reponse.content)
        self.assertEqual(len(donnees["observations"]), 2)
        self.assertTrue(donnees["correction_integree"])
        self.assertIsNotNone(donnees["video"])
        url = donnees["video"]["url"]
        partielle = Client().get(url, HTTP_RANGE="bytes=0-99")
        self.assertEqual(partielle.status_code, 206)
        self.assertEqual(len(b"".join(partielle.streaming_content)), 100)
        self.assertEqual(partielle["Content-Range"].split("/")[0], "bytes 0-99")


class FichiersTests(AvecProfilsReduits, TestCase):
    def test_api_signale_image_adaptee_absente(self):
        # Production des dérivés en retard : la page doit savoir qu'il faut
        # prendre l'original (sinon fond vide sur un 404 de Nginx).
        maintenant = datetime.now(timezone.utc).replace(second=0, microsecond=0)
        instant = maintenant.replace(minute=maintenant.minute // 10 * 10) - timedelta(minutes=20)
        original = self.original(instant)
        jour = derives.jour_local(instant).isoformat()
        lire = lambda: json.loads(Client().get(f"/meteo/api/satellite/?jour={jour}&profil=leger").content)
        donnees = lire()
        obs = donnees["observations"][-1]
        self.assertFalse(obs["derivee"])
        self.assertTrue(obs["originale"].endswith(original.name))
        self.assertFalse(donnees["secours"]["derivee"])
        self.assertEqual(Client().get(obs["originale"]).status_code, 200)
        derives.image_derivee(original, "leger")
        self.assertTrue(lire()["observations"][-1]["derivee"])

    def test_image_fabriquee_a_la_demande(self):
        instant = datetime(2026, 11, 18, 12, 0, tzinfo=timezone.utc)
        self.original(instant)
        reponse = Client().get("/meteo/donnees/derives/geocolour/leger/geocolour_20261118T1200Z.webp")
        self.assertEqual(reponse.status_code, 200)
        self.assertEqual(reponse["Content-Type"], "image/webp")
        self.assertIn("immutable", reponse["Cache-Control"])
        from PIL import Image
        chemin = derives.chemin_image("leger", "geocolour_20261118T1200Z.webp")
        self.assertEqual(Image.open(chemin).size, (32, 34))

    def test_noms_refuses(self):
        for nom in ("../../secret", "geocolour/leger/x.webp", "video/leger/2026-11-18/seg_x.mp4",
                    "geocolour/leger/.tmp_abc.webp"):
            self.assertEqual(Client().get(f"/meteo/donnees/derives/{nom}").status_code, 404)

    def test_journal(self):
        c = Client()
        self.assertEqual(c.post("/meteo/api/journal/", '{"type":"essai"}', content_type="application/json").status_code, 204)
        self.assertEqual(c.post("/meteo/api/journal/", "pas du json", content_type="application/json").status_code, 400)
        self.assertEqual(c.post("/meteo/api/journal/", "x" * 5000, content_type="application/json").status_code, 413)
        self.assertEqual(c.get("/meteo/api/journal/").status_code, 405)

    def test_purge(self):
        ancien = datetime.now(timezone.utc) - timedelta(days=12)
        original = self.original(ancien)
        derives.image_derivee(original, "leger")
        recent = self.original(datetime.now(timezone.utc) - timedelta(hours=1))
        derives.image_derivee(recent, "leger")
        nombre, _ = derives.purger(simulation=True)
        self.assertEqual(nombre, 1)
        self.assertTrue(derives.chemin_image("leger", original.name).exists())   # simulation
        derives.purger()
        self.assertFalse(derives.chemin_image("leger", original.name).exists())
        self.assertTrue(derives.chemin_image("leger", recent.name).exists())
        self.assertTrue(original.exists())          # l'original n'est jamais touché


class OperaTests(DossierTemporaire, TestCase):
    def test_trames_binaires(self):
        from meteo_app.sources import opera, stockage
        g = opera.description()
        instant = datetime.now(timezone.utc).replace(second=0, microsecond=0) - timedelta(minutes=20)
        instant = instant.replace(minute=instant.minute // 15 * 15)
        champs = {
            "intensite": np.full((g["ny"], g["nx"]), 2.0, np.float32),
            "pluie": np.full((g["ny"], g["nx"]), 0.5, np.float32),
            "couverture": np.ones((g["ny"], g["nx"]), np.float32),
        }
        stockage.enregistrer_grille("opera", "observation", instant, champs)
        for profil, facteur in (("standard", 1), ("leger", 2)):
            reponse = Client().get(f"/meteo/api/radar/?profil={profil}")
            self.assertEqual(reponse.status_code, 200)
            donnees = json.loads(gzip.decompress(reponse.content) if reponse.get("Content-Encoding") == "gzip"
                                 else reponse.content)
            grille = donnees["grille"]
            self.assertEqual(grille["nx"], g["nx"] // facteur)
            fichier = Client().get(donnees["trames"][0]["url"])
            self.assertEqual(fichier["Content-Encoding"], "gzip")
            octets = gzip.decompress(b"".join(fichier.streaming_content))
            self.assertEqual(len(octets), 2 * grille["nx"] * grille["ny"])
            # 2 mm/h -> round(40 × log2(3)) = 63 ; pluie 0,5 -> 8, couverture 1 -> 15
            self.assertEqual(octets[0], 63)
            self.assertEqual(octets[grille["nx"] * grille["ny"]], (8 << 4) | 15)


class GabaritTests(TestCase):
    def test_static_v(self):
        rendu = Template("{% load hko_statique %}{% static_v 'meteo_app/js/hko.js' %}").render(Context())
        self.assertRegex(rendu, r"meteo_app/js/hko\.js\?v=[0-9a-f]{10}$")
        absent = Template("{% load hko_statique %}{% static_v 'meteo_app/absent.js' %}").render(Context())
        self.assertNotIn("?v=", absent)
