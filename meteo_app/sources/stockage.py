"""
HKO Météo — archivage des grilles dérivées et catalogue des produits.

Chaque source ramenée sur la grille commune est archivée en .npz
compressé (float16), avec une ligne ProduitMeteo qui la décrit. Le
moteur de fusion ne relit que ces archives : il ne dépend jamais d'un
téléchargement en cours.
"""

import io

import numpy as np

from .commun import absolu, chemin_archive, ecrire_atomique, relatif


def enregistrer_grille(source, nature, instant, champs, reference=None,
                       debut_periode=None, qualite=None, empreinte="", nom=None):
    """Archive des champs (NY, NX) et les inscrit au catalogue. Renvoie le ProduitMeteo."""
    from meteo_app.models import ProduitMeteo

    nom = nom or (
        f"{source}_{instant:%Y%m%dT%H%MZ}"
        + (f"_run{reference:%Y%m%dT%HZ}" if reference else "")
        + ".npz"
    )
    chemin = chemin_archive(source, instant, nom)

    tampon = io.BytesIO()
    np.savez_compressed(tampon, **{
        k: (v.astype(np.float16) if np.issubdtype(np.asarray(v).dtype, np.floating) else v)
        for k, v in champs.items() if v is not None
    })
    ecrire_atomique(chemin, tampon.getvalue())

    produit, _ = ProduitMeteo.objects.update_or_create(
        source=source, nature=nature, instant=instant, reference=reference,
        defaults={
            "debut_periode": debut_periode,
            "fichier": relatif(chemin),
            "taille": chemin.stat().st_size,
            "empreinte": empreinte,
            "qualite": qualite or {},
        },
    )
    return produit


def lire_grille(produit):
    """Relit les champs d'un produit archivé (float32)."""
    with np.load(absolu(produit.fichier)) as donnees:
        return {
            k: (donnees[k].astype(np.float32) if np.issubdtype(donnees[k].dtype, np.floating) else donnees[k])
            for k in donnees.files
        }


def existe(source, instant, nature="observation", reference=None):
    from meteo_app.models import ProduitMeteo

    return ProduitMeteo.objects.filter(
        source=source, nature=nature, instant=instant, reference=reference
    ).exists()


def deja_vu(source, empreinte_fichier):
    from meteo_app.models import ProduitMeteo

    return bool(empreinte_fichier) and ProduitMeteo.objects.filter(
        source=source, empreinte=empreinte_fichier
    ).exists()
