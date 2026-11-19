
from django.urls import path
from . import views

app_name = "meteo_app"

urlpatterns = [
    # Expérience HKO Météo : les trois tableaux
    path("", views.accueil, name="accueil"),
    path("carte/", views.carte, name="carte"),

    # Rubrique « Est-ce normal ? »
    path("est-ce-normal/", views.est_ce_normal, name="est_ce_normal"),

    # Carte technique d'origine (réglages d'affichage et d'interpolation)
    path("labo/", views.carte_labo, name="carte_labo"),

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
        "api/normal/",
        views.api_normal,
        name="api_normal"
    ),

    # Conditions météo (fusion radar, satellite, stations, AROME)
    path("api/conditions/", views.api_conditions, name="api_conditions"),
    path("api/etat/", views.api_etat, name="api_etat"),

    # Boucles d'animation radar et satellite (grilles archivées)
    path("api/animation/", views.api_animation, name="api_animation"),

    # Fichiers radar publiés par collecter_radar
    path("donnees/radar/<str:nom>", views.fichier_radar, name="fichier_radar"),

    path("donnees/opera/<str:nom>", views.fichier_opera, name="fichier_opera"),

    # Images satellite GeoColour
    path("api/geocolour/", views.api_geocolour, name="api_geocolour"),
    path("donnees/geocolour/<str:nom>", views.fichier_geocolour, name="fichier_geocolour"),
]
