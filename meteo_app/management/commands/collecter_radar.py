"""
Collecte des mosaïques radar Météo-France.

    python manage.py collecter_radar
    python manage.py collecter_radar --fichier chemin\\paquet.tar.gz
    python manage.py collecter_radar --fichier chemin\\T_IPRN20_C_LFPW_20261117145500.h5

API : DPPaquetRadar v1, /mosaique/paquet (clé METEO_FRANCE_RADAR_API_KEY,
en-tête « apikey »). Le paquet regroupe les produits du dernier quart
d'heure (3 échéances de 5 minutes) ; il est publié toutes les 15 minutes
et conservé 20 heures par Météo-France. Le fichier reçu est une archive
TAR.GZ (vérifié sur votre poste) ; une archive ZIP est aussi acceptée.

Pour chaque mosaïque T_IPRN20 (cumul 5 min, France métropolitaine) :
1. ignorée si déjà traitée (même heure ou même contenu) ;
2. lue et contrôlée (coins, orientation, quantité ACRR) ;
3. ramenée sur la grille commune et archivée ;
4. la plus récente est publiée pour le tableau « Précipitations ».
Puis la fusion des conditions est relancée.
"""

import re
import tarfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError

from meteo_app.sources.commun import (
    CleManquante, DejaEnCours, ErreurSource, dossier, dossier_publication,
    empreinte, journal, lire_cle, maintenant, nettoyer_versions,
    telecharger_vers, verrou,
)

URL = "https://public-api.meteofrance.fr/public/DPPaquetRadar/v1/mosaique/paquet"
MOTIF = re.compile(r"T_IPRN20_C_LFPW_(\d{14})\.h5$")

# Au-delà, l'image publiée est déclarée ancienne (sans être supprimée)
AGE_ALERTE_MINUTES = 45


def instant_du_nom(nom):
    trouve = MOTIF.search(nom)
    if not trouve:
        return None
    return datetime.strptime(trouve.group(1), "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)


def extraire_mosaiques(paquet, cible):
    """Extrait les fichiers T_IPRN20 d'un paquet TAR.GZ ou ZIP."""
    paquet = Path(paquet)
    with open(paquet, "rb") as f:
        signature = f.read(4)

    extraits = []

    if signature[:2] == b"\x1f\x8b" or tarfile.is_tarfile(paquet):
        with tarfile.open(paquet, "r:*") as archive:
            for membre in archive.getmembers():
                nom = Path(membre.name).name
                if membre.isfile() and MOTIF.search(nom):
                    source = archive.extractfile(membre)
                    destination = Path(cible) / nom
                    destination.write_bytes(source.read())
                    extraits.append(destination)
    elif signature[:2] == b"PK":
        with zipfile.ZipFile(paquet) as archive:
            for nom_complet in archive.namelist():
                nom = Path(nom_complet).name
                if MOTIF.search(nom):
                    destination = Path(cible) / nom
                    destination.write_bytes(archive.read(nom_complet))
                    extraits.append(destination)
    else:
        raise CommandError(
            f"Format de paquet inattendu (signature {signature!r}) : ni TAR.GZ, ni ZIP."
        )

    return sorted(extraits, key=lambda p: p.name)


class Command(BaseCommand):
    help = "Télécharge et traite les dernières mosaïques radar Météo-France."

    def add_arguments(self, parser):
        parser.add_argument("--fichier", help="Paquet (.tar.gz, .zip) ou mosaïque (.h5) déjà téléchargé.")
        parser.add_argument("--sans-fusion", action="store_true", help="Ne pas relancer la fusion.")
        parser.add_argument("--largeur-image", type=int, default=2000)

    def handle(self, *args, **options):
        try:
            with verrou("radar", duree_max_secondes=600):
                with journal("radar", self.stdout) as suivi:
                    self.collecter(options, suivi)
        except DejaEnCours as erreur:
            self.stdout.write(str(erreur))
            return
        except (CleManquante, ErreurSource) as erreur:
            raise CommandError(str(erreur))

        if not options["sans_fusion"] and getattr(self, "nouveautes", 0):
            call_command("fusionner_conditions", stdout=self.stdout, stderr=self.stderr)

    def collecter(self, options, suivi):
        from meteo_app import radar
        from meteo_app.sources import stockage

        self.nouveautes = 0
        brut = dossier("brut", "radar")

        # 1. Obtenir les mosaïques
        if options["fichier"]:
            chemin = Path(options["fichier"])
            if not chemin.is_file():
                raise CommandError(f"Fichier introuvable : {chemin}")
            mosaiques = [chemin] if chemin.suffix == ".h5" else extraire_mosaiques(chemin, brut)
            paquet = None
        else:
            cle = lire_cle("METEO_FRANCE_RADAR_API_KEY")
            paquet = brut / f"paquet_{maintenant():%Y%m%dT%H%M%S}.bin"
            telecharger_vers(URL, paquet, headers={"apikey": cle, "accept": "*/*"}, timeout=120)
            mosaiques = extraire_mosaiques(paquet, brut)

        if not mosaiques:
            suivi.echec("Aucune mosaïque T_IPRN20 dans le paquet.")
            raise CommandError("Aucune mosaïque T_IPRN20 dans le paquet.")

        # 2. Traiter chaque mosaïque nouvelle, de la plus ancienne à la plus récente
        traitees, ignorees, rejetees = [], [], []
        derniere = None

        for chemin in mosaiques:
            instant = instant_du_nom(chemin.name)
            signature = empreinte(chemin)

            if (instant and stockage.existe("radar", instant)) or stockage.deja_vu("radar", signature):
                ignorees.append(chemin.name)
                continue

            try:
                m = radar.lire_mosaique(chemin)
            except Exception as erreur:  # fichier corrompu : on continue avec les autres
                rejetees.append(f"{chemin.name} : {erreur}")
                continue

            if m["quantite"] != "ACRR":
                rejetees.append(f"{chemin.name} : quantité {m['quantite']} inattendue")
                continue
            if m["ecart_coins_max"] > max(m["pas_x"], m["pas_y"]):
                rejetees.append(f"{chemin.name} : coins décalés de {m['ecart_coins_max']:.0f} m")
                continue

            instant = m["instant"]
            champs = radar.sur_grille(m)

            from meteo_app.sources import grille
            france = grille.masques()["france"] >= 0.5

            stockage.enregistrer_grille(
                "radar", "observation", instant, champs,
                debut_periode=m["debut"], empreinte=signature,
                qualite={
                    "radars_absents": m["radars_absents"],
                    "radars": len(m["radars"]),
                    "ecart_coins_m": round(m["ecart_coins_max"], 1),
                    "couverture_france": round(float(champs["couverture"][france].mean()), 3),
                    "fichier": chemin.name,
                },
            )
            traitees.append(chemin.name)
            if derniere is None or instant > derniere[0]:
                derniere = (instant, chemin, m)

        # 3. Publier la plus récente pour le tableau « Précipitations »
        if derniere:
            instant, chemin, m = derniere
            publication = dossier_publication("radar")

            from meteo_app.models import ProduitMeteo
            plus_recent = ProduitMeteo.objects.filter(source="radar", nature="observation").order_by("-instant").first()

            if plus_recent is None or plus_recent.instant <= instant:
                radar.convertir(
                    chemin, publication, options["largeur_image"],
                    afficher=lambda *t: None, nom_base=f"radar_{instant:%Y%m%dT%H%MZ}",
                    mosaique=m,
                )
                nettoyer_versions(publication, "radar_*Z.png", garder=3)
                nettoyer_versions(publication, "radar_*Z_couverture.png", garder=3)

        # 4. Ménage immédiat : le paquet ; les .h5 restent jusqu'à la purge
        if paquet is not None:
            paquet.unlink(missing_ok=True)

        self.nouveautes = len(traitees)

        details = {"traitees": traitees, "ignorees": ignorees, "rejetees": rejetees}

        if traitees:
            age = (maintenant() - derniere[0]).total_seconds() / 60
            message = f"{len(traitees)} mosaïque(s) traitée(s), la plus récente de {derniere[0]:%H:%M} UTC"
            if age > AGE_ALERTE_MINUTES:
                message += f" (déjà ancienne de {age:.0f} min)"
            suivi.succes(message, **details)
        elif rejetees:
            suivi.echec(f"{len(rejetees)} mosaïque(s) rejetée(s).", **details)
        else:
            suivi.rien_de_neuf("Aucune nouvelle mosaïque.", **details)
