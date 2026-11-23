# Résumé du jour — intégration

Journées passées (historique) : trois tableaux lus d'eux-mêmes, dans l'ordre
**Satellite** (la journée lue une fois) → **Résumé** (film de 40 s) →
**Précipitations** (radar OPERA, fenêtre la plus pluvieuse retenue par le film).
La journée en cours ne change pas : quatre tableaux, comme avant.

Formats du film : 16:9 sur écran large ; sur téléphone tenu droit, version
portrait qui occupe tout l'espace entre l'en-tête et les commandes (carte
agrandie, mise en page propre) ; téléphone tourné à l'horizontale : 16:9 sur
tout l'écran. Le film se reconstruit à la rotation, sans recharger les données.

Le film n'est pas une vidéo : chaque nuit, le serveur écrit une *partition*
JSON (≈ 1,4 Mo) par journée close ; le navigateur joue le film à partir de ce
seul fichier (Canvas 2D). Aucun rendu vidéo, aucun FFmpeg.

## Fichiers

| | Fichier | Rôle |
|---|---|---|
| N | `meteo_app/sources/resume.py` | Lecture de la journée (stations, OPERA, fusion), contrôle des valeurs, règles du récit, partition |
| M | `meteo_app/management/commands/hko_derives.py` | Étape `resume` (verrou `derives_resume`), jamais lancée par défaut |
| M | `meteo_app/views_ressources.py` | `api/resume/`, partitions servies sous `donnees/derives/resume/`, `api/radar/…&fenetre=resume` |
| M | `meteo_app/urls.py` | Adresse `api/resume/` |
| M | `meteo_app/templates/meteo_app/hko.html` | Tableau Résumé, bouton, adresses du moteur |
| M | `meteo_app/static/meteo_app/js/hko.js` | Mode historique, enchaînement des lectures, lecteur du film |
| M | `meteo_app/static/meteo_app/css/hko.css` | Tableau Résumé, boutons de l'historique, plein écran |
| N | `meteo_app/static/meteo_app/js/hko_resume_moteur.js` | Moteur du film (chargé à la demande) |
| N | `meteo_app/static/meteo_app/js/hko_resume_film.js` | Le film, construit depuis la partition |
| N | `meteo_app/static/meteo_app/geo/hko_resume_geo.json` | Géographie du film (contours, relief) |
| N | `meteo_app/tests_resume.py` | 12 tests |
| N | `meteo_app/deploiement/hko-derives-resume.service` / `.timer` | Chaque nuit à 1 h 47, 3 h 47, 5 h 47 |

## Mise en service (quand vous le déciderez)

```sh
cd /opt/hashkao
sudo -u www-data env/bin/python manage.py collectstatic --noinput
sudo -u www-data env/bin/python manage.py test meteo_app.tests_resume
# Rattrapage des 7 derniers jours encore en base (≈ 10 s par journée)
sudo -u www-data env/bin/python manage.py hko_derives --etapes resume
sudo cp meteo_app/deploiement/hko-derives-resume.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hko-derives-resume.timer
sudo systemctl restart gunicorn      # nom du service à vérifier
```

Refaire une journée : `manage.py hko_derives --etapes resume --jour 2026-11-19 --forcer`.

## À savoir

- Profondeur : les observations 6 min et les grilles OPERA sont gardées
  30 jours ; le rattrapage automatique remonte 7 jours. Une partition, une
  fois écrite, n'est jamais purgée (≈ 1,4 Mo par jour, ≈ 500 Mo par an).
- Journées de changement d'heure : les heures du film sont comptées depuis
  minuit ; après 3 h, l'heure affichée peut être décalée d'une heure ces deux
  jours-là.
- Le satellite des journées passées dépend des vidéos (8 jours) ; sans
  satellite, la lecture commence directement par le film.
- Nginx : les partitions passent par Django (`fichier_derive`, cache
  immuable grâce au paramètre `?v=`). Une règle Nginx dédiée est possible
  plus tard, sans urgence.
