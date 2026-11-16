
import json
from pathlib import Path

from shapely.geometry import shape, box
from shapely.ops import unary_union

# Fichiers du projet
fichier_geojson = Path(
    "meteo_app/static/meteo_app/geo/departements.geojson"
)

dossier = Path("meteo_app/data/relief")
dossier.mkdir(parents=True, exist_ok=True)

# Charger les départements
with fichier_geojson.open(encoding="utf-8") as fichier:
    geojson = json.load(fichier)

# Conserver la métropole et la Corse
departements = [
    shape(feature["geometry"])
    for feature in geojson["features"]
    if not str(feature["properties"].get("code", "")).startswith(
        ("97", "98")
    )
]

# Réunir les départements en une géométrie
france = unary_union(departements)

tuiles_utiles = []

for latitude in range(41, 52):
    for longitude in range(-6, 11):

        # Carré géographique de 1° x 1°
        tuile = box(
            longitude,
            latitude,
            longitude + 1,
            latitude + 1
        )

        if not france.intersects(tuile):
            continue

        ns = "N" if latitude >= 0 else "S"
        ew = "E" if longitude >= 0 else "W"

        nom = (
            f"Copernicus_DSM_COG_10_"
            f"{ns}{abs(latitude):02d}_00_"
            f"{ew}{abs(longitude):03d}_00_DEM"
        )

        tuiles_utiles.append(nom)

# Enregistrer la liste
fichier_sortie = dossier / "tuiles_france.txt"

fichier_sortie.write_text(
    "\n".join(tuiles_utiles),
    encoding="utf-8"
)

print("Tuiles candidates : 187")
print("Tuiles utiles :", len(tuiles_utiles))
print("Liste enregistrée :", fichier_sortie)

print("\nPremières tuiles :")
for nom in tuiles_utiles[:10]:
    print(nom)
