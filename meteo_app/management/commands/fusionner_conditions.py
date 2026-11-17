"""
Fusion des sources en une carte des conditions météo.

    python manage.py fusionner_conditions              situation actuelle
    python manage.py fusionner_conditions --previsions  jours suivants (AROME)
    python manage.py fusionner_conditions --forcer      même si rien n'a changé

Relancée automatiquement par les collecteurs radar, satellite et AROME.
Ne lit que les grilles archivées (aucun accès réseau) : elle est rapide
et peut tourner aussi souvent que nécessaire.

Le résultat (JSON compressé, environ 60 Ko) est archivé dans
archives/fusion/AAAA/MM/JJ/ et inscrit au catalogue ; la vue
/meteo/api/conditions/ le sert tel quel au navigateur.
"""

import gzip
import json
from datetime import timedelta

from django.core.management.base import BaseCommand

from meteo_app.sources.commun import (
    DejaEnCours, chemin_archive, ecrire_atomique, journal, maintenant,
    relatif, verrou,
)

ATTRIBUTIONS = {
    "radar": "Radar : Météo-France",
    "stations": "Stations : Météo-France",
    "satellite": "Satellite : contient des données EUMETSAT Meteosat modifiées",
    "arome": "Modèle AROME : Météo-France",
}


def derniere_observation(source, avant):
    from meteo_app.models import ProduitMeteo

    return (
        ProduitMeteo.objects
        .filter(source=source, nature="observation", instant__lte=avant + timedelta(minutes=2))
        .order_by("-instant").first()
    )


def arome_pour(instant, ecart_max=90):
    """Champ AROME le plus proche de l'instant, du run le plus récent."""
    from meteo_app.models import ProduitMeteo

    candidats = ProduitMeteo.objects.filter(
        source="arome", nature="prevision",
        instant__gte=instant - timedelta(minutes=ecart_max),
        instant__lte=instant + timedelta(minutes=ecart_max),
    ).order_by("-reference")

    meilleur = None
    for produit in candidats[:40]:
        cle = (abs((produit.instant - instant).total_seconds()), -produit.reference.timestamp())
        if meilleur is None or cle < meilleur[0]:
            meilleur = (cle, produit)
    return meilleur[1] if meilleur else None


def stations_recentes(instant, fenetre_minutes=30):
    """Observations du dernier créneau de 6 minutes avant l'instant."""
    from django.db.models import Max

    from meteo_app.models import ObservationMeteo

    debut = instant - timedelta(minutes=fenetre_minutes)
    creneau = ObservationMeteo.objects.filter(
        date__gte=debut, date__lte=instant + timedelta(minutes=2)
    ).aggregate(v=Max("date"))["v"]

    if creneau is None:
        return None, []

    lignes = ObservationMeteo.objects.filter(date=creneau).select_related("station")
    stations = []
    for o in lignes:
        s = o.station
        stations.append({
            "latitude": s.latitude, "longitude": s.longitude, "altitude": s.altitude,
            "temperature": o.temperature,
            # rr_per : cumul sur 6 minutes -> intensité horaire
            "precipitation": None if o.precipitation is None else o.precipitation * 10,
            "visibilite": o.visibilite,
            "rafale": None if o.rafale_vent is None else o.rafale_vent * 3.6,
            "direction": o.direction_vent,
        })
    return creneau, stations


class Command(BaseCommand):
    help = "Croise radar, satellite, stations et AROME en une carte des conditions."

    def add_arguments(self, parser):
        parser.add_argument("--previsions", action="store_true", help="Fusionner les prévisions AROME à venir.")
        parser.add_argument("--forcer", action="store_true")

    def handle(self, *args, **options):
        try:
            with verrou("fusion", duree_max_secondes=300):
                with journal("fusion", self.stdout) as suivi:
                    if options["previsions"]:
                        self.previsions(suivi, options["forcer"])
                    else:
                        self.observation(suivi, options["forcer"])
        except DejaEnCours as erreur:
            self.stdout.write(str(erreur))

    # ------------------------------------------------------------------
    def publier(self, resultat, instant, mode, provenance, reference=None, entrees=None):
        from meteo_app import fusion
        from meteo_app.models import ProduitMeteo

        contenu = fusion.encoder(resultat, instant, mode, provenance)
        octets = gzip.compress(json.dumps(contenu, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), 6)

        nom = f"conditions_{instant:%Y%m%dT%H%MZ}" + (f"_run{reference:%Y%m%dT%HZ}" if reference else "") + ".json.gz"
        chemin = chemin_archive("fusion", instant, nom)
        ecrire_atomique(chemin, octets)

        ProduitMeteo.objects.update_or_create(
            source="fusion", nature=mode, instant=instant, reference=reference,
            defaults={
                "fichier": relatif(chemin), "taille": len(octets),
                "qualite": {"entrees": entrees or {}, "resume_france": contenu["resume_france"]},
            },
        )
        return contenu

    # ------------------------------------------------------------------
    def observation(self, suivi, forcer):
        from meteo_app import fusion
        from meteo_app.models import ProduitMeteo
        from meteo_app.sources import grille, stockage

        maintenant_utc = maintenant()

        p_radar = derniere_observation("radar", maintenant_utc)
        p_sat = derniere_observation("satellite", maintenant_utc)

        # Les stations sont jugées par rapport à l'instant que décrira la
        # carte (celui des images), pas par rapport à l'heure courante :
        # sinon une carte un peu ancienne perdrait ses stations.
        images = [p.instant for p in (p_radar, p_sat) if p]
        creneau, stations = stations_recentes(maintenant_utc)
        if creneau is None and images:
            creneau, stations = stations_recentes(max(images))

        # Instant décrit : celui de l'observation la plus récente disponible
        candidats = images + ([creneau] if creneau else [])
        instant = max(candidats) if candidats else maintenant_utc.replace(second=0, microsecond=0)

        p_arome = arome_pour(instant)

        entrees = {
            "radar": p_radar.pk if p_radar else None,
            "satellite": p_sat.pk if p_sat else None,
            "stations": creneau.isoformat() if creneau else None,
            "arome": p_arome.pk if p_arome else None,
        }

        derniere = ProduitMeteo.objects.filter(source="fusion", nature="observation").order_by("-instant").first()
        if not forcer and derniere and derniere.qualite.get("entrees") == entrees:
            suivi.rien_de_neuf("Aucune source n'a changé depuis la dernière fusion.")
            return

        def age(produit_instant):
            return (instant - produit_instant).total_seconds() / 60

        radar = satellite = arome = st = None
        provenance = {}

        if p_radar:
            radar = {**stockage.lire_grille(p_radar), "age": age(p_radar.instant)}
            provenance["radar"] = {
                "instant": p_radar.instant.isoformat(),
                "radars_absents": len(p_radar.qualite.get("radars_absents", [])),
                "attribution": ATTRIBUTIONS["radar"],
            }
        if p_sat:
            satellite = {**stockage.lire_grille(p_sat), "age": age(p_sat.instant)}
            provenance["satellite"] = {
                "instant": p_sat.instant.isoformat(),
                "plateforme": p_sat.qualite.get("plateforme"),
                "attribution": ATTRIBUTIONS["satellite"],
            }
        if creneau:
            st = {**fusion.stations_sur_grille(stations, grille.altitudes()), "age": age(creneau)}
            provenance["stations"] = {
                "instant": creneau.isoformat(), "nombre": len(stations),
                "attribution": ATTRIBUTIONS["stations"],
            }
        if p_arome:
            arome = {**stockage.lire_grille(p_arome), "ecart": (p_arome.instant - instant).total_seconds() / 60}
            provenance["arome"] = {
                "validite": p_arome.instant.isoformat(), "run": p_arome.reference.isoformat(),
                "attribution": ATTRIBUTIONS["arome"],
            }

        if not any((radar, satellite, st, arome)):
            suivi.echec("Aucune source disponible : rien à fusionner.")
            return

        resultat = fusion.fusionner(instant, radar=radar, satellite=satellite, arome=arome,
                                    stations=st, altitude=grille.altitudes(), mode="observation")

        # Sources effectivement retenues (les trop anciennes sont écartées)
        for nom, limite in fusion.FRAICHEUR_MAX.items():
            if nom in provenance:
                donnees = {"radar": radar, "satellite": satellite, "stations": st}[nom]
                provenance[nom]["age_minutes"] = round(donnees["age"], 1)
                provenance[nom]["retenue"] = donnees["age"] <= limite
        if "arome" in provenance:
            provenance["arome"]["retenue"] = abs(arome["ecart"]) <= fusion.ECART_AROME_MAX

        contenu = self.publier(resultat, instant, "observation", provenance, entrees=entrees)
        retenues = [n for n, p in provenance.items() if p.get("retenue")]
        suivi.succes(f"Situation de {instant:%H:%M} UTC — sources : {', '.join(retenues) or 'aucune'}",
                     resume=contenu["resume_france"])

    # ------------------------------------------------------------------
    def previsions(self, suivi, forcer):
        from meteo_app import fusion
        from meteo_app.models import ProduitMeteo
        from meteo_app.sources import grille, stockage

        dernier = ProduitMeteo.objects.filter(source="arome").order_by("-reference").first()
        if dernier is None:
            suivi.rien_de_neuf("Aucune prévision AROME archivée.")
            return

        cycle = dernier.reference
        a_venir = ProduitMeteo.objects.filter(
            source="arome", reference=cycle, instant__gt=maintenant() + timedelta(minutes=30),
        ).order_by("instant")

        faites = 0
        for produit in a_venir:
            if not forcer and ProduitMeteo.objects.filter(
                source="fusion", nature="prevision", instant=produit.instant, reference=cycle
            ).exists():
                continue

            champs = {**stockage.lire_grille(produit), "ecart": 0}
            resultat = fusion.fusionner(produit.instant, arome=champs, altitude=grille.altitudes(), mode="prevision")
            provenance = {"arome": {
                "validite": produit.instant.isoformat(), "run": cycle.isoformat(),
                "echeance_heures": produit.qualite.get("echeance_heures"),
                "attribution": ATTRIBUTIONS["arome"], "retenue": True,
            }}
            self.publier(resultat, produit.instant, "prevision", provenance, reference=cycle,
                         entrees={"arome": produit.pk})
            faites += 1

        if faites:
            suivi.succes(f"{faites} carte(s) de prévision du run {cycle:%Y-%m-%d %H} UTC.")
        else:
            suivi.rien_de_neuf("Prévisions déjà fusionnées.")
