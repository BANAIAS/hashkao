"""
HKO Météo — modèle AROME de Météo-France (service WCS 2.0.1).

Service : MF-NWP-HIGHRES-AROME-001-FRANCE-WCS (0,01°, échéances 0 à 51 h)
Base    : https://public-api.meteofrance.fr/public/arome/1.0/wcs/MF-NWP-HIGHRES-AROME-001-FRANCE-WCS
Clé     : METEO_FRANCE_AROME_API_KEY (en-tête « apikey »)

Ce que montre le catalogue joint (GetCapabilities du 17 novembre 2026) :

- 6 074 couvertures, 46 paramètres ;
- un cycle toutes les 3 heures (00, 03, …, 21 UTC), environ 4,5 jours
  conservés ;
- identifiant = PARAMÈTRE___AAAA-MM-JJTHH.MM.SSZ (heure du cycle), avec
  un suffixe _PT1H, _PT3H… pour les cumuls ;
- formats proposés : image/tiff (GeoTIFF) et application/wmo-grib.

AROME est une PRÉVISION. Il complète les observations là où elles
manquent et fournit les jours suivants ; il n'est jamais présenté comme
une mesure. On distingue toujours :

    reference  heure d'initialisation du cycle (« run »)
    echeance   durée écoulée depuis le run
    validite   reference + echeance, l'heure que décrit le champ

Points NON VÉRIFIÉS faute d'accès à l'API depuis l'environnement de
développement (le diagnostic les contrôle sur votre machine) :

- la forme exacte du sous-ensemble temporel attendu par GetCoverage
  (secondes depuis le run, ou date ISO) : on lit l'axe dans
  DescribeCoverage et on essaie les deux ;
- les unités réelles (nébulosité en % ou en fraction, codes du type de
  précipitation) ;
- la compression des GeoTIFF renvoyés (donc le volume téléchargé).
"""

import io
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

import numpy as np

BASE = (
    "https://public-api.meteofrance.fr/public/arome/1.0/wcs/"
    "MF-NWP-HIGHRES-AROME-001-FRANCE-WCS"
)

# Zone demandée (un peu plus large que la grille de fusion n'est pas
# nécessaire : AROME s'arrête à environ 38° N - 55,4° N, 12° O - 16° E).
ZONE = {"lat": (40.5, 52.0), "long": (-6.5, 11.0)}

# Pause entre deux requêtes (secondes). Le quota du portail n'est pas
# documenté dans les pages consultées ; 1,5 s garde une marge confortable.
PAUSE = 1.5

# Paramètres collectés. hauteur : niveau en mètres, si la couverture en a.
# suffixe : cumul (_PT1H = cumul sur l'heure qui précède l'heure de validité).
PARAMETRES = {
    "temperature": {"indicateur": "TEMPERATURE__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND", "hauteur": 2},
    "nebulosite": {"indicateur": "TOTAL_CLOUD_COVER__GROUND_OR_WATER_SURFACE"},
    "nebulosite_basse": {"indicateur": "LOW_CLOUD_COVER__GROUND_OR_WATER_SURFACE"},
    "precipitation": {"indicateur": "TOTAL_PRECIPITATION__GROUND_OR_WATER_SURFACE", "suffixe": "_PT1H"},
    "type_precipitation": {"indicateur": "PRECIPITATION_TYPE_60_MIN__GROUND_OR_WATER_SURFACE", "categoriel": True},
    "visibilite": {"indicateur": "VISIBILITY_MINI_60MIN__GROUND_OR_WATER_SURFACE"},
    "rafale": {"indicateur": "WIND_SPEED_GUST__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND", "hauteur": 10},
    "vent_u": {"indicateur": "U_COMPONENT_OF_WIND__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND", "hauteur": 10},
    "vent_v": {"indicateur": "V_COMPONENT_OF_WIND__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND", "hauteur": 10},
    "foudre": {"indicateur": "LIGHTNING_STRIKE_DENSITY_CUMULATED__GROUND_OR_WATER_SURFACE", "suffixe": "_PT1H"},
}

# Codes du type de précipitation interprétés comme de la neige (tables
# GRIB2 4.201 : 5 neige, 6 neige humide, 7 pluie et neige, 8 granules de
# glace). À confirmer avec les valeurs relevées par le diagnostic.
CODES_NEIGE = {5, 6, 7, 8}

NS = {
    "wcs": "http://www.opengis.net/wcs/2.0",
    "gml": "http://www.opengis.net/gml/3.2",
    "gmlrgrid": "http://www.opengis.net/gml/3.3/rgrid",
    "swe": "http://www.opengis.net/swe/2.0",
}


class ErreurArome(Exception):
    pass


# ---------------------------------------------------------------------------
# Catalogue
# ---------------------------------------------------------------------------

def _date_couverture(texte):
    return datetime.strptime(texte, "%Y-%m-%dT%H.%M.%SZ").replace(tzinfo=timezone.utc)


def lire_catalogue(xml_texte):
    """
    Analyse GetCapabilities. Renvoie {indicateur: {suffixe: [cycles]}}
    où chaque cycle est un datetime UTC, trié du plus ancien au plus récent.
    """
    identifiants = re.findall(r"<wcs:CoverageId>([^<]+)</wcs:CoverageId>", xml_texte)
    catalogue = {}

    for identifiant in identifiants:
        trouve = re.match(r"^(.+?)___(\d{4}-\d\d-\d\dT\d\d\.\d\d\.\d\dZ)(_[A-Z0-9]+)?$", identifiant)
        if not trouve:
            continue
        indicateur, date_texte, suffixe = trouve.groups()
        catalogue.setdefault(indicateur, {}).setdefault(suffixe or "", []).append(
            _date_couverture(date_texte)
        )

    for variantes in catalogue.values():
        for liste in variantes.values():
            liste.sort()

    return catalogue


def dernier_cycle_complet(catalogue, parametres=PARAMETRES):
    """Le cycle le plus récent pour lequel tous les paramètres sont publiés."""
    communs = None
    for p in parametres.values():
        cycles = set(catalogue.get(p["indicateur"], {}).get(p.get("suffixe", ""), []))
        communs = cycles if communs is None else communs & cycles
    return max(communs) if communs else None


def identifiant(parametre, cycle):
    p = PARAMETRES[parametre]
    return f"{p['indicateur']}___{cycle:%Y-%m-%dT%H.%M.%SZ}{p.get('suffixe', '')}"


# ---------------------------------------------------------------------------
# DescribeCoverage
# ---------------------------------------------------------------------------

def lire_description(xml_texte):
    """
    Extrait de DescribeCoverage ce dont GetCoverage a besoin :

        axes         étiquettes des axes (ex. ['long', 'lat', 'height', 'time'])
        hauteurs     niveaux disponibles (m), s'il y a un axe vertical
        echeances    secondes depuis le run, si l'axe temps est relatif
        temps        valeurs brutes de l'axe temps (pour diagnostic)
        unite        unité annoncée du champ
        nil          valeurs « sans donnée »
        enveloppe    bornes géographiques
    """
    racine = ET.fromstring(xml_texte)

    description = {"axes": [], "hauteurs": [], "echeances": [], "temps": [],
                   "unite": None, "nil": [], "enveloppe": None}

    enveloppe = racine.find(".//gml:boundedBy/gml:Envelope", NS)
    if enveloppe is not None:
        description["axes"] = (enveloppe.get("axisLabels") or "").split()
        bas = (enveloppe.findtext("gml:lowerCorner", "", NS) or "").split()
        haut = (enveloppe.findtext("gml:upperCorner", "", NS) or "").split()
        description["enveloppe"] = {"bas": bas, "haut": haut}

    # Axes « référençables » : chaque axe porte ses coefficients
    for axe in racine.iter("{%s}GeneralGridAxis" % NS["gmlrgrid"]):
        nom = axe.findtext("gmlrgrid:gridAxesSpanned", "", NS).strip()
        coefficients = (axe.findtext("gmlrgrid:coefficients", "", NS) or "").split()
        if not coefficients:
            continue
        if nom.lower() in ("time", "temps"):
            description["temps"] = coefficients
            try:
                description["echeances"] = [int(float(c)) for c in coefficients]
            except ValueError:
                description["echeances"] = []
        elif nom.lower() in ("height", "z", "altitude", "elevation"):
            try:
                description["hauteurs"] = [float(c) for c in coefficients]
            except ValueError:
                pass

    unite = racine.find(".//swe:uom", NS)
    if unite is not None:
        description["unite"] = unite.get("code")

    for nil in racine.iter("{%s}nilValue" % NS["swe"]):
        if nil.text:
            description["nil"].append(nil.text.strip())

    return description


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------

class ClientArome:
    def __init__(self, cle, pause=PAUSE):
        import requests

        self.session = requests.Session()
        self.session.headers.update({"apikey": cle, "accept": "*/*"})
        self.pause = pause
        self._derniere = 0.0
        self.octets = 0
        self.requetes = 0

    def _get(self, operation, params, tentatives=4):
        from .commun import requete

        attente = self.pause - (time.monotonic() - self._derniere)
        if attente > 0:
            time.sleep(attente)

        try:
            reponse = requete(
                f"{BASE}/{operation}", params=params, session=self.session,
                tentatives=tentatives, timeout=120,
            )
        finally:
            self._derniere = time.monotonic()
            self.requetes += 1

        self.octets += len(reponse.content)
        return reponse

    def catalogue(self):
        r = self._get("GetCapabilities", {"service": "WCS", "version": "2.0.1", "language": "eng"})
        return r.text

    def description(self, coverage_id):
        r = self._get("DescribeCoverage", {
            "service": "WCS", "version": "2.0.1", "coverageID": coverage_id,
        })
        return r.text

    def couverture(self, coverage_id, cycle, validite, hauteur=None,
                   forme_temps="secondes", format_sortie="image/tiff", zone=ZONE):
        """
        GetCoverage pour une heure de validité. forme_temps : « secondes »
        (durée depuis le run) ou « iso » (date de validité).
        """
        if forme_temps == "secondes":
            temps = str(int((validite - cycle).total_seconds()))
        else:
            temps = f'"{validite:%Y-%m-%dT%H:%M:%SZ}"'

        sous_ensembles = [
            f"time({temps})",
            f"lat({zone['lat'][0]},{zone['lat'][1]})",
            f"long({zone['long'][0]},{zone['long'][1]})",
        ]
        if hauteur is not None:
            sous_ensembles.append(f"height({hauteur:g})")

        r = self._get("GetCoverage", {
            "service": "WCS", "version": "2.0.1", "coverageid": coverage_id,
            "subset": sous_ensembles, "format": format_sortie,
        }, tentatives=3)

        if r.content[:5] in (b"<?xml", b"<ows:", b"<Exce"):
            raise ErreurArome(f"Réponse XML au lieu d'une grille : {r.text[:300]}")

        return r.content


# ---------------------------------------------------------------------------
# GeoTIFF
# ---------------------------------------------------------------------------

def lire_geotiff(octets):
    """
    Lit un GeoTIFF à une bande en longitude/latitude, sans GDAL.
    Renvoie (valeurs float32, ouest, nord, pas_lon, pas_lat, nodata).

    Utilise tifffile s'il est installé, sinon Pillow. Les étiquettes
    GeoTIFF lues : ModelPixelScale (33550), ModelTiepoint (33922),
    GDAL_NODATA (42113).
    """
    etiquettes = {}
    try:
        import tifffile

        with tifffile.TiffFile(io.BytesIO(octets)) as tif:
            page = tif.pages[0]
            valeurs = page.asarray().astype(np.float32)
            for code in (33550, 33922, 42113, 1025):
                if code in page.tags:
                    etiquettes[code] = page.tags[code].value
    except ImportError:
        from PIL import Image

        image = Image.open(io.BytesIO(octets))
        valeurs = np.array(image, dtype=np.float32)
        for code in (33550, 33922, 42113):
            if code in image.tag_v2:
                etiquettes[code] = image.tag_v2[code]

    if valeurs.ndim == 3:
        valeurs = valeurs[..., 0]

    if 33550 not in etiquettes or 33922 not in etiquettes:
        raise ErreurArome("GeoTIFF sans géoréférencement (ModelPixelScale / ModelTiepoint).")

    pas_lon, pas_lat = float(etiquettes[33550][0]), float(etiquettes[33550][1])
    point = [float(v) for v in etiquettes[33922]]
    # Tiepoint : (i, j, k, x, y, z) ; le pixel (i, j) a pour coin x, y
    ouest = point[3] - point[0] * pas_lon
    nord = point[4] + point[1] * pas_lat

    nodata = None
    if 42113 in etiquettes:
        texte_nodata = str(etiquettes[42113]).strip("\x00 ")
        try:
            nodata = float(texte_nodata)
        except ValueError:
            nodata = None

    if nodata is not None:
        valeurs[valeurs == nodata] = np.nan

    # Convention « point » (1025 = 2) : les coordonnées désignent le centre
    if etiquettes.get(1025) == 2:
        ouest -= pas_lon / 2
        nord += pas_lat / 2

    return valeurs, ouest, nord, pas_lon, pas_lat, nodata


def sur_grille(valeurs, ouest, nord, pas_lon, pas_lat, categoriel=False):
    """
    Ramène un champ AROME (grille régulière lon/lat) sur la grille commune :
    moyenne des points prélevés, ou valeur la plus fréquente pour un champ
    catégoriel (type de précipitation).
    """
    from . import grille

    lon, lat = grille.points_echantillon()
    colonne = np.floor((lon - ouest) / pas_lon).astype(np.int64)
    ligne = np.floor((nord - lat) / pas_lat).astype(np.int64)
    valide = (colonne >= 0) & (colonne < valeurs.shape[1]) & (ligne >= 0) & (ligne < valeurs.shape[0])

    echantillons = np.full(lon.shape, np.nan, dtype=np.float32)
    echantillons[valide] = valeurs[ligne[valide], colonne[valide]]

    if not categoriel:
        with np.errstate(invalid="ignore"), _sans_alerte():
            return np.nanmean(echantillons, axis=2).astype(np.float32)

    # Catégoriel : le code le plus fréquent parmi les codes non nuls ;
    # 0 si aucune précipitation, NaN hors domaine
    resultat = np.full(lon.shape[:2], np.nan, dtype=np.float32)
    connus = np.isfinite(echantillons)
    resultat[connus.any(axis=2)] = 0
    codes = np.unique(echantillons[connus & (echantillons > 0)])
    meilleur = np.zeros(lon.shape[:2], dtype=np.int32)
    for code in codes:
        compte = (echantillons == code).sum(axis=2)
        plus = compte > meilleur
        resultat[plus] = code
        meilleur[plus] = compte[plus]
    return resultat


class _sans_alerte:
    def __enter__(self):
        import warnings
        self._contexte = warnings.catch_warnings()
        self._contexte.__enter__()
        warnings.simplefilter("ignore", RuntimeWarning)

    def __exit__(self, *exc):
        return self._contexte.__exit__(*exc)


def normaliser(champs, unites=None):
    """
    Met les champs dans les unités de la fusion :

        temperature  °C   (AROME publie des kelvins)
        nebulosite   0-1  (publiée en %, ou déjà en fraction)
        precipitation mm/h (cumul sur l'heure)
        rafale       km/h (publiée en m/s)
        vent_u/v     m/s
        visibilite   m
    """
    unites = unites or {}
    sortie = dict(champs)

    t = sortie.get("temperature")
    if t is not None and np.nanmedian(t) > 150:
        sortie["temperature"] = t - 273.15

    for nom in ("nebulosite", "nebulosite_basse"):
        n = sortie.get(nom)
        if n is not None and np.nanmax(n) > 1.5:
            sortie[nom] = n / 100

    if sortie.get("rafale") is not None:
        sortie["rafale"] = sortie["rafale"] * 3.6

    return sortie


def instant_validite(cycle, echeance_heures):
    return cycle + timedelta(hours=echeance_heures)
