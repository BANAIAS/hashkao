
import re

from django.shortcuts import render
from django.http import JsonResponse
from meteo.historique import classement_historique


def api_historique(request):
    """Renvoie le classement historique pour un jour donné."""

    try:
        mois = int(request.GET.get("mois", 11))
        jour = int(request.GET.get("jour", 14))
        mode = request.GET.get("mode", "chaud")

        if not 1 <= mois <= 12:
            raise ValueError("Le mois doit être compris entre 1 et 12.")

        if not 1 <= jour <= 31:
            raise ValueError("Le jour doit être compris entre 1 et 31.")

        resultat = classement_historique(mois, jour, mode)


        from meteo.historique import charger_historique

        meteo = charger_historique()

        colonne = "TX" if mode == "chaud" else "TN"

        selection = meteo.loc[
            (meteo["date"].dt.month == mois)
            & (meteo["date"].dt.day == jour),
            ["date", colonne]
        ].dropna()

        observations = [
            {
                "annee": int(ligne["date"].year),
                "temperature": float(ligne[colonne])
            }
            for _, ligne in selection.iterrows()
        ]


        return JsonResponse({
            "date": resultat["date"],
            "mode": resultat["mode"],
            "annees_comparees": resultat["annees_comparees"],
            "mediane": resultat["mediane"],
            "top3": resultat["top3"].to_dict(orient="records"),
            "observations": observations,
        })

    except ValueError as erreur:
        return JsonResponse(
            {"erreur": str(erreur)},
            status=400
        )


def accueil(request):
    """Page principale : l'expérience HKO Météo (les trois tableaux)."""
    return render(request, "meteo_app/hko.html")


def carte(request):
    """Ancienne adresse de la carte : même expérience HKO Météo."""
    return render(request, "meteo_app/hko.html")


def carte_labo(request):
    """Carte technique d'origine (affichage, interpolation, relief visuel)."""
    return render(request, "meteo_app/carte.html")


def est_ce_normal(request):
    """Rubrique « Est-ce normal ? »."""
    return render(request, "meteo_app/normal.html")


# ---------------------------------------------------------------------------
# API de la carte
# ---------------------------------------------------------------------------

# Heure locale visée pour représenter une journée passée
HEURE_REFERENCE = 15

# Nombre de jours de prévision que l'interface laisse parcourir
JOURS_FUTURS = 2


def _creneau_du_jour(jour, aujourdhui):
    """
    Créneau d'observation représentant un jour civil (heure de Paris) :
    le dernier disponible pour aujourd'hui, le plus proche de 15 h pour
    un jour passé. Renvoie None si la base n'a rien pour ce jour.
    """
    from datetime import datetime, time, timedelta

    from django.db.models import Max, Min
    from django.utils import timezone

    from .models import ObservationMeteo

    fuseau = timezone.get_current_timezone()

    debut = datetime.combine(jour, time.min).replace(tzinfo=fuseau)
    fin = debut + timedelta(days=1)

    du_jour = ObservationMeteo.objects.filter(date__gte=debut, date__lt=fin)

    if jour == aujourdhui:
        return du_jour.aggregate(v=Max("date"))["v"]

    cible = debut + timedelta(hours=HEURE_REFERENCE)

    avant = du_jour.filter(date__lte=cible).aggregate(v=Max("date"))["v"]
    apres = du_jour.filter(date__gt=cible).aggregate(v=Min("date"))["v"]

    if avant and apres:
        return avant if (cible - avant) <= (apres - cible) else apres

    return avant or apres


def _produit_du_jour(source, nature, jour, heure_locale=HEURE_REFERENCE):
    """
    Produit du catalogue le plus proche de l'heure locale visée pour un jour
    donné ; pour une prévision, le run le plus récent l'emporte.
    """
    from datetime import datetime, time, timedelta

    from django.utils import timezone

    from .models import ProduitMeteo

    fuseau = timezone.get_current_timezone()
    debut = datetime.combine(jour, time.min).replace(tzinfo=fuseau)
    cible = debut + timedelta(hours=heure_locale)

    produits = ProduitMeteo.objects.filter(
        source=source, nature=nature,
        instant__gte=debut, instant__lt=debut + timedelta(days=1),
    )

    meilleur = None
    for produit in produits.order_by("-reference", "-instant")[:200]:
        reference = produit.reference.timestamp() if produit.reference else 0
        cle = (abs((produit.instant - cible).total_seconds()), -reference)
        if meilleur is None or cle < meilleur[0]:
            meilleur = (cle, produit)
    return meilleur[1] if meilleur else None


def _points_prevision(jour):
    """
    Températures prévues par AROME pour un jour à venir, sous forme de
    points de grille réguliers (0,3°) sur la France. Les points sont
    marqués « prevision » : l'interface ne les présente pas comme des
    stations.
    """
    import numpy as np

    from .sources import grille, stockage

    produit = _produit_du_jour("arome", "prevision", jour)
    if produit is None:
        return {
            "disponible": False,
            "motif": "Aucune prévision AROME n'est encore disponible pour ce jour.",
        }

    champs = stockage.lire_grille(produit)
    temperature = champs.get("temperature")
    if temperature is None:
        return {"disponible": False, "motif": "La prévision de température est absente de ce run."}

    france = grille.masques()["france"] >= 0.5
    altitudes = grille.altitudes()
    lon, lat = grille.centres()
    pas = 6

    points = []
    for j in range(pas // 2, grille.NY, pas):
        for i in range(pas // 2, grille.NX, pas):
            if not france[j, i] or not np.isfinite(temperature[j, i]):
                continue
            altitude = altitudes[j, i]
            points.append({
                "id": f"arome-{j}-{i}",
                "nom": "Point de grille AROME",
                "commune": None,
                "latitude": round(float(lat[j]), 3),
                "longitude": round(float(lon[i]), 3),
                "altitude": None if not np.isfinite(altitude) else round(float(altitude)),
                "temperature": round(float(temperature[j, i]), 1),
                "humidite": None,
                "vent": None,
                "precipitation": None,
                "source": "arome",
            })

    return {
        "disponible": bool(points),
        "motif": None if points else "Prévision vide sur la France.",
        "date": produit.instant.isoformat(),
        "run": produit.reference.isoformat() if produit.reference else None,
        "nombre_stations": len(points),
        "stations": points,
    }


def api_carte(request):
    """
    Observations des stations pour un jour donné.

    Sans paramètre : le dernier créneau disponible (comportement d'origine).
    ?jour=AAAA-MM-JJ : le créneau représentatif de ce jour.

    La réponse précise toujours la nature des données (« observation »
    ou « prevision ») et, si rien n'est disponible, pourquoi.
    """
    from datetime import date as Date, timedelta

    from django.db.models import Max, Min
    from django.utils import timezone

    from .conditions import classer, unite_nebulosite
    from .models import ObservationMeteo

    aujourdhui = timezone.localdate()

    bornes = ObservationMeteo.objects.aggregate(
        premiere=Min("date"), derniere=Max("date")
    )

    def jour_local(instant):
        return timezone.localtime(instant).date() if instant else None

    premier_jour = jour_local(bornes["premiere"])
    dernier_jour = jour_local(bornes["derniere"])

    reponse = {
        "aujourdhui": aujourdhui.isoformat(),
        "premier_jour": premier_jour.isoformat() if premier_jour else None,
        "dernier_jour": dernier_jour.isoformat() if dernier_jour else None,
        "dernier_jour_navigable": (
            aujourdhui + timedelta(days=JOURS_FUTURS)
        ).isoformat(),
        "type": "observation",
        "disponible": False,
        "motif": None,
        "date": None,
        "nombre_stations": 0,
        "stations": [],
        "ciel_mesure": False,
    }

    parametre = request.GET.get("jour")

    if parametre:
        try:
            jour = Date.fromisoformat(parametre)
        except ValueError:
            return JsonResponse(
                {"erreur": "Le jour doit être au format AAAA-MM-JJ."},
                status=400,
            )
    else:
        # Sans paramètre : dernier jour disposant de données
        jour = dernier_jour or aujourdhui

    reponse["jour"] = jour.isoformat()

    if jour > aujourdhui:
        reponse["type"] = "prevision"
        reponse.update(_points_prevision(jour))
        return JsonResponse(reponse)

    if bornes["derniere"] is None:
        reponse["motif"] = "La base ne contient encore aucune observation."
        return JsonResponse(reponse)

    creneau = (
        bornes["derniere"]
        if not parametre
        else _creneau_du_jour(jour, aujourdhui)
    )

    if creneau is None:
        reponse["motif"] = (
            "Aucune observation n'a été collectée pour ce jour."
        )
        return JsonResponse(reponse)

    observations = list(
        ObservationMeteo.objects
        .filter(
            date=creneau,
            station__latitude__gte=41.0,
            station__latitude__lte=51.5,
            station__longitude__gte=-5.5,
            station__longitude__lte=10.0,
        )
        .select_related("station")
    )

    unite = unite_nebulosite([o.nebulosite for o in observations])

    stations = []
    ciel_mesure = False

    for observation in observations:
        station = observation.station
        condition = classer(observation, station, unite)

        if condition["source"] in ("nebulosite", "rayonnement"):
            ciel_mesure = True

        stations.append({
            "id": station.identifiant,
            "nom": station.nom,
            "commune": station.commune,
            "latitude": station.latitude,
            "longitude": station.longitude,
            "altitude": station.altitude,
            "temperature": observation.temperature,
            "humidite": observation.humidite,
            "vent": observation.vitesse_vent,
            "direction_vent": observation.direction_vent,
            "rafale": observation.rafale_vent,
            "precipitation": observation.precipitation,
            "pression": observation.pression,
            "condition": condition,
        })

    reponse.update({
        "disponible": bool(stations),
        "motif": None if stations else "Aucune station pour ce créneau.",
        "date": creneau.isoformat(),
        "nombre_stations": len(stations),
        "stations": stations,
        "ciel_mesure": ciel_mesure,
    })

    return JsonResponse(reponse)


# ---------------------------------------------------------------------------
# API « Est-ce normal ? »
# ---------------------------------------------------------------------------

def api_normal(request):
    """
    Replace un jour de l'année dans la série de Paris-Montsouris.

    ?jour=AAAA-MM-JJ (défaut : aujourd'hui). Renvoie les statistiques
    historiques des maximales et des minimales, la normale 1991-2020,
    et la mesure du jour si la station figure dans nos observations.
    """
    from datetime import date as Date

    from django.utils import timezone

    from . import climat

    aujourdhui = timezone.localdate()
    parametre = request.GET.get("jour")

    try:
        jour = Date.fromisoformat(parametre) if parametre else aujourdhui
    except ValueError:
        return JsonResponse(
            {"erreur": "Le jour doit être au format AAAA-MM-JJ."},
            status=400,
        )

    try:
        contexte = climat.contexte_climatique(jour.month, jour.day)
    except FileNotFoundError:
        return JsonResponse(
            {
                "erreur": (
                    "Les archives de Paris-Montsouris sont introuvables "
                    "sur ce serveur (dossier meteo/data/quotidiennes)."
                )
            },
            status=503,
        )
    except ImportError:
        return JsonResponse(
            {"erreur": "La bibliothèque pandas n'est pas installée."},
            status=503,
        )

    mesure = climat.mesure_du_jour(jour) if jour <= aujourdhui else None

    for mode, cle in (("chaud", "maximum"), ("froid", "minimum")):
        bloc = contexte.get(mode)

        if not bloc:
            continue

        valeur = mesure[cle] if mesure else None

        bloc["mesure"] = valeur
        bloc["position"] = climat.situer(valeur, bloc["annees"])
        bloc["ecart_normale"] = (
            round(valeur - bloc["normale"], 1)
            if valeur is not None and bloc["normale"] is not None
            else None
        )

    return JsonResponse({
        "jour": jour.isoformat(),
        "aujourdhui": aujourdhui.isoformat(),
        "station": climat.NOM_STATION,
        "mesure": mesure,
        "chaud": contexte.get("chaud"),
        "froid": contexte.get("froid"),
    })


# ---------------------------------------------------------------------------
# Conditions météo (fusion des sources)
# ---------------------------------------------------------------------------

def api_conditions(request):
    """
    Carte des conditions pour un jour (?jour=AAAA-MM-JJ, défaut : aujourd'hui).

    Aujourd'hui : la fusion la plus récente (observation).
    Jour passé : la fusion archivée la plus proche de 15 h.
    Jour à venir : la fusion AROME la plus proche de 15 h (prévision).

    Le fichier archivé est servi tel quel (JSON compressé). Si rien
    n'existe, la réponse le dit (statut 404, motif lisible).
    """
    from datetime import date as Date

    from django.http import HttpResponse
    from django.utils import timezone

    from .models import ProduitMeteo
    from .sources.commun import absolu

    aujourdhui = timezone.localdate()
    parametre = request.GET.get("jour")

    try:
        jour = Date.fromisoformat(parametre) if parametre else aujourdhui
    except ValueError:
        return JsonResponse({"erreur": "Le jour doit être au format AAAA-MM-JJ."}, status=400)

    if jour > aujourdhui:
        produit = _produit_du_jour("fusion", "prevision", jour)
        motif = "Aucune prévision AROME n'est encore disponible pour ce jour."
    elif jour == aujourdhui:
        produit = ProduitMeteo.objects.filter(source="fusion", nature="observation").order_by("-instant").first()
        if produit and timezone.localtime(produit.instant).date() != jour:
            produit = None
        motif = "Aucune carte des conditions n'a encore été calculée aujourd'hui."
    else:
        produit = _produit_du_jour("fusion", "observation", jour)
        motif = "Aucune carte des conditions n'a été archivée pour ce jour."

    if produit is None:
        return JsonResponse({"erreur": motif, "jour": jour.isoformat()}, status=404)

    try:
        octets = absolu(produit.fichier).read_bytes()
    except FileNotFoundError:
        return JsonResponse({"erreur": "Le fichier de cette carte a été purgé."}, status=404)

    reponse = HttpResponse(octets, content_type="application/json; charset=utf-8")
    reponse["Content-Encoding"] = "gzip"
    reponse["Cache-Control"] = "public, max-age=60" if jour >= aujourdhui else "public, max-age=86400"
    return reponse


FICHIERS_RADAR = re.compile(r"^radar(_\d{8}T\d{4}Z)?(_couverture)?\.(png|json)$")


def fichier_radar(request, nom):
    """Sert les fichiers radar publiés (hors static : ils changent toutes les 5 minutes)."""
    from django.http import FileResponse, Http404

    from .sources.commun import dossier_publication

    if not FICHIERS_RADAR.match(nom):
        raise Http404("Fichier inconnu.")

    chemin = dossier_publication("radar") / nom
    if not chemin.is_file():
        raise Http404("Fichier absent.")

    reponse = FileResponse(open(chemin, "rb"), content_type=(
        "application/json" if nom.endswith(".json") else "image/png"
    ))
    # Les images portent leur heure dans leur nom : elles ne changent jamais
    reponse["Cache-Control"] = "no-cache" if nom.endswith(".json") else "public, max-age=86400, immutable"
    return reponse


def api_etat(request):
    """Fraîcheur de chaque source (surveillance et habillage de la carte)."""
    from .sources.surveillance import etat_des_sources

    return JsonResponse(etat_des_sources())
