"""
Collecte du masque nuageux Meteosat Third Generation (EUMETSAT).

    python manage.py collecter_satellite
    python manage.py collecter_satellite --fichier chemin\\W_XX-EUMETSAT-…CLM….zip
    python manage.py collecter_satellite --rattrapage 6

Produit : EO:EUM:DAT:0678 (FCI Cloud Mask, disque complet, toutes les
10 minutes). Bibliothèque : eumdac (pip install eumdac).

Authentification sans session interactive (serveur Linux) : la clé et le
secret « consumer » du compte EUMETSAT (https://api.eumetsat.int/api-key/)
sont lus dans EUMETSAT_CONSUMER_KEY et EUMETSAT_CONSUMER_SECRET
(environnement ou .env). Le jeton est obtenu à chaque exécution et n'est
jamais enregistré.

Pour chaque produit nouveau : téléchargement du seul fichier .nc (pas des
aperçus), contrôle de la géolocalisation, extraction de la région utile,
passage sur la grille commune, archivage, puis suppression du fichier
brut (environ 4 Mo par produit, 600 Mo par jour s'ils étaient gardés).
"""

import shutil
from datetime import timedelta, timezone
from pathlib import Path

from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError

from meteo_app.sources.commun import (
    CleManquante, DejaEnCours, dossier, empreinte, journal, lire_cle,
    maintenant, verrou,
)

COLLECTION = "EO:EUM:DAT:0678"


def produits_recents(heures):
    """Liste (instant de fin, produit eumdac) des dernières heures, du plus récent au plus ancien."""
    try:
        import eumdac
    except ImportError:
        raise CommandError("La bibliothèque eumdac n'est pas installée (pip install eumdac).")

    jeton = eumdac.AccessToken((
        lire_cle("EUMETSAT_CONSUMER_KEY"), lire_cle("EUMETSAT_CONSUMER_SECRET"),
    ))
    collection = eumdac.DataStore(jeton).get_collection(COLLECTION)

    fin = maintenant()
    resultats = collection.search(dtstart=fin - timedelta(hours=heures), dtend=fin)

    produits = []
    for produit in resultats:
        instant = getattr(produit, "sensing_end", None) or getattr(produit, "sensing_start", None)
        if instant is not None and instant.tzinfo is None:
            instant = instant.replace(tzinfo=timezone.utc)   # eumdac renvoie de l'UTC sans fuseau
        produits.append((instant, produit))

    produits.sort(key=lambda p: p[0] or fin, reverse=True)
    return produits


def telecharger_netcdf(produit, cible):
    """Télécharge uniquement le fichier .nc du produit (sinon l'archive complète)."""
    from meteo_app.sources.satellite import extraire_netcdf

    entrees = [e for e in getattr(produit, "entries", []) or [] if str(e).endswith(".nc")]

    if entrees:
        nom = Path(str(entrees[0])).name
        destination = Path(cible) / nom
        with produit.open(entry=entrees[0]) as flux, open(destination, "wb") as sortie:
            shutil.copyfileobj(flux, sortie)
        return destination

    archive = Path(cible) / f"{produit}.zip"
    with produit.open() as flux, open(archive, "wb") as sortie:
        shutil.copyfileobj(flux, sortie)
    try:
        return extraire_netcdf(archive, cible)
    finally:
        archive.unlink(missing_ok=True)


class Command(BaseCommand):
    help = "Télécharge et traite le masque nuageux MTG (EUMETSAT)."

    def add_arguments(self, parser):
        parser.add_argument("--fichier", help="Archive .zip ou fichier .nc déjà téléchargé.")
        parser.add_argument("--rattrapage", type=float, default=1.0,
                            help="Heures à parcourir pour rattraper les produits manqués (défaut : 1).")
        parser.add_argument("--maximum", type=int, default=3,
                            help="Nombre maximal de produits traités par exécution (défaut : 3).")
        parser.add_argument("--garder-brut", action="store_true", help="Conserver le fichier .nc.")
        parser.add_argument("--sans-fusion", action="store_true")

    def handle(self, *args, **options):
        try:
            with verrou("satellite", duree_max_secondes=900):
                with journal("satellite", self.stdout) as suivi:
                    self.collecter(options, suivi)
        except DejaEnCours as erreur:
            self.stdout.write(str(erreur))
            return
        except CleManquante as erreur:
            raise CommandError(str(erreur))

        if not options["sans_fusion"] and getattr(self, "nouveautes", 0):
            call_command("fusionner_conditions", stdout=self.stdout, stderr=self.stderr)

    def traiter(self, chemin_nc, suivi_details):
        from meteo_app.sources import grille, satellite, stockage

        signature = empreinte(chemin_nc)
        if stockage.deja_vu("satellite", signature):
            suivi_details["ignores"].append(Path(chemin_nc).name)
            return False

        masque = satellite.lire_masque(chemin_nc)

        # Instant de référence : la fin nominale de la répétition, lue dans
        # le nom du produit (ex. …_20261117144000_20261117145000_…), comme
        # dans le catalogue EUMETSAT ; à défaut, la fin de couverture.
        debut_nom, fin_nom = satellite.instants_depuis_nom(Path(chemin_nc).name)
        if fin_nom:
            masque["instant"] = fin_nom
            masque["debut"] = debut_nom or masque["debut"]

        if stockage.existe("satellite", masque["instant"]):
            suivi_details["ignores"].append(Path(chemin_nc).name)
            return False

        controle = satellite.controler_orientation(masque)
        champs = satellite.sur_grille(masque)
        france = grille.masques()["france"] >= 0.5

        stockage.enregistrer_grille(
            "satellite", "observation", masque["instant"], champs,
            debut_periode=masque["debut"], empreinte=signature,
            qualite={
                **masque["indicateurs"],
                "plateforme": masque["plateforme"],
                "produit": masque["produit"],
                "controle_orientation": controle,
                "valide_france": round(float(champs["valide"][france].mean()), 3),
                "nuit_france": round(float(champs.get("nuit", champs["valide"] * 0)[france].mean()), 3),
                "fichier": Path(chemin_nc).name,
            },
        )
        suivi_details["traites"].append(f"{masque['instant']:%Y-%m-%d %H:%M} UTC")
        return True

    def collecter(self, options, suivi):
        from meteo_app.sources.satellite import ErreurSatellite, extraire_netcdf

        self.nouveautes = 0
        brut = dossier("brut", "satellite")
        details = {"traites": [], "ignores": [], "erreurs": []}

        if options["fichier"]:
            chemin = Path(options["fichier"])
            if not chemin.is_file():
                raise CommandError(f"Fichier introuvable : {chemin}")
            nc = extraire_netcdf(chemin, brut) if chemin.suffix == ".zip" else chemin
            try:
                self.nouveautes += self.traiter(nc, details)
            except ErreurSatellite as erreur:
                details["erreurs"].append(str(erreur))
            finally:
                if chemin.suffix == ".zip" and not options["garder_brut"]:
                    nc.unlink(missing_ok=True)
        else:
            from meteo_app.sources import stockage

            for instant, produit in produits_recents(options["rattrapage"]):
                if self.nouveautes >= options["maximum"]:
                    break
                if instant and stockage.existe("satellite", instant.replace(microsecond=0)):
                    details["ignores"].append(str(produit))
                    continue
                nc = None
                try:
                    nc = telecharger_netcdf(produit, brut)
                    self.nouveautes += self.traiter(nc, details)
                except ErreurSatellite as erreur:
                    details["erreurs"].append(f"{produit} : {erreur}")
                except Exception as erreur:  # réseau, archive incomplète : on passe au suivant
                    details["erreurs"].append(f"{produit} : {type(erreur).__name__} {erreur}")
                finally:
                    if nc is not None and not options["garder_brut"]:
                        Path(nc).unlink(missing_ok=True)

        if self.nouveautes:
            suivi.succes(f"{self.nouveautes} produit(s) traité(s) : {', '.join(details['traites'])}", **details)
        elif details["erreurs"]:
            suivi.echec("; ".join(details["erreurs"])[:900], **details)
        else:
            suivi.rien_de_neuf("Aucun nouveau produit.", **details)
