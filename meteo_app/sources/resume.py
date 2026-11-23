"""
HKO Météo — « Résumé du jour » : de la journée close à la partition du film.

Après la clôture d'une journée (heure de Paris), ce module lit ce que HKO a
déjà en base et en archive, et produit un seul fichier JSON léger, la
« partition » :

    publication/derives/resume/AAAA-MM-JJ.json      (≈ 1 à 1,5 Mo)

Le film de 40 s est joué dans le navigateur à partir de ce seul fichier
(static/meteo_app/js/hko_resume_*.js) : aucun rendu vidéo sur le serveur.

Données lues (rien n'est téléchargé) :
  - observations des stations, toutes les 6 min (ObservationMeteo) ;
  - grilles OPERA archivées (ProduitMeteo source « opera ») ;
  - cartes des conditions fusionnées (ProduitMeteo source « fusion »).

Tout ce qui apparaît à l'écran est décidé ici, par des règles : titre,
puces, phrases, chiffre du jour, villes, extrêmes contrôlés, événements
horodatés, fenêtre radar. Les heures de la partition sont des heures
écoulées depuis minuit (heure de Paris) : 0 à 24 (23 ou 25 les jours de
changement d'heure, où l'affichage peut être décalé d'une heure après 3 h).

Mesuré sur deux journées réelles : ≈ 10 s de calcul, < 400 Mo de mémoire.
"""

import base64
import collections
import gzip
import io
import json
import math
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from .commun import absolu
from .derives import PARIS, bornes_jour, ecrire_fichier_atomique, racine_derives

VERSION = 2

RELIEF = Path(__file__).resolve().parents[1] / "static" / "meteo_app" / "relief" / "hko_relief.json.gz"

# Cadre des champs de température (France métropolitaine et Corse)
T_OUEST, T_SUD, T_EST, T_NORD, T_PAS = -5.6, 41.2, 9.8, 51.3, 0.08
# Grille des conditions fusionnées (0,05°, ligne 0 au nord)
G_OUEST, G_NORD, G_PAS = -6.5, 52.0, 0.05
# Grille OPERA du site (0,025°, ligne 0 au nord), recadrée sur l'écran du film
O_OUEST, O_NORD, O_PAS = -16.0, 60.0, 0.025
C_OUEST, C_EST, C_SUD, C_NORD = -15.0, 17.0, 35.5, 57.0

GRADIENT = 0.0065           # °C par mètre (décroissance standard)
MONTAGNE = 1000             # au-dessus : sommets, exclus des chiffres « grand public »
PAS = 360                   # secondes entre deux observations (6 min)

JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août",
        "septembre", "octobre", "novembre", "décembre"]

# Villes repères : une station de référence chacune (identifiants Météo-France)
VILLES = [
    ("Lille", "59343001", 3.06, 50.63), ("Paris", "75114001", 2.35, 48.86),
    ("Strasbourg", "67124001", 7.75, 48.58), ("Brest", "29075001", -4.49, 48.39),
    ("Nantes", "44020001", -1.55, 47.22), ("Dijon", "21473001", 5.04, 47.32),
    ("Lyon", "69029001", 4.84, 45.76), ("Clermont-Ferrand", "63113001", 3.09, 45.78),
    ("Bordeaux", "33281001", -0.58, 44.84), ("Toulouse", "31069001", 1.44, 43.60),
    ("Marseille", "13055001", 5.37, 43.30), ("Nice", "06088001", 7.26, 43.70),
    ("Ajaccio", "20004002", 8.74, 41.93), ("Rouen", "76116001", 1.10, 49.44),
]

# Catégories de la fusion -> symboles du site
SYMBOLES = {"soleil": "soleil", "peu_nuageux": "eclaircies", "eclaircies": "eclaircies",
            "tres_nuageux": "nuageux", "couvert": "couvert", "brouillard": "brouillard",
            "pluie_faible": "pluie-faible", "pluie_moderee": "pluie", "pluie_forte": "pluie-forte",
            "averses": "pluie", "neige": "neige", "orage": "orage"}

SOURCES = "Observations : Météo-France. Radar : EUMETNET OPERA (CC BY 4.0). Fusion : HKO Météo."


class DonneesInsuffisantes(Exception):
    """La journée n'a pas assez de mesures pour un résumé honnête."""


# ---------------------------------------------------------------------------
# Outils
# ---------------------------------------------------------------------------

def fr(v, d=0):
    return f"{v:.{d}f}".replace(".", ",").replace("-", "−")


def png_b64(tableau):
    """uint8 2D -> PNG niveaux de gris en base64."""
    from PIL import Image

    tampon = io.BytesIO()
    Image.fromarray(np.asarray(tableau, dtype=np.uint8), "L").save(tampon, "PNG", optimize=True)
    return base64.b64encode(tampon.getvalue()).decode()


def soleil(jour, lon=2.35, lat=48.86):
    """Lever et coucher (heure locale décimale), formule NOAA simplifiée."""
    n = jour.timetuple().tm_yday
    g = 2 * math.pi / 365 * (n - 1)
    eqt = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g)
                    - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))
    decl = (0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g) - 0.006758 * math.cos(2 * g)
            + 0.000907 * math.sin(2 * g) - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g))
    ha = math.degrees(math.acos(math.cos(math.radians(90.833)) / (math.cos(math.radians(lat)) * math.cos(decl))
                                - math.tan(math.radians(lat)) * math.tan(decl)))
    midi = datetime(jour.year, jour.month, jour.day, 12, tzinfo=PARIS)
    decalage = midi.utcoffset().total_seconds() / 3600
    return (round((720 - 4 * (lon + ha) - eqt) / 60 + decalage, 3),
            round((720 - 4 * (lon - ha) - eqt) / 60 + decalage, 3))


def reduire(a, f=2):
    h, w = a.shape
    return a[:h - h % f, :w - w % f].reshape(h // f, f, w // f, f).mean(axis=(1, 3))


def chemin_partition(jour):
    return racine_derives("resume") / f"{jour.isoformat()}.json"


def lire_partition(jour):
    chemin = chemin_partition(jour)
    if not chemin.is_file():
        return None
    try:
        return json.loads(chemin.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Observations des stations
# ---------------------------------------------------------------------------

CHAMPS = ["temperature", "precipitation", "rafale_vent", "insolation",
          "vitesse_vent", "direction_vent"]


def lire_stations(debut, fin):
    """Séries à pas de 6 min depuis minuit (heure de Paris), par station."""
    from meteo_app.models import ObservationMeteo

    n = int(round((fin - debut).total_seconds() / PAS))
    meta, series = {}, {}
    lignes = (ObservationMeteo.objects
              .filter(date__gte=debut, date__lt=fin)
              .values_list("station__identifiant", "station__nom", "station__commune",
                           "station__latitude", "station__longitude", "station__altitude",
                           "date", *CHAMPS)
              .iterator(chunk_size=20000))
    for ident, nom, commune, la, lo, al, quand, *valeurs in lignes:
        if la is None or lo is None or not (41.2 < la < 51.3 and -5.6 < lo < 9.8):
            continue
        k = int((quand - debut).total_seconds() // PAS)
        if not 0 <= k < n:
            continue
        if ident not in meta:
            meta[ident] = {"nom": nom, "commune": commune or nom, "lat": la, "lon": lo, "alt": al or 0}
            series[ident] = {c: np.full(n, np.nan, np.float32) for c in CHAMPS}
        s = series[ident]
        for c, v in zip(CHAMPS, valeurs):
            if v is not None:
                s[c][k] = v
    return meta, series, n


def controler_temperatures(meta, series, n):
    """Contrôle spatial : une valeur trop éloignée de ses voisines (à altitude égale)
    est écartée ; une station souvent en désaccord est écartée entière."""
    from scipy.spatial import cKDTree
    import warnings

    ids = [i for i in meta if np.isfinite(series[i]["temperature"]).sum() > n // 2]
    if len(ids) < 20:
        return set()
    xy = np.array([[meta[i]["lon"] * math.cos(math.radians(46.5)), meta[i]["lat"]] for i in ids])
    alt = np.array([meta[i]["alt"] for i in ids])
    T = np.array([series[i]["temperature"] for i in ids])
    T[(T < -35) | (T > 47)] = np.nan
    T0 = T + GRADIENT * alt[:, None]
    _, voisins = cKDTree(xy).query(xy, k=11)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        med = np.nanmedian(T0[voisins[:, 1:], :], axis=1)
    ecart = np.abs(T0 - med)
    mauvais = np.isfinite(ecart) & (ecart > 8)
    T[mauvais] = np.nan
    exclues = {ids[j] for j in range(len(ids)) if mauvais[j].sum() >= 24}
    for j, i in enumerate(ids):
        s = T[j]
        if i in exclues:
            s[:] = np.nan
        else:
            # Pics isolés : plus de 5 °C d'écart à la médiane glissante d'une heure
            for k in range(n):
                fen = s[max(0, k - 5):k + 6]
                if np.isfinite(s[k]) and np.isfinite(fen).sum() >= 3 and abs(s[k] - np.nanmedian(fen)) > 5:
                    s[k] = np.nan
        series[i]["temperature"] = s
    return exclues


def serie_horaire(T, nh, trou_max=3):
    """Une valeur par heure : moyenne des mesures à ± 18 min, trous courts comblés."""
    h = np.full(nh, np.nan, np.float32)
    for hu in range(nh):
        fen = T[max(0, hu * 10 - 3):hu * 10 + 4]
        if np.isfinite(fen).any():
            h[hu] = np.nanmean(fen)
    ok = np.where(np.isfinite(h))[0]
    for a, b in zip(ok[:-1], ok[1:]):
        if 1 < b - a <= trou_max + 1:
            h[a + 1:b] = np.interp(np.arange(a + 1, b), [a, b], [h[a], h[b]])
    return h


def grille_altitude(lons, lats):
    r = json.load(gzip.open(RELIEF))
    rl, rh, (ro, rs, re_, rn) = r["largeur"], r["hauteur"], r["bounds"]
    a = np.array([0 if v is None else v for v in r["altitudes"]], np.float32).reshape(rh, rl)
    gx = np.clip(((lons - ro) * r["resolution"]).astype(int), 0, rl - 1)
    gy = np.clip(((rn - lats) * r["resolution"]).astype(int), 0, rh - 1)
    return np.maximum(a[gy, gx], 0)


def champ_temperatures(meta, series, nh):
    """Une grille par heure : noyau gaussien des températures ramenées au niveau
    de la mer, puis relief réappliqué. Codage : T = v / 4 - 20."""
    from scipy.spatial import cKDTree

    nx = int(round((T_EST - T_OUEST) / T_PAS)); ny = int(round((T_NORD - T_SUD) / T_PAS))
    lons = T_OUEST + (np.arange(nx) + 0.5) * T_PAS
    lats = T_NORD - (np.arange(ny) + 0.5) * T_PAS
    LO, LA = np.meshgrid(lons, lats)
    alt = grille_altitude(LO, LA)
    c = math.cos(math.radians(46.5))
    horaires = {i: serie_horaire(series[i]["temperature"], nh) for i in meta}
    images, heures = [], []
    for hu in range(nh):
        pts, vals = [], []
        for i, m in meta.items():
            v = horaires[i][hu]
            if np.isfinite(v):
                pts.append([m["lon"] * c, m["lat"]]); vals.append(v + GRADIENT * m["alt"])
        if len(pts) < 30:
            continue
        pts, vals = np.array(pts), np.array(vals)
        d, j = cKDTree(pts).query(np.c_[LO.ravel() * c, LA.ravel()], k=14)
        w = np.exp(-(d / 0.16) ** 2) + 1e-4 / (d + 0.05) ** 2
        T = ((w * vals[j]).sum(1) / w.sum(1)).reshape(ny, nx) - GRADIENT * alt
        images.append(np.clip(np.round((T + 20) * 4), 0, 255))
        heures.append(hu)
    if len(heures) < nh * 0.7:
        raise DonneesInsuffisantes("Trop d'heures sans températures.")
    return {"ouest": T_OUEST, "nord": T_NORD, "pas": T_PAS, "nx": nx, "ny": ny,
            "heures": heures, "codage": "T = v / 4 - 20", "png": png_b64(np.vstack(images))}


# ---------------------------------------------------------------------------
# Radar OPERA et conditions fusionnées
# ---------------------------------------------------------------------------

def produits(source, debut, fin):
    from meteo_app.models import ProduitMeteo

    return list(ProduitMeteo.objects
                .filter(source=source, nature="observation", instant__gte=debut, instant__lt=fin)
                .order_by("instant"))


def pile_opera(debut, fin, duree_h=6.0):
    """Les 6 h les plus pluvieuses sur la France, image par image (15 min), à
    0,05° sur tout l'écran du film. None si OPERA manque. Codage : mm/h = 2^(v/40) - 1."""
    liste = [p for p in produits("opera", debut, fin) if absolu(p.fichier).is_file()]
    if len(liste) < 8:
        return None
    c0, c1 = int(round((C_OUEST - O_OUEST) / O_PAS)), int(round((C_EST - O_OUEST) / O_PAS))
    r0, r1 = int(round((O_NORD - C_NORD) / O_PAS)), int(round((O_NORD - C_SUD) / O_PAS))
    fr0, fr1 = int((C_NORD - 51.2) / 0.05), int((C_NORD - 41.3) / 0.05)
    fc0, fc1 = int((-5.0 - C_OUEST) / 0.05), int((9.6 - C_OUEST) / 0.05)
    scores, images, temps = [], [], []
    for p in liste:
        try:
            with np.load(absolu(p.fichier), allow_pickle=False) as z:
                mm = np.nan_to_num(z["intensite"][r0:r1, c0:c1].astype(np.float32), nan=0.0)
        except (OSError, KeyError, ValueError):
            continue
        mm = np.clip(reduire(mm), 0, 150)
        scores.append(float(mm[fr0:fr1, fc0:fc1].sum()))
        images.append(np.clip(np.round(40 * np.log2(1 + mm)), 0, 255).astype(np.uint8))
        temps.append(p.instant)
    if len(images) < 8:
        return None
    n = int(duree_h * 4) + 1
    meilleur, i0 = -1.0, 0
    for i in range(0, max(1, len(images) - n + 1)):
        if (temps[min(len(temps), i + n) - 1] - temps[i]).total_seconds() > duree_h * 3600 + 60:
            continue                                   # trous dans la fenêtre
        sc = sum(scores[i:i + n])
        if sc > meilleur:
            meilleur, i0 = sc, i
    retenus = range(i0, min(len(images), i0 + n))
    heures = [round((temps[i] - debut).total_seconds() / 3600, 4) for i in retenus]
    pile = np.vstack([images[i] for i in retenus])
    return {"ouest": C_OUEST, "nord": C_NORD, "sud": C_SUD, "est": C_EST, "pas": 0.05,
            "nx": int(pile.shape[1]), "ny": int(pile.shape[0] // len(heures)), "heures": heures,
            "codage": "mm/h = 2^(v/40) - 1", "source": "EUMETNET OPERA", "png": png_b64(pile)}


def conditions(debut, fin):
    """Cartes de la fusion aux heures rondes : {heure écoulée : (catégories, noms, bilan)}."""
    sortie = {}
    for p in produits("fusion", debut, fin):
        if p.instant.minute != 0:
            continue
        try:
            with gzip.open(absolu(p.fichier)) as f:
                d = json.load(f)
        except (OSError, ValueError):
            continue
        g = d["grille"]
        cat = np.frombuffer(base64.b64decode(d["champs"]["categorie"]), np.uint8).reshape(g["ny"], g["nx"])
        sortie[int(round((p.instant - debut).total_seconds() / 3600))] = (cat, d["categories"], d.get("resume_france", {}))
    return sortie


def categorie_ville(cond, h, lon, lat):
    cat, noms, _ = cond[h]
    y, x = int((G_NORD - lat) / G_PAS), int((lon - G_OUEST) / G_PAS)
    bloc = cat[max(0, y - 1):y + 2, max(0, x - 1):x + 2].ravel()
    bloc = bloc[bloc > 0]
    if not len(bloc):
        return None
    # La catégorie « marquante » l'emporte si elle couvre au moins 3 cellules sur 9
    valeurs, nombres = np.unique(bloc, return_counts=True)
    ordre = sorted(zip(nombres, valeurs), reverse=True)
    choix = ordre[0][1]
    for nb, v in ordre:
        if noms[v] in ("orage", "neige", "pluie_forte", "pluie_moderee", "averses", "brouillard") and nb >= 3:
            choix = v
            break
    return SYMBOLES.get(noms[choix])


# ---------------------------------------------------------------------------
# Lecture de la journée : indicateurs, puis récit
# ---------------------------------------------------------------------------

def indicateurs(meta, series, cond, n):
    seuil = int(n * 0.75)
    tx, tn, pluie, rafale, insol = [], [], [], [], []
    for i in meta:
        s = series[i]
        T = s["temperature"]
        if np.isfinite(T).sum() >= seuil:
            k = int(np.nanargmax(T)); tx.append((float(T[k]), i, k / 10))
            k = int(np.nanargmin(T)); tn.append((float(T[k]), i, k / 10))
        P = s["precipitation"]
        if np.isfinite(P).sum() >= seuil:
            P = np.where((P >= 0) & (P < 30), P, np.nan)
            horaire = np.convolve(np.nan_to_num(P), np.ones(10), "same")
            k = int(np.argmax(horaire))
            pluie.append((float(np.nansum(P)), i, k / 10, float(horaire[k])))
        R = np.where(s["rafale_vent"] < 70, s["rafale_vent"], np.nan)      # m/s
        if np.isfinite(R).any():
            k = int(np.nanargmax(R)); rafale.append((float(R[k]) * 3.6, i, k / 10))
        I = s["insolation"]
        if np.isfinite(I).sum() >= seuil:
            insol.append((float(np.nansum(np.clip(I, 0, 6))) / 60, i))

    bas = lambda l: [x for x in l if meta[x[1]]["alt"] < MONTAGNE]
    tx_b, tn_b, raf_b = sorted(bas(tx), reverse=True), sorted(bas(tn)), sorted(bas(rafale), reverse=True)
    if len(tx_b) < 50 or not pluie:
        raise DonneesInsuffisantes(f"{len(tx_b)} stations de plaine avec une journée complète.")

    # Conditions de jour (8 h - 17 h) : part du territoire par catégorie
    bilan = collections.Counter()
    for h, (_, _, resume) in cond.items():
        if 8 <= h <= 17:
            bilan.update(resume)
    total = sum(bilan.values()) or 1
    part = {k: v / total for k, v in bilan.items()}

    return {
        "tx": tx_b, "tn": tn_b, "pluie": sorted(pluie, reverse=True), "rafale": raf_b,
        "insolation": sorted(insol, reverse=True),
        "tx_mediane": float(np.median([x[0] for x in tx_b])), "tn_mediane": float(np.median([x[0] for x in tn_b])),
        "part_stations_pluie": sum(1 for p in pluie if p[0] >= 1) / max(1, len(pluie)),
        "rafales_100": sum(1 for r in raf_b if r[0] >= 100), "rafales_80": sum(1 for r in raf_b if r[0] >= 80),
        "part_pluie": sum(part.get(k, 0) for k in ("pluie_faible", "pluie_moderee", "pluie_forte", "averses", "orage")),
        "part_soleil": part.get("soleil", 0) + part.get("peu_nuageux", 0) + 0.5 * part.get("eclaircies", 0),
        "part_brouillard": part.get("brouillard", 0), "part_neige": part.get("neige", 0),
        "part_orage": part.get("orage", 0), "part_couvert": part.get("couvert", 0) + part.get("tres_nuageux", 0),
    }


def region(lon, lat):
    """Grande région, déjà précédée de sa préposition, pour les phrases."""
    if lat < 43.1 and lon > 8.4:
        return "en Corse"
    if lat < 43.25 and lon < 3.2:
        return "dans les Pyrénées"
    if lat < 44.4 and lon > 3.5:
        return "sur le pourtour méditerranéen"
    if lat < 44.8 and lon < 3.5:
        return "dans le Sud-Ouest"
    if lon > 5.5 and lat < 46.6:
        return "dans les Alpes"
    if lon > 5.3 and lat >= 46.6:
        return "dans le Nord-Est"
    if lat > 49.3:
        return "dans le Nord"
    if lon < -1.2 and lat > 46.5:
        return "dans l'Ouest"
    if lon < 1.0:
        return "dans le Centre-Ouest"
    return "dans le centre du pays"


def nom_lieu(m):
    c = (m["commune"] or m["nom"]).strip()
    return c[:1].upper() + c[1:]


def titre_du_jour(ind):
    """Règles ordonnées : le premier phénomène franchissant son seuil donne le titre."""
    pluvieux = ind["part_stations_pluie"] >= 0.6 or ind["part_pluie"] >= 0.30
    venteux = ind["rafales_80"] >= 20
    if ind["rafales_100"] >= 15:
        return "Tempête"
    if ind["part_orage"] >= 0.01:
        return "Orages"
    if ind["part_neige"] >= 0.05:
        return "Neige"
    if pluvieux and venteux:
        return "Pluie et vent"
    if pluvieux:
        return "Journée pluvieuse"
    if venteux:
        return "Coup de vent"
    if ind["part_brouillard"] >= 0.12:
        return "Brouillards"
    if ind["tx_mediane"] >= 30:
        return "Fortes chaleurs"
    if ind["tn_mediane"] <= 0:
        return "Gelées"
    if ind["part_soleil"] >= 0.55:
        return "Grand soleil"
    if ind["part_couvert"] >= 0.5:
        return "Ciel gris"
    return "Ciel changeant"


PLUVIEUX = ("Journée pluvieuse", "Pluie et vent", "Tempête", "Orages")


def recit(ind, meta, lieu):
    """Titre, deux puces, deux phrases de synthèse et le chiffre du jour."""
    tx, tn, p = ind["tx"][0], ind["tn"][0], ind["pluie"][0]
    r = ind["rafale"][0] if ind["rafale"] else None
    dans = lambda i: region(meta[i]["lon"], meta[i]["lat"])
    titre = titre_du_jour(ind)
    etendue = ("presque tout le pays" if ind["part_stations_pluie"] >= 0.85 else
               "une grande partie du pays" if ind["part_stations_pluie"] >= 0.6 else "quelques régions")

    if titre in PLUVIEUX:
        puces = [f"Jusqu'à {fr(p[0])} mm {dans(p[1])}",
                 f"Rafales à {fr(r[0])} km/h {dans(r[1])}" if r and r[0] >= 80 else f"Pluie sur {etendue}"]
        phrase1 = f"Pluie sur {etendue}."
        chiffre = {"valeur": f"{fr(p[0])} mm", "legende": f"de pluie à {lieu(p[1])['lieu']}, le plus fort cumul"}
    elif titre == "Coup de vent" and r:
        puces = [f"Rafales à {fr(r[0])} km/h {dans(r[1])}", f"Jusqu'à {fr(tx[0])} °C {dans(tx[1])}"]
        phrase1 = "Vent fort sur une partie du pays."
        chiffre = {"valeur": f"{fr(r[0])} km/h", "legende": f"en rafale à {lieu(r[1])['lieu']}"}
    else:
        puces = [f"Jusqu'à {fr(tx[0])} °C {dans(tx[1])}", f"{fr(tn[0])} °C au plus bas {dans(tn[1])}"]
        if titre == "Gelées":
            phrase1 = "Gelées au petit matin."
            chiffre = {"valeur": f"{fr(tn[0], 1)} °C", "legende": f"au plus bas à {lieu(tn[1])['lieu']}"}
        elif titre == "Grand soleil" and ind["insolation"]:
            phrase1 = "Grand soleil sur la plupart des régions."
            ins = ind["insolation"][0]
            chiffre = {"valeur": f"{fr(ins[0])} h", "legende": f"de soleil à {lieu(ins[1])['lieu']}"}
        else:
            phrase1 = f"{titre} sur une grande partie du pays."
            chiffre = {"valeur": f"{fr(tx[0], 1)} °C", "legende": f"au plus haut à {lieu(tx[1])['lieu']}"}
    phrase2 = f"Jusqu'à {fr(tx[0])} °C {dans(tx[1])}."
    return titre, puces, [phrase1, phrase2], [chiffre]


# ---------------------------------------------------------------------------
# La partition
# ---------------------------------------------------------------------------

def construire(jour):
    """Partition complète de la journée (dict). Lève DonneesInsuffisantes au besoin."""
    debut, fin = bornes_jour(jour)
    nh = int(round((fin - debut).total_seconds() / 3600))

    meta, series, n = lire_stations(debut, fin)
    if len(meta) < 100:
        raise DonneesInsuffisantes(f"{len(meta)} stations seulement.")
    exclues = controler_temperatures(meta, series, n)
    cond = conditions(debut, fin)
    ind = indicateurs(meta, series, cond, n)

    def lieu(i):
        m = meta[i]
        return {"station": m["nom"], "lieu": nom_lieu(m), "lon": m["lon"], "lat": m["lat"], "alt": m["alt"],
                "region": region(m["lon"], m["lat"])}

    titre, puces, phrases, chiffres = recit(ind, meta, lieu)
    lever, coucher = soleil(jour)

    # Villes : températures observées heure par heure, conditions et vent
    villes = []
    for nom, ident, lon, lat in VILLES:
        if ident not in series:
            continue
        s = series[ident]
        horaire = [None if not np.isfinite(v) else round(float(v), 1) for v in serie_horaire(s["temperature"], nh)]
        if sum(v is not None for v in horaire) < nh * 0.75:
            continue
        symboles = {str(h): c for h in sorted(cond) if (c := categorie_ville(cond, h, lon, lat))}
        vent = []
        for hu in range(nh):
            fen = slice(max(0, hu * 10 - 3), hu * 10 + 4)
            v, d = s["vitesse_vent"][fen], s["direction_vent"][fen]
            ok = np.isfinite(v) & np.isfinite(d)
            if ok.any():
                a = np.radians(d[ok])          # moyenne vectorielle de la direction
                dm = (math.degrees(math.atan2(np.sin(a).mean(), np.cos(a).mean())) + 360) % 360
                vent.append([round(dm), round(float(v[ok].mean()) * 3.6)])
            else:
                vent.append(None)
        T = s["temperature"]
        villes.append({"nom": nom, "lon": lon, "lat": lat, "station": meta[ident]["nom"],
                       "t": horaire, "tmin": round(float(np.nanmin(T)), 1), "tmax": round(float(np.nanmax(T)), 1),
                       "conditions": symboles, "vent": vent})

    tx, tn = ind["tx"][0], ind["tn"][0]
    evenements = [{"type": "tx", "heure": round(tx[2], 2), "valeur": round(tx[0], 1), **lieu(tx[1])},
                  {"type": "tn", "heure": round(tn[2], 2), "valeur": round(tn[0], 1), **lieu(tn[1])}]

    # Radar : la pluie la plus forte (1 h) dans la fenêtre retenue
    radar = pile_opera(debut, fin)
    evenements_radar = []
    if radar:
        k0, k1 = int(round(radar["heures"][0] * 10)), int(round(radar["heures"][-1] * 10))
        meilleur = None
        for i in meta:
            P = series[i]["precipitation"][k0:k1 + 1]
            if np.isfinite(P).sum() < (k1 - k0) * 0.6:
                continue
            horaire = np.convolve(np.nan_to_num(np.where(P < 30, P, 0)), np.ones(10), "same")
            k = int(np.argmax(horaire))
            if meilleur is None or horaire[k] > meilleur[0]:
                meilleur = (float(horaire[k]), i, (k0 + k) / 10)
        if meilleur and meilleur[0] >= 2:
            evenements_radar.append({"type": "pluie_1h", "heure": round(meilleur[2], 2),
                                     "valeur": round(meilleur[0], 1), **lieu(meilleur[1])})

    # Conditions météo : une seule info clé (rafale, neige ou ensoleillement)
    r = ind["rafale"][0] if ind["rafale"] else None
    info_ciel = None
    if r and r[0] >= 80:
        info_ciel = {"type": "rafale", "heure": round(r[2], 2), "valeur": round(r[0]),
                     "texte": f"Rafale à {fr(r[0])} km/h à {lieu(r[1])['lieu']}", **lieu(r[1])}
    elif ind["part_neige"] >= 0.02:
        info_ciel = {"type": "neige", "heure": None, "texte": "Neige en montagne", "lon": 6.5, "lat": 45.3}
    elif ind["insolation"]:
        ins = ind["insolation"][0]
        info_ciel = {"type": "soleil", "heure": None, "valeur": round(ins[0], 1),
                     "texte": f"{fr(ins[0])} h de soleil à {lieu(ins[1])['lieu']}", **lieu(ins[1])}

    jour_txt = jour.day if jour.day > 1 else "1er"
    return {
        "version": VERSION,
        "jour": jour.isoformat(),
        "produit": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "date_longue": f"{JOURS[jour.weekday()]} {jour_txt} {MOIS[jour.month - 1]}",
        "date_courte": f"{jour_txt} {MOIS[jour.month - 1]}",
        "heures": nh,
        "soleil": {"lever": lever, "coucher": coucher, "lieu": "Paris"},
        "titre": titre, "puces": puces,
        "synthese": {"phrases": phrases, "chiffres": chiffres},
        "indicateurs": {k: (round(v, 3) if isinstance(v, float) else v) for k, v in ind.items()
                        if not isinstance(v, list)},
        "evenements": evenements,
        "evenements_radar": evenements_radar,
        "info_ciel": info_ciel,
        "villes": villes,
        "temperatures": champ_temperatures(meta, series, nh),
        "radar": radar,
        "controle": {"stations": len(meta), "conditions": len(cond),
                     "stations_temperature_ecartees": sorted(meta[i]["nom"] for i in exclues)},
        "sources": SOURCES,
    }


def produire(jour, forcer=False):
    """Écrit la partition de la journée si elle manque (ou si forcer). Renvoie le chemin, ou None si déjà faite."""
    chemin = chemin_partition(jour)
    if chemin.is_file() and not forcer:
        return None
    partition = construire(jour)
    octets = json.dumps(partition, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ecrire_fichier_atomique(chemin, lambda temporaire: Path(temporaire).write_bytes(octets))
    return chemin


def journee_close(jour, maintenant, marge=timedelta(minutes=80)):
    """Une journée est résumable quand elle est finie et que ses dernières
    observations, cartes fusionnées et images OPERA sont arrivées."""
    return maintenant >= bornes_jour(jour)[1] + marge


def jours_a_produire(maintenant, profondeur=7):
    """Journées closes récentes dont la partition manque, la plus récente d'abord."""
    aujourdhui = maintenant.astimezone(PARIS).date()
    candidats = [aujourdhui - timedelta(days=i) for i in range(1, profondeur + 1)]
    return [j for j in candidats if journee_close(j, maintenant) and not chemin_partition(j).is_file()]
