"""
HKO Météo — sources de données et traitements communs.

    commun.py     chemins, clés, verrous, publication atomique, requêtes HTTP
    grille.py     grille géographique commune utilisée par la fusion
    satellite.py  masque nuageux EUMETSAT (MTG FCI, Cloud Mask)
    arome.py      modèle AROME de Météo-France (service WCS)

Le radar reste dans meteo_app/radar.py (déjà utilisé par convertir_radar).
"""
