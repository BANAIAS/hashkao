
from django.urls import path
from . import views

app_name = "meteo_app"

urlpatterns = [
    path("", views.accueil, name="accueil"),

    path(
        "api/historique/",
        views.api_historique,
        name="api_historique"
    ),

    path(
        "api/carte/",
        views.api_carte,
        name="api_carte"
    ),

    path(
        "carte/",
        views.carte,
        name="carte"
    ),
]
