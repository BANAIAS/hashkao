from django.contrib import admin
from django.urls import path, include, re_path
from django.conf.urls.i18n import i18n_patterns
from django.views.generic import RedirectView
from django.utils.translation import gettext_lazy as _
from django.http import JsonResponse
import os

# Endpoint de diagnostic (retire-le après validation)
def whoami(_request):
    from django.conf import settings
    return JsonResponse({
        "DJANGO_SETTINGS_MODULE": os.environ.get("DJANGO_SETTINGS_MODULE"),
        "DEBUG": settings.DEBUG,
        "ROOT_URLCONF": settings.ROOT_URLCONF,
        "ALLOWED_HOSTS": settings.ALLOWED_HOSTS,
    })

urlpatterns = [
    path("__whoami__", whoami),

    # Application météo
    path("meteo/", include("meteo_app.urls")),

    # Home = Crypto-Vibe à la racine
    path("", include(("crypto_vibe.urls", "crypto_vibe"), namespace="crypto_vibe")),

    # Compat: ancien /crypto-vibe/ → /
    path("crypto-vibe/", RedirectView.as_view(url="/", permanent=True)),
    path("crypto_vibe/", RedirectView.as_view(url="/", permanent=True)),
    re_path(r"^crypto-vibe/(?P<rest>.*)$", RedirectView.as_view(url="/%(rest)s", permanent=True)),

    # API du générateur + i18n utilitaires à la racine
    path("generator/api/", include(("generator.api_urls", "generator_api"), namespace="generator_api")),
    path("i18n/", include("django.conf.urls.i18n")),
]

# i18n pour admin + interface du générateur
urlpatterns += i18n_patterns(
    path(_("admin/"), admin.site.urls),
    path(_("generator/"), include(("generator.urls", "generator"), namespace="generator")),
)
