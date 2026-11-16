
import json
import re
from pathlib import Path

dossier = Path("meteo_app/data/relief")
source = dossier / "grilles_france"

# Emprise nationale
lon_min, lon_max = -6, 11
lat_min, lat_max = 41, 52

resolution = 100

largeur = (lon_max - lon_min) * resolution
hauteur = (lat_max - lat_min) * resolution

# Lignes du nord vers le sud
grille = [
    [None] * largeur
    for _ in range(hauteur)
]

fichiers = sorted(source.glob("*.json"))

for fichier in fichiers:
    correspondance = re.search(
        r"_([NS])(\d{2})_00_([EW])(\d{3})_00_DEM",
        fichier.stem
    )

    if not correspondance:
        print("Nom non reconnu :", fichier.name)
        continue

    ns, latitude, ew, longitude = correspondance.groups()

    latitude = int(latitude) * (1 if ns == "N" else -1)
    longitude = int(longitude) * (1 if ew == "E" else -1)

    donnees = json.loads(fichier.read_text(encoding="utf-8"))
    altitudes = donnees["altitudes"]

    x = (longitude - lon_min) * resolution
    y = (lat_max - latitude - 1) * resolution

    for ligne in range(resolution):
        grille[y + ligne][x:x + resolution] = altitudes[ligne]

resultat = {
    "bounds": [lon_min, lat_min, lon_max, lat_max],
    "largeur": largeur,
    "hauteur": hauteur,
    "resolution": resolution,
    "altitudes": grille
}

sortie = dossier / "relief_france.json"

sortie.write_text(
    json.dumps(resultat, separators=(",", ":")),
    encoding="utf-8"
)

valeurs = [
    altitude
    for ligne in grille
    for altitude in ligne
    if altitude is not None
]

print("Tuiles assemblées :", len(fichiers))
print("Dimensions :", largeur, "x", hauteur)
print("Cellules avec altitude :", len(valeurs))
print("Altitude minimale :", min(valeurs), "m")
print("Altitude maximale :", max(valeurs), "m")
print("Taille du fichier :", round(sortie.stat().st_size / 1024 / 1024, 2), "Mo")
print("Fichier créé :", sortie)
print("Assemblage terminé !")
