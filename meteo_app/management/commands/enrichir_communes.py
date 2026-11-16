import time

import requests
from django.core.management.base import BaseCommand

from meteo_app.models import StationMeteo


class Command(BaseCommand):
    help = "Retrouver la commune des stations météo"

    def add_arguments(self, parser):
        parser.add_argument("--limite", type=int, default=20)

    def handle(self, *args, **options):
        stations = StationMeteo.objects.filter(
            commune__isnull=True
        ).order_by("identifiant")[:options["limite"]]

        session = requests.Session()

        for station in stations:
            try:
                reponse = session.get(
                    "https://geo.api.gouv.fr/communes",
                    params={
                        "lat": station.latitude,
                        "lon": station.longitude,
                        "fields": "nom,code",
                        "format": "json",
                    },
                    timeout=15,
                )
                reponse.raise_for_status()

                communes = reponse.json()

                if communes:
                    station.commune = communes[0]["nom"]
                    station.code_insee = communes[0]["code"]
                    station.save(
                        update_fields=["commune", "code_insee"]
                    )

                    self.stdout.write(
                        f"{station.nom} → {station.commune}"
                    )
                else:
                    self.stdout.write(
                        f"Aucune commune : {station.nom}"
                    )

            except (requests.RequestException, ValueError, KeyError) as erreur:
                self.stderr.write(
                    f"Erreur pour {station.nom} : {erreur}"
                )

            time.sleep(0.3)

        self.stdout.write("Lot terminé.")