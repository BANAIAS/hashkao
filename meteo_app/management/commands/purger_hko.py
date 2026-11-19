"""
Purge et résumé de l'historique HKO Météo.

    python manage.py purger_hko --simulation   affiche ce qui serait fait
    python manage.py purger_hko                applique

À lancer une fois par jour (la nuit). Politique de conservation :

  Fichiers bruts (téléchargés)
    radar .h5            6 h      (2,2 Mo l'un, ~630 Mo par jour)
    satellite .nc        3 h      (supprimés dès le traitement en temps normal)
    AROME                12 h     (le diagnostic est gardé)

  Grilles dérivées (0,05°, .npz)
    radar, satellite     30 jours, puis un résumé quotidien conservé :
                         cumul de pluie et part de temps pluvieux (radar),
                         nébulosité moyenne (satellite)
    AROME                3 jours ; les runs de 00 UTC 30 jours
                         (comparaison prévision / observation)

  Cartes des conditions (fusion, ~65 Ko l'une)
    observations         toutes pendant 48 h, puis une par heure jusqu'à
                         30 jours, puis quatre par jour (3 h, 9 h, 15 h,
                         21 h, heure de Paris), sans limite de durée
    prévisions           7 jours (remplacées par les runs suivants)

  Base de données
    observations 6 min   30 jours, résumées avant suppression en
                         observations horaires (conservées sans limite)
    journal de collecte  60 jours

Volumes estimés en régime établi : ~25 Mo par jour les 30 premiers jours
(grilles radar et satellite), puis ~1 Mo par jour d'archive durable.
"""

from collections import defaultdict
from datetime import timedelta
from zoneinfo import ZoneInfo

import numpy as np
from django.core.management.base import BaseCommand
from django.db import transaction

from meteo_app.sources.commun import (
    DejaEnCours, absolu, dossier, ecrire_atomique, journal, maintenant, verrou,
)

PARIS = ZoneInfo("Europe/Paris")

BRUT = {
    "radar": timedelta(hours=6),
    "opera": timedelta(hours=6),
    "satellite": timedelta(hours=3),
    "arome": timedelta(hours=12),
}

CONSERVATION_OPERA = timedelta(days=30)
GRILLES_OBSERVATION = timedelta(days=30)
AROME_COURT, AROME_LONG = timedelta(days=3), timedelta(days=30)
FUSION_TOUTES, FUSION_HORAIRE = timedelta(hours=48), timedelta(days=30)
FUSION_HEURES_DURABLES = (3, 9, 15, 21)
PREVISIONS_FUSION = timedelta(days=7)
OBSERVATIONS_DETAILLEES = timedelta(days=30)
JOURNAL = timedelta(days=60)


class Command(BaseCommand):
    help = "Purge les données anciennes de HKO Météo et conserve des résumés."

    def add_arguments(self, parser):
        parser.add_argument("--simulation", action="store_true", help="N'efface rien, affiche le bilan.")

    def handle(self, *args, **options):
        self.simulation = options["simulation"]
        self.bilan = defaultdict(int)
        self.octets = 0

        try:
            with verrou("purge", duree_max_secondes=7200):
                with journal("maintenance", self.stdout) as suivi:
                    a = maintenant()
                    self.fichiers_bruts(a)
                    self.grilles_observation(a)
                    self.grilles_opera(a)
                    self.grilles_arome(a)
                    self.cartes(a)
                    self.observations(a)
                    self.journal(a)

                    resume = ", ".join(f"{k} : {v}" for k, v in sorted(self.bilan.items())) or "rien à purger"
                    prefixe = "Simulation — " if self.simulation else ""
                    suivi.succes(f"{prefixe}{resume} ; {self.octets / 1e6:.0f} Mo libérés", **self.bilan)
        except DejaEnCours as erreur:
            self.stdout.write(str(erreur))

    # ------------------------------------------------------------------
    def supprimer_produit(self, produit, categorie):
        chemin = absolu(produit.fichier)
        self.bilan[categorie] += 1
        if chemin.exists():
            self.octets += chemin.stat().st_size
        if not self.simulation:
            chemin.unlink(missing_ok=True)
            produit.delete()

    def fichiers_bruts(self, a):
        for source, duree in BRUT.items():
            racine = dossier("brut", source)
            limite = (a - duree).timestamp()
            for chemin in racine.rglob("*"):
                if not chemin.is_file() or "diagnostic" in chemin.parts:
                    continue
                if chemin.stat().st_mtime < limite:
                    self.bilan[f"bruts {source}"] += 1
                    self.octets += chemin.stat().st_size
                    if not self.simulation:
                        chemin.unlink(missing_ok=True)

    def grilles_observation(self, a):
        """Grilles radar et satellite de plus de 30 jours, résumées par jour avant suppression."""
        from meteo_app.models import ProduitMeteo
        from meteo_app.sources import stockage

        limite = a - GRILLES_OBSERVATION

        for source in ("radar", "satellite"):
            anciens = ProduitMeteo.objects.filter(source=source, nature="observation", instant__lt=limite)
            par_jour = defaultdict(list)
            for produit in anciens.order_by("instant"):
                par_jour[produit.instant.astimezone(PARIS).date()].append(produit)

            for jour, produits in par_jour.items():
                cible = dossier("archives", source, "journalier", f"{jour:%Y}") / f"{jour.isoformat()}.npz"
                if not cible.exists() and not self.simulation:
                    self.resumer(source, produits, cible)
                    self.bilan[f"résumés {source}"] += 1
                for produit in produits:
                    self.supprimer_produit(produit, f"grilles {source}")

    def resumer(self, source, produits, cible):
        import io

        from meteo_app.sources import stockage

        somme, compte, nombre = None, None, 0
        for produit in produits:
            try:
                champs = stockage.lire_grille(produit)
            except FileNotFoundError:
                continue
            if source == "radar":
                # cumul (mm) = intensité (mm/h) x 5 min, là où le radar mesure
                valeur = np.where(champs["couverture"] >= 0.5, np.nan_to_num(champs["intensite"]) * 5 / 60, np.nan)
                pluie = np.where(champs["couverture"] >= 0.5, (np.nan_to_num(champs["pluie"]) >= 0.25).astype(float), np.nan)
                valeur = np.stack([valeur, pluie])
            else:
                valeur = np.where(champs["valide"] >= 0.6,
                                  np.nan_to_num(champs["opaque"]) + 0.6 * np.nan_to_num(champs["partiel"]), np.nan)[None]
            if somme is None:
                somme = np.zeros_like(valeur, dtype=np.float64)
                compte = np.zeros_like(valeur, dtype=np.int32)
            connu = np.isfinite(valeur)
            somme += np.where(connu, valeur, 0)
            compte += connu
            nombre += 1

        if somme is None:
            return

        with np.errstate(invalid="ignore", divide="ignore"):
            if source == "radar":
                champs = {
                    # cumul ramené à une journée complète si des mosaïques manquent
                    "cumul_mm": (somme[0] * np.where(compte[0] > 0, 288 / np.maximum(compte[0], 1), np.nan)).astype(np.float16),
                    "part_pluvieuse": (somme[1] / np.maximum(compte[1], 1)).astype(np.float16),
                }
            else:
                champs = {"nebulosite_moyenne": (somme[0] / np.maximum(compte[0], 1)).astype(np.float16)}

        tampon = io.BytesIO()
        np.savez_compressed(tampon, mosaiques=np.int32(nombre), **champs)
        ecrire_atomique(cible, tampon.getvalue())

    def grilles_opera(self, a):
        """Purge des archives et animations OPERA anciennes."""

        from datetime import date
        from meteo_app.models import ProduitMeteo

        limite = a - CONSERVATION_OPERA
        jour_limite = limite.astimezone(PARIS).date()

        anciens = ProduitMeteo.objects.filter(
            source="opera",
            nature="observation",
            instant__lt=limite,
        )

        for produit in anciens.iterator():
            jour = produit.instant.astimezone(PARIS).date()

            if jour < jour_limite:
                self.supprimer_produit(
                    produit,
                    "grilles OPERA",
                )

        publication = dossier("publication", "opera")

        for chemin in publication.glob("animation_*.json.gz"):

            nom = chemin.name
            texte = nom.removeprefix(
                "animation_"
            ).removesuffix(".json.gz")

            try:
                jour = date.fromisoformat(texte)
            except ValueError:
                continue

            if jour < jour_limite:
                self.bilan["animations OPERA"] += 1
                self.octets += chemin.stat().st_size

                if not self.simulation:
                    chemin.unlink(missing_ok=True)

    def grilles_arome(self, a):
        from meteo_app.models import ProduitMeteo

        for produit in ProduitMeteo.objects.filter(source="arome", reference__lt=a - AROME_COURT):
            if produit.reference.hour == 0 and produit.reference >= a - AROME_LONG:
                continue
            self.supprimer_produit(produit, "grilles AROME")

    def cartes(self, a):
        from meteo_app.models import ProduitMeteo

        for produit in ProduitMeteo.objects.filter(source="fusion", nature="prevision", instant__lt=a - PREVISIONS_FUSION):
            self.supprimer_produit(produit, "cartes prévues")

        anciennes = ProduitMeteo.objects.filter(source="fusion", nature="observation", instant__lt=a - FUSION_TOUTES)

        # Regroupement par heure (jusqu'à 30 jours) ou par quart de journée (au-delà)
        groupes = defaultdict(list)
        for produit in anciennes.order_by("instant"):
            locale = produit.instant.astimezone(PARIS)
            if produit.instant >= a - FUSION_HORAIRE:
                cle = ("heure", locale.replace(minute=0, second=0, microsecond=0))
                cible = cle[1]
            else:
                heure = min(FUSION_HEURES_DURABLES, key=lambda h: abs(locale.hour + locale.minute / 60 - h))
                cible = locale.replace(hour=heure, minute=0, second=0, microsecond=0)
                cle = ("quart", cible)
            groupes[cle].append((abs((locale - cible).total_seconds()), produit))

        for liste in groupes.values():
            liste.sort(key=lambda t: t[0])
            for _, produit in liste[1:]:
                self.supprimer_produit(produit, "cartes observées")

    def observations(self, a):
        from django.db.models import Avg, Count, Max, Min, Sum
        from django.db.models.functions import TruncHour

        from meteo_app.models import ObservationHoraire, ObservationMeteo

        limite = a - OBSERVATIONS_DETAILLEES
        anciennes = ObservationMeteo.objects.filter(date__lt=limite)
        nombre = anciennes.count()
        if not nombre:
            return

        self.bilan["observations 6 min"] += nombre
        if self.simulation:
            return

        resumes = (
            anciennes.annotate(heure_debut=TruncHour("date"))
            .values("station_id", "heure_debut")
            .annotate(
                t=Avg("temperature"), tmin=Min("temperature"), tmax=Max("temperature"),
                hu=Avg("humidite"), vent=Avg("vitesse_vent"), rafale=Max("rafale_vent"),
                pluie=Sum("precipitation"), vis=Min("visibilite"), pres=Avg("pression"),
                n=Count("id"),
            )
        )

        lot, total = [], 0
        for r in resumes.iterator():
            lot.append(ObservationHoraire(
                station_id=r["station_id"], heure=r["heure_debut"],
                temperature=r["t"], temperature_min=r["tmin"], temperature_max=r["tmax"],
                humidite=r["hu"], vent_moyen=r["vent"], rafale_max=r["rafale"],
                precipitation=r["pluie"], visibilite_min=r["vis"], pression=r["pres"],
                mesures=r["n"],
            ))
            if len(lot) >= 2000:
                ObservationHoraire.objects.bulk_create(lot, ignore_conflicts=True)
                total += len(lot)
                lot = []

        with transaction.atomic():
            if lot:
                ObservationHoraire.objects.bulk_create(lot, ignore_conflicts=True)
            anciennes.delete()

        self.bilan["observations horaires créées"] += total + len(lot)

    def journal(self, a):
        from meteo_app.models import JournalCollecte

        anciens = JournalCollecte.objects.filter(debut__lt=a - JOURNAL)
        self.bilan["lignes de journal"] += anciens.count()
        if not self.simulation:
            anciens.delete()
