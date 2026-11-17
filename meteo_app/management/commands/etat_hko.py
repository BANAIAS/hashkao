"""
État des sources HKO Météo (surveillance).

    python manage.py etat_hko

Affiche, pour chaque source, l'âge de la dernière donnée et le résultat de
la dernière collecte. Se termine en erreur (code 1) si une source est en
retard : le planificateur du serveur peut ainsi déclencher une alerte.
"""

from django.core.management.base import BaseCommand, CommandError

from meteo_app.sources.surveillance import etat_des_sources


class Command(BaseCommand):
    help = "Vérifie la fraîcheur des sources HKO Météo."

    def handle(self, *args, **options):
        etat = etat_des_sources()

        for nom, s in etat["sources"].items():
            age = "jamais" if s["age_minutes"] is None else f"{s['age_minutes']} min"
            marque = "RETARD" if s["en_retard"] else "ok"
            self.stdout.write(
                f"{nom:10s} {marque:7s} dernière donnée : {age:>9s} (limite {s['limite_minutes']} min)"
                f" — dernière collecte : {s['dernier_statut'] or '—'}"
                + (f", {s['echecs_consecutifs']} échec(s) de suite" if s["echecs_consecutifs"] else "")
            )
            if s["dernier_statut"] == "echec" and s["dernier_message"]:
                self.stdout.write(f"{'':19s}{s['dernier_message']}")

        if etat["en_retard"]:
            raise CommandError("Sources en retard : " + ", ".join(etat["en_retard"]))
