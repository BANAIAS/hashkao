
import gzip
from pathlib import Path

dossier = Path("meteo_app/data/relief")

source = dossier / "relief_france.json"
destination = dossier / "relief_france.json.gz"

with source.open("rb") as entree:
    with gzip.open(destination, "wb", compresslevel=9) as sortie:
        while bloc := entree.read(1024 * 1024):
            sortie.write(bloc)

taille_originale = source.stat().st_size
taille_compressee = destination.stat().st_size

print("Taille originale :", round(taille_originale / 1024 / 1024, 2), "Mo")
print("Taille compressee :", round(taille_compressee / 1024 / 1024, 2), "Mo")
print(
    "Reduction :",
    round(100 * (1 - taille_compressee / taille_originale), 1),
    "%"
)
print("Compression terminee !")
