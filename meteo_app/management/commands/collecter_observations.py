
import csv
import os
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path

import requests
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from meteo_app.models import StationMeteo, ObservationMeteo


def lire_cle_api():
    cle = os.environ.get("METEO_FRANCE_PACKAGE_API_KEY")

    if cle:
        return cle

    fichier = Path.cwd() / ".env"

    if fichier.exists():
        for ligne in fichier.read_text(encoding="utf-8-sig").splitlines():
            if ligne.strip().startswith("METEO_FRANCE_PACKAGE_API_KEY="):
                return ligne.split("=", 1)[1].strip().strip('"').strip("'")

    raise CommandError("Clé API Météo-France introuvable.")


def nombre(valeur):
    if valeur is None or valeur.strip() == "":
        return None
    return float(valeur)


def temperature(valeur):
    valeur = nombre(valeur)
    return round(valeur - 273.15, 2) if valeur is not None else None


def pression_hpa(valeur):
    valeur = nombre(valeur)
    return round(valeur / 100, 2) if valeur is not None else None


class Command(BaseCommand):
    help = "Collecter les observations nationales Météo-France"


    def add_arguments(self, parser):
        parser.add_argument(
            "--date",
            type=str,
            default=None,
            help="Date UTC au format AAAA-MM-JJTHH:MM:SSZ"
        )


    def handle(self, *args, **options):
        cle = lire_cle_api()


        if options["date"]:
            try:
                date_collecte = datetime.strptime(
                    options["date"],
                    "%Y-%m-%dT%H:%M:%SZ"
                ).replace(tzinfo=timezone.utc)

            except ValueError:
                raise CommandError(
                    "Format attendu : AAAA-MM-JJTHH:MM:SSZ"
                )

            if date_collecte.minute % 6 != 0:
                raise CommandError(
                    "La minute doit être un multiple de 6."
                )

        else:
            from datetime import timedelta

            maintenant = datetime.now(timezone.utc)
            minute = (maintenant.minute // 6) * 6

            date_collecte = maintenant.replace(
                minute=minute,
                second=0,
                microsecond=0
            ) - timedelta(minutes=6)

        date_api = date_collecte.strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        )


        self.stdout.write(f"Collecte nationale : {date_api}")

        url = (
            "https://public-api.meteofrance.fr"
            "/public/DPPaquetObs/v2/paquet/stations/infrahoraire-6m"
        )

        try:
            reponse = requests.get(
                url,
                headers={"apikey": cle},
                params={"date": date_api, "format": "csv"},
                timeout=90
            )
            reponse.raise_for_status()

        except requests.RequestException as erreur:
            if erreur.response is not None:
                self.stderr.write(
                    "Réponse Météo-France : "
                    + erreur.response.text[:2000]
                )
            raise CommandError(str(erreur)) from erreur


        reponse.encoding = "utf-8-sig"

        observations = csv.DictReader(
            StringIO(reponse.text),
            delimiter=";"
        )

        stations = {
            station.identifiant: station
            for station in StationMeteo.objects.all()
        }

        creees = 0
        ignorees = 0

        with transaction.atomic():
            for ligne in observations:
                identifiant = ligne.get("geo_id_insee")
                station = stations.get(identifiant)

                if not station:
                    ignorees += 1
                    continue

                date_mesure = datetime.fromisoformat(
                    ligne["validity_time"].replace("Z", "+00:00")
                )

                _, creation = ObservationMeteo.objects.get_or_create(
                    station=station,
                    date=date_mesure,
                    defaults={
                        "temperature": temperature(ligne.get("t")),
                        "point_rosee": temperature(ligne.get("td")),
                        "humidite": nombre(ligne.get("u")),
                        "direction_vent": nombre(ligne.get("dd")),
                        "vitesse_vent": nombre(ligne.get("ff")),
                        "rafale_vent": nombre(ligne.get("raf10")),
                        "precipitation": nombre(ligne.get("rr_per")),
                        "pression": pression_hpa(ligne.get("pres")),
                    }
                )

                if creation:
                    creees += 1
                else:
                    ignorees += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Collecte terminée : {creees} observations créées, "
                f"{ignorees} ignorées."
            )
        )
