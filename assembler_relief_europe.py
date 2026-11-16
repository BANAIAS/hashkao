
import json
import re
from pathlib import Path

dossier = Path("meteo_app/data/relief")

# Couverture de l'Europe occidentale
lon_min, lon_max = -12, 17
lat_min, lat_max = 35, 56

resolution = 100

largeur = (lon_max - lon_min) * resolution
hauteur = (lat_max - lat_min) * resolution

# Grille du nord vers le sud
grille = [
    [None] * largeur
    for _ in range(hauteur)
]

liste_tuiles = (
    dossier / "tuiles_europe.txt"
).read_text(encoding="utf-8-sig").splitlines()

nombre_assemble = 0

for nom in liste_tuiles:

    fichier = dossier / "grilles_europe" / f"{nom}.json"

    if not fichier.exists():
        fichier = dossier / "grilles_france" / f"{nom}.json"

    if not fichier.exists():
        print("Tuile absente :", nom)
        continue

    correspondance = re.search(
        r"_([NS])(\d{2})_00_([EW])(\d{3})_00_DEM",
        nom
    )

    if not correspondance:
        print("Nom non reconnu :", nom)
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

    nombre_assemble += 1

resultat = {
    "bounds": [lon_min, lat_min, lon_max, lat_max],
    "largeur": largeur,
    "hauteur": hauteur,
    "resolution": resolution,
    "altitudes": grille
}

sortie = dossier / "relief_europe.json"

sortie.write_text(
    json.dumps(resultat, separators=(",", ":")),
    encoding="utf-8"
)

print("Tuiles assemblées :", nombre_assemble)
print("Dimensions :", largeur, "x", hauteur)
print("Taille du fichier :", round(sortie.stat().st_size / 1024 / 1024, 2), "Mo")
print("Fichier créé :", sortie)
print("Assemblage terminé !")
