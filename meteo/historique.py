
from pathlib import Path
from functools import lru_cache

import pandas as pd


# Emplacement des archives quotidiennes
DATA_DIR = Path(__file__).parent / "data" / "quotidiennes"

# Station Paris-Montsouris
STATION_ID = "75114001"


@lru_cache(maxsize=1)
def charger_historique():
    """
    Charge les archives quotidiennes de Paris-Montsouris.

    Les données sont conservées en mémoire après le premier
    chargement pour éviter de relire les fichiers à chaque appel.
    """

    fichiers = sorted(DATA_DIR.glob("*.csv.gz"))

    if not fichiers:
        raise FileNotFoundError(
            f"Aucune archive trouvée dans {DATA_DIR}"
        )

    observations = []

    for fichier in fichiers:
        df = pd.read_csv(
            fichier,
            sep=";",
            compression="gzip",
            dtype={"NUM_POSTE": str},
            usecols=[
                "NUM_POSTE",
                "AAAAMMJJ",
                "TN",
                "TX",
                "QTN",
                "QTX"
            ]
        )

        # Conserver uniquement Paris-Montsouris
        paris = df.loc[
            df["NUM_POSTE"] == STATION_ID
        ].copy()

        observations.append(paris)

    meteo = pd.concat(observations, ignore_index=True)

    # Conversion des dates
    meteo["date"] = pd.to_datetime(
        meteo["AAAAMMJJ"].astype(str),
        format="%Y%m%d"
    )

    # Période historique de référence
    meteo = meteo.loc[
        meteo["date"].dt.year.between(1900, 2025)
    ].copy()

# Ne conserver que les températures de qualité validée (code 1)
# Les valeurs non validées deviennent manquantes.

    meteo.loc[meteo["QTN"] != 1, "TN"] = float("nan")
    meteo.loc[meteo["QTX"] != 1, "TX"] = float("nan")

    meteo = meteo.sort_values("date").reset_index(drop=True)

    return meteo


def classement_historique(mois, jour, mode="chaud"):
    """
    Classe les températures historiques pour un jour donné.

    mode="chaud" : températures maximales (TX), ordre décroissant
    mode="froid" : températures minimales (TN), ordre croissant
    """

    if mode not in ("chaud", "froid"):
        raise ValueError("Le mode doit être 'chaud' ou 'froid'.")

    meteo = charger_historique()

    colonne = "TX" if mode == "chaud" else "TN"
    ordre_croissant = mode == "froid"

    # Sélectionner le même jour et le même mois
    selection = meteo.loc[
        (meteo["date"].dt.month == mois)
        & (meteo["date"].dt.day == jour)
    ].copy()

    # Exclure les températures manquantes
    selection = selection.dropna(subset=[colonne])

    # Trier selon le mode choisi
    selection = selection.sort_values(
        colonne,
        ascending=ordre_croissant
    ).reset_index(drop=True)

    selection["Année"] = selection["date"].dt.year
    selection["Rang"] = selection.index + 1

    top3 = selection[["Rang", "Année", colonne]].head(3)

    return {
        "date": f"{jour:02d}/{mois:02d}",
        "mode": mode,
        "annees_comparees": len(selection),
        "mediane": round(float(selection[colonne].median()), 2),
        "top3": top3
    }


def position_temperature(mois, jour, temperature, mode="chaud"):
    """
    Positionne une température testée dans l'historique.

    Attention : la température testée doit être comparable
    à l'indicateur historique (TX ou TN quotidienne).
    """

    resultat = classement_historique(mois, jour, mode)

    meteo = charger_historique()
    colonne = "TX" if mode == "chaud" else "TN"

    selection = meteo.loc[
        (meteo["date"].dt.month == mois)
        & (meteo["date"].dt.day == jour),
        colonne
    ].dropna()

    if mode == "chaud":
        moins_extremes = (selection < temperature).sum()
        plus_extremes = (selection > temperature).sum()
    else:
        moins_extremes = (selection > temperature).sum()
        plus_extremes = (selection < temperature).sum()

    total = len(selection)

    if total == 0:
        raise ValueError("Aucune observation historique disponible.")

    resultat["temperature_testee"] = temperature
    resultat["pourcentage_moins_extremes"] = round(
        100 * moins_extremes / total, 1
    )
    resultat["rang_theorique"] = int(plus_extremes + 1)

    return resultat
