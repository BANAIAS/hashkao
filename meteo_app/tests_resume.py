"""
Tests du « Résumé du jour » : règles du récit, partition produite depuis la
base, API et service des fichiers.

    python manage.py test meteo_app.tests_resume

La journée d'essai est synthétique (120 stations, 6 min) : le calcul
complet reste rapide.
"""

import json
import math
from datetime import date, datetime, timedelta, timezone

import numpy as np
from django.test import Client, TestCase

from meteo_app.sources import derives, resume
from meteo_app.tests import DossierTemporaire


def indicateurs(**valeurs):
    base = {"tx_mediane": 13, "tn_mediane": 8, "part_stations_pluie": 0.2, "part_pluie": 0.05,
            "rafales_80": 0, "rafales_100": 0, "part_orage": 0, "part_neige": 0,
            "part_brouillard": 0, "part_soleil": 0.3, "part_couvert": 0.3}
    base.update(valeurs)
    return base


class TitreTests(TestCase):
    def test_pluie_et_vent(self):
        self.assertEqual(resume.titre_du_jour(indicateurs(part_stations_pluie=0.94, rafales_80=59)), "Pluie et vent")

    def test_tempete_avant_tout(self):
        self.assertEqual(resume.titre_du_jour(indicateurs(rafales_100=20, part_stations_pluie=0.9)), "Tempête")

    def test_journee_calme(self):
        self.assertEqual(resume.titre_du_jour(indicateurs(part_soleil=0.7)), "Grand soleil")
        self.assertEqual(resume.titre_du_jour(indicateurs(tn_mediane=-1)), "Gelées")
        self.assertEqual(resume.titre_du_jour(indicateurs(part_couvert=0.6)), "Ciel gris")
        self.assertEqual(resume.titre_du_jour(indicateurs()), "Ciel changeant")

    def test_regions(self):
        self.assertEqual(resume.region(9.2, 42.2), "en Corse")
        self.assertEqual(resume.region(2.4, 42.6), "dans les Pyrénées")
        self.assertEqual(resume.region(2.35, 48.86), "dans le centre du pays")
        self.assertEqual(resume.region(3.06, 50.63), "dans le Nord")

    def test_nombres_a_la_francaise(self):
        self.assertEqual(resume.fr(22.84, 1), "22,8")
        self.assertEqual(resume.fr(-3.2, 1), "−3,2")


class ProductionTests(DossierTemporaire, TestCase):
    JOUR = date(2026, 11, 19)

    def semer(self, n=120):
        from meteo_app.models import ObservationMeteo, StationMeteo

        debut, fin = derives.bornes_jour(self.JOUR)
        stations = []
        for i in range(n):
            lat = 42.5 + (i % 12) * 0.7
            lon = -3.5 + (i // 12) * 1.2
            stations.append(StationMeteo(identifiant=f"9{i:07d}", nom=f"STATION {i}", commune=f"Commune {i}",
                                         latitude=lat, longitude=lon, altitude=50 + (i % 5) * 40))
        StationMeteo.objects.bulk_create(stations)
        stations = list(StationMeteo.objects.all())
        lot = []
        pas = 0
        instant = debut
        while instant < fin:
            h = pas / 10
            for s in stations:
                t = 9 + 5 * math.sin(math.pi * max(0, h - 7) / 16) - (s.latitude - 46) * 0.4
                lot.append(ObservationMeteo(station=s, date=instant, temperature=round(t, 1),
                                            precipitation=0.2 if s.longitude < 0 and 8 < h < 12 else 0.0,
                                            rafale_vent=12.0 + (3 if s.identifiant == "90000007" else 0),
                                            vitesse_vent=5.0, direction_vent=240.0))
            instant += timedelta(minutes=6)
            pas += 1
        ObservationMeteo.objects.bulk_create(lot, batch_size=5000)

    def test_partition_depuis_la_base(self):
        self.semer()
        chemin = resume.produire(self.JOUR)
        self.assertTrue(chemin.is_file())
        p = json.loads(chemin.read_text())
        self.assertEqual(p["version"], resume.VERSION)
        self.assertEqual(p["jour"], "2026-11-19")
        self.assertEqual(p["date_longue"], "jeudi 19 novembre")
        self.assertEqual(p["heures"], 24)
        self.assertEqual(len(p["puces"]), 2)
        self.assertEqual(len(p["synthese"]["phrases"]), 2)
        self.assertEqual(len(p["synthese"]["chiffres"]), 1)
        self.assertIsNone(p["radar"])                     # pas d'OPERA archivé
        self.assertEqual(len(p["temperatures"]["heures"]), 24)
        tx = next(e for e in p["evenements"] if e["type"] == "tx")
        self.assertGreater(tx["valeur"], 10)
        # Déjà faite : sautée ; forcée : refaite
        self.assertIsNone(resume.produire(self.JOUR))
        self.assertIsNotNone(resume.produire(self.JOUR, forcer=True))

    def test_journee_vide_refusee(self):
        with self.assertRaises(resume.DonneesInsuffisantes):
            resume.construire(self.JOUR)

    def test_valeur_aberrante_ecartee(self):
        from meteo_app.models import ObservationMeteo

        self.semer()
        debut, _ = derives.bornes_jour(self.JOUR)
        ObservationMeteo.objects.filter(station__identifiant="90000003",
                                        date__gte=debut + timedelta(hours=6),
                                        date__lt=debut + timedelta(hours=7)).update(temperature=-36)
        p = resume.construire(self.JOUR)
        tn = next(e for e in p["evenements"] if e["type"] == "tn")
        self.assertGreater(tn["valeur"], -10)

    def test_journees_a_produire(self):
        maintenant = datetime(2026, 11, 22, 2, 0, tzinfo=timezone.utc)
        jours = resume.jours_a_produire(maintenant)
        self.assertEqual(jours[0], date(2026, 11, 21))      # close depuis 1 h + marge
        self.assertNotIn(date(2026, 11, 22), jours)
        tot = datetime(2026, 11, 21, 23, 30, tzinfo=timezone.utc)   # 0 h 30 à Paris
        self.assertNotIn(date(2026, 11, 21), resume.jours_a_produire(tot))


class ApiTests(DossierTemporaire, TestCase):
    def test_jour_en_cours_et_absent(self):
        c = Client()
        aujourdhui = derives.jour_local(datetime.now(timezone.utc))
        r = c.get("/meteo/api/resume/", {"jour": aujourdhui.isoformat()})
        self.assertEqual(r.status_code, 404)
        r = c.get("/meteo/api/resume/", {"jour": (aujourdhui - timedelta(days=3)).isoformat()})
        self.assertEqual(r.status_code, 404)
        self.assertIn("erreur", json.loads(r.content))

    def test_partition_servie(self):
        c = Client()
        jour = derives.jour_local(datetime.now(timezone.utc)) - timedelta(days=2)
        chemin = resume.chemin_partition(jour)
        chemin.parent.mkdir(parents=True, exist_ok=True)
        chemin.write_text('{"titre": "Essai"}')
        r = c.get("/meteo/api/resume/", {"jour": jour.isoformat()})
        self.assertEqual(r.status_code, 200)
        info = json.loads(r.content)
        self.assertIn(f"resume/{jour.isoformat()}.json?v=", info["url"])
        f = c.get(info["url"])
        self.assertEqual(f.status_code, 200)
        self.assertEqual(f["Content-Type"], "application/json")
        self.assertEqual(json.loads(b"".join(f.streaming_content)), {"titre": "Essai"})

    def test_chemins_refuses(self):
        c = Client()
        self.assertEqual(c.get("/meteo/donnees/derives/resume/../x.json").status_code, 404)
        self.assertEqual(c.get("/meteo/donnees/derives/resume/2026-11-19.txt").status_code, 404)
