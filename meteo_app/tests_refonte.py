"""
Tests de la refonte technique : ressources dérivées (images satellite
adaptées, vidéos H.264 par heure, trames OPERA binaires), API et fichiers.

    python manage.py test meteo_app.tests_refonte

Les images sont petites (profils réduits le temps des tests) : les essais
restent rapides. Les tests vidéo sont sautés si FFmpeg est introuvable.
"""

import gzip
import json
import os
import signal
import subprocess
import sys
import time
import weakref
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


class CorrectionParBandesTests(TestCase):
    def test_identique_au_calcul_d_un_bloc(self):
        # Le traitement par bandes doit donner exactement le même résultat
        rng = np.random.default_rng(1)
        image = rng.integers(0, 256, (derives.BANDE * 2 + 37, 41, 3), dtype=np.uint8)
        par_bandes = derives.corriger_satellite(image)
        with mock.patch.object(derives, "BANDE", 10 ** 6):
            d_un_bloc = derives.corriger_satellite(image)
        np.testing.assert_array_equal(par_bandes, d_un_bloc)


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

    def test_pas_de_video_pour_une_seule_observation(self):
        jour = date(2026, 11, 18)
        self.original(datetime(2026, 11, 18, 12, 0, tzinfo=timezone.utc))
        self.assertIsNone(derives.assembler_jour("leger", jour, journal=lambda *_: None))
        self.assertFalse(list(derives.dossier_video("leger", jour).glob("*.mp4")))

    def test_heures_closes_seulement(self):
        jour = date(2026, 11, 18)
        for heure, minute in ((12, 0), (12, 30), (13, 10), (13, 20)):
            self.original(datetime(2026, 11, 18, heure, minute, tzinfo=timezone.utc))
        # 13 h 40 : l'heure de 13 h n'est pas close -> vidéo de 12 h seulement
        index = derives.assembler_jour("leger", jour, journal=lambda *_: None,
                                       maintenant=datetime(2026, 11, 18, 13, 40, tzinfo=timezone.utc))
        self.assertEqual(index["images"], 24)
        self.assertEqual([o["instant"][11:16] for o in index["observations"]], ["12:00", "12:30"])
        # 14 h 30 : 13 h est close (marge de 25 min)
        index = derives.assembler_jour("leger", jour, journal=lambda *_: None,
                                       maintenant=datetime(2026, 11, 18, 14, 30, tzinfo=timezone.utc))
        self.assertEqual(index["images"], 48)
        self.assertEqual(len(index["observations"]), 4)

    def test_journee_a_jour_sans_segments_ni_reencodage(self):
        jour = date(2026, 11, 18)
        for minute in (0, 10, 20):
            self.original(datetime(2026, 11, 18, 12, minute, tzinfo=timezone.utc))
        index = derives.assembler_jour("leger", jour, journal=lambda *_: None)
        dossier = derives.dossier_video("leger", jour)
        for segment in dossier.glob("seg_*.mp4"):
            segment.unlink()                       # comme la purge après 36 h
        with mock.patch.object(derives, "encoder_segment", side_effect=AssertionError("réencodage inutile")):
            self.assertEqual(derives.assembler_jour("leger", jour, journal=lambda *_: None)["video"],
                             index["video"])

    def test_budget_epuise(self):
        jour = date(2026, 11, 18)
        for minute in (0, 10):
            self.original(datetime(2026, 11, 18, 12, minute, tzinfo=timezone.utc))
        with self.assertRaises(derives.EcheanceAtteinte):
            derives.assembler_jour("leger", jour, journal=lambda *_: None, echeance=0)
        self.assertFalse(list(derives.dossier_video("leger", jour).glob("*.mp4")))
        self.assertIsNotNone(derives.assembler_jour("leger", jour, journal=lambda *_: None))

    def test_un_seul_decodage_pour_trois_profils(self):
        from PIL import Image
        original = self.original(datetime(2026, 11, 18, 12, 0, tzinfo=timezone.utc))
        with mock.patch.object(Image, "open", wraps=Image.open) as ouvrir:
            self.assertEqual(derives.images_derivees(original, ["haute", "standard", "leger"]), 3)
        self.assertEqual(ouvrir.call_count, 1)
        self.assertEqual(derives.images_derivees(original, ["haute", "standard", "leger"]), 0)

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


# ---------------------------------------------------------------------------
# Mémoire de l'encodage, verrou noyau, budget, réglages d'encodage
# ---------------------------------------------------------------------------

def fondu_d_origine(a, b, part):
    """Formule de e7c47c0 / 750737b (référence)."""
    return (a.astype(np.float32) * (1 - part) + b.astype(np.float32) * part + 0.5).astype(np.uint8)


class FonduTests(TestCase):
    def test_identique_au_bit_pres(self):
        rng = np.random.default_rng(3)
        # Hauteur non multiple de la bande, valeurs extrêmes comprises
        a = rng.integers(0, 256, (derives.BANDE_FONDU * 2 + 61, 53, 3), dtype=np.uint8)
        b = rng.integers(0, 256, a.shape, dtype=np.uint8)
        a[0, 0] = 255
        b[0, 0] = 255
        a[1, 1] = 0
        b[1, 1] = 0
        sortie = np.empty_like(a)
        for part in (0.001, 0.125, 0.25, 1 / 3, 0.5, 0.75, 0.875, 0.999):
            np.testing.assert_array_equal(derives.fondre(a, b, part, sortie), fondu_d_origine(a, b, part))


@skipUnless(ffmpeg_present(), "FFmpeg introuvable")
class EncodageTests(AvecProfilsReduits, TestCase):
    def test_au_plus_deux_images_en_memoire_avec_fondus(self):
        jour = date(2026, 11, 18)
        for minute in (0, 10, 20, 30, 40, 50):
            self.original(datetime(2026, 11, 18, 12, minute, tzinfo=timezone.utc), 60 + 3 * minute)
        vivantes, pic = set(), [0]
        lire = derives.lire_image

        def lire_suivie(chemin):
            tableau = lire(chemin)
            cle = id(tableau)
            vivantes.add(cle)
            weakref.finalize(tableau, vivantes.discard, cle)
            pic[0] = max(pic[0], len(vivantes))
            return tableau

        with self.settings(HKO_FONDU_SATELLITE=True), mock.patch.object(derives, "lire_image", lire_suivie):
            plan = derives.plan_du_jour(jour)
            self.assertTrue(any(t > 0 for _, _, t in plan[0][1]))          # il y a bien des fondus
            derives.encoder_segment("leger", plan[0][1], derives.dossier_video("leger", jour) / "s.mp4")
        self.assertLessEqual(pic[0], 2)

    def test_flux_sans_images_b_et_decodable(self):
        jour = date(2026, 11, 18)
        for minute in (0, 10, 20):
            self.original(datetime(2026, 11, 18, 12, minute, tzinfo=timezone.utc))
        self.original(datetime(2026, 11, 18, 13, 5, tzinfo=timezone.utc))
        index = derives.assembler_jour("leger", jour, journal=lambda *_: None)
        video = derives.dossier_video("leger", jour) / index["video"]
        sonde = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0",
                                "-show_entries", "stream=has_b_frames,nb_frames", "-of", "csv=p=0", str(video)],
                               capture_output=True, text=True)
        if sonde.returncode == 0 and sonde.stdout.strip():
            images_b, nombre = sonde.stdout.strip().split(",")[:2]
            self.assertEqual(images_b, "0")
            self.assertEqual(int(nombre), 48)
        decodage = subprocess.run([derives.ffmpeg(), "-nostdin", "-v", "error", "-i", str(video), "-f", "null", "-"],
                                  capture_output=True, text=True)
        self.assertEqual(decodage.returncode, 0)
        self.assertEqual(decodage.stderr.strip(), "")

    def test_budget_anticipe(self):
        jour = date(2026, 11, 18)
        for minute in (0, 10):
            self.original(datetime(2026, 11, 18, 12, minute, tzinfo=timezone.utc))
        with mock.patch.dict(derives.DUREES_SEGMENT, {"leger": 1000.0}):
            with self.assertRaises(derives.EcheanceAtteinte):
                derives.assembler_jour("leger", jour, journal=lambda *_: None,
                                       echeance=time.monotonic() + 100)
        with mock.patch.dict(derives.DUREES_SEGMENT, {"leger": 0.01}):
            self.assertIsNotNone(derives.assembler_jour("leger", jour, journal=lambda *_: None,
                                                        echeance=time.monotonic() + 100))

    def test_signature_suit_les_reglages_d_encodage(self):
        jour = date(2026, 11, 18)
        for minute in (0, 10):
            self.original(datetime(2026, 11, 18, 12, minute, tzinfo=timezone.utc))
        images = derives.plan_du_jour(jour)[0][1]
        reference = derives.signature_segment("leger", images)
        self.assertEqual(derives.signature_segment("leger", images), reference)      # stable
        with mock.patch.object(derives, "X264_ANTICIPATION", 7):
            self.assertNotEqual(derives.signature_segment("leger", images), reference)
        with self.settings(HKO_VIDEO_PRESET="fast"):
            self.assertNotEqual(derives.signature_segment("leger", images), reference)

    def test_changement_de_reglage_reencode_toute_la_journee(self):
        # Une journée ne mélange jamais deux réglages d'encodage
        jour = date(2026, 11, 18)
        for minute in (0, 10):
            self.original(datetime(2026, 11, 18, 12, minute, tzinfo=timezone.utc))
        self.original(datetime(2026, 11, 18, 13, 0, tzinfo=timezone.utc))
        premier = derives.assembler_jour("leger", jour, journal=lambda *_: None)
        encodes = []
        reel = derives.encoder_segment
        with mock.patch.object(derives, "ENCODAGE_VERSION", 99), \
                mock.patch.object(derives, "encoder_segment",
                                  side_effect=lambda p, i, c: (encodes.append(c.name), reel(p, i, c))):
            second = derives.assembler_jour("leger", jour, journal=lambda *_: None)
        self.assertEqual(sorted(encodes), ["seg_20261118T12Z.mp4", "seg_20261118T13Z.mp4"])
        self.assertNotEqual(premier["video"], second["video"])


@skipUnless(hasattr(os, "fork"), "fork indisponible (Windows)")
class VerrouNoyauTests(DossierTemporaire, TestCase):
    def test_libere_apres_sigkill(self):
        from meteo_app.sources.commun import DejaEnCours
        from meteo_app.sources.verrous import verrou_noyau

        lecture, ecriture = os.pipe()
        enfant = os.fork()
        if enfant == 0:                       # processus qui garde le verrou
            try:
                with verrou_noyau("essai"):
                    os.write(ecriture, b"1")
                    time.sleep(60)
            finally:
                os._exit(0)
        os.read(lecture, 1)
        with self.assertRaises(DejaEnCours):
            with verrou_noyau("essai"):
                pass
        os.kill(enfant, signal.SIGKILL)       # comme un oom-kill
        os.waitpid(enfant, 0)
        with verrou_noyau("essai"):           # repris immédiatement, sans attendre une heure
            pass

    def test_deux_passages_successifs(self):
        from meteo_app.sources.verrous import verrou_noyau
        for _ in range(2):
            with verrou_noyau("essai"):
                pass


class PurgeListesTests(DossierTemporaire, TestCase):
    def test_listes_abandonnees_effacees(self):
        dossier = derives.dossier_video("leger", date(2026, 11, 18))
        liste = dossier / ".liste_abc.txt"
        liste.write_text("file 'x'\n")
        ancien = time.time() - 7200
        os.utime(liste, (ancien, ancien))
        recente = dossier / ".liste_def.txt"
        recente.write_text("file 'y'\n")
        with mock.patch.object(derives, "conservation", return_value=timedelta(days=3650)):
            derives.purger()
        self.assertFalse(liste.exists())
        self.assertTrue(recente.exists())     # peut-être en cours d'utilisation


class JournalMemoireTests(TestCase):
    def test_memoire_maximale(self):
        from meteo_app.management.commands.hko_derives import memoire_maximale
        texte = memoire_maximale()
        if sys.platform != "win32":
            self.assertRegex(texte, r"^mémoire max : Python \d+ Mo, FFmpeg \d+ Mo$")
