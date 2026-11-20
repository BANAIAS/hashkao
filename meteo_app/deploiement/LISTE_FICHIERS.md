# Refonte technique — fichiers livrés

Chemins relatifs à la racine du projet. Copier l'archive telle quelle :
chaque fichier remplace (M) ou complète (N) celui du dépôt `8820e46`.

## Navigateur

| | Fichier | Rôle |
|---|---|---|
| M | `meteo_app/templates/meteo_app/hko.html` | Gabarit : statiques versionnés par empreinte, D3 local, calques vidéo et voile satellite, adresses des nouvelles API, bouton de défilement corrigé, filtre SVG retiré |
| M | `meteo_app/static/meteo_app/css/hko.css` | Calques vidéo et voile du satellite ; filtre CSS du satellite retiré (correction faite par le serveur) |
| M | `meteo_app/static/meteo_app/js/hko.js` | Démarrage progressif, profils d'appareil, contours Path2D, fonds et températures via le Worker, ambiance sans recalcul, satellite et radar binaires, boucle économe, reprise après perte de contexte, caches bornés, journal client |
| M | `meteo_app/static/meteo_app/js/hko_anime.js` | Moteur WebGL : perte/restauration du contexte, envoi progressif des trames, trames et mouvements fournis par le Worker, grille OPERA allégée, utilisable dans un Worker |
| N | `meteo_app/static/meteo_app/js/hko_calcul.js` | Worker de calcul (relief, mer, ambiances, températures, conversion radar, mouvement) ; même code dans la page à défaut |
| N | `meteo_app/static/meteo_app/js/hko_satellite.js` | Lecteur satellite : vidéo H.264 synchronisée à la frise, image exacte à l'arrêt, images adaptées, repli automatique |
| N | `meteo_app/static/meteo_app/vendor/d3.v7.min.js` | D3 7.9.2 servi par le site (plus de CDN) |
| N | `meteo_app/static/meteo_app/vendor/d3.LICENSE.txt` | Licence ISC de D3 |

## Serveur

| | Fichier | Rôle |
|---|---|---|
| N | `meteo_app/sources/derives.py` | Ressources dérivées : images adaptées et corrigées, vidéos par heure et par journée, index temporel, trames OPERA binaires, purge |
| N | `meteo_app/management/commands/hko_derives.py` | Commande de production et de rattrapage des dérivés (idempotente, verrouillée) |
| N | `meteo_app/views_ressources.py` | `api/satellite/`, `api/radar/`, fichiers dérivés (requêtes partielles), journal client, cache de `api/carte` |
| M | `meteo_app/urls.py` | Nouvelles adresses ; `api/carte/` passe par le cache |
| M | `meteo_app/apps.py` | Mode WAL de SQLite, facultatif (`HKO_SQLITE_WAL`) |
| N | `meteo_app/templatetags/__init__.py` | Paquet des balises de gabarit |
| N | `meteo_app/templatetags/hko_statique.py` | Balise `{% static_v %}` (empreinte du contenu) |
| M | `meteo_app/management/commands/hko_planificateur.py` | Tâche « derives » toutes les 5 min (usage local) |
| M | `meteo_app/requirements-collecte.txt` | Mention de FFmpeg / imageio-ffmpeg (facultatif) |
| N | `meteo_app/tests_refonte.py` | 13 tests de la refonte |

## Déploiement et documentation

| | Fichier | Rôle |
|---|---|---|
| N | `meteo_app/deploiement/hko-derives.service` | Unité systemd des dérivés (priorité minimale) |
| N | `meteo_app/deploiement/hko-derives.timer` | Toutes les 5 minutes |
| N | `meteo_app/deploiement/nginx_hko_refonte.conf` | Compression, statiques immuables, dérivés servis par Nginx |
| N | `meteo_app/deploiement/DEPLOIEMENT_REFONTE.md` | Procédure complète (local, production, sauvegarde, retour arrière, validation, questions serveur) |
| N | `meteo_app/deploiement/RAPPORT_REFONTE.md` | Mesures avant/après et classement des constats |
| N | `meteo_app/deploiement/LISTE_FICHIERS.md` | Cette liste |

Aucun fichier n'est supprimé. Aucune migration de base. Les fichiers
devenus inutiles sont listés dans `DEPLOIEMENT_REFONTE.md`, section 9.
