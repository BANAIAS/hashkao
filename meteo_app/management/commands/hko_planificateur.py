"""
Planificateur simple de HKO Météo, pour les essais en local (Windows).

    python manage.py hko_planificateur              tourne jusqu'à Ctrl+C
    python manage.py hko_planificateur --une-fois   lance ce qui est dû, puis s'arrête
    python manage.py hko_planificateur --sans stations,arome

Sur le serveur, préférer les minuteurs systemd fournis dans
meteo_app/deploiement/systemd/ : chaque collecte y est indépendante,
redémarrée par le système et journalisée.

Cadences (minutes après l'heure) choisies pour laisser aux fournisseurs
le temps de publier :

    stations    toutes les 6 min, à 2 min du créneau   (02, 08, 14…)
    radar       toutes les 5 min                       (03, 08, 13…)
                le paquet ne change que toutes les 15 min ; les appels
                intermédiaires ne téléchargent qu'un doublon vite écarté
    satellite   toutes les 10 min                      (06, 16, 26…)
    arome       toutes les 30 min (un nouveau cycle toutes les 3 h)
    purge       une fois par jour, à 3 h 40 (heure de Paris)
    état        toutes les 15 min (affiche les sources en retard)
"""

import time
import traceback
from datetime import datetime
from zoneinfo import ZoneInfo

from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError

PARIS = ZoneInfo("Europe/Paris")

TACHES = [
    # (nom, commande, arguments, période en minutes, décalage en minutes)
    ("stations", "collecter_observations", [], 6, 2),
    ("radar", "collecter_radar", [], 5, 3),
    ("opera", "collecter_opera", [], 5, 4),
    ("satellite", "collecter_satellite", [], 10, 6),
    ("arome", "collecter_arome", [], 30, 20),
    ("etat", "etat_hko", [], 15, 11),
]


class Command(BaseCommand):
    help = "Lance les collectes HKO Météo à leur rythme (usage local)."

    def add_arguments(self, parser):
        parser.add_argument("--une-fois", action="store_true", help="Lancer toutes les tâches une fois, puis s'arrêter.")
        parser.add_argument("--sans", default="", help="Tâches à ignorer, séparées par des virgules.")

    def lancer(self, nom, commande, arguments):
        debut = time.monotonic()
        self.stdout.write(f"\n{datetime.now(PARIS):%H:%M:%S} — {nom}")
        try:
            call_command(commande, *arguments, stdout=self.stdout, stderr=self.stderr)
        except CommandError as erreur:
            self.stderr.write(f"  {nom} : {erreur}")
        except Exception:
            self.stderr.write(f"  {nom} : erreur inattendue\n{traceback.format_exc()}")
        self.stdout.write(f"  ({time.monotonic() - debut:.0f} s)")

    def handle(self, *args, **options):
        exclues = {n.strip() for n in options["sans"].split(",") if n.strip()}
        taches = [t for t in TACHES if t[0] not in exclues]

        if options["une_fois"]:
            for nom, commande, arguments, *_ in taches:
                self.lancer(nom, commande, arguments)
            return

        self.stdout.write("Planificateur HKO Météo — Ctrl+C pour arrêter.")
        derniers = {}
        purge_faite = None

        try:
            while True:
                locale = datetime.now(PARIS)
                minute_du_jour = locale.hour * 60 + locale.minute

                for nom, commande, arguments, periode, decalage in taches:
                    if (minute_du_jour - decalage) % periode == 0 and derniers.get(nom) != minute_du_jour:
                        derniers[nom] = minute_du_jour
                        self.lancer(nom, commande, arguments)

                if "purge" not in exclues and locale.hour == 3 and locale.minute >= 40 and purge_faite != locale.date():
                    purge_faite = locale.date()
                    self.lancer("purge", "purger_hko", [])

                time.sleep(20)
        except KeyboardInterrupt:
            self.stdout.write("\nArrêt du planificateur.")
