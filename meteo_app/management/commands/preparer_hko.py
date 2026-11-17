"""
Prépare les ressources allégées de la carte HKO Météo.

    python manage.py preparer_hko

À partir des fichiers déjà présents dans meteo_app/static/meteo_app/ :

    geo/pays_monde_50m.geojson      -> geo/hko_pays.geojson
    geo/departements.geojson        -> geo/hko_departements.geojson
    relief/relief_europe.json.gz    -> relief/hko_relief.json.gz

Les fichiers produits sont beaucoup plus légers (chargement rapide,
notamment sur mobile). La carte les utilise s'ils existent et revient
sinon aux fichiers d'origine. Aucune bibliothèque supplémentaire.
"""

import gzip
import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

STATIQUE = Path(__file__).resolve().parents[2] / "static" / "meteo_app"

# Zone utile autour de la France (ouest, sud, est, nord)
ZONE = (-30.0, 22.0, 42.0, 70.0)

# Pas d'accrochage des coordonnées, en degrés. Les sommets voisins sont
# ramenés sur la même grille : les frontières communes restent jointives.
PAS_PAYS = 0.01
PAS_DEPARTEMENTS = 0.008


def accrocher(anneau, pas):
    resultat = []
    decimales = 3

    for longitude, latitude, *_ in anneau:
        point = [
            round(round(longitude / pas) * pas, decimales),
            round(round(latitude / pas) * pas, decimales),
        ]
        if not resultat or resultat[-1] != point:
            resultat.append(point)

    if len(resultat) >= 3 and resultat[0] != resultat[-1]:
        resultat.append(resultat[0])

    return resultat if len(resultat) >= 4 else None


def dans_zone(anneau):
    longitudes = [p[0] for p in anneau]
    latitudes = [p[1] for p in anneau]

    return not (
        max(longitudes) < ZONE[0] or min(longitudes) > ZONE[2]
        or max(latitudes) < ZONE[1] or min(latitudes) > ZONE[3]
    )


def alleger_geometrie(geometrie, pas, filtrer_zone):
    if not geometrie:
        return None

    if geometrie["type"] == "Polygon":
        polygones = [geometrie["coordinates"]]
    elif geometrie["type"] == "MultiPolygon":
        polygones = geometrie["coordinates"]
    else:
        return None

    gardes = []

    for polygone in polygones:
        if not polygone:
            continue
        if filtrer_zone and not dans_zone(polygone[0]):
            continue

        exterieur = accrocher(polygone[0], pas)
        if not exterieur:
            continue

        trous = [a for a in (accrocher(t, pas) for t in polygone[1:]) if a]
        gardes.append([exterieur] + trous)

    if not gardes:
        return None

    return {"type": "MultiPolygon", "coordinates": gardes}


class Command(BaseCommand):
    help = "Prépare les fichiers géographiques et de relief allégés de HKO Météo."

    def ecrire(self, chemin, contenu, compresser=False):
        texte = json.dumps(contenu, separators=(",", ":"), ensure_ascii=False)

        if compresser:
            with gzip.open(chemin, "wb", compresslevel=9) as sortie:
                sortie.write(texte.encode("utf-8"))
        else:
            chemin.write_text(texte, encoding="utf-8")

        taille = chemin.stat().st_size / 1024 / 1024
        self.stdout.write(f"  {chemin.name} : {taille:.2f} Mo")

    def handle(self, *args, **options):
        geo = STATIQUE / "geo"
        relief = STATIQUE / "relief"

        for source in (
            geo / "pays_monde_50m.geojson",
            geo / "departements.geojson",
            relief / "relief_europe.json.gz",
        ):
            if not source.is_file():
                raise CommandError(f"Fichier source introuvable : {source}")

        # --- Pays -------------------------------------------------------
        self.stdout.write("Pays…")
        pays = json.loads((geo / "pays_monde_50m.geojson").read_text("utf-8"))

        entites = []
        for entite in pays["features"]:
            geometrie = alleger_geometrie(entite.get("geometry"), PAS_PAYS, True)
            if geometrie:
                proprietes = entite.get("properties") or {}
                entites.append({
                    "type": "Feature",
                    "properties": {
                        "ADM0_A3": proprietes.get("ADM0_A3"),
                        "NAME_FR": proprietes.get("NAME_FR"),
                    },
                    "geometry": geometrie,
                })

        self.ecrire(
            geo / "hko_pays.geojson",
            {"type": "FeatureCollection", "features": entites},
        )

        # --- Départements ----------------------------------------------
        self.stdout.write("Départements…")
        departements = json.loads(
            (geo / "departements.geojson").read_text("utf-8")
        )

        entites = []
        for entite in departements["features"]:
            proprietes = entite.get("properties") or {}
            code = str(proprietes.get("code") or "")

            if code.startswith("97"):
                continue  # métropole et Corse uniquement

            geometrie = alleger_geometrie(
                entite.get("geometry"), PAS_DEPARTEMENTS, False
            )
            if geometrie:
                entites.append({
                    "type": "Feature",
                    "properties": {"code": code, "nom": proprietes.get("nom")},
                    "geometry": geometrie,
                })

        self.ecrire(
            geo / "hko_departements.geojson",
            {"type": "FeatureCollection", "features": entites},
        )

        # --- Relief -----------------------------------------------------
        self.stdout.write("Relief (quelques secondes)…")
        with gzip.open(relief / "relief_europe.json.gz", "rt", encoding="utf-8") as f:
            source = json.load(f)

        facteur = 2
        lignes = source["altitudes"]

        hauteur = source["hauteur"] // facteur
        largeur = source["largeur"] // facteur

        altitudes = []

        for ligne in range(hauteur):
            haut = lignes[ligne * facteur]
            bas = lignes[ligne * facteur + 1]

            for colonne in range(largeur):
                c = colonne * facteur
                valeurs = [
                    v for v in (haut[c], haut[c + 1], bas[c], bas[c + 1])
                    if v is not None
                ]
                # Entiers (mètres) ; None reste None (mer ou hors données)
                altitudes.append(
                    int(round(sum(valeurs) / len(valeurs))) if valeurs else None
                )

        self.ecrire(
            relief / "hko_relief.json.gz",
            {
                "bounds": source["bounds"],
                "largeur": largeur,
                "hauteur": hauteur,
                "resolution": source["resolution"] / facteur,
                "altitudes": altitudes,
            },
            compresser=True,
        )

        self.stdout.write(self.style.SUCCESS("Ressources HKO Météo prêtes."))
