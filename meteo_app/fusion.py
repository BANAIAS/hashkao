"""
HKO Météo — moteur de fusion des conditions météorologiques.

Croise quatre sources sur la grille commune (sources/grille.py, 0,05°) et
décide, cellule par cellule, du temps qu'il fait, avec sa source et un
degré de confiance. Le moteur ne fait que des calculs sur des tableaux :
il est testé sans base de données ni réseau (meteo_app/tests.py).

Rôle des sources
----------------
    radar      précipitations : présence, intensité, couverture
    satellite  nuages : part de ciel clair, nuages partiels, opaques
    stations   mesures ponctuelles : température, pluie, visibilité, vent
    AROME      prévision : complète les trous, fournit les jours suivants

Fraîcheur maximale (au-delà, la source est ignorée)
---------------------------------------------------
    radar 20 min, satellite 40 min, stations 30 min,
    AROME : heure de validité à moins de 90 min de l'instant décrit.

Règles, dans l'ordre où elles s'appliquent
------------------------------------------
1. Précipitations
   a. Radar frais et cellule couverte à 50 % au moins : il fait foi.
      Pluie si 25 % au moins de la cellule reçoit >= 0,2 mm/h.
   b. Sinon, station à moins de 15 km avec une mesure : elle fait foi.
   c. Sinon, AROME (estimation du modèle, confiance faible).
   d. Sinon : inconnu. L'absence de mesure n'est jamais « temps sec ».
   Intensité (seuils OMM) : faible < 2,5 mm/h, modérée < 7,6, forte au-delà.

2. Type : neige si la température de la cellule est <= 1 °C, ou si AROME
   annonce de la neige et qu'il fait <= 2,5 °C. La température vient des
   stations voisines (ramenée à l'altitude de la cellule), sinon d'AROME.

3. Averses : précipitations présentes, mais sur moins de 40 % du
   voisinage (environ 35 km), avec au moins 35 % de ciel clair ou peu
   nuageux autour (satellite, sinon AROME). C'est la signature de cellules
   isolées séparées d'éclaircies.

4. Orage, seulement si deux indices indépendants coïncident : une
   intensité radar >= 25 mm/h dans le voisinage immédiat ET de la foudre
   prévue par AROME pour cette heure (> 0) à moins de 15 km. En prévision :
   foudre AROME et au moins 1 mm/h. Faute de mesure de foudre, la carte
   écrit « orage probable ».

5. Nébulosité
   a. Satellite frais, au moins 60 % de la cellule exploitable :
      N = part opaque + 0,6 x part partielle.
   b. Sinon AROME (nébulosité totale), sinon inconnue.
   c. Précipitations présentes (hors averses) : N >= 0,75.
   Désaccord signalé si le radar voit de la pluie sous un ciel clair
   (N satellite < 0,3) : la pluie est gardée (le radar mesure les
   précipitations) mais la confiance baisse.

6. Brouillard, sans précipitations : visibilité < 1 000 m mesurée par une
   station à moins de 20 km, ou visibilité AROME < 1 000 m sans que le
   satellite montre un ciel franchement clair de jour.

7. Catégorie affichée (première règle vraie) :
   orage > neige > forte pluie > averses > pluie modérée > pluie faible >
   brouillard > état du ciel selon N :
       N <= 0,15 ensoleillé        N <= 0,35 quelques nuages
       N <= 0,60 éclaircies        N <= 0,85 très nuageux    sinon couvert

Confiance (0 à 3)
-----------------
    3  précipitations ET ciel observés (radar, satellite), sans désaccord
    2  une seule des deux observée, l'autre par le modèle ou les stations
    1  modèle seul, ou désaccord entre sources
    0  rien de connu
Les cellules au-delà de 2 heures d'écart avec AROME, hors radar et hors
satellite, restent inconnues.
"""

import base64
import math
from datetime import datetime, timezone

import numpy as np

# ---------------------------------------------------------------------------
# Seuils
# ---------------------------------------------------------------------------

FRAICHEUR_MAX = {"radar": 20, "satellite": 40, "stations": 30}  # minutes
ECART_AROME_MAX = 90  # minutes

COUVERTURE_RADAR_MIN = 0.5
PART_PLUIE_MIN = 0.25
SEUIL_PLUIE = 0.2          # mm/h
PLUIE_MODEREE = 2.5        # mm/h (OMM)
PLUIE_FORTE = 7.6          # mm/h (OMM)

TEMPERATURE_NEIGE = 1.0
TEMPERATURE_NEIGE_MODELE = 2.5
GRADIENT_ALTITUDE = 0.0045  # °C par mètre (identique au tableau Températures)

VOISINAGE_AVERSES = 3      # cellules de part et d'autre (environ 35 km)
PART_PLUIE_AVERSES = 0.40
PART_CLAIR_AVERSES = 0.35

INTENSITE_ORAGE = 25.0     # mm/h
VOISINAGE_FOUDRE = 2       # cellules (environ 10 à 15 km)
PRECIPITATION_ORAGE_PREVUE = 1.0

VALIDE_SATELLITE_MIN = 0.6
POIDS_PARTIEL = 0.6
NEBULOSITE_SOUS_PLUIE = 0.75
CIEL_CLAIR_DESACCORD = 0.3

VISIBILITE_BROUILLARD = 1000  # m

DISTANCE_STATION_PLUIE = 15      # km
DISTANCE_STATION_VISIBILITE = 20
DISTANCE_STATION_VENT = 25
DISTANCE_STATION_TEMPERATURE = 50

SEUILS_CIEL = [(0.15, "soleil"), (0.35, "peu_nuageux"), (0.60, "eclaircies"),
               (0.85, "tres_nuageux"), (1.01, "couvert")]

CATEGORIES = [
    "inconnu", "soleil", "peu_nuageux", "eclaircies", "tres_nuageux", "couvert",
    "brouillard", "pluie_faible", "pluie_moderee", "pluie_forte", "averses",
    "neige", "orage",
]
CODE = {nom: i for i, nom in enumerate(CATEGORIES)}

# Sources, en bits
RADAR, SATELLITE, AROME, STATIONS = 1, 2, 4, 8


# ---------------------------------------------------------------------------
# Outils
# ---------------------------------------------------------------------------

def voisinage(tableau, rayon, operation="moyenne"):
    """
    Moyenne ou maximum sur un carré de (2 rayon + 1) cellules, en ignorant
    les NaN. Un résultat NaN signifie « aucune valeur connue autour ».
    """
    connu = np.isfinite(tableau)
    if operation == "maximum":
        rempli = np.where(connu, tableau, -np.inf)
        resultat = np.full(tableau.shape, -np.inf)
        ny, nx = tableau.shape
        for dy in range(-rayon, rayon + 1):
            for dx in range(-rayon, rayon + 1):
                decale = np.full(tableau.shape, -np.inf)
                decale[max(0, -dy):ny - max(0, dy), max(0, -dx):nx - max(0, dx)] = \
                    rempli[max(0, dy):ny - max(0, -dy), max(0, dx):nx - max(0, -dx)]
                resultat = np.maximum(resultat, decale)
        return np.where(np.isfinite(resultat), resultat, np.nan)

    valeurs = np.where(connu, tableau, 0.0)

    def somme_carre(t):
        c = np.pad(t, ((1, 0), (1, 0))).cumsum(0).cumsum(1)
        ny, nx = t.shape
        y0 = np.clip(np.arange(ny) - rayon, 0, ny)
        y1 = np.clip(np.arange(ny) + rayon + 1, 0, ny)
        x0 = np.clip(np.arange(nx) - rayon, 0, nx)
        x1 = np.clip(np.arange(nx) + rayon + 1, 0, nx)
        return (c[y1][:, x1] - c[y0][:, x1] - c[y1][:, x0] + c[y0][:, x0])

    total = somme_carre(valeurs)
    nombre = somme_carre(connu.astype(float))
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(nombre > 0, total / np.maximum(nombre, 1), np.nan)


def hauteur_soleil_grille(instant, longitudes, latitudes):
    """Hauteur du soleil (degrés) sur une grille (vectorisé)."""
    instant = instant.astimezone(timezone.utc)
    jour = instant.timetuple().tm_yday
    heure = instant.hour + instant.minute / 60 + instant.second / 3600
    gamma = 2 * math.pi / 365 * (jour - 1 + (heure - 12) / 24)

    declinaison = (
        0.006918 - 0.399912 * math.cos(gamma) + 0.070257 * math.sin(gamma)
        - 0.006758 * math.cos(2 * gamma) + 0.000907 * math.sin(2 * gamma)
        - 0.002697 * math.cos(3 * gamma) + 0.00148 * math.sin(3 * gamma)
    )
    equation = 229.18 * (
        0.000075 + 0.001868 * math.cos(gamma) - 0.032077 * math.sin(gamma)
        - 0.014615 * math.cos(2 * gamma) - 0.040849 * math.sin(2 * gamma)
    )

    lon, lat = np.meshgrid(longitudes, latitudes)
    angle = np.radians((heure * 60 + equation + 4 * lon) / 4 - 180)
    phi = np.radians(lat)
    sinus = np.sin(phi) * math.sin(declinaison) + np.cos(phi) * math.cos(declinaison) * np.cos(angle)
    return np.degrees(np.arcsin(np.clip(sinus, -1, 1)))


def _champ(source, nom, forme):
    if source is None or source.get(nom) is None:
        return np.full(forme, np.nan, dtype=np.float32)
    return np.asarray(source[nom], dtype=np.float32)


# ---------------------------------------------------------------------------
# Stations -> grille
# ---------------------------------------------------------------------------

def stations_sur_grille(stations, altitude_cellules=None):
    """
    Ramène des observations ponctuelles sur la grille.

    stations : liste de dicts (latitude, longitude, altitude, temperature °C,
               precipitation mm/h, visibilite m, rafale km/h, direction °)

    Renvoie des tableaux (NY, NX) : temperature (pondération par l'inverse
    de la distance, ramenée à l'altitude de la cellule), et pour les autres
    mesures la valeur de la station la plus proche qui en dispose, dans
    la limite de distance propre à chaque mesure.
    """
    from meteo_app.sources import grille

    lon_c, lat_c = grille.centres()
    lon, lat = np.meshgrid(lon_c, lat_c)
    forme = lon.shape
    cos_lat = math.cos(math.radians(46.5))

    def km(lo, la):
        return np.stack([np.asarray(lo) * 111.32 * cos_lat, np.asarray(la) * 110.57], axis=-1)

    cellules = km(lon.ravel(), lat.ravel())
    resultat = {}

    try:
        from scipy.spatial import cKDTree
    except ImportError:  # pragma: no cover
        cKDTree = None

    def plus_proches(points, k):
        if cKDTree is not None:
            distance, indice = cKDTree(points).query(cellules, k=k)
            if k == 1:
                distance, indice = distance[:, None], indice[:, None]
            return distance, indice
        d = np.linalg.norm(cellules[:, None, :] - points[None, :, :], axis=2)
        indice = np.argsort(d, axis=1)[:, :k]
        return np.take_along_axis(d, indice, axis=1), indice

    def disposant(nom):
        return [s for s in stations if s.get(nom) is not None and np.isfinite(s[nom])
                and s.get("latitude") is not None and s.get("longitude") is not None]

    # Température : 6 stations au plus, à moins de 50 km
    avec_t = disposant("temperature")
    if len(avec_t) >= 3:
        points = km([s["longitude"] for s in avec_t], [s["latitude"] for s in avec_t])
        k = min(6, len(avec_t))
        distance, indice = plus_proches(points, k)
        t = np.array([s["temperature"] for s in avec_t])
        alt = np.array([s.get("altitude") if s.get("altitude") is not None else np.nan for s in avec_t])
        cible = altitude_cellules.ravel() if altitude_cellules is not None else np.full(len(cellules), np.nan)

        valeurs = t[indice]
        correction = np.where(
            np.isfinite(cible)[:, None] & np.isfinite(alt[indice]),
            -GRADIENT_ALTITUDE * (cible[:, None] - alt[indice]), 0,
        )
        poids = np.where(distance <= DISTANCE_STATION_TEMPERATURE, 1 / np.maximum(distance, 1) ** 2, 0)
        with np.errstate(invalid="ignore", divide="ignore"):
            moyenne = (poids * (valeurs + correction)).sum(axis=1) / poids.sum(axis=1)
        resultat["temperature"] = np.where(poids.sum(axis=1) > 0, moyenne, np.nan).reshape(forme).astype(np.float32)

    for nom, limite in (("precipitation", DISTANCE_STATION_PLUIE),
                        ("visibilite", DISTANCE_STATION_VISIBILITE),
                        ("rafale", DISTANCE_STATION_VENT),
                        ("direction", DISTANCE_STATION_VENT)):
        avec = disposant(nom)
        if not avec:
            continue
        points = km([s["longitude"] for s in avec], [s["latitude"] for s in avec])
        distance, indice = plus_proches(points, 1)
        valeurs = np.array([s[nom] for s in avec], dtype=np.float32)[indice[:, 0]]
        resultat[nom] = np.where(distance[:, 0] <= limite, valeurs, np.nan).reshape(forme).astype(np.float32)

    return resultat


# ---------------------------------------------------------------------------
# Fusion
# ---------------------------------------------------------------------------

def fusionner(instant, radar=None, satellite=None, arome=None, stations=None,
              altitude=None, mode="observation"):
    """
    Applique les règles décrites en tête de module.

    instant    datetime UTC décrit par le résultat
    radar      sortie de radar.sur_grille + {"age": minutes}
    satellite  sortie de satellite.sur_grille + {"age": minutes}
    arome      champs normalisés (arome.normaliser) + {"ecart": minutes}
    stations   sortie de stations_sur_grille + {"age": minutes}
    mode       « observation » (instant présent ou passé) ou « prevision »
               (AROME seul)

    Renvoie un dictionnaire de tableaux (NY, NX) et un résumé.
    """
    from meteo_app.sources import grille

    forme = (grille.NY, grille.NX)

    def frais(source, nom):
        return source is not None and source.get("age", 1e9) <= FRAICHEUR_MAX[nom]

    if mode == "prevision":
        radar = satellite = stations = None
    else:
        radar = radar if frais(radar, "radar") else None
        satellite = satellite if frais(satellite, "satellite") else None
        stations = stations if frais(stations, "stations") else None

    arome_utilisable = arome is not None and abs(arome.get("ecart", 1e9)) <= ECART_AROME_MAX
    if not arome_utilisable:
        arome = None

    sources = np.zeros(forme, dtype=np.uint8)
    desaccord = np.zeros(forme, dtype=bool)

    # ----- 1. Précipitations ---------------------------------------------
    intensite = np.full(forme, np.nan, dtype=np.float32)
    origine_pluie = np.zeros(forme, dtype=np.uint8)  # bit de la source retenue

    if radar is not None:
        couvert = _champ(radar, "couverture", forme) >= COUVERTURE_RADAR_MIN
        part = _champ(radar, "pluie", forme)
        valeur = np.where(part >= PART_PLUIE_MIN, _champ(radar, "intensite", forme), 0.0)
        intensite = np.where(couvert, valeur, intensite)
        origine_pluie[couvert] = RADAR

    if stations is not None and stations.get("precipitation") is not None:
        st = _champ(stations, "precipitation", forme)
        libre = (origine_pluie == 0) & np.isfinite(st)
        intensite[libre] = st[libre]
        origine_pluie[libre] = STATIONS

    if arome is not None and arome.get("precipitation") is not None:
        ar = _champ(arome, "precipitation", forme)
        libre = (origine_pluie == 0) & np.isfinite(ar)
        intensite[libre] = ar[libre]
        origine_pluie[libre] = AROME

    sources |= origine_pluie
    pluie = np.nan_to_num(intensite) >= SEUIL_PLUIE

    # ----- 2. Température et type -----------------------------------------
    temperature = np.full(forme, np.nan, dtype=np.float32)
    if stations is not None and stations.get("temperature") is not None:
        temperature = _champ(stations, "temperature", forme)
    if arome is not None and arome.get("temperature") is not None:
        ta = _champ(arome, "temperature", forme)
        temperature = np.where(np.isfinite(temperature), temperature, ta)

    type_modele = _champ(arome, "type_precipitation", forme)
    from meteo_app.sources.arome import CODES_NEIGE
    neige_modele = np.isin(np.nan_to_num(type_modele, nan=-1).astype(int), list(CODES_NEIGE))

    neige = pluie & (
        (np.nan_to_num(temperature, nan=99) <= TEMPERATURE_NEIGE)
        | (neige_modele & (np.nan_to_num(temperature, nan=99) <= TEMPERATURE_NEIGE_MODELE))
        | (neige_modele & ~np.isfinite(temperature))
    )

    # ----- 5a/b. Nébulosité ------------------------------------------------
    nebulosite = np.full(forme, np.nan, dtype=np.float32)
    origine_ciel = np.zeros(forme, dtype=np.uint8)
    nebulosite_satellite = np.full(forme, np.nan, dtype=np.float32)

    if satellite is not None:
        exploitable = _champ(satellite, "valide", forme) >= VALIDE_SATELLITE_MIN
        n_sat = _champ(satellite, "opaque", forme) + POIDS_PARTIEL * _champ(satellite, "partiel", forme)
        nebulosite_satellite = np.where(exploitable, n_sat, np.nan)
        nebulosite = np.where(exploitable, n_sat, nebulosite)
        origine_ciel[exploitable & np.isfinite(n_sat)] = SATELLITE

    if arome is not None and arome.get("nebulosite") is not None:
        n_ar = _champ(arome, "nebulosite", forme)
        libre = (origine_ciel == 0) & np.isfinite(n_ar)
        nebulosite[libre] = n_ar[libre]
        origine_ciel[libre] = AROME

    sources |= origine_ciel

    # ----- 3. Averses ---------------------------------------------------------
    connue = np.where(origine_pluie > 0, pluie.astype(float), np.nan)
    part_pluie_autour = voisinage(connue, VOISINAGE_AVERSES)
    clair = np.where(np.isfinite(nebulosite), (nebulosite <= 0.6).astype(float), np.nan)
    part_clair_autour = voisinage(clair, VOISINAGE_AVERSES)

    averses = (
        pluie & ~neige
        & (np.nan_to_num(part_pluie_autour, nan=1) < PART_PLUIE_AVERSES)
        & (np.nan_to_num(part_clair_autour, nan=0) >= PART_CLAIR_AVERSES)
    )

    # ----- 5c. Ciel sous la pluie, désaccords -----------------------------
    sous_pluie = pluie & ~averses
    desaccord |= (
        (origine_pluie == RADAR) & pluie
        & (np.nan_to_num(nebulosite_satellite, nan=1) < CIEL_CLAIR_DESACCORD)
    )
    nebulosite = np.where(sous_pluie, np.fmax(np.nan_to_num(nebulosite, nan=0), NEBULOSITE_SOUS_PLUIE), nebulosite)

    # ----- 4. Orage ------------------------------------------------------------
    foudre = _champ(arome, "foudre", forme)
    foudre_autour = voisinage(foudre, VOISINAGE_FOUDRE, "maximum")

    if mode == "prevision":
        orage = (np.nan_to_num(foudre_autour) > 0) & (np.nan_to_num(intensite) >= PRECIPITATION_ORAGE_PREVUE)
    else:
        maximum_radar = _champ(radar, "maximum", forme)
        intense = np.nan_to_num(voisinage(maximum_radar, 1, "maximum")) >= INTENSITE_ORAGE
        orage = intense & (np.nan_to_num(foudre_autour) > 0) & pluie

    # ----- 6. Brouillard ----------------------------------------------------
    brouillard = np.zeros(forme, dtype=bool)
    origine_brouillard = np.zeros(forme, dtype=np.uint8)

    if stations is not None and stations.get("visibilite") is not None:
        vis = _champ(stations, "visibilite", forme)
        b = np.nan_to_num(vis, nan=1e9) < VISIBILITE_BROUILLARD
        brouillard |= b
        origine_brouillard[b] = STATIONS

    if arome is not None and arome.get("visibilite") is not None:
        vis_m = _champ(arome, "visibilite", forme)
        jour = hauteur_soleil_grille(instant, *grille.centres()) > 5
        satellite_clair = (
            np.nan_to_num(nebulosite_satellite, nan=1) < 0.2
        ) & jour
        b = (np.nan_to_num(vis_m, nan=1e9) < VISIBILITE_BROUILLARD) & ~satellite_clair & ~brouillard
        brouillard |= b
        origine_brouillard[b] = AROME

    brouillard &= ~pluie
    sources |= np.where(brouillard, origine_brouillard, 0).astype(np.uint8)

    # ----- Vent ---------------------------------------------------------------
    rafale = np.full(forme, np.nan, dtype=np.float32)
    direction = np.full(forme, np.nan, dtype=np.float32)
    if stations is not None:
        rafale = _champ(stations, "rafale", forme)
        direction = _champ(stations, "direction", forme)
    if arome is not None:
        r_ar = _champ(arome, "rafale", forme)
        rafale = np.where(np.isfinite(rafale), rafale, r_ar)
        u, v = _champ(arome, "vent_u", forme), _champ(arome, "vent_v", forme)
        # Direction d'où vient le vent, en degrés (convention météo)
        d_ar = (np.degrees(np.arctan2(-u, -v)) + 360) % 360
        direction = np.where(np.isfinite(direction), direction, d_ar)

    # ----- 7. Catégorie ---------------------------------------------------------
    categorie = np.full(forme, CODE["inconnu"], dtype=np.uint8)

    n = np.nan_to_num(nebulosite, nan=-1)
    for seuil, nom in reversed(SEUILS_CIEL):
        categorie = np.where((n >= 0) & (n <= seuil), CODE[nom], categorie)

    categorie = np.where(brouillard, CODE["brouillard"], categorie)
    i = np.nan_to_num(intensite)
    categorie = np.where(pluie, CODE["pluie_faible"], categorie)
    categorie = np.where(pluie & (i >= PLUIE_MODEREE), CODE["pluie_moderee"], categorie)
    categorie = np.where(averses, CODE["averses"], categorie)
    categorie = np.where(pluie & (i >= PLUIE_FORTE) & ~averses, CODE["pluie_forte"], categorie)
    categorie = np.where(neige, CODE["neige"], categorie)
    categorie = np.where(orage, CODE["orage"], categorie)

    # ----- Confiance --------------------------------------------------------
    observe_pluie = (origine_pluie == RADAR) | (origine_pluie == STATIONS)
    observe_ciel = origine_ciel == SATELLITE

    confiance = np.zeros(forme, dtype=np.uint8)
    confiance[(origine_pluie > 0) | (origine_ciel > 0)] = 1
    confiance[observe_pluie | observe_ciel] = 2
    confiance[(origine_pluie == RADAR) & observe_ciel] = 3
    confiance = np.where(desaccord, np.minimum(confiance, 1), confiance).astype(np.uint8)
    confiance[categorie == CODE["inconnu"]] = 0

    # ----- Jour / nuit --------------------------------------------------------
    hauteur = hauteur_soleil_grille(instant, *grille.centres())

    return {
        "categorie": categorie,
        "nebulosite": nebulosite,
        "intensite": intensite,
        "neige": neige,
        "averses": averses,
        "orage": orage,
        "brouillard": brouillard,
        "temperature": temperature,
        "rafale": rafale,
        "direction": direction,
        "confiance": confiance,
        "sources": sources,
        "desaccord": desaccord,
        "jour": hauteur > 0,
    }


# ---------------------------------------------------------------------------
# Encodage pour le navigateur
# ---------------------------------------------------------------------------

def _octets(tableau, conversion):
    return base64.b64encode(conversion(tableau).astype(np.uint8).tobytes()).decode("ascii")


def encoder(resultat, instant, mode, provenance):
    """
    Encode le résultat en JSON compact : une chaîne base64 d'octets par
    champ, ligne par ligne (la ligne 0 est au nord). 255 = inconnu.
    """
    from meteo_app.sources import grille

    def pourcent(t):
        return np.where(np.isfinite(t), np.clip(np.round(t * 100), 0, 100), 255)

    def intensite(t):  # dixièmes de mm/h, plafonnés à 25 mm/h
        return np.where(np.isfinite(t), np.clip(np.round(t * 10), 0, 254), 255)

    def temperature(t):  # demi-degrés à partir de -40 °C
        return np.where(np.isfinite(t), np.clip(np.round((t + 40) * 2), 0, 254), 255)

    def kmh(t):
        return np.where(np.isfinite(t), np.clip(np.round(t), 0, 254), 255)

    def angle(t):  # degrés / 2
        return np.where(np.isfinite(t), np.round(t / 2) % 180, 255)

    drapeaux = (
        resultat["neige"].astype(np.uint8)
        | (resultat["averses"].astype(np.uint8) << 1)
        | (resultat["orage"].astype(np.uint8) << 2)
        | (resultat["brouillard"].astype(np.uint8) << 3)
        | (resultat["desaccord"].astype(np.uint8) << 4)
        | (resultat["jour"].astype(np.uint8) << 5)
    )

    masque_france = grille.masques()["france"] >= 0.5
    categories = resultat["categorie"][masque_france]
    comptes = {
        CATEGORIES[c]: int(n) for c, n in zip(*np.unique(categories, return_counts=True))
    }

    return {
        "version": 1,
        "instant": instant.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "mode": mode,
        "grille": grille.description(),
        "categories": CATEGORIES,
        "provenance": provenance,
        "resume_france": comptes,
        "champs": {
            "categorie": _octets(resultat["categorie"], lambda t: t),
            "nebulosite": _octets(resultat["nebulosite"], pourcent),
            "intensite": _octets(resultat["intensite"], intensite),
            "temperature": _octets(resultat["temperature"], temperature),
            "rafale": _octets(resultat["rafale"], kmh),
            "direction": _octets(resultat["direction"], angle),
            "confiance": _octets(resultat["confiance"], lambda t: t),
            "sources": _octets(resultat["sources"], lambda t: t),
            "drapeaux": _octets(drapeaux, lambda t: t),
        },
    }


def maintenant():
    return datetime.now(timezone.utc)
