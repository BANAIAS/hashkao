"""
HKO Météo — mosaïque radar Météo-France (ODIM_H5).

Trois usages :

1. lire_mosaique()  lit le fichier .h5, contrôle son géoréférencement et
                    renvoie les intensités de précipitation (mm/h) ;
2. convertir()      produit l'image Mercator transparente de la carte
                    « Précipitations » (radar.png, radar_couverture.png,
                    radar.json) ;
3. sur_grille()     ramène la mosaïque sur la grille commune de la fusion.

Commande associée :

    python manage.py convertir_radar meteo_app\\data\\T_IPRN20_C_LFPW_20261117145500.h5

Rappels sur le format (vérifiés sur T_IPRN20_C_LFPW_20261117145500.h5) :

- quantité ACRR : cumul de précipitation sur 5 minutes, en centièmes de
  millimètre (gain 0,01) ;
- 65535 (nodata) : pas de mesure, zone hors couverture radar ;
- 65534 (undetect) : zone mesurée, aucune précipitation détectée ;
- how/missing_nodes : radars absents de la mosaïque à cet instant.

Une zone sans mesure n'est jamais traitée comme une zone sèche.

Bibliothèques nécessaires : h5py, numpy, Pillow, pyproj.
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
# Légende : seuils (bornes inférieures, mm/h) et couleurs associées.
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

# Intensité (mm/h) à partir de laquelle un point est considéré pluvieux
SEUIL_PLUIE = SEUILS[0]


def dossier_sortie_defaut():
    """Dossier de publication du radar (servi par la vue /meteo/donnees/)."""
    from meteo_app.sources.commun import dossier_publication
    return dossier_publication("radar")


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


# ---------------------------------------------------------------------------
# 1. Lecture et contrôle
# ---------------------------------------------------------------------------

def lire_mosaique(chemin_h5):
    """
    Lit une mosaïque ODIM_H5 et renvoie un dictionnaire :

        intensite      float32 (lignes, colonnes), mm/h si la période est
                       connue (sinon mm), 0 là où rien n'est détecté
        mesure         bool (lignes, colonnes), False hors couverture
        debut, fin     période couverte (UTC)
        instant        instant de validité (fin de période)
        ...            géométrie, unité, radars absents, contrôles

    Lève ErreurRadar si le fichier est incomplet ou incohérent.
    """
    with h5py.File(chemin_h5, "r") as fichier:
        ou = attributs(fichier, "where", "dataset1/where")
        quoi = attributs(fichier, "dataset1/what", "dataset1/data1/what")
        racine = attributs(fichier, "what")
        comment = attributs(fichier, "how")
        if "dataset1/data1/data" not in fichier:
            raise ErreurRadar("Jeu de données dataset1/data1/data absent.")
        donnees = fichier["dataset1/data1/data"][()]

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
        x_gauche, y_haut = vers_radar.transform(float(ou["UL_lon"]), float(ou["UL_lat"]))
    elif "LL_lon" in ou and "LL_lat" in ou:
        x_gauche, y_bas = vers_radar.transform(float(ou["LL_lon"]), float(ou["LL_lat"]))
        y_haut = y_bas + lignes * pas_y
    else:
        raise ErreurRadar("Coins UL ou LL introuvables dans where.")

    # Contrôle : les coins annoncés doivent retomber sur ceux de la grille
    coins_calcules = {
        "UL": (x_gauche, y_haut),
        "UR": (x_gauche + colonnes * pas_x, y_haut),
        "LL": (x_gauche, y_haut - lignes * pas_y),
        "LR": (x_gauche + colonnes * pas_x, y_haut - lignes * pas_y),
    }

    ecarts = {}
    for nom, (x_calc, y_calc) in coins_calcules.items():
        if f"{nom}_lon" in ou and f"{nom}_lat" in ou:
            x_fich, y_fich = vers_radar.transform(
                float(ou[f"{nom}_lon"]), float(ou[f"{nom}_lat"])
            )
            ecarts[nom] = math.hypot(x_fich - x_calc, y_fich - y_calc)

    ecart_max = max(ecarts.values()) if ecarts else 0.0

    if coins_calcules["UL"][1] <= coins_calcules["LL"][1]:
        raise ErreurRadar("La grille semble inversée (nord/sud).")

    # Valeurs physiques
    gain = float(quoi.get("gain", 1))
    decalage = float(quoi.get("offset", 0))
    nodata = quoi.get("nodata")
    undetect = quoi.get("undetect")
    quantite = str(quoi.get("quantity", "?"))

    mesure = np.ones(donnees.shape, dtype=bool)
    if nodata is not None:
        mesure &= donnees != float(nodata)

    valeur = donnees.astype(np.float32) * gain + decalage
    if undetect is not None:
        valeur[donnees == float(undetect)] = 0
    valeur[~mesure] = 0

    debut = date_odim(quoi.get("startdate"), quoi.get("starttime"))
    fin = date_odim(quoi.get("enddate"), quoi.get("endtime"))
    date_produit = date_odim(racine.get("date"), racine.get("time"))

    periode_minutes = None
    if debut and fin and fin > debut:
        periode_minutes = (fin - debut).total_seconds() / 60

    if quantite == "RATE":
        # OPERA : intensité déjà exprimée en mm/h
        unite = "mm/h"

    elif quantite == "ACRR" and periode_minutes:
        # Météo-France : cumul converti en intensité horaire
        valeur *= 60 / periode_minutes
        unite = "mm/h"

    else:
        unite = "mm"

    def liste(texte_brut):
        return [n.strip() for n in str(texte_brut or "").split(",") if n.strip()]

    return {
        "chemin": str(chemin_h5),
        "source": racine.get("source"),
        "projdef": projdef,
        "vers_radar": vers_radar,
        "vers_geo": vers_geo,
        "x_gauche": x_gauche, "y_haut": y_haut,
        "pas_x": pas_x, "pas_y": pas_y,
        "lignes": lignes, "colonnes": colonnes,
        "ecarts_coins": ecarts,
        "ecart_coins_max": ecart_max,
        "coins_calcules": coins_calcules,
        "quantite": quantite, "gain": gain, "offset": decalage,
        "nodata": nodata, "undetect": undetect,
        "debut": debut, "fin": fin, "date_produit": date_produit,
        "instant": fin or date_produit,
        "periode_minutes": periode_minutes,
        "unite": unite,
        "intensite": valeur,
        "mesure": mesure,
        "radars": liste(comment.get("nodes")),
        "radars_absents": liste(comment.get("missing_nodes")),
    }


# ---------------------------------------------------------------------------
# 2. Image Mercator pour la carte
# ---------------------------------------------------------------------------

def convertir(chemin_h5, dossier_sortie=None, largeur_image=2000,
              afficher=print, nom_base="radar", mosaique=None):
    """
    Convertit un fichier ODIM_H5 et renvoie les métadonnées écrites.

    Fichiers produits dans dossier_sortie :
        <nom_base>.png              image RGBA en projection Mercator
        <nom_base>_couverture.png   zone couverte par les radars
        radar.json                  emprise, heure, unité, légende ; écrit
                                    en dernier, de façon atomique
    """
    from meteo_app.sources.commun import ecrire_atomique

    dossier_sortie = Path(dossier_sortie) if dossier_sortie else dossier_sortie_defaut()
    print = afficher  # noqa: A001 — sortie redirigeable (commande Django)

    m = mosaique or lire_mosaique(chemin_h5)

    print("Fichier          :", Path(chemin_h5).name)
    print("Projection       :", m["projdef"])
    print(f"Grille           : {m['colonnes']} x {m['lignes']} pixels, "
          f"pas {m['pas_x']:g} x {m['pas_y']:g} m")

    print("Contrôle des coins (écart entre le fichier et la grille) :")
    for nom, (x_calc, y_calc) in m["coins_calcules"].items():
        if nom not in m["ecarts_coins"]:
            print(f"  {nom} : absent du fichier")
            continue
        lon, lat = m["vers_geo"].transform(x_calc, y_calc)
        print(f"  {nom} : {m['ecarts_coins'][nom]:9.1f} m   "
              f"(calculé {lon:8.4f}°, {lat:7.4f}°)")

    if m["ecart_coins_max"] > max(m["pas_x"], m["pas_y"]):
        print("  ATTENTION : écart supérieur à un pixel radar. "
              "Le géoréférencement est à vérifier avant d'utiliser l'image.")
    else:
        print("  OK : les coins concordent à moins d'un pixel radar.")

    x_gauche, y_haut = m["x_gauche"], m["y_haut"]
    pas_x, pas_y = m["pas_x"], m["pas_y"]
    lignes, colonnes = m["lignes"], m["colonnes"]

    # Emprise géographique : contour de la grille en longitude/latitude
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

    contour_lon, contour_lat = m["vers_geo"].transform(contour_x, contour_y)

    ouest = float(np.floor(contour_lon.min() * 100) / 100)
    est = float(np.ceil(contour_lon.max() * 100) / 100)
    sud = float(np.floor(contour_lat.min() * 100) / 100)
    nord = float(np.ceil(contour_lat.max() * 100) / 100)

    # Grille de sortie en Mercator (identique à d3.geoMercator)
    lam_ouest, lam_est = math.radians(ouest), math.radians(est)
    y_nord = float(mercator_y(math.radians(nord)))
    y_sud = float(mercator_y(math.radians(sud)))

    largeur = int(largeur_image)
    hauteur = int(round(largeur * (y_nord - y_sud) / (lam_est - lam_ouest)))

    lam = lam_ouest + (np.arange(largeur) + 0.5) * (lam_est - lam_ouest) / largeur
    y_merc = y_nord - (np.arange(hauteur) + 0.5) * (y_nord - y_sud) / hauteur

    longitudes = np.degrees(lam)
    latitudes = np.degrees(2 * np.arctan(np.exp(y_merc)) - np.pi / 2)

    grille_lon, grille_lat = np.meshgrid(longitudes, latitudes)
    x_radar, y_radar = m["vers_radar"].transform(grille_lon, grille_lat)

    # Plus proche voisin : aucun lissage, les valeurs restent exactes
    colonne = np.floor((x_radar - x_gauche) / pas_x).astype(np.int64)
    ligne = np.floor((y_haut - y_radar) / pas_y).astype(np.int64)

    dans_grille = (colonne >= 0) & (colonne < colonnes) & (ligne >= 0) & (ligne < lignes)

    valeur = np.zeros((hauteur, largeur), dtype=np.float32)
    mesure = np.zeros((hauteur, largeur), dtype=bool)
    valeur[dans_grille] = m["intensite"][ligne[dans_grille], colonne[dans_grille]]
    mesure[dans_grille] = m["mesure"][ligne[dans_grille], colonne[dans_grille]]

    print("Quantité         :", m["quantite"], f"(gain {m['gain']:g}, offset {m['offset']:g}, "
          f"nodata {m['nodata']}, undetect {m['undetect']})")
    print("Période          :", iso(m["debut"]), "->", iso(m["fin"]),
          f"({m['periode_minutes']:g} min)" if m["periode_minutes"] else "(inconnue)")
    print("Heure des données:", iso(m["instant"]), "UTC")
    print("Unité affichée   :", m["unite"])
    if m["radars_absents"]:
        print("Radars absents   :", len(m["radars_absents"]), "—", ", ".join(m["radars_absents"]))

    # Colorisation
    classe = np.digitize(valeur, SEUILS)  # 0 = sous le premier seuil

    palette = np.zeros((len(SEUILS) + 1, 4), dtype=np.uint8)
    for indice, code in enumerate(COULEURS, start=1):
        palette[indice] = (*couleur_rgb(code), OPACITE)

    image = palette[classe]
    image[~mesure] = (0, 0, 0, 0)

    dossier_sortie.mkdir(parents=True, exist_ok=True)

    def png(tableau):
        import io
        tampon = io.BytesIO()
        Image.fromarray(tableau, "RGBA").save(tampon, format="PNG", optimize=True)
        return tampon.getvalue()

    nom_image = f"{nom_base}.png"
    nom_couverture = f"{nom_base}_couverture.png"

    ecrire_atomique(dossier_sortie / nom_image, png(image))

    # Zone couverte : noir opaque là où une mesure existe, transparent
    # ailleurs. La carte s'en sert pour hachurer les zones sans mesure.
    couverture = np.zeros((hauteur, largeur, 4), dtype=np.uint8)
    couverture[mesure] = (0, 0, 0, 255)
    ecrire_atomique(dossier_sortie / nom_couverture, png(couverture))

    pixels_pluie = int((classe > 0).sum())
    pixels_mesure = int(mesure.sum())

    meta = {
        "image": nom_image,
        "couverture": nom_couverture,
        "projection": "mercator",
        "emprise": [ouest, sud, est, nord],
        "largeur": largeur,
        "hauteur": hauteur,
        "date_utc": iso(m["instant"]),
        "debut_utc": iso(m["debut"]),
        "fin_utc": iso(m["fin"]),
        "periode_minutes": m["periode_minutes"],
        "quantite": m["quantite"],
        "unite": m["unite"],
        "seuils": SEUILS,
        "couleurs": COULEURS,
        "source": Path(chemin_h5).name,
        "ecart_coins_m": round(m["ecart_coins_max"], 1),
        "radars_absents": m["radars_absents"],
        "attribution": (
            "Source : EUMETNET OPERA — CC BY 4.0 — "
            "Données reprojetées et colorisées par HKO Météo"
            if m["quantite"] == "RATE"
            else "Source : Météo-France"
        ),
    }

    # Le fichier de description est écrit en dernier : le navigateur ne
    # voit jamais une description qui pointe vers des images incomplètes.
    ecrire_atomique(
        dossier_sortie / "radar.json",
        json.dumps(meta, ensure_ascii=False, indent=2),
    )

    print(f"Emprise          : {ouest}° à {est}° E, {sud}° à {nord}° N")
    print(f"Image            : {largeur} x {hauteur} pixels")
    print(f"Couverture radar : {100 * pixels_mesure / (largeur * hauteur):.1f} % de l'image")
    print(f"Pluie détectée   : {100 * pixels_pluie / max(pixels_mesure, 1):.2f} % "
          "de la zone couverte")
    if mesure.any():
        print(f"Valeur maximale  : {valeur[mesure].max():.2f} {m['unite']}")
    print("Écrit            :", dossier_sortie / nom_image)
    print("Écrit            :", dossier_sortie / nom_couverture)
    print("Écrit            :", dossier_sortie / "radar.json")

    return meta


# ---------------------------------------------------------------------------
# 3. Grille commune de la fusion
# ---------------------------------------------------------------------------

def sur_grille(mosaique):
    """
    Ramène la mosaïque sur la grille commune. Renvoie des tableaux (NY, NX) :

        couverture   part des points de la cellule mesurés par un radar
        pluie        part des points mesurés où l'intensité >= 0,2 mm/h
        intensite    intensité moyenne sur les points pluvieux (mm/h)
        maximum      intensité maximale de la cellule (mm/h)

    Les cellules sans aucune mesure valent NaN (sauf couverture = 0).
    """
    from meteo_app.sources import grille

    m = mosaique
    cle = grille.cle_cache(
        "radar", m["projdef"], round(m["x_gauche"], 1), round(m["y_haut"], 1),
        m["pas_x"], m["pas_y"], m["lignes"], m["colonnes"],
    )
    table = grille.indices_par_projection(
        cle, m["vers_radar"], m["x_gauche"], m["y_haut"],
        m["pas_x"], m["pas_y"], m["colonnes"], m["lignes"],
    )

    mesure = m["mesure"][table["ligne"], table["colonne"]] & table["valide"]
    valeurs = m["intensite"][table["ligne"], table["colonne"]]
    valeurs = np.where(mesure, valeurs, np.nan)

    n = mesure.shape[2]
    nb_mesures = mesure.sum(axis=2)
    pluvieux = mesure & (np.nan_to_num(valeurs) >= SEUIL_PLUIE)
    nb_pluie = pluvieux.sum(axis=2)

    with np.errstate(invalid="ignore", divide="ignore"):
        couverture = nb_mesures / n
        pluie = np.where(nb_mesures > 0, nb_pluie / np.maximum(nb_mesures, 1), np.nan)
        intensite = np.where(
            nb_pluie > 0,
            np.where(pluvieux, valeurs, 0).sum(axis=2) / np.maximum(nb_pluie, 1),
            np.where(nb_mesures > 0, 0.0, np.nan),
        )
        maximum = np.where(nb_mesures > 0, np.nanmax(np.where(mesure, valeurs, -1), axis=2), np.nan)

    return {
        "couverture": couverture.astype(np.float32),
        "pluie": pluie.astype(np.float32),
        "intensite": intensite.astype(np.float32),
        "maximum": np.where(maximum < 0, np.nan, maximum).astype(np.float32),
    }
