"""
HKO Météo — verrou libéré par le noyau.

Le verrou historique (commun.verrou) est un fichier créé en exclusif : si le
processus est tué brutalement (SIGKILL, oom-kill), le fichier reste et bloque
les passages suivants jusqu'à ce qu'il soit jugé abandonné (une heure).

Ici, le verrou est un verrou système (flock) posé sur un fichier ouvert : le
noyau le libère dès que le processus meurt, quelle qu'en soit la raison. Le
fichier lui-même reste en place (c'est normal) et contient le PID du dernier
détenteur, pour le diagnostic.

Utilisé par hko_derives uniquement : les collectes gardent commun.verrou.
Sous Windows (développement local), où flock n'existe pas, on se replie sur
commun.verrou.
"""

import os
from contextlib import contextmanager
from datetime import datetime, timezone

from .commun import DejaEnCours, dossier

try:
    import fcntl
except ImportError:          # Windows
    fcntl = None


@contextmanager
def verrou_noyau(nom):
    """Empêche deux exécutions simultanées ; libéré par le noyau à la mort du processus."""
    if fcntl is None:
        from .commun import verrou
        with verrou(nom, duree_max_secondes=3600):
            yield
        return

    chemin = dossier("verrous") / f"{nom}.flock"
    descripteur = os.open(chemin, os.O_RDWR | os.O_CREAT, 0o644)
    try:
        try:
            fcntl.flock(descripteur, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            try:
                detenteur = os.pread(descripteur, 200, 0).decode(errors="replace").strip()
            except OSError:
                detenteur = "?"
            raise DejaEnCours(f"{nom} est déjà en cours ({detenteur or 'détenteur inconnu'}).")
        os.ftruncate(descripteur, 0)
        os.pwrite(descripteur, f"pid {os.getpid()} depuis {datetime.now(timezone.utc):%Y-%m-%d %H:%M:%S} UTC".encode(), 0)
        yield
    finally:
        # Fermer le descripteur suffit à rendre le verrou
        os.close(descripteur)
