
import os
import math

os.environ.setdefault(
    "DJANGO_SETTINGS_MODULE",
    "hashkao.settings.dev"
)

import django
django.setup()

from django.db.models import Max
from meteo_app.models import ObservationMeteo

GRADIENT = 0.0045
N_VOISINS = 8


from datetime import datetime, timezone

date = datetime(
    2026, 11, 14, 12, 0,
    tzinfo=timezone.utc
)


observations = (
    ObservationMeteo.objects
    .filter(
        date=date,
        station__latitude__gte=41,
        station__latitude__lte=51.5,
        station__longitude__gte=-5.5,
        station__longitude__lte=10,
        temperature__isnull=False,
        station__altitude__isnull=False,
    )
    .select_related("station")
)

stations = []

for obs in observations:
    s = obs.station
    stations.append({
        "id": s.identifiant,
        "lat": float(s.latitude),
        "lon": float(s.longitude),
        "alt": float(s.altitude),
        "temp": float(obs.temperature),
    })


def distance_km(a, b):
    lat1 = math.radians(a["lat"])
    lat2 = math.radians(b["lat"])
    dlat = lat2 - lat1
    dlon = math.radians(b["lon"] - a["lon"])

    h = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2)
        * math.sin(dlon / 2) ** 2
    )

    return 6371 * 2 * math.asin(
        math.sqrt(min(1, h))
    )


def estimer(cible, voisines, correction=False):
    numerateur = 0
    denominateur = 0

    for distance, station in voisines:
        if distance < 0.001:
            return station["temp"]

        poids = 1 / (distance ** 2)

        temperature = station["temp"]

        if correction:
            temperature -= GRADIENT * (
                cible["alt"] - station["alt"]
            )

        numerateur += poids * temperature
        denominateur += poids

    return numerateur / denominateur


erreurs_classique = []
erreurs_corrige = []

for cible in stations:
    distances = sorted(
        (
            (distance_km(cible, station), station)
            for station in stations
            if station["id"] != cible["id"]
        ),
        key=lambda element: element[0]
    )

    voisines = distances[:N_VOISINS]

    if len(voisines) < N_VOISINS:
        continue

    classique = estimer(cible, voisines)
    corrige = estimer(cible, voisines, correction=True)

    erreurs_classique.append(
        abs(classique - cible["temp"])
    )
    erreurs_corrige.append(
        abs(corrige - cible["temp"])
    )


def moyenne(valeurs):
    return sum(valeurs) / len(valeurs)


print("\nVALIDATION DE L'INTERPOLATION")
print("Date :", date)
print("Stations disponibles :", len(stations))
print("Stations testees :", len(erreurs_classique))

if erreurs_classique:
    erreur_a = moyenne(erreurs_classique)
    erreur_b = moyenne(erreurs_corrige)

    print(f"\nIDW classique : {erreur_a:.3f} °C")
    print(f"IDW avec relief : {erreur_b:.3f} °C")

    print(
        f"Difference : {erreur_a - erreur_b:+.3f} °C"
    )

    if erreur_b < erreur_a:
        print("La correction altimetrique ameliore le resultat.")
    else:
        print("La correction altimetrique n'ameliore pas le resultat.")
else:
    print("Pas assez de stations pour effectuer le test.")
