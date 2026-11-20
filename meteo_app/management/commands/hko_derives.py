"""
Produit et entretient les ressources dérivées de HKO Météo.

    python manage.py hko_derives                 # récent : images, vidéos du jour (et de la veille), OPERA, purge
    python manage.py hko_derives --jours 7       # rattrapage des 7 derniers jours (archives existantes)
    python manage.py hko_derives --jour 2026-11-18
    python manage.py hko_derives --sans-video    # images et OPERA seulement
    python manage.py hko_derives --purger --simulation

Sans risque pour les données : seuls des fichiers sous publication/derives/
sont écrits ou effacés. Relançable à volonté : ce qui est à jour est sauté.
Prévu pour tourner toutes les 5 minutes (minuterie systemd), avec une
priorité basse pour ne gêner ni les collectes ni le site.
"""

from datetime import date, timedelta

from django.core.management.base import BaseCommand, CommandError

from meteo_app.sources import derives
from meteo_app.sources.commun import DejaEnCours, journal, maintenant, verrou


class Command(BaseCommand):
    help = "Produit les images satellite réduites, les vidéos H.264 et les trames OPERA ; purge les anciens dérivés."

    def add_arguments(self, parser):
        parser.add_argument("--jours", type=int, default=1,
                            help="Nombre de journées (Paris) à traiter, aujourd'hui compris (défaut : 1, plus la veille avant 1 h).")
        parser.add_argument("--jour", help="Une journée précise (AAAA-MM-JJ).")
        parser.add_argument("--profils", default=",".join(derives.PROFILS_SATELLITE),
                            help="Profils à produire (standard,leger).")
        parser.add_argument("--sans-video", action="store_true")
        parser.add_argument("--sans-opera", action="store_true")
        parser.add_argument("--purger", action="store_true", help="Seulement la purge.")
        parser.add_argument("--simulation", action="store_true", help="Avec --purger : n'efface rien.")

    def handle(self, *args, **options):
        profils = [p for p in options["profils"].split(",") if p]
        for p in profils:
            if p not in derives.PROFILS_SATELLITE:
                raise CommandError(f"Profil inconnu : {p}")

        try:
            with verrou("derives", duree_max_secondes=3600):
                with journal("derives", self.stdout) as suivi:
                    if options["purger"]:
                        n, o = derives.purger(simulation=options["simulation"])
                        suivi.succes(f"{'Simulation — ' if options['simulation'] else ''}{n} fichiers, {o / 1e6:.0f} Mo")
                        return
                    bilan = self.produire(options, profils)
                    n, o = derives.purger()
                    bilan.append(f"purge {n} fichiers ({o / 1e6:.0f} Mo)")
                    suivi.succes(" ; ".join(bilan))
        except DejaEnCours as erreur:
            self.stdout.write(str(erreur))

    def jours(self, options):
        if options["jour"]:
            return [date.fromisoformat(options["jour"])]
        aujourdhui = derives.jour_local(maintenant())
        jours = [aujourdhui - timedelta(days=i) for i in range(max(1, options["jours"]))]
        # Juste après minuit, la veille peut encore recevoir des observations tardives
        if options["jours"] == 1 and maintenant().astimezone(derives.PARIS).hour < 1:
            jours.append(aujourdhui - timedelta(days=1))
        return sorted(jours)

    def produire(self, options, profils):
        ecrire = self.stdout.write
        bilan = []
        originaux = derives.originaux_geocolour()

        for jour in self.jours(options):
            du_jour = derives.observations_du_jour(jour, originaux)
            ecrire(f"{jour} : {len(du_jour)} images GeoColour")
            for profil in profils:
                faites = 0
                for instant, original in du_jour:
                    avant = derives.chemin_image(profil, original.name)
                    existait = avant.exists() and avant.stat().st_mtime >= original.stat().st_mtime
                    derives.image_derivee(original, profil)
                    faites += not existait
                if faites:
                    bilan.append(f"{jour} {profil} : {faites} images")
                if not options["sans_video"] and du_jour:
                    index = derives.assembler_jour(profil, jour, originaux, journal=ecrire)
                    if index:
                        bilan.append(f"{jour} {profil} : vidéo de {len(index['observations'])} observations")

            if not options["sans_opera"]:
                bilan.extend(self.opera(jour))
        return bilan

    def opera(self, jour):
        from meteo_app.models import ProduitMeteo

        debut, fin = derives.bornes_jour(jour)
        produits = ProduitMeteo.objects.filter(source="opera", nature="observation",
                                               instant__gte=debut, instant__lt=fin)
        bilan = []
        for profil in derives.PROFILS_OPERA:
            faites = 0
            for produit in produits:
                chemin = derives.chemin_trame_opera(profil, produit.instant)
                existait = chemin.exists()
                try:
                    derives.trame_opera(produit, profil)
                except FileNotFoundError:
                    continue          # archive purgée : rien à dériver
                faites += not existait
            if faites:
                bilan.append(f"{jour} OPERA {profil} : {faites} trames")
        return bilan
