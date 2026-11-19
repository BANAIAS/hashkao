
import io
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

from django.core.management.base import BaseCommand, CommandError
from PIL import Image

from meteo_app.sources.commun import (
    requete,
    dossier_publication,
    ecrire_atomique,
    verrou,
)


URL_WMS = "https://view.eumetsat.int/geoserver/wms"
COUCHE = "mtg_fd:rgb_geocolour"


def lire_date(instant):
    return datetime.fromisoformat(
        instant.strip().replace("Z", "+00:00")
    ).astimezone(timezone.utc)


def observations_disponibles(heures=2):
    """Recherche les observations annoncees dans le catalogue."""

    with requete(
        URL_WMS,
        params={
            "service": "WMS",
            "version": "1.3.0",
            "request": "GetCapabilities",
        },
    ) as reponse:
        racine = ET.fromstring(reponse.content)

    ns = {"wms": "http://www.opengis.net/wms"}
    disponibles = set()

    for couche in racine.findall(".//wms:Layer", ns):
        nom = couche.findtext("wms:Name", namespaces=ns)

        if nom != COUCHE:
            continue

        for dimension in couche.findall("wms:Dimension", ns):
            if dimension.get("name") != "time":
                continue

            dernier = dimension.get("default")

            if not dernier:
                raise CommandError("Heure GeoColour introuvable.")

            fin = lire_date(dernier)
            debut = fin - timedelta(hours=heures)

            disponibles.add(fin)

            for element in (dimension.text or "").split(","):
                element = element.strip()

                if not element:
                    continue

                parties = element.split("/")

                if len(parties) == 1:
                    date = lire_date(element)

                    if debut <= date <= fin:
                        disponibles.add(date)

                elif len(parties) == 3:
                    premiere = lire_date(parties[0])
                    derniere = lire_date(parties[1])
                    resolution = parties[2]

                    if resolution != "PT10M":
                        raise CommandError(
                            f"Resolution temporelle inattendue : "
                            f"{resolution}"
                        )

                    pas = timedelta(minutes=10)
                    date = premiere

                    if date < debut:
                        n = (debut - date) // pas
                        date += n * pas

                        if date < debut:
                            date += pas

                    while date <= min(derniere, fin):
                        disponibles.add(date)
                        date += pas

                else:
                    raise CommandError(
                        f"Intervalle WMS inattendu : {element}"
                    )

            return sorted(disponibles)

    raise CommandError("Catalogue GeoColour introuvable.")


def derniere_observation():
    date = observations_disponibles(heures=0)[-1]
    return date.strftime("%Y-%m-%dT%H:%M:%SZ")


def telecharger_image(instant):
    with requete(
        URL_WMS,
        params={
            "SERVICE": "WMS",
            "VERSION": "1.3.0",
            "REQUEST": "GetMap",
            "LAYERS": COUCHE,
            "STYLES": "raster",
            "CRS": "EPSG:3857",
            "BBOX": "-1781111.85,4028802.03,2449028.80,8399737.89",
            "WIDTH": 3980,
            "HEIGHT": 4112,
            "FORMAT": "image/png",
            "TIME": instant,
        },
    ) as reponse:
        contenu = reponse.content

    with Image.open(io.BytesIO(contenu)) as image:
        if image.size != (3980, 4112):
            raise CommandError(
                "Dimensions GeoColour incorrectes."
            )

        tampon = io.BytesIO()

        image.convert("RGB").save(
            tampon,
            format="WEBP",
            quality=90,
            method=4,
        )

    return tampon.getvalue()


def nettoyer_anciennes_images(repertoire):
    limite = datetime.now(timezone.utc) - timedelta(days=7)
    supprimees = 0

    fichiers = sorted(repertoire.glob("geocolour_*.webp"))

    for fichier in fichiers[:-1]:
        try:
            date = datetime.strptime(
                fichier.stem,
                "geocolour_%Y%m%dT%H%MZ"
            ).replace(tzinfo=timezone.utc)

        except ValueError:
            continue

        if date < limite:
            fichier.unlink(missing_ok=True)
            supprimees += 1

    return supprimees


class Command(BaseCommand):
    help = "Collecte et rattrapage des images GeoColour EUMETSAT"

    def add_arguments(self, parser):
        parser.add_argument(
            "--heures",
            type=int,
            default=2,
            help="Nombre d'heures a verifier dans le catalogue.",
        )

        parser.add_argument(
            "--simulation",
            action="store_true",
            help="Liste les images manquantes sans les telecharger.",
        )

    def handle(self, *args, **options):
        heures = options["heures"]
        simulation = options["simulation"]

        if not 1 <= heures <= 24:
            raise CommandError(
                "--heures doit etre compris entre 1 et 24."
            )

        with verrou(
            "geocolour",
            duree_max_secondes=10800,
        ):
            dates = observations_disponibles(heures)
            repertoire = dossier_publication("geocolour")

            manquantes = []

            for date in dates:
                nom = f"geocolour_{date:%Y%m%dT%H%MZ}.webp"
                chemin = repertoire / nom

                if not chemin.exists():
                    manquantes.append((date, chemin))

            self.stdout.write(
                f"Observations annoncees : {len(dates)}"
            )
            self.stdout.write(
                f"Images deja disponibles : "
                f"{len(dates) - len(manquantes)}"
            )
            self.stdout.write(
                f"Images manquantes : {len(manquantes)}"
            )

            if simulation:
                for date, chemin in manquantes:
                    self.stdout.write(
                        f"A recuperer : {chemin.name}"
                    )

                self.stdout.write("Simulation terminee.")
                return

            nouvelles = 0
            erreurs = 0

            # Priorite a l'observation la plus recente.
            for date, chemin in reversed(manquantes):
                instant = date.strftime("%Y-%m-%dT%H:%M:%SZ")

                self.stdout.write(
                    f"Telechargement : {instant}"
                )

                try:
                    contenu = telecharger_image(instant)
                    ecrire_atomique(chemin, contenu)

                    nouvelles += 1

                    self.stdout.write(
                        self.style.SUCCESS(
                            f"Image enregistree : {chemin.name}"
                            f" ({len(contenu) / 1024**2:.2f} Mo)"
                        )
                    )

                except Exception as erreur:
                    erreurs += 1

                    self.stderr.write(
                        f"Echec pour {instant} : {erreur}"
                    )

            supprimees = nettoyer_anciennes_images(repertoire)

            self.stdout.write(
                f"Images nouvelles : {nouvelles}"
            )
            self.stdout.write(
                f"Images anciennes supprimees : {supprimees}"
            )
            self.stdout.write(
                f"Erreurs de collecte : {erreurs}"
            )

            if erreurs:
                raise CommandError(
                    f"{erreurs} observation(s) non recuperee(s)."
                )
