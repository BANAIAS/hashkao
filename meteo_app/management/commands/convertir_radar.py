"""
Convertit une mosaïque radar Météo-France (fichier .h5 déjà téléchargé)
en image Mercator pour la carte HKO Météo.

    python manage.py convertir_radar meteo_app\data\T_IPRN20_C_LFPW_20261116201000.h5

Écrit radar.png et radar.json dans meteo_app/static/meteo_app/radar/.
Cette commande ne télécharge rien et n'utilise pas la clé API.
"""

from pathlib import Path

from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = (
        "Convertit une mosaïque radar ODIM_H5 en image Mercator "
        "(radar.png + radar.json) pour la carte HKO Météo."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "fichier_h5",
            help="Chemin du fichier .h5 extrait du paquet radar.",
        )
        parser.add_argument(
            "--sortie",
            default=None,
            help=(
                "Dossier de sortie "
                "(défaut : meteo_app/static/meteo_app/radar)."
            ),
        )
        parser.add_argument(
            "--largeur",
            type=int,
            default=2000,
            help="Largeur de l'image en pixels (défaut : 2000).",
        )

    def handle(self, *args, **options):
        chemin = Path(options["fichier_h5"])

        if not chemin.is_file():
            raise CommandError(f"Fichier introuvable : {chemin}")

        if not 200 <= options["largeur"] <= 6000:
            raise CommandError(
                "La largeur doit être comprise entre 200 et 6000 pixels."
            )

        try:
            # Import tardif : h5py, pyproj et Pillow ne sont nécessaires
            # que pour cette commande, pas pour le site.
            from meteo_app.radar import ErreurRadar, convertir
        except ImportError as erreur:
            raise CommandError(
                "Bibliothèque manquante pour le radar "
                f"(h5py, numpy, Pillow, pyproj) : {erreur}"
            )

        try:
            meta = convertir(
                chemin,
                dossier_sortie=options["sortie"],
                largeur_image=options["largeur"],
                afficher=lambda *morceaux: self.stdout.write(
                    " ".join(str(m) for m in morceaux)
                ),
            )
        except (ErreurRadar, OSError, KeyError) as erreur:
            raise CommandError(f"Conversion impossible : {erreur}")

        self.stdout.write(self.style.SUCCESS(
            f"Radar converti — données du {meta['date_utc']} (UTC)."
        ))
