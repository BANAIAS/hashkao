
import json
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling

dossier = Path("meteo_app/data/relief")
sortie = dossier / "grilles_europe"
sortie.mkdir(parents=True, exist_ok=True)

tuiles = (
    dossier / "tuiles_europe_manquantes.txt"
).read_text(encoding="utf-8-sig").splitlines()

base = "https://copernicus-dem-30m.s3.amazonaws.com"

for index, nom in enumerate(tuiles, start=1):
    fichier = sortie / f"{nom}.json"

    if fichier.exists():
        print(f"Déjà téléchargée : {nom}")
        continue

    url = f"/vsicurl/{base}/{nom}/{nom}.tif"

    print(f"Tuile {index}/{len(tuiles)} : {nom}", flush=True)

    try:
        with rasterio.Env(
            GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"
        ):
            with rasterio.open(url) as source:
                grille = source.read(
                    1,
                    out_shape=(100, 100),
                    resampling=Resampling.average,
                    masked=True
                )

                altitudes = [
                    [
                        round(float(valeur), 1)
                        if not np.ma.is_masked(valeur)
                        and np.isfinite(valeur)
                        else None
                        for valeur in ligne
                    ]
                    for ligne in grille
                ]

                resultat = {
                    "bounds": [
                        source.bounds.left,
                        source.bounds.bottom,
                        source.bounds.right,
                        source.bounds.top
                    ],
                    "largeur": 100,
                    "hauteur": 100,
                    "altitudes": altitudes
                }

        fichier.write_text(
            json.dumps(resultat, separators=(",", ":")),
            encoding="utf-8"
        )

        print("Enregistrée :", fichier.name, flush=True)

    except Exception as erreur:
        print("ERREUR :", nom, erreur, flush=True)

print("Traitement terminé.")
