"""
Contrôle qualité des températures observées pour HKO Météo.

Les observations originales restent intactes en base.
Les mesures suspectes sont écartées de la représentation graphique.
"""

from math import cos, radians, hypot, isfinite
from statistics import median
from statistics import median

import numpy as np
from scipy.spatial import cKDTree


TEMPERATURE_MIN = -40.0
TEMPERATURE_MAX = 50.0

RAYON_KM = 60
ALTITUDE_ECART_MAX = 300
NOMBRE_VOISINES = 8
MIN_VOISINES = 4
SEUIL_ECART = 8.0
GRADIENT_ALTITUDE = 0.0045


def nombre_valide(valeur):
    return valeur is not None and isfinite(valeur)


def distance_km(a, b):
    """Distance géographique approximative, adaptée aux faibles distances."""

    latitude_moyenne = radians(
        (a.latitude + b.latitude) / 2
    )

    dx = (
        (a.longitude - b.longitude)
        * 111.32
        * cos(latitude_moyenne)
    )

    dy = (a.latitude - b.latitude) * 111.32

    return hypot(dx, dy)


def controler_temperatures(observations):
    """
    Renvoie un dictionnaire des stations dont la température
    est jugée suspecte, accompagné du motif.
    """

    anomalies = {}
    valides = []

    # Niveau 1 : contrôle des limites physiques.
    for observation in observations:
        t = observation.temperature
        identifiant = observation.station.identifiant

        if t is None:
            continue

        if not nombre_valide(t):
            anomalies[identifiant] = {
                "motif": "valeur_non_finie"
            }
            continue

        if not TEMPERATURE_MIN <= t <= TEMPERATURE_MAX:
            anomalies[identifiant] = {
                "motif": "hors_limites",
                "temperature": t
            }
            continue

        valides.append(observation)

    if not valides:
        return anomalies

    # Index spatial des stations valides.
    coordonnees = np.array([
        [o.station.latitude, o.station.longitude]
        for o in valides
    ])

    arbre = cKDTree(coordonnees)

    # Rayon conservateur en degrés, couvrant toute
    # la France métropolitaine, Corse comprise.
    rayon_recherche = 1.0

    # Niveau 2 : cohérence avec les stations voisines.
    for i, observation in enumerate(valides):
        station = observation.station

        if not nombre_valide(station.altitude):
            continue

        voisines = []

        indices = arbre.query_ball_point(
            coordonnees[i], rayon_recherche
        )

        for indice in indices:
            autre = valides[indice]
            if autre.station_id == observation.station_id:
                continue

            voisine = autre.station

            if not nombre_valide(voisine.altitude):
                continue

            ecart_altitude = station.altitude - voisine.altitude

            if abs(ecart_altitude) > ALTITUDE_ECART_MAX:
                continue

            distance = distance_km(station, voisine)

            if distance > RAYON_KM:
                continue

            temperature_corrigee = (
                autre.temperature
                - GRADIENT_ALTITUDE * ecart_altitude
            )

            voisines.append((distance, temperature_corrigee))

        if len(voisines) < MIN_VOISINES:
            continue

        voisines.sort(key=lambda v: v[0])

        temperatures = [
            v[1] for v in voisines[:NOMBRE_VOISINES]
        ]

        reference = median(temperatures)
        ecart = observation.temperature - reference

        # Ne pas conclure si les voisines sont elles-mêmes
        # trop dispersées (front météorologique, par exemple).
        dispersion = median(
            abs(t - reference) for t in temperatures
        )

        seuil = max(SEUIL_ECART, 4 * dispersion)

        if abs(ecart) > seuil:
            anomalies[station.identifiant] = {
                "motif": "incoherence_spatiale",
                "temperature": observation.temperature,
                "reference": round(reference, 2),
                "ecart": round(ecart, 2),
                "voisines": len(temperatures)
            }

    return anomalies