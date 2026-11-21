"""
Produit et entretient les ressources dérivées de HKO Météo.

    python manage.py hko_derives                          # tout : images, OPERA, vidéos (heures closes), purge
    python manage.py hko_derives --etapes images,opera    # léger, toutes les 5 min (hko-derives-images)
    python manage.py hko_derives --etapes videos,purge --budget 240   # toutes les 15 min (hko-derives-videos)
    python manage.py hko_derives --jours 7 --etapes videos --budget 900   # rattrapage par tranches de 15 min
    python manage.py hko_derives --jour 2026-11-18
    python manage.py hko_derives --profils-video standard,leger
    python manage.py hko_derives --purger --simulation

Sans risque pour les données : seuls des fichiers sous publication/derives/
sont écrits ou effacés. Relançable à volonté : ce qui est à jour est sauté.

Deux verrous distincts : « derives_images » (images fixes et OPERA) et
« derives_videos » (vidéos et purge). Un encodage vidéo en cours ne retarde
donc jamais les images fixes que la page affiche à l'ouverture.

--budget : au-delà de ce nombre de secondes, aucun nouveau segment vidéo
n'est commencé ; le travail fait est gardé et la suite reprend au passage
suivant. Un passage ne déborde ainsi jamais sur le suivant.

Arrêt par systemd (SIGTERM, délai dépassé) : le verrou est rendu et FFmpeg
arrêté proprement ; aucun fichier partiel n'est visible.
"""

import signal
import time
from datetime import date, timedelta

from django.core.management.base import BaseCommand, CommandError

from meteo_app.sources import derives
from meteo_app.sources.commun import DejaEnCours, journal, maintenant, verrou

ETAPES = ("images", "opera", "videos", "purge")
GROUPES = {"images": "derives_images", "opera": "derives_images",
           "videos": "derives_videos", "purge": "derives_videos"}


def _arret(signum, frame):
    # Sans ceci, SIGTERM tue Python sans exécuter les « finally » : le verrou
    # resterait posé une heure et bloquerait les passages suivants.
    raise SystemExit(128 + signum)


class Command(BaseCommand):
    help = "Produit les images satellite réduites, les vidéos H.264 et les trames OPERA ; purge les anciens dérivés."

    def add_arguments(self, parser):
        parser.add_argument("--jours", type=int, default=1,
                            help="Nombre de journées (Paris) à traiter, aujourd'hui compris "
                                 "(défaut : 1, plus la veille jusqu'à 2 h).")
        parser.add_argument("--jour", help="Une journée précise (AAAA-MM-JJ).")
        parser.add_argument("--etapes", default=",".join(ETAPES),
                            help="images, opera, videos, purge (défaut : toutes).")
        parser.add_argument("--profils", default=",".join(derives.PROFILS_SATELLITE),
                            help="Profils des images fixes (défaut : haute,standard,leger).")
        parser.add_argument("--profils-video", default=None,
                            help="Profils des vidéos (défaut : les mêmes que --profils).")
        parser.add_argument("--budget", type=int, default=0,
                            help="Secondes au-delà desquelles aucun nouveau segment vidéo n'est commencé (0 : sans limite).")
        # Compatibilité avec les anciennes options
        parser.add_argument("--sans-video", action="store_true")
        parser.add_argument("--sans-opera", action="store_true")
        parser.add_argument("--purger", action="store_true", help="Seulement la purge.")
        parser.add_argument("--simulation", action="store_true", help="Avec --purger : n'efface rien.")

    @staticmethod
    def _profils(texte):
        profils = [p for p in texte.split(",") if p]
        for p in profils:
            if p not in derives.PROFILS_SATELLITE:
                raise CommandError(f"Profil inconnu : {p}")
        return profils

    def handle(self, *args, **options):
        signal.signal(signal.SIGTERM, _arret)
        self.debut = time.monotonic()

        profils = self._profils(options["profils"])
        profils_video = self._profils(options["profils_video"] or options["profils"])
        etapes = [e for e in options["etapes"].split(",") if e]
        for e in etapes:
            if e not in ETAPES:
                raise CommandError(f"Étape inconnue : {e}")
        if options["sans_video"]:
            etapes = [e for e in etapes if e != "videos"]
        if options["sans_opera"]:
            etapes = [e for e in etapes if e != "opera"]
        if options["purger"]:
            etapes = ["purge"]

        groupes = []
        for e in etapes:
            if GROUPES[e] not in groupes:
                groupes.append(GROUPES[e])

        for groupe in groupes:
            a_faire = [e for e in etapes if GROUPES[e] == groupe]
            try:
                with verrou(groupe, duree_max_secondes=3600):
                    with journal(groupe, self.stdout) as suivi:
                        bilan = self.executer(a_faire, options, profils, profils_video)
                        duree = time.monotonic() - self.debut
                        suivi.succes(" ; ".join(bilan + [f"{duree:.0f} s"]))
            except DejaEnCours as erreur:
                self.stdout.write(str(erreur))

    def jours(self, options):
        if options["jour"]:
            return [date.fromisoformat(options["jour"])]
        aujourdhui = derives.jour_local(maintenant())
        jours = [aujourdhui - timedelta(days=i) for i in range(max(1, options["jours"]))]
        # Juste après minuit, la veille reçoit encore ses dernières observations
        # et sa dernière heure se clôt (marge de 25 min)
        if options["jours"] == 1 and maintenant().astimezone(derives.PARIS).hour < 2:
            jours.append(aujourdhui - timedelta(days=1))
        # Les plus récentes d'abord : c'est ce que les visiteurs regardent
        return sorted(jours, reverse=True)

    def executer(self, etapes, options, profils, profils_video):
        bilan = []
        originaux = derives.originaux_geocolour()
        jours = self.jours(options)

        if "images" in etapes:
            bilan.extend(self.images(jours, originaux, profils))
        if "opera" in etapes:
            for jour in jours:
                bilan.extend(self.opera(jour))
        if "videos" in etapes:
            bilan.extend(self.videos(jours, originaux, profils_video, options["budget"]))
        if "purge" in etapes:
            n, o = derives.purger(simulation=options["simulation"])
            prefixe = "simulation — " if options["simulation"] else ""
            bilan.append(f"{prefixe}purge {n} fichiers ({o / 1e6:.0f} Mo)")
        return bilan

    # Images fixes : les plus récentes d'abord, un seul décodage de
    # l'original pour tous les profils
    def images(self, jours, originaux, profils):
        bilan = []
        for jour in jours:
            du_jour = derives.observations_du_jour(jour, originaux)
            faites = 0
            for _, original in sorted(du_jour, reverse=True):
                faites += derives.images_derivees(original, profils)
            if faites:
                bilan.append(f"{jour} : {faites} images")
        return bilan

    def videos(self, jours, originaux, profils, budget):
        bilan = []
        echeance = self.debut + budget if budget else None
        for jour in jours:
            if not derives.observations_du_jour(jour, originaux):
                continue
            for profil in profils:
                avant = derives.lire_index_video(profil, jour)
                try:
                    index = derives.assembler_jour(profil, jour, originaux, journal=self.stdout.write,
                                                   echeance=echeance)
                except derives.EcheanceAtteinte:
                    bilan.append(f"budget de {budget} s atteint : suite au prochain passage")
                    return bilan
                if index and (not avant or avant.get("video") != index["video"]):
                    bilan.append(f"{jour} {profil} : vidéo de {len(index['observations'])} observations")
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
