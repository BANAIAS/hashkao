# HKO Météo — collecte automatique, fusion et archivage

## Vue d'ensemble

```
 Stations ──┐                                           ┌─ /meteo/api/carte/       (Températures)
 Radar    ──┤  collecteurs  ─►  grilles archivées  ─►  fusion  ─►  /meteo/api/conditions/  (Conditions)
 Satellite ─┤  (commandes)      (0,05°, .npz)                 └─ /meteo/donnees/radar/   (Précipitations)
 AROME    ──┘
```

Chaque collecteur télécharge, contrôle, ramène sa source sur une grille
commune de 0,05° et l'archive. La fusion ne lit que ces archives : elle
est rapide (moins d'une seconde) et ne dépend jamais d'un téléchargement
en cours. Le navigateur ne reçoit que des produits légers (image radar,
carte fusionnée d'environ 65 Ko).

| Commande | Rôle | Cadence conseillée |
|---|---|---|
| `collecter_observations` | stations Météo-France (6 min) | toutes les 6 min |
| `collecter_radar` | mosaïques radar (paquet de 15 min) | toutes les 5 min |
| `collecter_satellite` | masque nuageux MTG (EUMETSAT) | toutes les 10 min |
| `collecter_arome` | prévisions AROME (cycle de 3 h) | toutes les 30 min |
| `fusionner_conditions` | carte des conditions | lancée par les collecteurs |
| `purger_hko` | purge et résumés | une fois par jour |
| `etat_hko` | surveillance de la fraîcheur | toutes les 15 min |

Toutes utilisent un verrou (jamais deux exécutions simultanées d'une même
collecte), détectent les doublons et inscrivent leur résultat dans le
journal (`JournalCollecte`, visible dans l'administration Django).

## 1. Dépendances

```
pip install -r meteo_app/requirements-collecte.txt
```

## 2. Variables d'environnement

Lues dans l'environnement, sinon dans le fichier `.env` à la racine. Ne
jamais les écrire dans le dépôt.

| Variable | Source |
|---|---|
| `METEO_FRANCE_PACKAGE_API_KEY` | stations (déjà utilisée) |
| `METEO_FRANCE_RADAR_API_KEY` | radar |
| `METEO_FRANCE_AROME_API_KEY` | AROME |
| `EUMETSAT_CONSUMER_KEY`, `EUMETSAT_CONSUMER_SECRET` | satellite (page « API Key » du compte EUMETSAT, https://api.eumetsat.int/api-key/) |
| `HKO_DONNEES` (facultatif) | dossier des données, défaut `meteo_app/data/hko/` (déjà exclu de Git) |

L'authentification EUMETSAT par clé et secret ne demande aucune session
interactive : elle fonctionne telle quelle sur un serveur Linux.

## 3. Première mise en route (poste Windows)

```
python manage.py migrate meteo_app
python manage.py preparer_hko

:: Fichiers déjà téléchargés : validation sans réseau
python manage.py collecter_radar --fichier meteo_app\data\T_IPRN20_C_LFPW_20261117145500.h5
python manage.py collecter_satellite --fichier meteo_app\data\W_XX-EUMETSAT-...CLM....zip
python manage.py fusionner_conditions --forcer

:: AROME : validation pas à pas de GetCoverage (à faire une fois)
python manage.py collecter_arome --diagnostic

:: Collecte en continu (Ctrl+C pour arrêter)
python manage.py hko_planificateur
```

## 4. Validation reproductible de chaque source

**Radar.** `collecter_radar --fichier …` doit afficher une mosaïque
traitée. `convertir_radar fichier.h5` détaille les contrôles :
« les coins concordent à moins d'un pixel radar », « Période … (5 min) »,
« Unité affichée : mm/h ». Le fichier du 17 novembre 2026, 14 h 55 UTC,
passe tous ces contrôles (écart des coins : 0 m ; 8 radars absents,
signalés dans le produit).

**Satellite.** Le contrôle d'orientation compare, sur le disque entier,
la hauteur du soleil calculée pixel par pixel à l'indicateur
jour / nuit du produit. Résultat attendu dans le journal :
`controle_orientation : conforme`. Sur le produit du 17 novembre,
14 h 40 - 14 h 50 UTC : soleil à -8,9° dans les zones « nuit », +37° dans
les zones « jour ». Avec l'axe x non inversé, le même contrôle trouve un
soleil à +49° « de nuit » et refuse l'image.

**AROME.** `collecter_arome --diagnostic` déroule :
GetCapabilities, DescribeCoverage de chaque paramètre, un GetCoverage
réduit (Paris, température à 2 m) sous les deux formes de temps
possibles, le contrôle du GeoTIFF (emprise, pas, valeur à Paris, unité)
et l'estimation du volume par cycle. Il enregistre la forme de temps
acceptée ; la collecte normale refuse de démarrer tant que ce
diagnostic n'a pas réussi.

## 5. Serveur (Scaleway, Linux) — systemd

Les unités sont dans `meteo_app/deploiement/systemd/`. Adapter dans
`hko@.service` : `User`, `WorkingDirectory`, chemin du Python de
l'environnement virtuel, `EnvironmentFile`.

```
sudo cp meteo_app/deploiement/systemd/* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hko@collecter_observations.timer hko@collecter_radar.timer \
     hko@collecter_satellite.timer hko@collecter_arome.timer \
     hko@etat_hko.timer hko@purger_hko.timer
systemctl list-timers 'hko@*'
```

- Une collecte bloquée est arrêtée au bout de 25 minutes ; la suivante
  repart normalement (le verrou abandonné est repris).
- Un échec déclenche `hko-alerte@…` : `journalctl -t hko-alerte`.
- `etat_hko` échoue (et alerte) dès qu'une source est en retard.
- L'état est aussi lisible en JSON : `/meteo/api/etat/`.

Si les collectes tournent en parallèle d'un trafic important, passer la
base de SQLite à PostgreSQL : SQLite supporte mal les écritures
concurrentes.

## 6. Cadences et limites des fournisseurs

| Source | Publication | Ce qui est vérifié |
|---|---|---|
| Stations | toutes les 6 min | collecte existante, testée le 17 nov. 2026 |
| Radar | paquet toutes les 15 min, 3 échéances de 5 min, conservé 20 h | documentation Météo-France ; format TAR.GZ constaté sur votre poste |
| Satellite | toutes les 10 min | produit réel examiné |
| AROME | cycle toutes les 3 h, ~4,5 jours conservés | catalogue réel examiné |

Les quotas d'appels ne sont pas indiqués dans les pages consultées. Les
collecteurs restent prudents : 1,5 s entre deux requêtes AROME, nouvelles
tentatives espacées sur les erreurs 429 et 5xx (en respectant l'en-tête
`Retry-After`), aucune nouvelle tentative sur 401, 403 et 404.

Volume AROME : environ 80 requêtes par cycle (10 paramètres x 8 heures de
validité). Le volume réel dépend de la compression des GeoTIFF renvoyés ;
le diagnostic l'estime. S'il est trop lourd, réduire `HEURES_PROCHES`
ou ne collecter que les cycles de 00 et 12 UTC.

## 7. Conservation et volumes

Détail dans `purger_hko.py`. En résumé :

- fichiers bruts : quelques heures (le radar brut pèse ~630 Mo par jour) ;
- grilles radar et satellite : 30 jours, puis un résumé par jour
  (cumul de pluie, part pluvieuse, nébulosité moyenne) gardé sans limite ;
- cartes des conditions : toutes pendant 48 h, une par heure jusqu'à
  30 jours, puis quatre par jour sans limite ;
- prévisions AROME : 3 jours (runs de 00 UTC : 30 jours, pour comparer
  prévisions et observations) ;
- observations des stations : détail 30 jours, puis résumé horaire.

Ordre de grandeur : ~25 Mo par jour pendant 30 jours, puis ~1 Mo par jour
d'archive durable.

## 8. Licences et mentions

- **Météo-France** (stations, radar, AROME) : données publiques, Licence
  Ouverte d'Etalab ; mention « Source : Météo-France ».
- **EUMETSAT** (masque nuageux MTG) : produits dérivés FCI classés
  « Core » dans la politique de données d'EUMETSAT (licence CC-BY-4.0,
  redistribution autorisée), mention du type « Contains modified
  EUMETSAT Meteosat data 2026 ».

La carte affiche ces mentions sous la légende des conditions. Vérifiez
les termes en vigueur avant une mise en production (liens dans les
attributs des fichiers et sur les portails des fournisseurs).

## 9. Ce que le moteur ne fait pas

- Il ne déduit jamais une absence de pluie d'une absence de mesure.
- Il ne présente jamais une prévision comme une observation : chaque
  carte porte son mode (`observation` ou `prevision`), son instant, et
  pour AROME l'heure du run.
- Les orages ne sont affichés que si une forte intensité radar coïncide
  avec de la foudre prévue par AROME (« orage probable »). Des
  observations de foudre (par exemple le Lightning Imager de MTG, sur le
  même Data Store EUMETSAT) permettraient de les confirmer.
