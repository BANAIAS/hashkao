
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

dossier = Path("meteo_app/data/relief")

tuiles = (
    dossier / "tuiles_france.txt"
).read_text(encoding="utf-8").splitlines()

base = "https://copernicus-dem-30m.s3.amazonaws.com"

disponibles = []
manquantes = []

for i, nom in enumerate(tuiles, start=1):
    url = f"{base}/{nom}/{nom}.tif"

    requete = Request(url, method="HEAD")

    try:
        with urlopen(requete, timeout=15) as reponse:
            if reponse.status == 200:
                disponibles.append(nom)
                statut = "OK"
            else:
                manquantes.append(nom)
                statut = str(reponse.status)

    except (HTTPError, URLError, TimeoutError) as erreur:
        manquantes.append(nom)
        statut = str(erreur)

    print(f"{i}/{len(tuiles)} : {statut} - {nom}")

print("\nRESULTAT")
print("Disponibles :", len(disponibles))
print("Non verifiees ou manquantes :", len(manquantes))

(dossier / "tuiles_disponibles.txt").write_text(
    "\n".join(disponibles),
    encoding="utf-8"
)

(dossier / "tuiles_manquantes.txt").write_text(
    "\n".join(manquantes),
    encoding="utf-8"
)
