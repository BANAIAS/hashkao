
import json
import math
from pathlib import Path

fichier = Path("meteo_app/data/relief/relief_france.json")

donnees = json.loads(fichier.read_text(encoding="utf-8"))

lon_min, lat_min, lon_max, lat_max = donnees["bounds"]
resolution = donnees["resolution"]
grille = donnees["altitudes"]

lieux = {
    "Paris": (2.35, 48.85),
    "Lyon": (4.8357, 45.764),
    "Bordeaux": (-0.5792, 44.8378),
    "Chamonix": (6.8694, 45.9237),
    "Mont Blanc": (6.8652, 45.8326),
}

for nom, (longitude, latitude) in lieux.items():

    x = math.floor((longitude - lon_min) * resolution)
    y = math.floor((lat_max - latitude) * resolution)

    if 0 <= x < len(grille[0]) and 0 <= y < len(grille):
        altitude = grille[y][x]
        print(f"{nom} : {altitude} m")
    else:
        print(f"{nom} : hors grille")

print("\nVerification terminee !")
