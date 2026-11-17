"""
HKO Météo — outils communs aux collecteurs.

Tout ce qui touche au disque, au réseau et aux clés passe par ici, pour
que chaque collecteur se comporte de la même façon :

- les données vivent hors du dépôt, dans HKO_DONNEES
  (par défaut meteo_app/data/hko/, déjà exclu de Git) ;
- les clés sont lues dans l'environnement, puis dans le fichier .env ;
  elles ne sont jamais écrites dans un journal ;
- un verrou empêche deux exécutions simultanées d'un même collecteur ;
- les fichiers servis au navigateur sont publiés de façon atomique ;
- les requêtes réseau sont retentées sur les erreurs passagères.
"""

import hashlib
import json
import os
import tempfile
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from django.conf import settings


# ---------------------------------------------------------------------------
# Dossiers
# ---------------------------------------------------------------------------

def dossier_donnees():
    """Racine des données HKO (réglable par HKO_DONNEES dans settings ou l'environnement)."""
    racine = (
        getattr(settings, "HKO_DONNEES", None)
        or os.environ.get("HKO_DONNEES")
        or Path(settings.BASE_DIR) / "meteo_app" / "data" / "hko"
    )
    racine = Path(racine)
    racine.mkdir(parents=True, exist_ok=True)
    return racine


def dossier(*parties):
    """Sous-dossier de HKO_DONNEES, créé au besoin."""
    chemin = dossier_donnees().joinpath(*parties)
    chemin.mkdir(parents=True, exist_ok=True)
    return chemin


# Organisation :
#   brut/<source>/            fichiers téléchargés, conservés peu de temps
#   archives/<source>/AAAA/MM/  grilles dérivées compressées (.npz)
#   publication/              fichiers servis au navigateur
#   cache/                    tables de correspondance recalculables
#   verrous/                  verrous d'exécution

def dossier_publication(*parties):
    return dossier("publication", *parties)


def chemin_archive(source, instant, nom):
    """Chemin d'archive daté : archives/<source>/AAAA/MM/JJ/<nom>."""
    return dossier("archives", source, f"{instant:%Y}", f"{instant:%m}", f"{instant:%d}") / nom


def relatif(chemin):
    """Chemin relatif à HKO_DONNEES, pour l'enregistrer en base."""
    return Path(chemin).resolve().relative_to(dossier_donnees().resolve()).as_posix()


def absolu(chemin_relatif):
    return dossier_donnees() / chemin_relatif


# ---------------------------------------------------------------------------
# Clés d'API
# ---------------------------------------------------------------------------

class CleManquante(Exception):
    pass


def lire_cle(nom, obligatoire=True):
    """
    Lit une clé dans l'environnement, puis dans un fichier .env situé dans le
    dossier courant ou à la racine du projet (même logique que la collecte
    des stations). La valeur n'est jamais affichée.
    """
    valeur = os.environ.get(nom)
    if valeur:
        return valeur.strip()

    for fichier in (Path.cwd() / ".env", Path(settings.BASE_DIR) / ".env"):
        if not fichier.exists():
            continue
        for ligne in fichier.read_text(encoding="utf-8-sig").splitlines():
            ligne = ligne.strip()
            if ligne.startswith(f"{nom}="):
                return ligne.split("=", 1)[1].strip().strip('"').strip("'")

    if obligatoire:
        raise CleManquante(
            f"Variable {nom} introuvable (environnement ou fichier .env)."
        )
    return None


# ---------------------------------------------------------------------------
# Verrou d'exécution (Windows et Linux, sans dépendance)
# ---------------------------------------------------------------------------

class DejaEnCours(Exception):
    pass


@contextmanager
def verrou(nom, duree_max_secondes=900):
    """
    Empêche deux exécutions simultanées. Le verrou est un fichier créé de
    façon exclusive ; s'il date de plus de duree_max_secondes (processus
    interrompu brutalement), il est considéré comme abandonné et repris.
    """
    chemin = dossier("verrous") / f"{nom}.lock"

    for _ in range(2):
        try:
            descripteur = os.open(chemin, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            break
        except FileExistsError:
            try:
                age = time.time() - chemin.stat().st_mtime
            except FileNotFoundError:
                continue
            if age > duree_max_secondes:
                chemin.unlink(missing_ok=True)
                continue
            raise DejaEnCours(
                f"{nom} est déjà en cours (verrou posé il y a {int(age)} s)."
            )
    else:
        raise DejaEnCours(f"Impossible de poser le verrou {nom}.")

    try:
        os.write(descripteur, f"{os.getpid()} {datetime.now(timezone.utc).isoformat()}".encode())
        os.close(descripteur)
        yield
    finally:
        chemin.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Écriture et publication
# ---------------------------------------------------------------------------

def ecrire_atomique(chemin, contenu):
    """Écrit un fichier en passant par un fichier temporaire du même dossier."""
    chemin = Path(chemin)
    chemin.parent.mkdir(parents=True, exist_ok=True)

    if isinstance(contenu, str):
        contenu = contenu.encode("utf-8")

    descripteur, temporaire = tempfile.mkstemp(dir=chemin.parent, prefix=".tmp_")
    try:
        with os.fdopen(descripteur, "wb") as sortie:
            sortie.write(contenu)
        os.chmod(temporaire, 0o644)  # lisible par un serveur web séparé
        os.replace(temporaire, chemin)
    except BaseException:
        Path(temporaire).unlink(missing_ok=True)
        raise


def ecrire_json_atomique(chemin, donnees):
    ecrire_atomique(
        chemin,
        json.dumps(donnees, ensure_ascii=False, separators=(",", ":")),
    )


def empreinte(chemin_ou_octets):
    """Empreinte SHA-256 (détection des doublons)."""
    h = hashlib.sha256()
    if isinstance(chemin_ou_octets, (bytes, bytearray)):
        h.update(chemin_ou_octets)
    else:
        with open(chemin_ou_octets, "rb") as f:
            for bloc in iter(lambda: f.read(1 << 20), b""):
                h.update(bloc)
    return h.hexdigest()


def nettoyer_versions(dossier_cible, motif, garder):
    """Supprime les anciennes versions publiées, en gardant les plus récentes."""
    fichiers = sorted(Path(dossier_cible).glob(motif), key=lambda p: p.name)
    for ancien in fichiers[:-garder] if garder else fichiers:
        ancien.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Réseau
# ---------------------------------------------------------------------------

class ErreurSource(Exception):
    """Erreur de téléchargement, avec un message lisible (sans clé)."""


def requete(url, *, headers=None, params=None, stream=False, timeout=90,
            tentatives=4, pause_initiale=3.0, session=None):
    """
    GET avec nouvelles tentatives sur les erreurs passagères (réseau,
    429 « trop de requêtes », 5xx). Les erreurs d'authentification (401,
    403) et les ressources absentes (404) ne sont pas retentées.
    """
    import requests

    client = session or requests
    pause = pause_initiale
    derniere = None

    for essai in range(1, tentatives + 1):
        try:
            reponse = client.get(
                url, headers=headers, params=params, stream=stream, timeout=timeout
            )
        except requests.RequestException as erreur:
            derniere = f"erreur réseau ({type(erreur).__name__})"
        else:
            if reponse.status_code == 200:
                return reponse

            corps = ""
            if not stream:
                corps = reponse.text[:300].replace("\n", " ")

            if reponse.status_code in (401, 403):
                raise ErreurSource(
                    f"Accès refusé ({reponse.status_code}) : vérifiez la clé d'API "
                    f"et l'abonnement à cette API. {corps}"
                )
            if reponse.status_code == 404:
                raise ErreurSource(f"Ressource introuvable (404). {corps}")

            derniere = f"HTTP {reponse.status_code} {corps}"

            if reponse.status_code == 429:
                attente = reponse.headers.get("Retry-After")
                if attente and attente.isdigit():
                    pause = max(pause, float(attente))
            elif reponse.status_code < 500:
                raise ErreurSource(derniere)

        if essai < tentatives:
            time.sleep(pause)
            pause = min(pause * 2.5, 120)

    raise ErreurSource(f"Échec après {tentatives} tentatives : {derniere}")


def telecharger_vers(url, chemin, **options):
    """Télécharge en flux vers un fichier (écriture atomique)."""
    reponse = requete(url, stream=True, **options)
    chemin = Path(chemin)
    chemin.parent.mkdir(parents=True, exist_ok=True)

    descripteur, temporaire = tempfile.mkstemp(dir=chemin.parent, prefix=".tmp_")
    try:
        with os.fdopen(descripteur, "wb") as sortie:
            for bloc in reponse.iter_content(1 << 16):
                sortie.write(bloc)
        os.replace(temporaire, chemin)
    except BaseException:
        Path(temporaire).unlink(missing_ok=True)
        raise
    finally:
        reponse.close()

    return chemin


# ---------------------------------------------------------------------------
# Journal
# ---------------------------------------------------------------------------

@contextmanager
def journal(source, sortie=None):
    """
    Enregistre chaque exécution d'un collecteur dans JournalCollecte.

        with journal("radar", self.stdout) as j:
            ...
            j.succes("2 mosaïques publiées", produits=2)

    Une exception non rattrapée est enregistrée comme un échec, puis
    relancée pour que la commande se termine en erreur.
    """
    from meteo_app.models import JournalCollecte

    entree = JournalCollecte.objects.create(source=source, statut="en_cours")

    class Suivi:
        def _fermer(self, statut, message, **details):
            entree.statut = statut
            entree.message = message[:1000]
            entree.details = details
            entree.fin = datetime.now(timezone.utc)
            entree.save()
            if sortie is not None:
                sortie.write(f"[{source}] {statut} — {message}")

        def succes(self, message, **details):
            self._fermer("succes", message, **details)

        def rien_de_neuf(self, message, **details):
            self._fermer("rien_de_neuf", message, **details)

        def echec(self, message, **details):
            self._fermer("echec", message, **details)

    suivi = Suivi()

    try:
        yield suivi
    except DejaEnCours as erreur:
        suivi._fermer("verrouille", str(erreur))
        raise
    except BaseException as erreur:
        if entree.statut == "en_cours":
            suivi._fermer("echec", f"{type(erreur).__name__} : {erreur}")
        raise
    else:
        if entree.statut == "en_cours":
            suivi._fermer("succes", "Terminé.")


def maintenant():
    return datetime.now(timezone.utc)
