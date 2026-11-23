"""
Produit et entretient les ressources dérivées de HKO Météo.

    python manage.py hko_derives                          # tout : images, OPERA, vidéos (heures closes), purge
    python manage.py hko_derives --etapes images,opera    # léger, toutes les 5 min (hko-derives-images)
    python manage.py hko_derives --etapes videos,purge --budget 240   # toutes les 15 min (hko-derives-videos)
    python manage.py hko_derives --jours 7 --etapes videos --budget 900   # rattrapage par tranches de 15 min
    python manage.py hko_derives --jour 2026-11-18
    python manage.py hko_derives --profils-video standard,leger
    python manage.py hko_derives --purger --simulation
    python manage.py hko_derives --etapes resume          # résumés des journées closes (hko-derives-resume)
    python manage.py hko_derives --etapes resume --jour 2026-11-19 --forcer   # refaire un résumé

Sans risque pour les données : seuls des fichiers sous publication/derives/
sont écrits ou effacés. Relançable à volonté : ce qui est à jour est sauté.

Trois verrous distincts : « derives_images » (images fixes et OPERA),
« derives_videos » (vidéos et purge) et « derives_resume » (partitions du
film « Résumé du jour »). Un encodage vidéo en cours ne retarde donc jamais
les images fixes que la page affiche à l'ouverture.

Résumé du jour : une partition JSON par journée close (publication/derives/
resume/), calculée une fois, jamais purgée automatiquement. Sans --jour,
seules les journées closes des 7 derniers jours dont la partition manque
sont traitées (la plus récente d'abord).

--budget : au-delà de ce nombre de secondes, aucun nouveau segment vidéo
n'est commencé ; le travail fait est gardé et la suite reprend au passage
suivant. Un passage ne déborde ainsi jamais sur le suivant.

Verrous : verrous système (flock), rendus par le noyau même si le processus
est tué brutalement (SIGKILL, oom-kill). Arrêt par systemd (SIGTERM) :
FFmpeg est arrêté proprement ; aucun fichier partiel n'est visible.

Chaque passage écrit au journal sa durée et sa mémoire maximale (Python et
FFmpeg séparément), pour suivre la consommation réelle sur le serveur.
"""

import signal
import time
from datetime import date, timedelta

from django.core.management.base import BaseCommand, CommandError

from meteo_app.sources import derives
from meteo_app.sources.commun import DejaEnCours, journal, maintenant
from meteo_app.sources.verrous import verrou_noyau

try:
    import resource
except ImportError:          # Windows
    resource = None

ETAPES = ("images", "opera", "videos", "purge", "resume")
GROUPES = {"images": "derives_images", "opera": "derives_images",
           "videos": "derives_videos", "purge": "derives_videos",
           "resume": "derives_resume"}
# « resume » n'est lancé que s'il est demandé : il a son propre service
ETAPES_PAR_DEFAUT = ("images", "opera", "videos", "purge")


def memoire_maximale():
    """Mémoire résidente maximale (Mo) de ce processus et de ses enfants (FFmpeg)."""
    if resource is None:
        return ""
    python = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024
    enfants = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss // 1024
    return f"mémoire max : Python {python} Mo, FFmpeg {enfants} Mo"


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
        parser.add_argument("--etapes", default=",".join(ETAPES_PAR_DEFAUT),
                            help="images, opera, videos, purge, resume (défaut : les quatre premières).")
        parser.add_argument("--forcer", action="store_true",
                            help="Avec --etapes resume --jour : refait la partition même si elle existe.")
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
                with verrou_noyau(groupe):
                    with journal(groupe, self.stdout) as suivi:
                        bilan = self.executer(a_faire, options, profils, profils_video)
                        duree = time.monotonic() - self.debut
                        suivi.succes(" ; ".join(x for x in bilan + [f"{duree:.0f} s", memoire_maximale()] if x))
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
        if "resume" in etapes:
            bilan.extend(self.resumes(options))
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
                    bilan.append(f"budget de {budget} s atteint (segment suivant estimé à "
                                 f"{1.5 * derives.DUREES_SEGMENT.get(profil, 10):.0f} s) : suite au prochain passage")
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

    def resumes(self, options):
        from meteo_app.sources import resume

        if options["jour"]:
            jours = [date.fromisoformat(options["jour"])]
            if not resume.journee_close(jours[0], maintenant()):
                return [f"{jours[0]} : journée pas encore close, pas de résumé"]
        else:
            jours = resume.jours_a_produire(maintenant())
        bilan = []
        for jour in jours[:3]:                 # au plus trois par passage
            debut = time.monotonic()
            try:
                chemin = resume.produire(jour, forcer=options["forcer"])
            except resume.DonneesInsuffisantes as erreur:
                bilan.append(f"{jour} : résumé impossible ({erreur})")
                continue
            if chemin:
                bilan.append(f"{jour} : résumé « {resume.lire_partition(jour)['titre']} » "
                             f"({chemin.stat().st_size // 1024} Ko, {time.monotonic() - debut:.0f} s)")
            else:
                bilan.append(f"{jour} : résumé déjà fait")
        return bilan or ["aucun résumé à produire"]
