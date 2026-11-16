
import csv
import os
from io import StringIO

import requests
from django.core.management.base import BaseCommand, CommandError

from meteo_app.models import StationMeteo


class Command(BaseCommand):
    help = "Importer les stations météo depuis Météo-France"

    def handle(self, *args, **options):
        from pathlib import Path

        cle = os.environ.get("METEO_FRANCE_PACKAGE_API_KEY")

        if not cle:
            fichier_env = Path.cwd() / ".env"

            if fichier_env.exists():
                for ligne in fichier_env.read_text(
                    encoding="utf-8-sig"
                ).splitlines():
                    if ligne.strip().startswith("METEO_FRANCE_PACKAGE_API_KEY="):
                        cle = ligne.split("=", 1)[1].strip().strip('"').strip("'")
                        break

        if not cle:
            raise CommandError(
                "METEO_FRANCE_PACKAGE_API_KEY absente de l'environnement."
            )

        url = (
            "https://public-api.meteofrance.fr"
            "/public/DPPaquetObs/v2/liste-stations"
        )

        self.stdout.write("Téléchargement des stations Météo-France...")

        try:
            reponse = requests.get(
                url,
                headers={"apikey": cle},
                timeout=60,
            )
            reponse.raise_for_status()
        except requests.RequestException as erreur:
            raise CommandError(str(erreur)) from erreur

        reponse.encoding = "ISO-8859-1"

        stations = csv.DictReader(
            StringIO(reponse.text),
            delimiter=";",
        )

        creees = 0
        mises_a_jour = 0

        for station in stations:
            identifiant = station["Id_station"].strip()

            if not identifiant:
                continue

            _, creation = StationMeteo.objects.update_or_create(
                identifiant=identifiant,
                defaults={
                    "nom": station["Nom_usuel"],
                    "latitude": float(station["Latitude"]),
                    "longitude": float(station["Longitude"]),
                    "altitude": (
                        float(station["Altitude"])
                        if station["Altitude"]
                        else None
                    ),
                },
            )

            if creation:
                creees += 1
            else:
                mises_a_jour += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Import terminé : {creees} stations créées, "
                f"{mises_a_jour} mises à jour."
            )
        )
