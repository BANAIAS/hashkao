import xml.etree.ElementTree as ET

from django.core.management.base import BaseCommand, CommandError
from meteo_app.sources.commun import requete

import io
from datetime import datetime, timedelta, timezone

from PIL import Image
from meteo_app.sources.commun import (
    dossier_publication,
    ecrire_atomique,
    verrou,
)


URL_WMS = "https://view.eumetsat.int/geoserver/wms"
COUCHE = "mtg_fd:rgb_geocolour"


def derniere_observation():
    reponse = requete(
        URL_WMS,
        params={
            "service": "WMS",
            "version": "1.3.0",
            "request": "GetCapabilities",
        },
    )

    racine = ET.fromstring(reponse.content)
    ns = {"wms": "http://www.opengis.net/wms"}

    for couche in racine.findall(".//wms:Layer", ns):
        nom = couche.findtext("wms:Name", namespaces=ns)

        if nom != COUCHE:
            continue

        for dimension in couche.findall("wms:Dimension", ns):
            if dimension.get("name") == "time":
                instant = dimension.get("default")

                if instant:
                    return instant

    raise CommandError("Heure GeoColour introuvable.")

def telecharger_image(instant):
    reponse = requete(
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
    )

    with Image.open(io.BytesIO(reponse.content)) as image:
        if image.size != (3980, 4112):
            raise CommandError("Dimensions GeoColour incorrectes.")

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
    help = "Collecte des images satellite GeoColour EUMETSAT"

    def handle(self, *args, **options):
        with verrou("geocolour"):
            instant = derniere_observation()
            date = datetime.fromisoformat(
                instant.replace("Z", "+00:00")
            ).astimezone(timezone.utc)

            repertoire = dossier_publication("geocolour")
            nom = f"geocolour_{date:%Y%m%dT%H%MZ}.webp"
            chemin = repertoire / nom

            if chemin.exists():
                self.stdout.write("Image deja disponible.")
                return

            self.stdout.write(f"Telechargement : {instant}")

            contenu = telecharger_image(instant)
            ecrire_atomique(chemin, contenu)

            supprimees = nettoyer_anciennes_images(repertoire)
            self.stdout.write(f"Images anciennes supprimees : {supprimees}")

            self.stdout.write(
                self.style.SUCCESS(
                    f"Image enregistree : {chemin}"
                    f" ({len(contenu) / 1024**2:.2f} Mo)"
                )
            )