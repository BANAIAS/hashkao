"""
Prépare les fonds d'images des tableaux HKO Météo.

    python manage.py preparer_fonds_cartes \
        --aout chemin/world.200408.3x21600x10800.jpg \
        --decembre chemin/world.topo.bathy.200412.3x21600x10800.jpg

Sources : NASA Blue Marble Next Generation (domaine public, crédit
« NASA Earth Observatory »), mosaïques mensuelles à 500 m ramenées à
21 600 × 10 800 pixels (60 pixels par degré).

- Août (« world ») donne la couleur des terres : c'est le mois sans neige
  saisonnière ; seuls les glaciers permanents restent blancs. La neige du
  jour est ajoutée par la carte, d'après le masque satellite observé.
- Décembre (« world.topo.bathy ») ne sert qu'aux fonds marins : sa
  bathymétrie ombrée (GEBCO) donne la profondeur, recolorée ici.
- Le relief de HKO (relief/relief_europe.json.gz, 100 pixels par degré)
  ajoute un ombrage plus fin que celui de la mosaïque.

Fichiers produits dans meteo_app/static/meteo_app/fonds/ :

    satellite_4096.webp, satellite_2048.webp   fond « vue satellite »
    bathymetrie.jpg                            profondeur (niveaux de gris)

Toutes ces images sont en projection de Mercator sur l'emprise EMPRISE :
la carte les pose avec un simple drawImage, quelle que soit la taille de
l'écran (la projection D3 n'est qu'une mise à l'échelle de Mercator).
"""

import gzip
import json
from pathlib import Path

import numpy as np
from django.core.management.base import BaseCommand, CommandError

STATIQUE = Path(__file__).resolve().parents[2] / "static" / "meteo_app"

# Emprise des fonds (ouest, sud, est, nord), en degrés. À garder identique
# à FOND_EMPRISE dans static/meteo_app/js/hko.js.
EMPRISE = (-16.0, 34.0, 22.0, 60.0)

PIXELS_PAR_DEGRE_SOURCE = 60


def mercator_y(latitude):
    return np.log(np.tan(np.pi / 4 + np.radians(latitude) / 2))


def latitude_de(y):
    return np.degrees(2 * np.arctan(np.exp(y)) - np.pi / 2)


def lire_zone(chemin, marge=1.0):
    """Découpe la zone utile (plus une marge) dans une mosaïque mondiale."""
    from PIL import Image

    Image.MAX_IMAGE_PIXELS = None
    image = Image.open(chemin)
    if image.size != (21600, 10800):
        raise CommandError(f"{chemin} : 21600 × 10800 pixels attendus, {image.size} trouvés.")

    ouest, sud, est, nord = EMPRISE
    p = PIXELS_PAR_DEGRE_SOURCE
    boite = (
        int((180 + ouest - marge) * p), int((90 - nord - marge) * p),
        int((180 + est + marge) * p), int((90 - sud + marge) * p),
    )
    zone = np.asarray(image.convert("RGB").crop(boite), dtype=np.float32) / 255.0
    origine = (ouest - marge, nord + marge)   # coin haut gauche (lon, lat)
    return zone, origine


def echantillonner(image, origine, pas, longitudes, latitudes):
    """Bilinéaire dans une grille régulière en degrés (image H × W × C)."""
    x = (longitudes[None, :] - origine[0]) / pas - 0.5
    y = (origine[1] - latitudes[:, None]) / pas - 0.5
    x = np.clip(x, 0, image.shape[1] - 1.001)
    y = np.clip(y, 0, image.shape[0] - 1.001)
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    fx = (x - x0)[..., None] if image.ndim == 3 else x - x0
    fy = (y - y0)[..., None] if image.ndim == 3 else y - y0
    x0 = np.broadcast_to(x0, (len(latitudes), len(longitudes)))
    y0 = np.broadcast_to(y0, (len(latitudes), len(longitudes)))
    a = image[y0, x0]
    b = image[y0, x0 + 1]
    c = image[y0 + 1, x0]
    d = image[y0 + 1, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def lire_relief():
    chemin = STATIQUE / "relief" / "relief_europe.json.gz"
    if not chemin.exists():
        return None
    with gzip.open(chemin, "rt") as f:
        source = json.load(f)
    altitudes = np.array(
        [[np.nan if v is None else v for v in ligne] for ligne in source["altitudes"]],
        dtype=np.float32,
    )
    ouest, sud, est, nord = source["bounds"]
    return altitudes, (ouest, nord), 1.0 / source["resolution"], (ouest, sud, est, nord)


def ombrage(altitudes, pas_degres, latitudes, accent=2.2):
    """Ombrage (lumière du nord-ouest, 45°) d'une grille d'altitudes."""
    z = np.nan_to_num(altitudes, nan=0.0)
    metres_y = 111320.0 * pas_degres
    metres_x = metres_y * np.cos(np.radians(latitudes))[:, None]
    dzdx = np.gradient(z, axis=1) / metres_x * accent
    dzdy = -np.gradient(z, axis=0) / metres_y * accent
    lx, ly, lz = -0.5, 0.5, 0.7071
    lumiere = (-dzdx * lx - dzdy * ly + lz) / np.sqrt(dzdx ** 2 + dzdy ** 2 + 1)
    return lumiere / 0.7071


def degrade(valeur, arrets):
    """Interpolation d'une palette [(position, (r, g, b)), ...]."""
    positions = np.array([a[0] for a in arrets])
    couleurs = np.array([a[1] for a in arrets], dtype=np.float32) / 255.0
    resultat = np.empty(valeur.shape + (3,), dtype=np.float32)
    for k in range(3):
        resultat[..., k] = np.interp(valeur, positions, couleurs[:, k])
    return resultat


class Command(BaseCommand):
    help = "Prépare les fonds d'images (vue satellite, bathymétrie) à partir de Blue Marble."

    def add_arguments(self, parser):
        parser.add_argument("--aout", required=True,
                            help="world.200408.3x21600x10800.jpg (Blue Marble, août)")
        parser.add_argument("--decembre", required=True,
                            help="world.topo.bathy.200412.3x21600x10800.jpg (Blue Marble, relief et bathymétrie)")
        parser.add_argument("--largeur", type=int, default=4096)
        parser.add_argument("--dossier", default=str(STATIQUE / "fonds"))

    def handle(self, *args, **options):
        from PIL import Image
        from scipy import ndimage

        dossier = Path(options["dossier"])
        dossier.mkdir(parents=True, exist_ok=True)

        ouest, sud, est, nord = EMPRISE
        largeur = options["largeur"]
        y_nord, y_sud = mercator_y(nord), mercator_y(sud)
        echelle = largeur / np.radians(est - ouest)          # pixels par radian
        hauteur = int(round((y_nord - y_sud) * echelle))

        longitudes = ouest + (np.arange(largeur) + 0.5) / largeur * (est - ouest)
        latitudes = latitude_de(y_nord - (np.arange(hauteur) + 0.5) / echelle)
        self.stdout.write(f"Fond {largeur} × {hauteur} px, Mercator {EMPRISE}")

        pas = 1.0 / PIXELS_PAR_DEGRE_SOURCE
        aout, origine = lire_zone(options["aout"])
        decembre, _ = lire_zone(options["decembre"])

        terre = echantillonner(aout, origine, pas, longitudes, latitudes)
        fonds = echantillonner(decembre, origine, pas, longitudes, latitudes)

        # --- Eau / terre : la mer d'août est presque noire et bleutée, celle de
        # décembre franchement bleue. Les deux critères se complètent.
        r, g, b = fonds[..., 0], fonds[..., 1], fonds[..., 2]
        sombre = (terre.max(axis=2) < 32 / 255) & (terre[..., 2] >= terre[..., 0])
        bleue = ((b - r) > 30 / 255) & (b > g + 15 / 255)
        eau = ndimage.binary_opening(sombre | bleue, iterations=1)
        eau = ndimage.binary_closing(eau, iterations=1)
        # Transition douce de 1 à 2 pixels le long des côtes
        part_eau = ndimage.gaussian_filter(eau.astype(np.float32), 0.9)

        # --- Terres : couleur d'août, éclaircie (les mosaïques sont sombres)
        couleur = np.clip(terre, 0, 1) ** 0.78 * 1.08
        luminance = couleur.mean(axis=2, keepdims=True)
        couleur = luminance + (couleur - luminance) * 1.12     # un peu plus de saturation

        relief = lire_relief()
        if relief is not None:
            altitudes, origine_r, pas_r, bornes = relief
            alt = echantillonner(altitudes, origine_r, pas_r, longitudes, latitudes)
            dedans = ((longitudes[None, :] > bornes[0] + 0.3) & (longitudes[None, :] < bornes[2] - 0.3)
                      & (latitudes[:, None] > bornes[1] + 0.3) & (latitudes[:, None] < bornes[3] - 0.3))
            alt = np.where(dedans & np.isfinite(alt), alt, np.nan)
            pas_y = np.radians(est - ouest) / largeur      # Mercator : pas variable en degrés
            pas_deg = np.degrees(pas_y) * np.cos(np.radians(latitudes))
            lumiere = ombrage(alt, float(np.median(pas_deg)), latitudes)
            facteur = np.clip(1 + (lumiere - 1) * 0.55, 0.62, 1.22)
            facteur = np.where(np.isfinite(alt), facteur, 1.0)
            couleur = couleur * facteur[..., None]

        # --- Mers : profondeur lue dans le bleu de la bathymétrie ombrée
        # (bleu 39/255 sur les plaines abyssales, 128/255 sur le plateau)
        profondeur = ndimage.gaussian_filter(b, 1.2)
        profondeur = np.clip((profondeur - 38 / 255) / (90 / 255), 0, 1)   # 0 abysses -> 1 plateau
        mer = degrade(profondeur, [
            (0.00, (2, 9, 26)),
            (0.35, (4, 18, 46)),
            (0.65, (7, 31, 68)),
            (0.88, (11, 46, 88)),
            (1.00, (17, 62, 102)),
        ])
        # Eaux côtières légèrement turquoise (sédiments), sur une frange étroite
        distance = ndimage.distance_transform_edt(eau)
        frange = np.exp(-distance / 5.0)[..., None]
        mer = mer * (1 - 0.35 * frange) + np.array([0.13, 0.36, 0.42]) * 0.35 * frange

        image = couleur * (1 - part_eau[..., None]) + mer * part_eau[..., None]
        image = np.clip(image, 0, 1)

        def enregistrer(tableau, nom, largeur_cible, **reglages):
            img = Image.fromarray((tableau * 255 + 0.5).astype(np.uint8))
            if largeur_cible != img.width:
                img = img.resize((largeur_cible, round(img.height * largeur_cible / img.width)),
                                 Image.LANCZOS)
            chemin = dossier / nom
            img.save(chemin, **reglages)
            self.stdout.write(f"  {chemin.name} : {img.width} × {img.height}, {chemin.stat().st_size // 1024} Ko")

        enregistrer(image, "satellite_4096.webp", 4096, quality=80, method=6)
        enregistrer(image, "satellite_2048.webp", 2048, quality=80, method=6)

        # Bathymétrie seule : 0 sur terre, 1..255 en mer (255 = haut-fond)
        bathy = np.where(part_eau > 0.5, 1 + profondeur * 254, 0) / 255.0
        img = Image.fromarray((bathy * 255 + 0.5).astype(np.uint8), mode="L")
        img = img.resize((1600, round(img.height * 1600 / img.width)), Image.LANCZOS)
        img.save(dossier / "bathymetrie.jpg", quality=82)
        self.stdout.write(f"  bathymetrie.jpg : {img.width} × {img.height}, "
                          f"{(dossier / 'bathymetrie.jpg').stat().st_size // 1024} Ko")
