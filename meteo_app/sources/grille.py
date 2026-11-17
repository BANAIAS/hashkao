"""
HKO Météo — grille géographique commune.

Toutes les sources (radar, satellite, AROME, stations) sont ramenées sur
une même grille régulière en longitude/latitude avant d'être croisées.

    pas      0,05°  (environ 5,5 km d'est en ouest, 4 km du nord au sud
                     à nos latitudes)
    emprise  6,5° O à 11° E, 40,5° N à 52° N
    taille   350 colonnes x 230 lignes ; la ligne 0 est au nord

Pour agréger une source sur une cellule, on prélève N x N points répartis
régulièrement dans la cellule (N = 5 par défaut), on lit la valeur de la
source en chacun d'eux (plus proche voisin), puis on calcule des
proportions et des statistiques. Les tables « point de grille -> pixel de
la source » sont mises en cache sur disque : elles ne se recalculent que
si la géométrie de la source change.
"""

import gzip
import hashlib
import json
from functools import lru_cache
from pathlib import Path

import numpy as np

OUEST, SUD, EST, NORD = -6.5, 40.5, 11.0, 52.0
PAS = 0.05

NX = int(round((EST - OUEST) / PAS))
NY = int(round((NORD - SUD) / PAS))

ECHANTILLONS = 5


def description():
    """Description de la grille, transmise au navigateur."""
    return {
        "ouest": OUEST, "sud": SUD, "est": EST, "nord": NORD,
        "pas": PAS, "nx": NX, "ny": NY,
    }


def centres():
    """Longitudes (NX,) et latitudes (NY,) des centres de cellules."""
    lon = OUEST + (np.arange(NX) + 0.5) * PAS
    lat = NORD - (np.arange(NY) + 0.5) * PAS
    return lon, lat


def points_echantillon(n=ECHANTILLONS):
    """
    Points prélevés dans chaque cellule : deux tableaux (NY, NX, n*n)
    de longitudes et de latitudes.
    """
    decalage = (np.arange(n) + 0.5) / n * PAS
    lon0 = OUEST + np.arange(NX) * PAS
    lat0 = NORD - np.arange(NY) * PAS

    dlon, dlat = np.meshgrid(decalage, decalage)
    lon = lon0[None, :, None] + dlon.reshape(-1)[None, None, :]
    lat = lat0[:, None, None] - dlat.reshape(-1)[None, None, :]

    lon = np.broadcast_to(lon, (NY, NX, n * n)).copy()
    lat = np.broadcast_to(lat, (NY, NX, n * n)).copy()
    return lon, lat


def cle_cache(*elements):
    texte = json.dumps([str(e) for e in elements] + [description(), ECHANTILLONS])
    return hashlib.sha1(texte.encode()).hexdigest()[:16]


def table_en_cache(nom, cle, calcul):
    """
    Charge une table de correspondance depuis le cache, ou la calcule.
    calcul() doit renvoyer un dictionnaire de tableaux numpy.
    """
    from .commun import dossier

    chemin = dossier("cache") / f"{nom}_{cle}.npz"

    if chemin.exists():
        with np.load(chemin) as donnees:
            return {k: donnees[k] for k in donnees.files}

    tables = calcul()
    temporaire = chemin.with_suffix(".tmp.npz")
    np.savez_compressed(temporaire, **tables)
    temporaire.replace(chemin)
    return tables


# ---------------------------------------------------------------------------
# Masques et altitude, tirés des fichiers du projet
# ---------------------------------------------------------------------------

def _statique():
    from django.conf import settings
    return Path(settings.BASE_DIR) / "meteo_app" / "static" / "meteo_app"


def _rasteriser(geometries, sur_echantillon=4):
    """Rasterise des polygones lon/lat sur la grille (fraction couverte par cellule)."""
    from PIL import Image, ImageDraw

    largeur, hauteur = NX * sur_echantillon, NY * sur_echantillon
    image = Image.new("L", (largeur, hauteur), 0)
    dessin = ImageDraw.Draw(image)

    def vers_pixels(anneau):
        return [
            ((lon - OUEST) / PAS * sur_echantillon, (NORD - lat) / PAS * sur_echantillon)
            for lon, lat, *_ in anneau
        ]

    for geometrie in geometries:
        if not geometrie:
            continue
        polygones = (
            [geometrie["coordinates"]] if geometrie["type"] == "Polygon"
            else geometrie["coordinates"] if geometrie["type"] == "MultiPolygon"
            else []
        )
        for polygone in polygones:
            if len(polygone[0]) >= 3:
                dessin.polygon(vers_pixels(polygone[0]), fill=255)
            for trou in polygone[1:]:
                if len(trou) >= 3:
                    dessin.polygon(vers_pixels(trou), fill=0)

    tableau = np.asarray(image, dtype=np.float32) / 255
    return tableau.reshape(NY, sur_echantillon, NX, sur_echantillon).mean(axis=(1, 3))


def _lire_geojson(*noms):
    for nom in noms:
        chemin = _statique() / "geo" / nom
        if chemin.exists():
            return json.loads(chemin.read_text(encoding="utf-8"))
    raise FileNotFoundError(f"Aucun des fichiers {noms} n'existe dans static/meteo_app/geo/.")


@lru_cache(maxsize=1)
def masques():
    """
    Fractions de chaque cellule couvertes par la France métropolitaine
    et par des terres (tous pays). Calculées une fois, puis en cache.
    """
    def calcul():
        departements = _lire_geojson("hko_departements.geojson", "departements.geojson")
        pays = _lire_geojson("hko_pays.geojson", "pays_monde_50m.geojson")

        france = _rasteriser(
            f.get("geometry") for f in departements["features"]
            if not str((f.get("properties") or {}).get("code", "")).startswith("97")
        )
        autres = _rasteriser(
            f.get("geometry") for f in pays["features"]
            if (f.get("properties") or {}).get("ADM0_A3") != "FRA"
        )
        return {"france": france, "terre": np.clip(france + autres, 0, 1)}

    return table_en_cache("masques", cle_cache("masques-v1"), calcul)


@lru_cache(maxsize=1)
def altitudes():
    """Altitude moyenne de chaque cellule (m), NaN en mer ou hors données."""
    def calcul():
        relief = None
        for nom in ("hko_relief.json.gz", "relief_europe.json.gz"):
            chemin = _statique() / "relief" / nom
            if chemin.exists():
                with gzip.open(chemin, "rt", encoding="utf-8") as f:
                    relief = json.load(f)
                break

        if relief is None:
            return {"altitude": np.full((NY, NX), np.nan, dtype=np.float32)}

        largeur, hauteur = relief["largeur"], relief["hauteur"]
        brut = relief["altitudes"]
        if brut and isinstance(brut[0], list):
            valeurs = np.array(
                [[np.nan if v is None else v for v in ligne] for ligne in brut],
                dtype=np.float32,
            )
        else:
            valeurs = np.array(
                [np.nan if v is None else v for v in brut], dtype=np.float32
            ).reshape(hauteur, largeur)

        ouest, sud, est, nord = relief["bounds"]
        resolution = relief["resolution"]

        lon, lat = points_echantillon(3)
        colonne = np.floor((lon - ouest) * resolution).astype(int)
        ligne = np.floor((nord - lat) * resolution).astype(int)
        dedans = (colonne >= 0) & (colonne < largeur) & (ligne >= 0) & (ligne < hauteur)

        echantillons = np.full(lon.shape, np.nan, dtype=np.float32)
        echantillons[dedans] = valeurs[ligne[dedans], colonne[dedans]]

        with np.errstate(all="ignore"):
            moyenne = np.nanmean(np.where(np.isfinite(echantillons), echantillons, np.nan), axis=2)

        return {"altitude": moyenne.astype(np.float32)}

    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        return table_en_cache("altitudes", cle_cache("altitudes-v1"), calcul)["altitude"]


# ---------------------------------------------------------------------------
# Lecture d'une source par table d'indices
# ---------------------------------------------------------------------------

def indices_par_projection(cle, transformer_vers_source, origine_x, origine_y,
                           pas_x, pas_y, colonnes, lignes):
    """
    Table d'indices pour une source en projection plane régulière.

    transformer_vers_source : pyproj.Transformer EPSG:4326 -> projection
    origine_x, origine_y    : coin supérieur gauche du pixel (0, 0)
    pas_y                   : positif ; les lignes descendent vers le sud
    """
    def calcul():
        lon, lat = points_echantillon()
        x, y = transformer_vers_source.transform(lon, lat)
        colonne = np.floor((x - origine_x) / pas_x)
        ligne = np.floor((origine_y - y) / pas_y)
        valide = (
            np.isfinite(colonne) & np.isfinite(ligne)
            & (colonne >= 0) & (colonne < colonnes)
            & (ligne >= 0) & (ligne < lignes)
        )
        return {
            "ligne": np.where(valide, ligne, 0).astype(np.int32),
            "colonne": np.where(valide, colonne, 0).astype(np.int32),
            "valide": valide,
        }

    return table_en_cache("indices", cle, calcul)


def lire_echantillons(tableau, table, hors=np.nan):
    """Valeurs de la source aux points prélevés : tableau (NY, NX, N*N)."""
    valeurs = tableau[table["ligne"], table["colonne"]]
    if np.issubdtype(valeurs.dtype, np.floating):
        valeurs = valeurs.copy()
        valeurs[~table["valide"]] = hors
    return valeurs
