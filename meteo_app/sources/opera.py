
"""
HKO Météo — grille de visualisation du radar européen OPERA.

Cette grille est indépendante de la grille commune de fusion.
"""

import numpy as np

OUEST = -16.0
EST = 22.0
SUD = 34.0
NORD = 60.0

PAS = 0.025

NX = round((EST - OUEST) / PAS)
NY = round((NORD - SUD) / PAS)

PAS_MINUTES = 15

ATTRIBUTION = (
    "EUMETNET OPERA — CC BY 4.0 — "
    "Données reprojetées et colorisées par HKO Météo"
)


def description():
    return {
        "ouest": OUEST,
        "est": EST,
        "sud": SUD,
        "nord": NORD,
        "pas": PAS,
        "nx": NX,
        "ny": NY,
    }


def coordonnees():
    """Coordonnées du centre de chaque cellule."""
    lon = OUEST + (np.arange(NX) + 0.5) * PAS
    lat = NORD - (np.arange(NY) + 0.5) * PAS

    return np.meshgrid(lon, lat)


def sur_grille(mosaique):
    """Reprojette OPERA sur la grille de visualisation HKO."""

    m = mosaique

    if m["quantite"] != "RATE":
        raise ValueError("Une mosaïque OPERA RATE est attendue.")

    lon, lat = coordonnees()
    x, y = m["vers_radar"].transform(lon, lat)

    colonne = np.floor(
        (x - m["x_gauche"]) / m["pas_x"]
    ).astype(np.int64)

    ligne = np.floor(
        (m["y_haut"] - y) / m["pas_y"]
    ).astype(np.int64)

    valide = (
        (colonne >= 0)
        & (colonne < m["colonnes"])
        & (ligne >= 0)
        & (ligne < m["lignes"])
    )

    intensite = np.zeros((NY, NX), dtype=np.float32)
    mesure = np.zeros((NY, NX), dtype=bool)

    intensite[valide] = m["intensite"][
        ligne[valide], colonne[valide]
    ]

    mesure[valide] = m["mesure"][
        ligne[valide], colonne[valide]
    ]

    mesure &= np.isfinite(intensite)

    intensite = np.where(
        mesure,
        np.maximum(intensite, 0),
        np.nan
    ).astype(np.float32)

    pluie = np.where(
        mesure,
        intensite >= 0.2,
        np.nan
    ).astype(np.float32)

    return {
        "intensite": intensite,
        "pluie": pluie,
        "couverture": mesure.astype(np.float32),
    }
