"""
HKO Météo — surveillance de la fraîcheur des sources.

Seuils au-delà desquels une source est déclarée en retard. Ils tiennent
compte du rythme de publication réel :

    stations   toutes les 6 min, publiées avec quelques minutes de délai
    radar      paquet toutes les 15 min (3 mosaïques de 5 min)
    satellite  toutes les 10 min, publié environ 5 à 10 min après
    arome      un cycle toutes les 3 h, publié plusieurs heures après
    fusion     dépend des précédentes
"""

from datetime import timedelta

from .commun import maintenant

RETARD_MAX = {
    "stations": timedelta(minutes=30),
    "radar": timedelta(minutes=40),
    "satellite": timedelta(minutes=45),
    "arome": timedelta(hours=9),
    "fusion": timedelta(minutes=40),
}


def etat_des_sources():
    from django.db.models import Max

    from meteo_app.models import JournalCollecte, ObservationMeteo, ProduitMeteo

    a = maintenant()
    resultat = {"verifie_le": a.isoformat(), "sources": {}, "en_retard": []}

    for source, limite in RETARD_MAX.items():
        if source == "stations":
            dernier = ObservationMeteo.objects.aggregate(v=Max("date"))["v"]
        elif source == "arome":
            dernier = ProduitMeteo.objects.filter(source="arome").aggregate(v=Max("reference"))["v"]
        else:
            dernier = ProduitMeteo.objects.filter(source=source, nature="observation").aggregate(v=Max("instant"))["v"]

        execution = JournalCollecte.objects.filter(source=source).exclude(statut="en_cours").first()
        echecs = 0
        for entree in JournalCollecte.objects.filter(source=source).exclude(statut="en_cours")[:10]:
            if entree.statut != "echec":
                break
            echecs += 1

        retard = dernier is None or a - dernier > limite
        resultat["sources"][source] = {
            "derniere_donnee": dernier.isoformat() if dernier else None,
            "age_minutes": round((a - dernier).total_seconds() / 60) if dernier else None,
            "limite_minutes": int(limite.total_seconds() / 60),
            "en_retard": retard,
            "derniere_execution": execution.debut.isoformat() if execution else None,
            "dernier_statut": execution.statut if execution else None,
            "dernier_message": execution.message[:200] if execution else None,
            "echecs_consecutifs": echecs,
        }
        if retard:
            resultat["en_retard"].append(source)

    return resultat
