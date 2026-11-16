
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
    """Affiche la page principale du projet météo."""
    return render(request, "meteo_app/accueil.html")


def api_carte(request):
    from django.http import JsonResponse
    from django.db.models import Max
    from .models import ObservationMeteo

    # Dernière date disponible dans notre base
    derniere_date = ObservationMeteo.objects.aggregate(
        derniere=Max("date")
    )["derniere"]

    if derniere_date is None:
        return JsonResponse({
            "date": None,
            "nombre_stations": 0,
            "stations": []
        })

    # Toutes les observations de ce créneau

    observations = (
        ObservationMeteo.objects
        .filter(
            date=derniere_date,
            station__latitude__gte=41.0,
            station__latitude__lte=51.5,
            station__longitude__gte=-5.5,
            station__longitude__lte=10.0,
        )
        .select_related("station")
    )


    stations = []

    for observation in observations:
        station = observation.station

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
        })

    return JsonResponse({
        "date": derniere_date.isoformat(),
        "nombre_stations": len(stations),
        "stations": stations
    })


def carte(request):
    from django.shortcuts import render

    return render(request, "meteo_app/carte.html")
