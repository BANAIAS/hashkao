"""
HKO Météo — ressources dérivées (régénérables).

Les données de référence restent les originaux : images GeoColour publiées
par collecter_geocolour et grilles archivées (ProduitMeteo). Tout ce qui est
ici en est tiré, peut être effacé sans perte, et se reconstruit avec
« python manage.py hko_derives ».

    publication/derives/
        geocolour/<profil>/geocolour_<AAAAMMJJ>T<HHMM>Z.webp
        video/<profil>/<AAAA-MM-JJ>/seg_<AAAAMMJJ>T<HH>Z.mp4  (+ .json, interne)
        video/<profil>/<AAAA-MM-JJ>/jour_<empreinte>.mp4
        video/<profil>/<AAAA-MM-JJ>/index.json
        opera/<profil>/<AAAAMMJJ>/opera_<AAAAMMJJ>T<HHMM>Z.bin   (gzip)

Principes
---------
- Chaque fichier est écrit à part puis renommé (os.replace) : un visiteur
  ne voit jamais un fichier en cours d'écriture.
- Chaque production est idempotente : on ne refait que ce dont les entrées
  ont changé (signature des fichiers sources).
- Les vidéos sont produites par heure UTC et, par défaut, seulement pour
  les heures closes : chaque heure est encodée une fois (sauf observation
  tardive), puis la journée est réassemblée sans réencodage. L'heure en
  cours est montrée par les images fixes, produites en priorité.
- Pas de vidéo pour moins de deux observations : la page affiche l'image.
- Une journée dont la vidéo est à jour n'est plus touchée, même si ses
  segments ont été purgés (rattrapage sans réencodage).
- Les journées sont des journées civiles de Paris : 23, 24 ou 25 heures
  UTC selon les changements d'heure.

Images satellite dérivées
-------------------------
L'ancienne page appliquait au canvas satellite un filtre CSS
(contrast 1,10, saturate 1,15, brightness 1,06) suivi d'un filtre SVG
(feColorMatrix puis netteté feConvolveMatrix). Ce traitement coûtait cher
au navigateur à chaque image ; il est désormais appliqué ici, une fois,
avec les mêmes formules (corriger_satellite).
"""

import gzip
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import tempfile
import time as time_module
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np

from .commun import dossier_publication, ecrire_atomique

PARIS = ZoneInfo("Europe/Paris")

# Version des recettes : la changer force la régénération des dérivés.
VERSION = 1

# ---------------------------------------------------------------------------
# Profils
# ---------------------------------------------------------------------------

# Emprise des images GeoColour (Mercator) : celle de FOND_EMPRISE dans hko.js
EMPRISE_GEOCOLOUR = (-16.0, 34.0, 22.0, 60.0)
TAILLE_ORIGINALE = (3980, 4112)

# Largeur × hauteur : dimensions paires (H.264), compatibles avec le
# décodage matériel courant. « haute » est un recadrage de l'original à
# pleine résolution (Europe de l'Ouest) : c'est la seule à égaler la
# finesse d'origine sur un grand écran d'ordinateur ; elle ne sert que si
# la zone visible tient dans son emprise (sinon : « standard »).
PROFILS_SATELLITE = {
    "haute": {"taille": (2514, 2934), "emprise": (-9.5, 37.0, 14.5, 56.0),
              "qualite": 84, "crf": 21, "niveau": "5.1"},
    "standard": {"taille": (1990, 2056), "emprise": EMPRISE_GEOCOLOUR,
                 "qualite": 84, "crf": 21, "niveau": "5.1"},
    "leger": {"taille": (1280, 1322), "emprise": EMPRISE_GEOCOLOUR,
              "qualite": 80, "crf": 23, "niveau": "4.1"},
}


def _y_mercator(latitude):
    import math
    return math.log(math.tan(math.pi / 4 + math.radians(latitude) / 2))


def boite_originale(emprise, taille=TAILLE_ORIGINALE):
    """Rectangle (gauche, haut, droite, bas) de l'image d'origine couvrant une emprise."""
    ouest, sud, est, nord = EMPRISE_GEOCOLOUR
    o, s, e, n = emprise
    largeur, hauteur = taille
    ymin, ymax = _y_mercator(sud), _y_mercator(nord)
    gauche = (o - ouest) / (est - ouest) * largeur
    droite = (e - ouest) / (est - ouest) * largeur
    haut = (ymax - _y_mercator(n)) / (ymax - ymin) * hauteur
    bas = (ymax - _y_mercator(s)) / (ymax - ymin) * hauteur
    return gauche, haut, droite, bas


# Vidéo : une image toutes les 2 min 30 de temps réel (24 par heure UTC,
# soit une seconde de vidéo par heure). La vidéo est donc linéaire dans le
# temps, comme la frise : l'image n° k montre la dernière observation
# disponible à l'instant (début + k × 2 min 30). Une lacune se traduit par
# une image tenue, qui ne coûte presque rien une fois compressée.
FPS = 24
IMAGES_PAR_HEURE = 24
PAS_IMAGE = timedelta(hours=1) / IMAGES_PAR_HEURE
# Au-delà de cet écart sans observation, la frise indique « Lacune »
ECART_LACUNE = timedelta(minutes=30)
# Fondus entre observations : désactivés pour garder le rendu image par
# image d'origine (direction artistique). Réglage HKO_FONDU_SATELLITE.
FONDU_DUREE = timedelta(minutes=10)


# Heures closes : une heure n'est encodée qu'une fois finie, avec une marge
# pour l'observation de HH:50 qui arrive après l'heure pleine. Réglage
# HKO_VIDEO_HEURE_EN_COURS = True pour encoder aussi l'heure en cours
# (réencodée à chaque nouvelle observation, comme avant).
MARGE_HEURE_CLOSE = timedelta(minutes=25)
# Il faut au moins deux observations pour qu'une vidéo ait un sens
OBSERVATIONS_MIN_VIDEO = 2


def reglage(nom, defaut):
    from django.conf import settings
    return getattr(settings, nom, defaut)


def fondu_actif():
    from django.conf import settings
    return bool(getattr(settings, "HKO_FONDU_SATELLITE", False))


# OPERA : grille d'origine (0,025°) ou deux fois plus grossière (0,05°,
# quatre fois moins de données) pour les appareils légers. Même emprise :
# les bords de la carte restent couverts sur les écrans les plus hauts.
# (Un recadrage reste possible : « emprise » = ouest, sud, est, nord.)
PROFILS_OPERA = {
    "standard": {"emprise": None, "facteur": 1},
    "leger": {"emprise": None, "facteur": 2},
}

CONSERVATION = timedelta(days=8)
# Segments horaires : utiles tant qu'une observation tardive peut arriver
CONSERVATION_SEGMENTS = timedelta(hours=36)


def conservation():
    """Durée de conservation des dérivés (réglage HKO_DERIVES_JOURS, défaut 8 jours)."""
    from django.conf import settings
    jours = getattr(settings, "HKO_DERIVES_JOURS", None)
    return timedelta(days=int(jours)) if jours else CONSERVATION

MOTIF_GEOCOLOUR = re.compile(r"^geocolour_(\d{8}T\d{4})Z\.webp$")


def racine_derives(*parties):
    return dossier_publication("derives", *parties)


def ecrire_fichier_atomique(chemin, producteur):
    """Écrit via un fichier temporaire du même dossier ; producteur(chemin_tmp)."""
    chemin = Path(chemin)
    chemin.parent.mkdir(parents=True, exist_ok=True)
    descripteur, temporaire = tempfile.mkstemp(dir=chemin.parent, prefix=".tmp_", suffix=chemin.suffix)
    os.close(descripteur)
    try:
        producteur(Path(temporaire))
        os.chmod(temporaire, 0o644)
        os.replace(temporaire, chemin)
    finally:
        if os.path.exists(temporaire):
            os.unlink(temporaire)


# ---------------------------------------------------------------------------
# Originaux GeoColour
# ---------------------------------------------------------------------------

def instant_geocolour(nom):
    m = MOTIF_GEOCOLOUR.match(nom)
    if not m:
        return None
    return datetime.strptime(m.group(1), "%Y%m%dT%H%M").replace(tzinfo=timezone.utc)


def originaux_geocolour():
    """[(instant UTC, chemin)] triés, d'après le dossier publié par le collecteur."""
    resultat = []
    for chemin in dossier_publication("geocolour").glob("geocolour_*.webp"):
        instant = instant_geocolour(chemin.name)
        if instant:
            resultat.append((instant, chemin))
    return sorted(resultat)


def bornes_jour(jour):
    """Début et fin (UTC) d'une journée civile de Paris : 23, 24 ou 25 h."""
    debut = datetime.combine(jour, time.min, tzinfo=PARIS)
    fin = datetime.combine(jour + timedelta(days=1), time.min, tzinfo=PARIS)
    return debut.astimezone(timezone.utc), fin.astimezone(timezone.utc)


def jour_local(instant):
    return instant.astimezone(PARIS).date()


# ---------------------------------------------------------------------------
# Correction de couleur et netteté (équivalent exact des filtres CSS + SVG)
# ---------------------------------------------------------------------------

def corriger_satellite(rgb):
    """
    rgb : tableau uint8 (H, W, 3). Reproduit, dans l'ordre :
      filter: contrast(1.10) saturate(1.15) brightness(1.06) url(#correction-satellite)
    où #correction-satellite = feColorMatrix diag(1.02, 0.96, 1.04)
                              + feConvolveMatrix [0 -.2 0; -.2 1.8 -.2; 0 -.2 0].
    Chaque étape est bornée à [0, 1], comme dans le navigateur.

    Traité par bandes de lignes (avec une ligne de recouvrement pour la
    netteté) : résultat identique, mémoire bornée (≈ 60 Mo au lieu de
    ≈ 800 Mo pour le profil « haute »).
    """
    hauteur = rgb.shape[0]
    if hauteur <= BANDE:
        return _corriger_bloc(rgb, 0, hauteur)
    sortie = np.empty_like(rgb)
    for debut in range(0, hauteur, BANDE):
        fin = min(hauteur, debut + BANDE)
        sortie[debut:fin] = _corriger_bloc(rgb, debut, fin)
    return sortie


BANDE = 256


def _couleur(rgb):
    """Étapes point par point (contraste, saturation, luminosité, matrice)."""
    x = rgb.astype(np.float32) / 255.0

    x = np.clip((x - 0.5) * 1.10 + 0.5, 0, 1)                        # contrast(1.10)

    s = 1.15                                                           # saturate(1.15)
    m = np.array([
        [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
        [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
        [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
    ], dtype=np.float32)
    x = np.clip(x @ m.T, 0, 1)

    x = np.clip(x * 1.06, 0, 1)                                        # brightness(1.06)
    return np.clip(x * np.array([1.02, 0.96, 1.04], dtype=np.float32), 0, 1)   # feColorMatrix


def _corriger_bloc(rgb, debut, fin):
    """Lignes [debut, fin) corrigées ; la netteté lit une ligne de part et d'autre."""
    hauteur = rgb.shape[0]
    haut, bas = max(0, debut - 1), min(hauteur, fin + 1)
    x = _couleur(rgb[haut:bas])
    # Bords de l'image : ligne dupliquée (edgeMode="duplicate")
    if debut == 0:
        x = np.concatenate([x[:1], x])
    if fin == hauteur:
        x = np.concatenate([x, x[-1:]])
    # feConvolveMatrix [0 -.2 0; -.2 1.8 -.2; 0 -.2 0], diviseur 1
    p = np.pad(x, ((0, 0), (1, 1), (0, 0)), mode="edge")
    y = 1.8 * p[1:-1, 1:-1] - 0.2 * (p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:])
    return (np.clip(y, 0, 1) * 255.0 + 0.5).astype(np.uint8)


# ---------------------------------------------------------------------------
# Images satellite dérivées
# ---------------------------------------------------------------------------

def chemin_image(profil, nom_original):
    return racine_derives("geocolour", profil) / nom_original


def image_a_jour(original, profil):
    cible = chemin_image(profil, original.name)
    return cible.exists() and cible.stat().st_mtime >= original.stat().st_mtime


def images_derivees(original, profils, forcer=False):
    """
    Produit les images manquantes de plusieurs profils à partir d'un seul
    décodage de l'original (≈ 0,35 s économisée par profil supplémentaire).
    Renvoie le nombre d'images produites.
    """
    from PIL import Image

    a_faire = [p for p in profils if forcer or not image_a_jour(original, p)]
    if not a_faire:
        return 0
    Image.MAX_IMAGE_PIXELS = None
    with Image.open(original) as source:
        source = source.convert("RGB")
        for profil in a_faire:
            reglage = PROFILS_SATELLITE[profil]
            if reglage["emprise"] != EMPRISE_GEOCOLOUR:
                boite = boite_originale(reglage["emprise"], source.size)
                image = source.resize(reglage["taille"], Image.LANCZOS, box=boite)
            elif source.size != reglage["taille"]:
                image = source.resize(reglage["taille"], Image.LANCZOS)
            else:
                image = source
            tableau = corriger_satellite(np.asarray(image))
            del image

            def produire(temporaire, tableau=tableau, qualite=reglage["qualite"]):
                Image.fromarray(tableau).save(temporaire, "WEBP", quality=qualite, method=4)

            ecrire_fichier_atomique(chemin_image(profil, original.name), produire)
            del tableau
    return len(a_faire)


def image_derivee(original, profil, forcer=False):
    """Produit (si besoin) l'image réduite et corrigée d'un profil ; renvoie son chemin."""
    images_derivees(original, [profil], forcer=forcer)
    return chemin_image(profil, original.name)


def lire_image(chemin):
    from PIL import Image
    with Image.open(chemin) as image:
        return np.asarray(image.convert("RGB"))


# ---------------------------------------------------------------------------
# Vidéo H.264 : segments horaires et assemblage par journée
# ---------------------------------------------------------------------------

def ffmpeg():
    """FFmpeg : réglage HKO_FFMPEG, sinon le PATH, sinon le paquet imageio-ffmpeg."""
    from django.conf import settings

    candidat = getattr(settings, "HKO_FFMPEG", None) or os.environ.get("HKO_FFMPEG")
    if candidat:
        return candidat
    trouve = shutil.which("ffmpeg")
    if trouve:
        return trouve
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def dossier_video(profil, jour):
    return racine_derives("video", profil, jour.isoformat())


def observations_du_jour(jour, originaux=None):
    debut, fin = bornes_jour(jour)
    originaux = originaux_geocolour() if originaux is None else originaux
    return [(t, c) for t, c in originaux if debut <= t < fin]


def plan_du_jour(jour, originaux=None, jusqua=None):
    """
    Découpe d'une journée en heures UTC : [(heure, [(o1, o2, t) × 24])].
    Pour chaque image : o1 = observation affichée, o2 = suivante (fondu)
    ou None, t = part de o2 (0 sans fondu). Les heures avant la première
    observation et après la dernière ne sont pas produites.
    """
    obs = observations_du_jour(jour, originaux)
    if not obs:
        return []
    fondu = fondu_actif()
    # jusqua : heure (UTC) exclue et suivantes non produites (heures closes)
    premiere = obs[0][0].replace(minute=0, second=0, microsecond=0)
    derniere = obs[-1][0]
    plan, i = [], 0
    heure = premiere
    while heure <= derniere and (jusqua is None or heure < jusqua):
        images = []
        for k in range(IMAGES_PAR_HEURE):
            instant = heure + k * PAS_IMAGE
            while i + 1 < len(obs) and obs[i + 1][0] <= instant:
                i += 1
            courante = obs[i] if obs[i][0] <= instant else obs[0]
            suivante, part = None, 0.0
            if fondu and i + 1 < len(obs) and courante is obs[i]:
                ecart = obs[i + 1][0] - instant
                if timedelta(0) < ecart < FONDU_DUREE and obs[i + 1][0] - obs[i][0] <= 2 * FONDU_DUREE:
                    suivante, part = obs[i + 1], round(1 - ecart / FONDU_DUREE, 3)
            images.append((courante, suivante, part))
        plan.append((heure, images))
        heure += timedelta(hours=1)
    return plan


def signature(*elements):
    texte = json.dumps(elements, sort_keys=True, default=str)
    return hashlib.sha1(texte.encode()).hexdigest()


def reglage_ffmpeg_preset():
    return reglage("HKO_VIDEO_PRESET", "veryfast")


def encoder_segment(profil, images, sortie):
    """Encode les 24 images d'une heure (images tenues ou fondues)."""
    executable = ffmpeg()
    if not executable:
        raise RuntimeError("FFmpeg introuvable : installez-le ou « pip install imageio-ffmpeg ».")

    reglage = PROFILS_SATELLITE[profil]
    largeur, hauteur = reglage["taille"]
    # « veryfast » : 3 fois plus rapide que « medium » pour ces images tenues,
    # fichier un peu plus petit, PSNR 44,7 dB au lieu de 45,5 (mesuré).
    # Hors signature : changer le preset ne réencode pas l'existant.
    preset = reglage_ffmpeg_preset()
    memoire = {}

    def pixels(observation):
        if observation[1] not in memoire:
            if len(memoire) > 3:
                memoire.clear()
            memoire[observation[1]] = lire_image(image_derivee(observation[1], profil))
        return memoire[observation[1]]

    def produire(temporaire):
        commande = [
            executable, "-y", "-hide_banner", "-loglevel", "error",
            "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{largeur}x{hauteur}", "-r", str(FPS),
            "-i", "-", "-an",
            "-c:v", "libx264", "-preset", preset, "-crf", str(reglage["crf"]),
            "-pix_fmt", "yuv420p", "-profile:v", "high", "-level:v", reglage["niveau"],
            "-g", str(FPS), "-keyint_min", str(FPS), "-sc_threshold", "0",
            # Un seul fil (le service n'a droit qu'à un cœur) et une petite
            # anticipation : ≈ 650 Mo au lieu de ≈ 940 Mo pour « haute »
            "-threads", "1", "-rc-lookahead", "10",
            "-movflags", "+faststart", "-f", "mp4", str(temporaire),
        ]
        processus = subprocess.Popen(commande, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            for courante, suivante, part in images:
                image = pixels(courante)
                if suivante and part > 0:
                    autre = pixels(suivante)
                    image = (image.astype(np.float32) * (1 - part) + autre.astype(np.float32) * part + 0.5).astype(np.uint8)
                processus.stdin.write(np.ascontiguousarray(image).tobytes())
            processus.stdin.close()
        except BrokenPipeError:
            pass
        erreur = processus.stderr.read().decode(errors="replace")
        if processus.wait() != 0:
            raise RuntimeError(f"FFmpeg a échoué : {erreur.strip()[:500]}")

    ecrire_fichier_atomique(sortie, produire)


class EcheanceAtteinte(Exception):
    """Budget de temps du passage épuisé : la suite au passage suivant."""


def fin_des_heures_closes(jour, maintenant=None):
    """
    Première heure (UTC) à ne pas encoder encore, ou None si toutes les
    heures de la journée peuvent l'être (journée finie, ou réglage
    HKO_VIDEO_HEURE_EN_COURS). Une heure H est close quand
    H + 1 h + MARGE_HEURE_CLOSE est passé.
    """
    if reglage("HKO_VIDEO_HEURE_EN_COURS", False):
        return None
    maintenant = maintenant or datetime.now(timezone.utc)
    _, fin = bornes_jour(jour)
    if maintenant >= fin + MARGE_HEURE_CLOSE:
        return None
    return (maintenant - MARGE_HEURE_CLOSE).replace(minute=0, second=0, microsecond=0)


def signature_segment(profil, images):
    # Même formule qu'avant la mise à jour : les segments existants restent valides
    return signature(VERSION, profil, FPS, PROFILS_SATELLITE[profil], [
        (c[1].name, c[1].stat().st_mtime_ns, s[1].name if s else None, t) for c, s, t in images
    ])


def segment_a_jour(chemin, sig):
    meta = chemin.with_suffix(".json")
    if not chemin.exists() or not meta.exists():
        return False
    try:
        return json.loads(meta.read_text()).get("signature") == sig
    except ValueError:
        return False


def assembler_jour(profil, jour, originaux=None, journal=print, maintenant=None, echeance=None):
    """
    Vidéo de la journée : segments horaires (encodés seulement s'ils
    manquent ou ont changé), concaténés sans réencodage, et index.

    - Heures closes seulement (voir fin_des_heures_closes) : l'heure en
      cours est montrée par les images fixes.
    - Moins de OBSERVATIONS_MIN_VIDEO observations couvertes : pas de vidéo.
    - Vidéo déjà à jour : rien n'est relu ni réencodé, même si les segments
      ont été purgés (rattrapage des journées anciennes sans coût).
    - echeance (time.monotonic()) : au-delà, EcheanceAtteinte est levée
      avant d'encoder un nouveau segment ; le travail fait est conservé.

    Le nom de la vidéo porte une empreinte : un visiteur qui lit l'ancienne
    version n'est pas interrompu (elle est gardée 30 minutes).
    """
    originaux = originaux_geocolour() if originaux is None else originaux
    plan = plan_du_jour(jour, originaux, fin_des_heures_closes(jour, maintenant))
    if not plan:
        return None
    obs = observations_du_jour(jour, originaux)
    fin_video = plan[-1][0] + timedelta(hours=1)
    couvertes = [(t, c) for t, c in obs if t < fin_video]
    if len(couvertes) < OBSERVATIONS_MIN_VIDEO:
        return None

    dossier = dossier_video(profil, jour)
    signatures = [signature_segment(profil, images) for _, images in plan]
    empreinte = signature(signatures)[:12]
    nom_video = f"jour_{empreinte}.mp4"
    video = dossier / nom_video
    index_chemin = dossier / "index.json"

    if video.exists():
        try:
            index = json.loads(index_chemin.read_text())
            if index.get("video") == nom_video:
                return index                     # déjà à jour : rien à faire
        except (FileNotFoundError, ValueError):
            pass
    else:
        segments = []
        for (heure, images), sig in zip(plan, signatures):
            chemin = dossier / f"seg_{heure:%Y%m%dT%H}Z.mp4"
            if not segment_a_jour(chemin, sig):
                if echeance is not None and time_module.monotonic() > echeance:
                    raise EcheanceAtteinte(f"{profil} {jour}")
                journal(f"  segment {profil} {heure:%Y-%m-%d %H} h UTC")
                encoder_segment(profil, images, chemin)
                ecrire_atomique(chemin.with_suffix(".json"), json.dumps({"signature": sig}).encode())
            segments.append(chemin)

        executable = ffmpeg()
        liste = dossier / f".liste_{empreinte}.txt"
        liste.write_text("".join(f"file '{c.name}'\n" for c in segments))

        def produire(temporaire):
            commande = [executable, "-y", "-hide_banner", "-loglevel", "error",
                        "-f", "concat", "-safe", "0", "-i", str(liste),
                        "-c", "copy", "-movflags", "+faststart", "-f", "mp4", str(temporaire)]
            sortie = subprocess.run(commande, capture_output=True, cwd=dossier)
            if sortie.returncode != 0:
                raise RuntimeError(sortie.stderr.decode(errors="replace")[:500])

        try:
            ecrire_fichier_atomique(video, produire)
        finally:
            liste.unlink(missing_ok=True)
        journal(f"  journée {profil} {jour} assemblée : {nom_video} ({len(couvertes)} observations)")

    debut = plan[0][0]
    observations = []
    for i, (instant, _) in enumerate(couvertes):
        prochain = obs[i + 1][0] if i + 1 < len(obs) else None
        observations.append({
            "instant": instant.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "image": int(-(-(instant - debut) // PAS_IMAGE)),   # première image qui la montre
            "lacune": bool(prochain and prochain - instant > ECART_LACUNE),
        })

    largeur, hauteur = PROFILS_SATELLITE[profil]["taille"]
    index = {
        "version": VERSION, "jour": jour.isoformat(), "profil": profil,
        "video": nom_video, "fps": FPS,
        "debut": debut.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "secondes_par_image": PAS_IMAGE.total_seconds(),
        "images": len(plan) * IMAGES_PAR_HEURE,
        "fondu": fondu_actif(),
        "largeur": largeur, "hauteur": hauteur,
        "emprise": PROFILS_SATELLITE[profil]["emprise"],
        "observations": observations,
        "genere": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    ecrire_atomique(index_chemin, json.dumps(index, separators=(",", ":")).encode())

    # Anciennes versions : gardées 30 min pour les lectures en cours
    limite = datetime.now().timestamp() - 1800
    for ancienne in dossier.glob("jour_*.mp4"):
        if ancienne.name != nom_video and ancienne.stat().st_mtime < limite:
            ancienne.unlink(missing_ok=True)
    # Segments d'heures sorties du plan (observation retirée, ancienne heure en cours)
    heures = {f"seg_{h:%Y%m%dT%H}Z" for h, _ in plan}
    for fichier in dossier.glob("seg_*"):
        if fichier.stem not in heures:
            fichier.unlink(missing_ok=True)
    return index


def lire_index_video(profil, jour):
    chemin = dossier_video(profil, jour) / "index.json"
    try:
        index = json.loads(chemin.read_text())
    except (FileNotFoundError, ValueError):
        return None
    if not (chemin.parent / index.get("video", "")).exists():
        return None
    return index


# ---------------------------------------------------------------------------
# OPERA : trames binaires compressées
# ---------------------------------------------------------------------------

def description_opera(profil):
    from . import opera

    reglage = PROFILS_OPERA[profil]
    base = opera.description()
    ouest, sud, est, nord = reglage["emprise"] or (base["ouest"], base["sud"], base["est"], base["nord"])
    pas = base["pas"] * reglage["facteur"]
    return {"ouest": ouest, "sud": sud, "est": est, "nord": nord, "pas": pas,
            "nx": round((est - ouest) / pas), "ny": round((nord - sud) / pas)}


def reduire_opera(champs, profil):
    """Recadre et agrège (moyenne par blocs) une grille OPERA archivée."""
    from . import opera

    reglage = PROFILS_OPERA[profil]
    base = opera.description()
    intensite = np.nan_to_num(champs["intensite"].astype(np.float32), nan=0.0)
    pluie = np.nan_to_num(champs["pluie"].astype(np.float32), nan=0.0)
    couverture = np.nan_to_num(champs["couverture"].astype(np.float32), nan=0.0)

    if reglage["emprise"]:
        ouest, sud, est, nord = reglage["emprise"]
        i0 = round((ouest - base["ouest"]) / base["pas"])
        j0 = round((base["nord"] - nord) / base["pas"])
        i1 = round((est - base["ouest"]) / base["pas"])
        j1 = round((base["nord"] - sud) / base["pas"])
        intensite, pluie, couverture = (a[j0:j1, i0:i1] for a in (intensite, pluie, couverture))

    f = reglage["facteur"]
    if f > 1:
        ny, nx = (intensite.shape[0] // f) * f, (intensite.shape[1] // f) * f

        def blocs(a):
            return a[:ny, :nx].reshape(ny // f, f, nx // f, f)

        poids = blocs(pluie).sum(axis=(1, 3))
        intensite = np.where(poids > 0, (blocs(intensite * pluie)).sum(axis=(1, 3)) / np.maximum(poids, 1e-6), 0.0)
        pluie = blocs(pluie).mean(axis=(1, 3))
        couverture = blocs(couverture).mean(axis=(1, 3))
    return {"intensite": intensite, "pluie": pluie, "couverture": couverture}


def chemin_trame_opera(profil, instant):
    return racine_derives("opera", profil, f"{instant:%Y%m%d}") / f"opera_{instant:%Y%m%dT%H%M}Z.bin"


def trame_opera(produit, profil, forcer=False):
    """Trame binaire compressée (gzip) d'un ProduitMeteo OPERA ; renvoie son chemin."""
    from meteo_app.views import encoder_trame

    from .commun import absolu

    cible = chemin_trame_opera(profil, produit.instant)
    source = absolu(produit.fichier)
    if not forcer and cible.exists() and cible.stat().st_mtime >= source.stat().st_mtime:
        return cible
    with np.load(source) as champs:
        reduits = reduire_opera({k: champs[k] for k in ("intensite", "pluie", "couverture")}, profil)
    octets = gzip.compress(encoder_trame("radar", reduits), 6)
    ecrire_atomique(cible, octets)
    return cible


# ---------------------------------------------------------------------------
# Nettoyage
# ---------------------------------------------------------------------------

def purger(duree=None, simulation=False):
    """Efface les dérivés anciens ou orphelins ; renvoie (nombre, octets)."""
    limite = datetime.now(timezone.utc) - (duree or conservation())
    limite_segments = datetime.now(timezone.utc) - CONSERVATION_SEGMENTS
    nombre = octets = 0

    def effacer(chemin):
        nonlocal nombre, octets
        if chemin.is_file():
            octets += chemin.stat().st_size
            nombre += 1
            if not simulation:
                chemin.unlink(missing_ok=True)

    originaux = {c.name for _, c in originaux_geocolour()}
    for profil in PROFILS_SATELLITE:
        for chemin in racine_derives("geocolour", profil).glob("geocolour_*.webp"):
            instant = instant_geocolour(chemin.name)
            if chemin.name not in originaux or (instant and instant < limite):
                effacer(chemin)
        for dossier in racine_derives("video", profil).iterdir():
            try:
                jour = date.fromisoformat(dossier.name)
            except ValueError:
                continue
            if bornes_jour(jour)[1] < limite:
                for fichier in dossier.iterdir():
                    effacer(fichier)
                if not simulation:
                    shutil.rmtree(dossier, ignore_errors=True)
            elif bornes_jour(jour)[1] < limite_segments:
                # Journée close : la vidéo assemblée suffit (les segments se
                # refont d'eux-mêmes si une observation très tardive arrive)
                for fichier in dossier.glob("seg_*.mp4"):
                    effacer(fichier)
    for profil in PROFILS_OPERA:
        for dossier in racine_derives("opera", profil).iterdir():
            try:
                jour = datetime.strptime(dossier.name, "%Y%m%d").replace(tzinfo=timezone.utc)
            except ValueError:
                continue
            if jour + timedelta(days=1) < limite:
                for fichier in dossier.iterdir():
                    effacer(fichier)
                if not simulation:
                    shutil.rmtree(dossier, ignore_errors=True)
    # Fichiers temporaires abandonnés (interruption brutale)
    vieux = datetime.now().timestamp() - 3600
    for fichier in racine_derives().rglob(".tmp_*"):
        if fichier.stat().st_mtime < vieux:
            effacer(fichier)
    return nombre, octets
