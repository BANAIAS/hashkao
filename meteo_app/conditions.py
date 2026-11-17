"""
HKO Météo — état du temps déduit des observations des stations.

Règle de conduite : on ne déduit que ce que les mesures permettent
d'affirmer. Chaque résultat indique sa source, et la valeur "sec"
signifie « pas de précipitation mesurée, état du ciel non mesuré ».

Mesures utilisées, par ordre de priorité :

1. précipitations sur 6 minutes (rr_per) et température -> pluie / neige
2. visibilité horizontale (vv)                          -> brouillard
3. nébulosité totale (n)                                -> état du ciel
4. rayonnement global sur 6 minutes (ray_glo01), de jour, comparé au
   rayonnement théorique par ciel clair                 -> état du ciel

Les orages ne sont jamais déduits : il faut des données de foudre.
"""

import math
from datetime import timezone

# Seuils d'intensité de pluie, en mm/h
PLUIE_MODEREE = 2.5
PLUIE_FORTE = 7.5

# Précipitation mesurée avec une température inférieure ou égale
# à ce seuil : affichée comme neige (type estimé, pas observé).
TEMPERATURE_NEIGE = 1.0

# Visibilité en mètres sous laquelle on parle de brouillard
VISIBILITE_BROUILLARD = 1000

# Rafale (km/h) à partir de laquelle le vent est signalé
RAFALE_SIGNALEE = 50

# Hauteur minimale du soleil (degrés) pour interpréter le rayonnement
HAUTEUR_SOLEIL_MIN = 10


def hauteur_soleil(date, latitude, longitude):
    """Hauteur du soleil au-dessus de l'horizon, en degrés."""
    date = date.astimezone(timezone.utc)

    jour = date.timetuple().tm_yday
    heure = date.hour + date.minute / 60 + date.second / 3600

    gamma = 2 * math.pi / 365 * (jour - 1 + (heure - 12) / 24)

    declinaison = (
        0.006918
        - 0.399912 * math.cos(gamma) + 0.070257 * math.sin(gamma)
        - 0.006758 * math.cos(2 * gamma) + 0.000907 * math.sin(2 * gamma)
        - 0.002697 * math.cos(3 * gamma) + 0.00148 * math.sin(3 * gamma)
    )

    equation_temps = 229.18 * (
        0.000075
        + 0.001868 * math.cos(gamma) - 0.032077 * math.sin(gamma)
        - 0.014615 * math.cos(2 * gamma) - 0.040849 * math.sin(2 * gamma)
    )

    temps_solaire = heure * 60 + equation_temps + 4 * longitude
    angle_horaire = math.radians(temps_solaire / 4 - 180)

    lat = math.radians(latitude)

    sinus = (
        math.sin(lat) * math.sin(declinaison)
        + math.cos(lat) * math.cos(declinaison) * math.cos(angle_horaire)
    )

    return math.degrees(math.asin(max(-1.0, min(1.0, sinus))))


def rayonnement_ciel_clair(hauteur):
    """Rayonnement global théorique par ciel clair (modèle de Haurwitz), W/m²."""
    cosinus = math.sin(math.radians(hauteur))

    if cosinus <= 0:
        return 0.0

    return 1098 * cosinus * math.exp(-0.059 / cosinus)


def unite_nebulosite(valeurs):
    """
    La nébulosité est publiée en octas (0 à 8) ou en pourcentage selon
    les flux. On tranche sur l'ensemble des stations d'un même créneau.
    """
    connues = [v for v in valeurs if v is not None]

    if not connues:
        return None

    return "pourcent" if max(connues) > 9 else "octas"


def _ciel_depuis_fraction(fraction):
    if fraction <= 0.2:
        return "soleil"
    if fraction <= 0.55:
        return "eclaircies"
    if fraction <= 0.85:
        return "nuageux"
    return "couvert"


def classer(observation, station, unite=None):
    """
    Renvoie l'état du temps d'une observation :

        {"code": ..., "jour": bool, "source": ..., "vent": bool}
    """
    hauteur = hauteur_soleil(
        observation.date, station.latitude, station.longitude
    )
    jour = hauteur > 0

    rafale = observation.rafale_vent
    vent = rafale is not None and rafale * 3.6 >= RAFALE_SIGNALEE

    resultat = {"code": "sec", "jour": jour, "source": None, "vent": vent}

    # 1. Précipitations mesurées
    pluie = observation.precipitation

    if pluie is not None and pluie > 0:
        intensite = pluie * 10  # mm sur 6 minutes -> mm/h
        temperature = observation.temperature

        if temperature is not None and temperature <= TEMPERATURE_NEIGE:
            resultat.update(code="neige", source="precipitation+temperature")
        elif intensite >= PLUIE_FORTE:
            resultat.update(code="pluie-forte", source="precipitation")
        elif intensite >= PLUIE_MODEREE:
            resultat.update(code="pluie", source="precipitation")
        else:
            resultat.update(code="pluie-faible", source="precipitation")

        return resultat

    # 2. Brouillard
    visibilite = getattr(observation, "visibilite", None)

    if visibilite is not None and 0 <= visibilite < VISIBILITE_BROUILLARD:
        resultat.update(code="brouillard", source="visibilite")
        return resultat

    # 3. Nébulosité mesurée
    nebulosite = getattr(observation, "nebulosite", None)

    if nebulosite is not None and unite:
        fraction = nebulosite / (100 if unite == "pourcent" else 8)

        if 0 <= fraction <= 1.13:  # 9 octas = ciel invisible
            resultat.update(
                code=_ciel_depuis_fraction(min(fraction, 1)),
                source="nebulosite",
            )
            return resultat

    # 4. Rayonnement global, de jour uniquement
    rayonnement = getattr(observation, "rayonnement", None)

    if rayonnement is not None and hauteur >= HAUTEUR_SOLEIL_MIN:
        theorique = rayonnement_ciel_clair(hauteur)

        if theorique > 0:
            indice = (rayonnement / 360) / theorique  # J/m² en 6 min -> W/m²

            if indice >= 0.75:
                code = "soleil"
            elif indice >= 0.5:
                code = "eclaircies"
            elif indice >= 0.25:
                code = "nuageux"
            else:
                code = "couvert"

            resultat.update(code=code, source="rayonnement")

    return resultat
