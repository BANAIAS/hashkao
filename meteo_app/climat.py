"""
HKO Météo — rubrique « Est-ce normal ? ».

Replace la température d'une journée dans la série quotidienne de
Paris-Montsouris (archives chargées par meteo.historique).

Vocabulaire :

- la « normale » est une référence climatique : la moyenne sur 30 ans
  (1991-2020), calculée ici sur une fenêtre de 15 jours centrée sur la
  date, pour ne pas dépendre du hasard d'un seul jour ;
- l'écart d'une journée à cette normale est une variation météo ;
- l'évolution des moyennes par décennie relève du climat.
"""

from datetime import date as Date, datetime, time, timedelta

STATION_REFERENCE = "75114001"
NOM_STATION = "Paris-Montsouris"

NORMALE_DEBUT = 1991
NORMALE_FIN = 2020

DEMI_FENETRE = 7  # jours de part et d'autre de la date

INDICATEURS = {"chaud": "TX", "froid": "TN"}


def _arrondi(valeur, decimales=1):
    return None if valeur is None else round(float(valeur), decimales)


def contexte_climatique(mois, jour):
    """Statistiques historiques d'un jour de l'année, pour TX et TN."""
    import pandas as pd

    from meteo.historique import charger_historique

    meteo = charger_historique()

    # Rang du jour dans une année non bissextile (le 29 février suit le 28)
    reference = pd.to_datetime(
        {
            "year": 2001,
            "month": meteo["date"].dt.month,
            "day": meteo["date"].dt.day.where(
                ~((meteo["date"].dt.month == 2) & (meteo["date"].dt.day == 29)),
                28,
            ),
        }
    ).dt.dayofyear

    jour_cible = Date(2001, mois, 28 if (mois == 2 and jour == 29) else jour)
    rang_cible = jour_cible.timetuple().tm_yday

    ecart = (reference - rang_cible).abs()
    ecart = ecart.where(ecart <= 182, 365 - ecart)

    meme_jour = meteo.loc[
        (meteo["date"].dt.month == mois) & (meteo["date"].dt.day == jour)
    ]
    fenetre = meteo.loc[ecart <= DEMI_FENETRE]

    resultat = {}

    for mode, colonne in INDICATEURS.items():
        serie = meme_jour[["date", colonne]].dropna()

        if serie.empty:
            resultat[mode] = None
            continue

        valeurs = serie[colonne]

        annees = [
            {"annee": int(d.year), "temperature": float(t)}
            for d, t in zip(serie["date"], valeurs)
        ]

        plus_haut = serie.loc[valeurs.idxmax()]
        plus_bas = serie.loc[valeurs.idxmin()]

        # Normale climatique 1991-2020 sur la fenêtre de 15 jours
        base = fenetre.loc[
            fenetre["date"].dt.year.between(NORMALE_DEBUT, NORMALE_FIN),
            colonne,
        ].dropna()

        normale = float(base.mean()) if len(base) >= 300 else None

        # Moyennes par décennie sur la même fenêtre
        f = fenetre[["date", colonne]].dropna()
        decennie = (f["date"].dt.year // 10) * 10

        groupes = f.groupby(decennie)[colonne].agg(["mean", "count"])

        decennies = [
            {
                "decennie": int(d),
                "moyenne": _arrondi(ligne["mean"], 2),
                "nombre": int(ligne["count"]),
            }
            for d, ligne in groupes.iterrows()
            # Au moins 5 années documentées dans la décennie
            if ligne["count"] >= 5 * (2 * DEMI_FENETRE + 1)
        ]

        resultat[mode] = {
            "indicateur": colonne,
            "annees": annees,
            "nombre_annees": len(annees),
            "premiere_annee": annees[0]["annee"],
            "derniere_annee": annees[-1]["annee"],
            "mediane": _arrondi(valeurs.median()),
            "decile_bas": _arrondi(valeurs.quantile(0.1)),
            "decile_haut": _arrondi(valeurs.quantile(0.9)),
            "record_haut": {
                "annee": int(plus_haut["date"].year),
                "temperature": float(plus_haut[colonne]),
            },
            "record_bas": {
                "annee": int(plus_bas["date"].year),
                "temperature": float(plus_bas[colonne]),
            },
            "normale": _arrondi(normale),
            "normale_periode": f"{NORMALE_DEBUT}-{NORMALE_FIN}",
            "normale_valeurs": int(len(base)),
            "decennies": decennies,
        }

    return resultat


def mesure_du_jour(jour):
    """
    Maximum et minimum mesurés à Paris-Montsouris pour un jour civil
    (heure de Paris), d'après les observations 6 minutes en base.

    Renvoie None si la station n'a aucune mesure ce jour-là.
    """
    from django.db.models import Count, Max, Min
    from django.utils import timezone

    from .models import ObservationMeteo

    fuseau = timezone.get_current_timezone()

    debut = datetime.combine(jour, time.min).replace(tzinfo=fuseau)
    fin = debut + timedelta(days=1)

    bilan = ObservationMeteo.objects.filter(
        station__identifiant=STATION_REFERENCE,
        date__gte=debut,
        date__lt=fin,
        temperature__isnull=False,
    ).aggregate(
        maximum=Max("temperature"),
        minimum=Min("temperature"),
        nombre=Count("id"),
        derniere=Max("date"),
    )

    if not bilan["nombre"]:
        return None

    aujourdhui = timezone.localdate()

    return {
        "maximum": _arrondi(bilan["maximum"]),
        "minimum": _arrondi(bilan["minimum"]),
        "nombre": bilan["nombre"],
        # 240 créneaux de 6 minutes dans une journée
        "couverture": round(min(bilan["nombre"] / 240, 1), 2),
        "derniere": bilan["derniere"].isoformat(),
        "en_cours": jour == aujourdhui,
    }


def situer(valeur, annees):
    """Part des années de la série plus froides et plus chaudes que la valeur."""
    temperatures = [a["temperature"] for a in annees]
    total = len(temperatures)

    if not total or valeur is None:
        return None

    plus_froides = sum(1 for t in temperatures if t < valeur)
    plus_chaudes = sum(1 for t in temperatures if t > valeur)

    return {
        "plus_froides": plus_froides,
        "plus_chaudes": plus_chaudes,
        "total": total,
        "part_plus_froides": round(100 * plus_froides / total),
        "rang_chaud": plus_chaudes + 1,
        "rang_froid": plus_froides + 1,
    }
