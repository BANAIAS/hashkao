"""
Fichiers statiques versionnés par leur contenu.

    {% load hko_statique %}
    <script src="{% static_v 'meteo_app/js/hko.js' %}"></script>
    ->  /static/meteo_app/js/hko.js?v=3f9a1c02be

L'empreinte change dès que le fichier change : le navigateur peut garder
les fichiers en cache longtemps (Cache-Control immutable côté Nginx) sans
jamais servir une version périmée après un déploiement. Plus besoin de
modifier « ?v=… » à la main dans les gabarits.
"""

import hashlib
from functools import lru_cache
from pathlib import Path

from django import template
from django.conf import settings
from django.contrib.staticfiles import finders
from django.templatetags.static import static

register = template.Library()


def _chemin(nom):
    racine = getattr(settings, "STATIC_ROOT", None)
    if racine:
        candidat = Path(racine) / nom
        if candidat.is_file():
            return candidat
    trouve = finders.find(nom)
    return Path(trouve) if trouve else None


@lru_cache(maxsize=256)
def _empreinte(nom, date):
    chemin = _chemin(nom)
    if not chemin:
        return ""
    return hashlib.sha1(chemin.read_bytes()).hexdigest()[:10]


@register.simple_tag
def static_v(nom):
    chemin = _chemin(nom)
    if not chemin:
        return static(nom)
    try:
        date = chemin.stat().st_mtime_ns
    except OSError:
        return static(nom)
    return f"{static(nom)}?v={_empreinte(nom, date)}"
