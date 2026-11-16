
import json
from pathlib import Path

from shapely.geometry import shape, box
from shapely.ops import unary_union

dossier = Path("meteo_app/data/relief")

fichier_geojson = Path(
    "meteo_app/static/meteo_app/geo/pays_monde_50m.geojson"
)

# Zone de l'Europe occidentale
lon_min, lon_max = -12, 17
lat_min, lat_max = 35, 56

with fichier_geojson.open(encoding="utf-8") as fichier:
    geojson = json.load(fichier)

# Réunir les terres situées dans notre zone
zone = box(lon_min, lat_min, lon_max, lat_max)

geometries = [
    shape(feature["geometry"])
    for feature in geojson["features"]
    if shape(feature["geometry"]).intersects(zone)
]

terres = unary_union(geometries)

tuiles = []

for latitude in range(lat_min, lat_max):
    for longitude in range(lon_min, lon_max):

        tuile = box(
            longitude,
            latitude,
            longitude + 1,
            latitude + 1
        )

        if not terres.intersects(tuile):
            continue

        ns = "N" if latitude >= 0 else "S"
        ew = "E" if longitude >= 0 else "W"

        nom = (
            f"Copernicus_DSM_COG_10_"
            f"{ns}{abs(latitude):02d}_00_"
            f"{ew}{abs(longitude):03d}_00_DEM"
        )

        tuiles.append(nom)

sortie = dossier / "tuiles_europe.txt"

sortie.write_text(
    "\n".join(tuiles),
    encoding="utf-8"
)

print("Tuiles européennes :", len(tuiles))
print("Liste enregistrée :", sortie)
