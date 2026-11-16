"""
HKO Météo — conversion d'une mosaïque radar Météo-France (ODIM_H5)
en image transparente Mercator, prête à être superposée à la carte D3.js.

Ce module est appelé par la commande :

    python manage.py convertir_radar meteo_app\\data\\T_IPRN20_C_LFPW_20261116201000.h5

Fichiers produits (par défaut dans meteo_app/static/meteo_app/radar/) :

    radar.png   image RGBA en projection Mercator (la même que d3.geoMercator)
    radar.json  emprise géographique, heure des données, unité, légende

Le module ne dépend pas de Django et n'utilise aucune clé API.
Il lit la projection et la grille dans le fichier lui-même (groupe "where"),
puis affiche un contrôle du géoréférencement avant d'écrire les fichiers.

Bibliothèques nécessaires : h5py, numpy, Pillow, pyproj.
Elles ne sont importées que par ce module : le site fonctionne sans elles.
"""

import json
import math
from datetime import datetime, timezone
from pathlib import Path

import h5py
import numpy as np
from PIL import Image
from pyproj import CRS, Transformer

# ---------------------------------------------------------------------------
# Légende : seuils (bornes inférieures) et couleurs associées.
# En dessous du premier seuil, le pixel reste transparent.
# ---------------------------------------------------------------------------
SEUILS = [0.2, 0.5, 1, 2, 4, 7, 12, 20, 35, 60]

COULEURS = [
    "#a5d8f3",
    "#6fb7ea",
    "#3f8fd8",
    "#2a63c0",
    "#3aa655",
    "#9fce3f",
    "#f3e03b",
    "#f4a12a",
    "#e8502a",
    "#b3207a",
]

OPACITE = 215  # 0 = invisible, 255 = opaque

DOSSIER_SORTIE = (
    Path(__file__).resolve().parent / "static" / "meteo_app" / "radar"
)


class ErreurRadar(Exception):
    """Fichier radar illisible ou géoréférencement incohérent."""


def texte(valeur):
    """Convertit un attribut HDF5 (bytes, numpy) en valeur Python simple."""
    if isinstance(valeur, bytes):
        return valeur.decode("utf-8", "replace").strip("\x00").strip()
    if isinstance(valeur, np.ndarray):
        if valeur.size == 1:
            return texte(valeur.reshape(-1)[0])
        return [texte(v) for v in valeur.tolist()]
    if isinstance(valeur, np.generic):
        return texte(valeur.item())
    return valeur


def attributs(fichier, *chemins):
    """Fusionne les attributs de plusieurs groupes (les derniers l'emportent)."""
    resultat = {}
    for chemin in chemins:
        if chemin in fichier:
            for cle, valeur in fichier[chemin].attrs.items():
                resultat[cle] = texte(valeur)
    return resultat


def date_odim(jour, heure):
    """Assemble une date ODIM (AAAAMMJJ + HHMMSS, en UTC)."""
    if not jour or not heure:
        return None
    try:
        return datetime.strptime(
            f"{str(jour).strip()}{str(heure).strip()[:6]}", "%Y%m%d%H%M%S"
        ).replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def iso(date):
    return date.strftime("%Y-%m-%dT%H:%M:%SZ") if date else None


def couleur_rgb(code):
    code = code.lstrip("#")
    return tuple(int(code[i:i + 2], 16) for i in (0, 2, 4))


def mercator_y(latitude_rad):
    return np.log(np.tan(np.pi / 4 + latitude_rad / 2))


def convertir(chemin_h5, dossier_sortie=None, largeur_image=2000,
              afficher=print):
    """Convertit un fichier ODIM_H5 et renvoie les métadonnées écrites."""
    dossier_sortie = Path(dossier_sortie) if dossier_sortie else DOSSIER_SORTIE
    print = afficher  # noqa: A001 — sortie redirigeable (commande Django)

    with h5py.File(chemin_h5, "r") as fichier:
        ou = attributs(fichier, "where", "dataset1/where")
        quoi = attributs(
            fichier, "dataset1/what", "dataset1/data1/what"
        )
        racine = attributs(fichier, "what")
        donnees = fichier["dataset1/data1/data"][()]

    # ------------------------------------------------------------------
    # 1. Grille d'origine
    # ------------------------------------------------------------------
    projdef = ou.get("projdef")
    if not projdef:
        raise ErreurRadar("Attribut where/projdef introuvable.")

    lignes, colonnes = donnees.shape
    pas_x = float(ou.get("xscale", 500))
    pas_y = float(ou.get("yscale", 500))

    crs_radar = CRS.from_proj4(projdef)
    vers_radar = Transformer.from_crs("EPSG:4326", crs_radar, always_xy=True)
    vers_geo = Transformer.from_crs(crs_radar, "EPSG:4326", always_xy=True)

    if "UL_lon" in ou and "UL_lat" in ou:
        x_gauche, y_haut = vers_radar.transform(
            float(ou["UL_lon"]), float(ou["UL_lat"])
        )
    elif "LL_lon" in ou and "LL_lat" in ou:
        x_gauche, y_bas = vers_radar.transform(
            float(ou["LL_lon"]), float(ou["LL_lat"])
        )
        y_haut = y_bas + lignes * pas_y
    else:
        raise ErreurRadar("Coins UL ou LL introuvables dans where.")

    print("Fichier          :", Path(chemin_h5).name)
    print("Projection       :", projdef)
    print(f"Grille           : {colonnes} x {lignes} pixels, "
          f"pas {pas_x:g} x {pas_y:g} m")

    # ------------------------------------------------------------------
    # 2. Contrôle du géoréférencement : les coins annoncés dans le
    #    fichier doivent retomber sur les coins de la grille calculée.
    # ------------------------------------------------------------------
    coins_calcules = {
        "UL": (x_gauche, y_haut),
        "UR": (x_gauche + colonnes * pas_x, y_haut),
        "LL": (x_gauche, y_haut - lignes * pas_y),
        "LR": (x_gauche + colonnes * pas_x, y_haut - lignes * pas_y),
    }

    ecart_max = 0.0
    print("Contrôle des coins (écart entre le fichier et la grille) :")
    for nom, (x_calc, y_calc) in coins_calcules.items():
        if f"{nom}_lon" not in ou or f"{nom}_lat" not in ou:
            print(f"  {nom} : absent du fichier")
            continue
        x_fich, y_fich = vers_radar.transform(
            float(ou[f"{nom}_lon"]), float(ou[f"{nom}_lat"])
        )
        ecart = math.hypot(x_fich - x_calc, y_fich - y_calc)
        ecart_max = max(ecart_max, ecart)
        lon, lat = vers_geo.transform(x_calc, y_calc)
        print(f"  {nom} : {ecart:9.1f} m   "
              f"(calculé {lon:8.4f}°, {lat:7.4f}°)")

    if ecart_max > max(pas_x, pas_y):
        print("  ATTENTION : écart supérieur à un pixel radar. "
              "Le géoréférencement est à vérifier avant d'utiliser l'image.")
    else:
        print("  OK : les coins concordent à moins d'un pixel radar.")

    if coins_calcules["UL"][1] <= coins_calcules["LL"][1]:
        raise ErreurRadar("La grille semble inversée (nord/sud).")

    # ------------------------------------------------------------------
    # 3. Emprise géographique : contour de la grille en longitude/latitude
    # ------------------------------------------------------------------
    bord_x = np.linspace(x_gauche, x_gauche + colonnes * pas_x, 400)
    bord_y = np.linspace(y_haut - lignes * pas_y, y_haut, 400)

    contour_x = np.concatenate([
        bord_x, bord_x,
        np.full_like(bord_y, bord_x[0]), np.full_like(bord_y, bord_x[-1]),
    ])
    contour_y = np.concatenate([
        np.full_like(bord_x, bord_y[0]), np.full_like(bord_x, bord_y[-1]),
        bord_y, bord_y,
    ])

    contour_lon, contour_lat = vers_geo.transform(contour_x, contour_y)

    ouest = float(np.floor(contour_lon.min() * 100) / 100)
    est = float(np.ceil(contour_lon.max() * 100) / 100)
    sud = float(np.floor(contour_lat.min() * 100) / 100)
    nord = float(np.ceil(contour_lat.max() * 100) / 100)

    # ------------------------------------------------------------------
    # 4. Grille de sortie en Mercator (identique à d3.geoMercator :
    #    x proportionnel à la longitude, y = ln(tan(pi/4 + lat/2)))
    # ------------------------------------------------------------------
    lam_ouest, lam_est = math.radians(ouest), math.radians(est)
    y_nord = float(mercator_y(math.radians(nord)))
    y_sud = float(mercator_y(math.radians(sud)))

    largeur = int(largeur_image)
    hauteur = int(round(largeur * (y_nord - y_sud) / (lam_est - lam_ouest)))

    # Centres des pixels de sortie
    lam = lam_ouest + (np.arange(largeur) + 0.5) * (lam_est - lam_ouest) / largeur
    y_merc = y_nord - (np.arange(hauteur) + 0.5) * (y_nord - y_sud) / hauteur

    longitudes = np.degrees(lam)
    latitudes = np.degrees(2 * np.arctan(np.exp(y_merc)) - np.pi / 2)

    grille_lon, grille_lat = np.meshgrid(longitudes, latitudes)

    x_radar, y_radar = vers_radar.transform(grille_lon, grille_lat)

    # Plus proche voisin : aucun lissage, les valeurs restent exactes
    colonne = np.floor((x_radar - x_gauche) / pas_x).astype(np.int64)
    ligne = np.floor((y_haut - y_radar) / pas_y).astype(np.int64)

    dans_grille = (
        (colonne >= 0) & (colonne < colonnes) &
        (ligne >= 0) & (ligne < lignes)
    )

    brut = np.zeros((hauteur, largeur), dtype=np.float64)
    brut[dans_grille] = donnees[ligne[dans_grille], colonne[dans_grille]]

    # ------------------------------------------------------------------
    # 5. Valeurs physiques
    # ------------------------------------------------------------------
    gain = float(quoi.get("gain", 1))
    decalage = float(quoi.get("offset", 0))
    nodata = quoi.get("nodata")
    undetect = quoi.get("undetect")
    quantite = str(quoi.get("quantity", "?"))

    mesure = dans_grille.copy()
    if nodata is not None:
        mesure &= brut != float(nodata)

    valeur = brut * gain + decalage

    if undetect is not None:
        valeur[brut == float(undetect)] = 0

    valeur[~mesure] = 0

    debut = date_odim(quoi.get("startdate"), quoi.get("starttime"))
    fin = date_odim(quoi.get("enddate"), quoi.get("endtime"))
    date_produit = date_odim(racine.get("date"), racine.get("time"))

    periode_minutes = None
    if debut and fin and fin > debut:
        periode_minutes = (fin - debut).total_seconds() / 60

    if periode_minutes:
        # Cumul sur la période -> intensité horaire
        valeur = valeur * 60 / periode_minutes
        unite = "mm/h"
    else:
        unite = "mm"

    date_validite = fin or date_produit

    print("Quantité         :", quantite, f"(gain {gain:g}, offset {decalage:g}, "
          f"nodata {nodata}, undetect {undetect})")
    print("Période          :", iso(debut), "->", iso(fin),
          f"({periode_minutes:g} min)" if periode_minutes else "(inconnue)")
    print("Heure des données:", iso(date_validite), "UTC")
    print("Unité affichée   :", unite)

    # ------------------------------------------------------------------
    # 6. Colorisation
    # ------------------------------------------------------------------
    classe = np.digitize(valeur, SEUILS)  # 0 = sous le premier seuil

    palette = np.zeros((len(SEUILS) + 1, 4), dtype=np.uint8)
    for indice, code in enumerate(COULEURS, start=1):
        palette[indice] = (*couleur_rgb(code), OPACITE)

    image = palette[classe]
    image[~mesure] = (0, 0, 0, 0)

    dossier_sortie.mkdir(parents=True, exist_ok=True)

    chemin_png = dossier_sortie / "radar.png"
    chemin_json = dossier_sortie / "radar.json"

    Image.fromarray(image, "RGBA").save(chemin_png, optimize=True)

    pixels_pluie = int((classe > 0).sum())
    pixels_mesure = int(mesure.sum())

    meta = {
        "image": "radar.png",
        "projection": "mercator",
        "emprise": [ouest, sud, est, nord],
        "largeur": largeur,
        "hauteur": hauteur,
        "date_utc": iso(date_validite),
        "debut_utc": iso(debut),
        "fin_utc": iso(fin),
        "periode_minutes": periode_minutes,
        "quantite": quantite,
        "unite": unite,
        "seuils": SEUILS,
        "couleurs": COULEURS,
        "source": Path(chemin_h5).name,
        "ecart_coins_m": round(ecart_max, 1),
    }

    chemin_json.write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"Emprise          : {ouest}° à {est}° E, {sud}° à {nord}° N")
    print(f"Image            : {largeur} x {hauteur} pixels")
    print(f"Couverture radar : {100 * pixels_mesure / (largeur * hauteur):.1f} % "
          "de l'image")
    print(f"Pluie détectée   : {100 * pixels_pluie / max(pixels_mesure, 1):.2f} % "
          "de la zone couverte")
    if mesure.any():
        print(f"Valeur maximale  : {valeur[mesure].max():.2f} {unite}")
    print("Écrit            :", chemin_png)
    print("Écrit            :", chemin_json)

    return meta
