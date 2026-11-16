from pathlib import Path
import pandas as pd

# Dossier contenant les archives météo
DATA_DIR = Path(__file__).parent / "data"

# Station Paris-Montsouris
STATION_ID = "75114001"

# Liste des fichiers
fichiers = sorted(DATA_DIR.glob("*.csv.gz"))

print(f"Nombre de fichiers trouvés : {len(fichiers)}")

for fichier in fichiers:
    print(f"\nLecture : {fichier.name}")

    df = pd.read_csv(
        fichier,
        sep=";",
        compression="gzip",
        dtype={"NUM_POSTE": str},
        usecols=["NUM_POSTE", "AAAAMMJJHH", "T", "QT"],
    )

    paris = df[df["NUM_POSTE"] == STATION_ID]

    print(f"Relevés Paris-Montsouris : {len(paris):,}")
    print(f"Températures disponibles : {paris['T'].notna().sum():,}")
    print("Codes qualité QT :", paris["QT"].value_counts(dropna=False).to_dict())