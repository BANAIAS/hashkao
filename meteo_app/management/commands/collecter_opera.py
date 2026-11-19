"""
Collecte automatique du radar européen EUMETNET OPERA.

    python manage.py collecter_opera
    python manage.py collecter_opera --heures 6

Source : MeteoGate, mosaïques RATE ODIM HDF5.
"""

import json
import re

from datetime import datetime, timedelta, timezone

from meteo_app.models import ProduitMeteo

from django.core.management.base import BaseCommand, CommandError

from meteo_app import radar

from meteo_app.sources import opera, stockage

from meteo_app.sources.commun import (
    DejaEnCours,
    dossier,
    dossier_publication,
    empreinte,
    journal,
    maintenant,
    requete,
    telecharger_vers,
    verrou,
)






API = (
    "https://api.meteogate.eu/"
    "eu-eumetnet-weather-radar/collections/"
    "observations/locations/0-20010-0-OPERA"
)

MOTIF_URL = re.compile(
    r"https://object-store\.os-api\.cci1\.ecmwf\.int/"
    r"[^\"\s]+\.h5"
)

MOTIF_NOM = re.compile(
    r"OPERA@(\d{8}T\d{4})@0@RATE\.h5"
)


class Command(BaseCommand):

    help = "Collecte et archive les observations radar OPERA."

    def add_arguments(self, parser):
        parser.add_argument(
            "--heures",
            type=int,
            default=6,
            help="Nombre d'heures recherchees dans le catalogue.",
        )

    def handle(self, *args, **options):

        heures = options["heures"]

        if not 1 <= heures <= 24:
            raise CommandError("--heures doit etre compris entre 1 et 24.")

        try:
            with verrou("opera", duree_max_secondes=1800):
                with journal("opera", self.stdout) as j:

                    nouveaux = self.collecter(heures)
                    self.publier_image()

                    if nouveaux:
                        j.succes(
                            f"{nouveaux} nouvelles observations.",
                            produits=nouveaux,
                        )
                    else:
                        j.rien_de_neuf(
                            "Aucune nouvelle observation."
                        )

        except DejaEnCours as erreur:
            self.stdout.write(str(erreur))

    def collecter(self, heures):

        fin = maintenant()
        debut = fin - timedelta(hours=heures)

        params = {
            "datetime": (
                debut.strftime("%Y-%m-%dT%H:%MZ")
                + "/"
                + fin.strftime("%Y-%m-%dT%H:%MZ")
            ),
            "f": "CoverageJSON",
            "standard_name": "RATE",
            "format": "ODIM",
        }

        self.stdout.write("Interrogation du catalogue OPERA...")

        with requete(API, params=params) as reponse:
            urls = sorted(set(MOTIF_URL.findall(reponse.text)))

        if not urls:
            raise CommandError("Aucun fichier OPERA dans le catalogue.")

        self.stdout.write(f"{len(urls)} fichiers disponibles.")

        nouveaux = 0

        for url in urls:

            nom = url.rsplit("/", 1)[-1]
            correspondance = MOTIF_NOM.fullmatch(nom)

            if not correspondance:
                continue

            instant = datetime.strptime(
                correspondance.group(1),
                "%Y%m%dT%H%M",
            ).replace(tzinfo=timezone.utc)

            if stockage.existe("opera", instant):
                continue

            chemin = dossier("brut", "opera") / nom

            self.stdout.write(f"Collecte : {nom}")

            if not chemin.exists():
                telecharger_vers(url, chemin)

            try:
                m = radar.lire_mosaique(chemin)

                if m["instant"] != instant:
                    raise ValueError("Date HDF5 incoherente.")

                if m["quantite"] != "RATE":
                    raise ValueError("Produit RATE attendu.")

                champs = opera.sur_grille(m)

                stockage.enregistrer_grille(
                    source="opera",
                    nature="observation",
                    instant=instant,
                    champs=champs,
                    empreinte=empreinte(chemin),
                    qualite={
                        "couverture": round(
                            float(champs["couverture"].mean()), 4
                        ),
                        "fichier": nom,
                    },
                )

            except Exception:
                chemin.unlink(missing_ok=True)
                raise

            nouveaux += 1

            self.stdout.write(
                f"  Archivee : {instant:%H:%M} UTC"
            )

        return nouveaux

    def publier_image(self):

        dernier = ProduitMeteo.objects.filter(
            source="opera",
            nature="observation",
        ).order_by("-instant").first()

        if dernier is None:
            return

        publication = dossier_publication("opera")
        description = publication / "radar.json"

        instant = dernier.instant.astimezone(timezone.utc)
        nom_base = f"radar_{instant:%Y%m%dT%H%MZ}"

        # Ne pas recalculer une image déjà publiée.
        if description.exists():
            try:
                meta = json.loads(
                    description.read_text(encoding="utf-8")
                )

                if (
                    meta.get("image") == f"{nom_base}.png"
                    and (publication / f"{nom_base}.png").exists()
                    and (
                        publication / f"{nom_base}_couverture.png"
                    ).exists()
                ):
                    return

            except (OSError, ValueError):
                pass

        nom = f"OPERA@{instant:%Y%m%dT%H%M}@0@RATE.h5"
        chemin = dossier("brut", "opera") / nom

        if not chemin.exists():
            self.stdout.write(
                "Image de secours : fichier brut indisponible."
            )
            return

        m = radar.lire_mosaique(chemin)

        radar.convertir(
            chemin,
            dossier_sortie=publication,
            largeur_image=2000,
            afficher=lambda *t: None,
            nom_base=nom_base,
            mosaique=m,
        )

        self.stdout.write(
            f"Image OPERA publiee : {nom_base}.png"
        )

        # Conservation des trois dernières images.
        images = sorted(
            p for p in publication.glob("radar_*.png")
            if not p.name.endswith("_couverture.png")
        )

        for ancienne in images[:-3]:
            couverture = publication / (
                ancienne.stem + "_couverture.png"
            )
            ancienne.unlink(missing_ok=True)
            couverture.unlink(missing_ok=True)
