"""
HKO Météo — API et fichiers de la refonte technique.

    api/satellite/?jour=AAAA-MM-JJ&profil=haute|standard|leger
        Observations GeoColour de la journée (Paris) : image d'origine,
        image adaptée au profil, et la vidéo H.264 de la journée si elle
        est prête (index des images : quelle image vidéo correspond à
        quelle observation).

    api/radar/?jour=AAAA-MM-JJ&profil=standard|leger&heures=3[&fenetre=resume]
        Trames OPERA binaires (deux plans d'octets, compressés gzip).
        fenetre=resume (jour passé) : finit avec la fenêtre radar du film.

    donnees/derives/<chemin>
        Fichiers dérivés. En production, Nginx les sert directement
        (voir deploiement/nginx_hko_refonte.conf) ; cette vue sert de
        secours et en développement, avec prise en charge des requêtes
        partielles (Range) indispensables à la lecture vidéo sur Safari.

    api/resume/?jour=AAAA-MM-JJ
        Film « Résumé du jour » d'une journée close : adresse de sa
        partition (fichier JSON figé, mis en cache par le navigateur),
        titre et date. 404 si la journée n'est pas close ou pas encore
        résumée.

    api/journal/   (POST)
        Petit journal d'erreurs du navigateur (perte de contexte WebGL,
        échec de chargement…) : écrit dans le journal du serveur, rien
        n'est stocké en base.

Les anciennes API (api/geocolour/, api/animation/) restent en place,
inchangées, pour la compatibilité et le retour arrière.
"""

import gzip
import json
import logging
import mimetypes
import re
from datetime import date, datetime, timedelta, timezone

from django.http import FileResponse, Http404, HttpResponse, JsonResponse, StreamingHttpResponse
from django.urls import reverse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from .sources import derives

journal = logging.getLogger("meteo_app.client")

PROFILS = ("haute", "standard", "leger")
JOURS_CONSERVES = 7
OPERA_A_LA_DEMANDE = 25        # trames produites au plus par requête (le reste : minuterie)


def _profil(request):
    profil = request.GET.get("profil", "standard")
    return profil if profil in PROFILS else "standard"


def _jour(request):
    aujourdhui = derives.jour_local(datetime.now(timezone.utc))
    texte = request.GET.get("jour")
    if not texte:
        return aujourdhui, aujourdhui
    return date.fromisoformat(texte), aujourdhui


def reponse_json(request, contenu, cache="no-cache", statut=200):
    """JSON compact, compressé si le navigateur l'accepte (Nginx peut aussi le faire)."""
    octets = json.dumps(contenu, separators=(",", ":"), ensure_ascii=False).encode()
    accepte = "gzip" in request.META.get("HTTP_ACCEPT_ENCODING", "")
    if accepte and len(octets) > 1024:
        octets = gzip.compress(octets, 5)
    reponse = HttpResponse(octets, content_type="application/json; charset=utf-8", status=statut)
    if accepte and len(octets) and octets[:2] == b"\x1f\x8b":
        reponse["Content-Encoding"] = "gzip"
    reponse["Vary"] = "Accept-Encoding"
    reponse["Cache-Control"] = cache
    return reponse


# ---------------------------------------------------------------------------
# Satellite
# ---------------------------------------------------------------------------

def api_satellite(request):
    try:
        jour, aujourdhui = _jour(request)
    except ValueError:
        return JsonResponse({"erreur": "Le jour doit être au format AAAA-MM-JJ."}, status=400)
    profil = _profil(request)

    originaux = derives.originaux_geocolour()
    du_jour = derives.observations_du_jour(jour, originaux)
    limite = datetime.now(timezone.utc) - timedelta(days=JOURS_CONSERVES)

    # « derivee » : l'image adaptée existe déjà. Sinon (production des
    # dérivés en retard), le navigateur prend directement l'original au lieu
    # d'attendre un 404.
    dossier_profil = derives.racine_derives("geocolour", profil)
    observations = [{
        "instant": instant.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "image": reverse("meteo_app:fichier_derive", args=[f"geocolour/{profil}/{chemin.name}"]),
        "originale": reverse("meteo_app:fichier_geocolour", args=[chemin.name]),
        "derivee": (dossier_profil / chemin.name).is_file(),
    } for instant, chemin in du_jour if instant >= limite]

    video = None
    index = derives.lire_index_video(profil, jour)
    if index and index["observations"]:
        # La vidéo peut avoir quelques minutes de retard sur la dernière
        # observation : le lecteur montre alors les dernières en images.
        connues = {o["instant"] for o in observations}
        video = {
            "url": reverse("meteo_app:fichier_derive",
                           args=[f"video/{profil}/{jour.isoformat()}/{index['video']}"]),
            "fps": index["fps"],
            "debut": index["debut"],
            "secondes_par_image": index["secondes_par_image"],
            "images": index["images"],
            "fondu": index["fondu"],
            "largeur": index["largeur"], "hauteur": index["hauteur"],
            "fin": index["observations"][-1]["instant"],
            "observations": [o for o in index["observations"] if o["instant"] in connues],
        }

    dernier = originaux[-1] if originaux else None
    largeur, hauteur = derives.PROFILS_SATELLITE[profil]["taille"]
    contenu = {
        "version": 2,
        "jour": jour.isoformat(),
        "profil": profil,
        "emprise": derives.PROFILS_SATELLITE[profil]["emprise"],
        "largeur": largeur, "hauteur": hauteur,
        "correction_integree": True,
        "pas_minutes": 10,
        "attribution": "EUMETSAT / NASA - Traitement visuel HKO",
        "observations": observations,
        "video": video,
        "secours": {
            "instant": dernier[0].strftime("%Y-%m-%dT%H:%M:%SZ"),
            "image": reverse("meteo_app:fichier_derive", args=[f"geocolour/{profil}/{dernier[1].name}"]),
            "originale": reverse("meteo_app:fichier_geocolour", args=[dernier[1].name]),
            "derivee": (dossier_profil / dernier[1].name).is_file(),
        } if dernier else None,
    }
    return reponse_json(request, contenu, cache="no-cache" if jour >= aujourdhui else "public, max-age=600")


# ---------------------------------------------------------------------------
# Radar OPERA
# ---------------------------------------------------------------------------

def api_radar(request):
    from django.utils import timezone as dj

    from .models import ProduitMeteo

    try:
        jour, aujourdhui = _jour(request)
        heures = min(max(float(request.GET.get("heures", 3)), 0.5), 6.0)
    except ValueError:
        return JsonResponse({"erreur": "Paramètres incorrects."}, status=400)
    profil = "leger" if _profil(request) == "leger" else "standard"
    if jour > aujourdhui:
        return JsonResponse({"erreur": "Pas d'observation pour un jour à venir."}, status=404)

    debut, fin = derives.bornes_jour(jour)
    produits = ProduitMeteo.objects.filter(source="opera", nature="observation")
    if jour == aujourdhui:
        dernier = produits.filter(instant__lte=dj.now()).order_by("-instant").first()
    else:
        # Comme l'ancienne API : un jour passé est montré jusqu'à 16 h ;
        # avec fenetre=resume, la fenêtre la plus pluvieuse retenue par le
        # film « Résumé du jour » (même pluie dans le film et dans le tableau)
        limite = datetime.combine(jour, datetime.min.time().replace(hour=16), tzinfo=derives.PARIS)
        if request.GET.get("fenetre") == "resume":
            from .sources import resume
            partition = resume.lire_partition(jour)
            if partition and partition.get("radar"):
                limite = debut + timedelta(hours=partition["radar"]["heures"][-1], minutes=1)
        dernier = produits.filter(instant__gte=debut, instant__lte=limite).order_by("-instant").first()
    if dernier is None:
        return JsonResponse({"erreur": "Aucune image archivée pour ce jour.", "jour": jour.isoformat()}, status=404)

    selection = list(produits.filter(instant__gt=dernier.instant - timedelta(hours=heures),
                                     instant__lte=dernier.instant).order_by("instant"))
    trames, produites = [], 0
    for produit in selection:
        chemin = derives.chemin_trame_opera(profil, produit.instant)
        if not chemin.exists():
            if produites >= OPERA_A_LA_DEMANDE:
                continue
            try:
                derives.trame_opera(produit, profil)
                produites += 1
            except (FileNotFoundError, KeyError, ValueError):
                continue        # archive purgée : la trame manque, sans être inventée
        relatif = chemin.relative_to(derives.racine_derives()).as_posix()
        trames.append({
            "instant": produit.instant.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "url": reverse("meteo_app:fichier_derive", args=[relatif]),
        })
    if not trames:
        return JsonResponse({"erreur": "Les images de cette période ont été purgées."}, status=404)

    from .views import ANIMATION_ATTRIBUTIONS, encoder_trame
    contenu = {
        "version": 2, "source": "radar", "jour": jour.isoformat(), "profil": profil,
        "grille": derives.description_opera(profil),
        "pas_minutes": 15,
        "encodage": encoder_trame.__doc__.strip(),
        "compression": "gzip",
        "attribution": ANIMATION_ATTRIBUTIONS["opera"],
        "trames": trames,
    }
    return reponse_json(request, contenu, cache="public, max-age=60" if jour == aujourdhui else "public, max-age=3600")


# ---------------------------------------------------------------------------
# Fichiers dérivés
# ---------------------------------------------------------------------------

MOTIF_DERIVE = re.compile(
    r"^(geocolour/(haute|standard|leger)/geocolour_\d{8}T\d{4}Z\.webp"
    r"|video/(haute|standard|leger)/\d{4}-\d{2}-\d{2}/jour_[0-9a-f]{12}\.mp4"
    r"|opera/(standard|leger)/\d{8}/opera_\d{8}T\d{4}Z\.bin"
    r"|resume/\d{4}-\d{2}-\d{2}\.json)$"
)
TYPES = {".webp": "image/webp", ".mp4": "video/mp4", ".bin": "application/octet-stream",
         ".json": "application/json"}
PLAGE = re.compile(r"^bytes=(\d*)-(\d*)$")


def _fichier_partiel(fichier, debut, longueur, bloc=256 * 1024):
    with fichier:
        fichier.seek(debut)
        reste = longueur
        while reste > 0:
            morceau = fichier.read(min(bloc, reste))
            if not morceau:
                break
            reste -= len(morceau)
            yield morceau


def fichier_derive(request, chemin):
    if not MOTIF_DERIVE.match(chemin):
        raise Http404("Fichier inconnu.")
    fichier = derives.racine_derives() / chemin

    if not fichier.is_file() and chemin.startswith("geocolour/"):
        # Image adaptée pas encore produite : on la fabrique une fois (≈ 1 s)
        _, profil, nom = chemin.split("/")
        original = derives.dossier_publication("geocolour") / nom
        if not original.is_file():
            raise Http404("Image indisponible.")
        derives.image_derivee(original, profil)
    if not fichier.is_file():
        raise Http404("Fichier absent.")

    taille = fichier.stat().st_size
    type_mime = TYPES.get(fichier.suffix) or mimetypes.guess_type(fichier.name)[0]
    plage = PLAGE.match(request.META.get("HTTP_RANGE", ""))

    if plage and (plage.group(1) or plage.group(2)):
        if plage.group(1):
            debut = int(plage.group(1))
            fin = int(plage.group(2)) if plage.group(2) else taille - 1
        else:
            debut, fin = max(0, taille - int(plage.group(2))), taille - 1
        fin = min(fin, taille - 1)
        if debut > fin:
            reponse = HttpResponse(status=416)
            reponse["Content-Range"] = f"bytes */{taille}"
            return reponse
        reponse = StreamingHttpResponse(_fichier_partiel(open(fichier, "rb"), debut, fin - debut + 1),
                                        status=206, content_type=type_mime)
        reponse["Content-Range"] = f"bytes {debut}-{fin}/{taille}"
        reponse["Content-Length"] = str(fin - debut + 1)
    else:
        reponse = FileResponse(open(fichier, "rb"), content_type=type_mime)
    reponse["Accept-Ranges"] = "bytes"
    if fichier.suffix == ".bin":
        reponse["Content-Encoding"] = "gzip"
    # Chaque nom désigne un contenu figé (empreinte ou heure d'observation)
    reponse["Cache-Control"] = "public, max-age=604800, immutable"
    return reponse


# ---------------------------------------------------------------------------
# Résumé du jour
# ---------------------------------------------------------------------------

def api_resume(request):
    from .sources import resume

    try:
        jour, aujourdhui = _jour(request)
    except ValueError:
        return reponse_json(request, {"erreur": "Date invalide."}, statut=400)
    if jour >= aujourdhui:
        return reponse_json(request, {"jour": jour.isoformat(), "erreur":
                            "Le résumé d'une journée est publié dans la nuit qui suit."}, statut=404)
    chemin = resume.chemin_partition(jour)
    if not chemin.is_file():
        return reponse_json(request, {"jour": jour.isoformat(), "erreur":
                            "Pas de résumé pour ce jour : les mesures n'ont pas été conservées "
                            "assez longtemps, ou le résumé n'est pas encore prêt."},
                            cache="public, max-age=600", statut=404)
    version = int(chemin.stat().st_mtime)
    url = reverse("meteo_app:fichier_derive", args=[f"resume/{jour.isoformat()}.json"]) + f"?v={version}"
    return reponse_json(request, {"jour": jour.isoformat(), "url": url, "taille": chemin.stat().st_size},
                        cache="public, max-age=600")


# ---------------------------------------------------------------------------
# Journal du navigateur
# ---------------------------------------------------------------------------

@csrf_exempt
@require_POST
def journal_client(request):
    if len(request.body) > 4096:
        return HttpResponse(status=413)
    try:
        message = json.loads(request.body or b"{}")
    except ValueError:
        return HttpResponse(status=400)
    if not isinstance(message, dict):
        return HttpResponse(status=400)
    propre = {str(k)[:40]: str(v)[:300] for k, v in list(message.items())[:12]}
    journal.warning("navigateur %s", json.dumps(propre, ensure_ascii=False))
    return HttpResponse(status=204)


# ---------------------------------------------------------------------------
# api/carte : mise en cache (Redis en production)
# ---------------------------------------------------------------------------

def api_carte(request):
    """
    Même réponse que views.api_carte, mise en cache tant qu'aucune nouvelle
    observation ni aucun nouveau produit n'est enregistré, et compressée.
    La première requête après une collecte recalcule (≈ 0,2 s) ; les
    suivantes sont servies en quelques millisecondes.
    """
    from django.core.cache import cache
    from django.db.models import Max

    from . import views
    from .models import ObservationMeteo, ProduitMeteo

    try:
        etat = (ObservationMeteo.objects.aggregate(m=Max("id"))["m"],
                ProduitMeteo.objects.aggregate(m=Max("id"))["m"],
                derives.jour_local(datetime.now(timezone.utc)).isoformat())
        cle = "hko:carte:" + derives.signature(request.GET.urlencode(), etat)[:24]
    except Exception:
        return views.api_carte(request)

    try:
        contenu = cache.get(cle)
    except Exception:            # Redis arrêté : on calcule sans cache
        contenu = None
    if contenu is None:
        reponse = views.api_carte(request)
        if reponse.status_code != 200:
            return reponse
        contenu = json.loads(reponse.content)
        try:
            cache.set(cle, contenu, 900)
        except Exception:
            pass
    return reponse_json(request, contenu, cache="no-cache")
