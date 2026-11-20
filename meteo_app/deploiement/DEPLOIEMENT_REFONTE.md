# HKO Météo — refonte technique : installation, déploiement, retour arrière

Base : commit `8820e46`, branche `develop-meteo`. Rien n'a été poussé ni
déployé. Ce document dit **dans quel ordre** tout faire, d'abord en local
(Windows, PowerShell), puis en production (Scaleway, Linux), sans perte de
données et avec un retour arrière possible à chaque étape.

> Les chemins de production ci-dessous (`/opt/hashkao`, `www-data`,
> `/etc/hashkao.env`, `env/`) sont repris de `deploiement/hko-scaleway.service`.
> Le dépôt contient aussi des unités qui pointent vers `/srv/hashkao`. **Les
> deux ne peuvent pas être vraies en même temps : à vérifier avant tout**
> (voir « Informations à récupérer sur le serveur », en fin de document).

---

## 1. Ce qui change, en bref

| Domaine | Avant | Après |
|---|---|---|
| Satellite | Originaux 3980 × 4112 (≈ 1,5 Mo) décodés et filtrés (CSS + SVG) à chaque image, aussi hors du tableau | Images adaptées à l'écran (1280, 1990 ou pleine résolution recadrée), correction de couleur appliquée **une fois** sur le serveur ; vidéo H.264 de la journée pour la lecture ; image exacte à l'arrêt |
| Radar OPERA | 55 Mo de JSON base64 par boucle, conversion et mouvement dans la page | Trames binaires compressées (≈ 50 Ko), conversion et mouvement dans un Worker, affichage dès la première trame |
| Fonds | Relief, mer, ombrage recalculés à chaque clic, dans la page | Calculés une fois dans un Worker, ambiance horaire appliquée sans recalcul, préparés en arrière-plan |
| Contours | Reprojection D3 à chaque dessin, liseré par toile temporaire | Projetés une fois (Path2D), simple transformation ; liseré par découpe |
| Démarrage | Tout attendu avant d'ouvrir | Satellite d'abord ; contours et relief ensuite, sans disputer la connexion |
| Animation | Boucle permanente, même à l'arrêt | Arrêtée quand rien ne bouge ; heure de la frise donnée par l'image vidéo présentée |
| Robustesse | Rien en cas de perte du contexte graphique | Reprise automatique (WebGL et canvas 2D), journal des incidents |
| Statiques | `?v=71e5b73` à la main, D3 sur un CDN | Empreinte automatique du contenu (`{% static_v %}`), D3 servi par le site |
| Serveur | `api/carte` recalculée à chaque requête (≈ 0,2 s, 520 Ko) | Mise en cache (Redis) jusqu'à la prochaine collecte, réponse compressée (≈ 53 Ko) |

La direction artistique est inchangée (voir `RAPPORT_REFONTE.md`, mesures
de fidélité). Seule différence visible : le bouton de défilement du pied de
page affiche enfin son icône à l'intérieur du bouton (le code HTML d'origine
le refermait avant l'icône).

---

## 2. Nouvelles dépendances

| Dépendance | Où | Pourquoi | Installation |
|---|---|---|---|
| **FFmpeg** (≥ 4.2, avec libx264) | serveur (et poste local pour essayer les vidéos) | Encodage des vidéos satellite H.264 | Linux : `sudo apt install ffmpeg`. Windows : `pip install imageio-ffmpeg` (FFmpeg fourni) |
| `imageio-ffmpeg` (facultatif) | venv | FFmpeg sans installation système | `pip install imageio-ffmpeg` |
| **Redis** | serveur | Déjà configuré dans `settings/base.py` (`django_redis`). Sert maintenant au cache de `api/carte`. Si Redis est arrêté, l'API fonctionne quand même (calcul sans cache) | `sudo systemctl status redis-server` |
| D3 7.9.2 | `static/meteo_app/vendor/` | Fichier local (licence ISC jointe) : plus de dépendance au CDN | rien à faire |

Aucune nouvelle dépendance Python obligatoire (Pillow et numpy sont déjà là).
Aucune modification de `settings/*.py` n'est imposée : les nouveaux réglages
sont facultatifs (section 7).

---

## 3. En local (Windows, PowerShell)

Dans le dossier du projet, environnement virtuel activé :

```powershell
# 0. Sauvegarde de la branche actuelle (rien n'est poussé)
git switch develop-meteo
git switch -c refonte-technique

# 1. Copier le contenu de l'archive ZIP à la racine du projet (mêmes chemins),
#    puis vérifier la liste des fichiers modifiés
git status

# 2. FFmpeg pour les vidéos (une seule fois)
pip install imageio-ffmpeg

# 3. Aucune migration de base n'est nécessaire (aucun modèle modifié)
python manage.py migrate --check

# 4. Tests (anciens + nouveaux)
python manage.py test meteo_app

# 5. Ressources dérivées des archives présentes (7 derniers jours)
python manage.py hko_derives --jours 7

# 6. Lancer le site
python manage.py runserver
```

Ouvrir `http://127.0.0.1:8000/meteo/`. Paramètres d'essai utiles :

| Paramètre | Effet |
|---|---|
| `?lecteur=images` | lecteur satellite par images (comparaison avec la vidéo) |
| `?profil=leger` / `standard` / `riche` | force le profil d'appareil |
| `?satellite=leger` / `standard` / `haute` | force la résolution satellite |
| `?worker=0` | calculs dans la page (navigateur sans Worker) |
| `?opera=0` | ancien radar Météo-France (inchangé) |
| `?heure=19` | ambiance horaire du fond des températures (inchangé) |
| `?essai=1` | expose `window.HKOEssai` pour les essais automatisés |

Pendant le développement, le planificateur local lance aussi les dérivés :
`python manage.py hko_planificateur` (nouvelle tâche « derives » toutes les 5 min).

---

## 4. Commandes de la refonte

```text
python manage.py hko_derives                    # récent : images, vidéos du jour (+ veille juste après minuit), OPERA, purge
python manage.py hko_derives --jours 7          # rattrapage : les 7 dernières journées (archives existantes)
python manage.py hko_derives --jour 2026-11-18  # une journée précise
python manage.py hko_derives --profils leger,standard   # profils satellite choisis (défaut : haute,standard,leger)
python manage.py hko_derives --sans-video       # images et OPERA seulement
python manage.py hko_derives --sans-opera
python manage.py hko_derives --purger --simulation      # ce que la purge effacerait (rien n'est effacé)
python manage.py hko_derives --purger
```

Propriétés garanties :

- **Les originaux ne sont jamais modifiés ni effacés** : seuls des fichiers
  sous `publication/derives/` sont écrits ou effacés.
- **Idempotent et relançable** : ce qui est à jour est sauté (signature des
  sources). Une interruption ne laisse aucun fichier visible à moitié écrit :
  chaque fichier est écrit sous un nom temporaire `.tmp_*` puis renommé ;
  Nginx refuse de servir ces noms, la purge les efface après une heure.
- **Un seul passage à la fois** (verrou `derives`) : la minuterie ne double
  jamais un passage en cours.
- **Observations tardives** : une image arrivée en retard ne réencode que
  l'heure concernée (et la suivante si l'image y était « tenue »), puis la
  journée est réassemblée sans réencodage. La nouvelle vidéo a un nouveau
  nom (empreinte) ; l'ancienne est gardée 30 min pour les lectures en cours.
- **Journées de 23 et 25 h** : les journées sont des journées civiles de
  Paris, découpées en heures UTC (testé : 29 mars et 25 octobre 2026).

### Ce qui est produit

```
publication/derives/
  geocolour/haute/      2514 × 2934, recadré −9,5…14,5 E / 37…56 N, pleine résolution
  geocolour/standard/   1990 × 2056, emprise complète
  geocolour/leger/      1280 × 1322, emprise complète
  video/<profil>/<AAAA-MM-JJ>/jour_<empreinte>.mp4   journée (H.264, faststart)
  video/<profil>/<AAAA-MM-JJ>/index.json             heure de chaque image
  video/<profil>/<AAAA-MM-JJ>/seg_<AAAAMMJJ>T<HH>Z.*  segments horaires (internes, effacés après 36 h)
  opera/standard/<AAAAMMJJ>/opera_*.bin              grille 0,025° (gzip)
  opera/leger/<AAAAMMJJ>/opera_*.bin                 grille 0,05°  (gzip)
```

Vidéo : une image toutes les 2 min 30 de temps réel (24 par heure),
chacune montrant la dernière observation disponible : la vidéo est
**linéaire dans le temps**, exactement comme la frise. Pas de fondu entre
observations (rendu d'origine, image par image) ; réglage
`HKO_FONDU_SATELLITE = True` pour l'activer plus tard.

### Récapitulatifs de 30 s (préparés, non développés)

Rien n'est construit, mais tout ce qui leur servira existe déjà : journées
civiles de Paris stockées à part (23/25 h comprises), index temporel exact
de chaque image, segments horaires réutilisables sans réencodage, vidéo
linéaire dans le temps (une journée = 24 s à 24 i/s, un récapitulatif de
30 s n'est qu'un changement de cadence), lacunes signalées dans l'index,
option de fondus côté serveur. Côté navigateur, le lecteur sait déjà
basculer entre deux versions d'une vidéo sans saut et piloter la frise
depuis l'image présentée.

---

## 5. Production (Scaleway, Linux) — dans l'ordre

**Ne rien faire tant que les informations de la section 10 ne sont pas vérifiées.**
Toutes les commandes en tant qu'administrateur, dans `/opt/hashkao` (à confirmer).

### 5.1 Sauvegarde (avant toute chose)

```bash
cd /opt/hashkao
DATE=$(date +%Y%m%d_%H%M)
sudo mkdir -p /var/backups/hashkao

# Code et configuration
sudo tar czf /var/backups/hashkao/code_$DATE.tgz --exclude=env --exclude=staticfiles --exclude=meteo_app/data .
sudo cp /etc/nginx/sites-available/* /var/backups/hashkao/ 2>/dev/null
sudo cp /etc/systemd/system/hko* /etc/systemd/system/gunicorn* /var/backups/hashkao/ 2>/dev/null

# Base SQLite : copie cohérente même si une collecte écrit
sudo -u www-data sqlite3 db.sqlite3 ".backup '/var/backups/hashkao/db_$DATE.sqlite3'"

# Données HKO : les originaux ne seront pas touchés, mais une copie de
# l'arborescence (sans les gros fichiers) aide en cas de doute
sudo du -sh meteo_app/data/hko/*   # noter les tailles
git rev-parse HEAD | sudo tee /var/backups/hashkao/commit_$DATE.txt
```

### 5.2 Dépendances système

```bash
sudo apt update && sudo apt install -y ffmpeg
ffmpeg -hide_banner -encoders | grep libx264      # doit afficher libx264
redis-cli ping                                     # doit répondre PONG
df -h /opt/hashkao                                 # place disponible (voir 5.6)
```

### 5.3 Code

```bash
cd /opt/hashkao
sudo systemctl stop 'hko@*.timer'                  # suspend les collectes le temps de la copie (≈ 2 min)
# Copier les fichiers de l'archive (mêmes chemins), par exemple depuis /tmp/refonte :
sudo rsync -a /tmp/refonte/ /opt/hashkao/
sudo chown -R www-data:www-data meteo_app
sudo -u www-data env/bin/python manage.py check --deploy --settings=hashkao.settings.prod
sudo -u www-data env/bin/python manage.py migrate --check --settings=hashkao.settings.prod   # aucune migration attendue
sudo -u www-data env/bin/python manage.py collectstatic --noinput --settings=hashkao.settings.prod
sudo systemctl start 'hko@*.timer'
```

### 5.4 Rattrapage des archives existantes (sans gêner le site)

```bash
# Simulation de purge d'abord : rien n'est effacé
sudo -u www-data nice -n 15 ionice -c3 env/bin/python manage.py hko_derives --purger --simulation --settings=hashkao.settings.prod

# Puis les dérivés des 7 derniers jours, en priorité minimale
sudo systemd-run --uid=www-data --working-directory=/opt/hashkao \
     -p Nice=15 -p IOSchedulingClass=idle -p CPUQuota=100% \
     --setenv=DJANGO_SETTINGS_MODULE=hashkao.settings.prod \
     env/bin/python manage.py hko_derives --jours 7
journalctl -f -u 'run-*'            # suivre ; relançable sans risque s'il est interrompu
```

Durée estimée : quelques minutes par journée et par profil sur un cœur
(mesuré ici : 21 observations, trois profils, ≈ 75 s). À valider sur le serveur.

### 5.5 Minuterie des dérivés

```bash
sudo cp meteo_app/deploiement/hko-derives.service meteo_app/deploiement/hko-derives.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hko-derives.timer
systemctl list-timers | grep hko
journalctl -u hko-derives.service -n 50
```

`hko-derives.service` tourne avec `Nice=15`, `IOSchedulingClass=idle`,
`CPUQuota=100%` (un cœur au plus) et `MemoryMax=1500M` : les collectes
(`Nice=10`) et Gunicorn restent prioritaires.

### 5.6 Nginx

1. Adapter `meteo_app/deploiement/nginx_hko_refonte.conf` (chemins de
   `HKO_DONNEES`, `STATIC_ROOT`, adresse de Gunicorn).
2. ```bash
   sudo cp meteo_app/deploiement/nginx_hko_refonte.conf /etc/nginx/snippets/hko_refonte.conf
   # ajouter « include /etc/nginx/snippets/hko_refonte.conf; » dans le bloc server de hashkao.com,
   # avant « location / »
   sudo nginx -t && sudo systemctl reload nginx
   ```
3. Vérifier :
   ```bash
   curl -sI https://hashkao.com/meteo/api/carte/ -H 'Accept-Encoding: gzip' | grep -i 'content-encoding'
   curl -sI -H 'Range: bytes=0-99' https://hashkao.com$(curl -s 'https://hashkao.com/meteo/api/satellite/' | python3 -c 'import json,sys; print(json.load(sys.stdin)["video"]["url"])') | head -3   # 206
   ```

Place disque (estimation à partir des données d'essai, **à valider** avec
de vraies images) : ≈ 0,35 Go par jour de dérivés (images des trois
profils + vidéos assemblées), soit ≈ 2,9 Go pour 8 jours, en plus des
originaux (≈ 0,22 Go/jour). Pour réduire : `HKO_DERIVES_JOURS = 4` ou
`--profils standard,leger` dans l'unité (sans « haute », les grands écrans
utilisent « standard »).

### 5.7 Gunicorn

Aucun changement obligatoire. Les requêtes lourdes ont disparu
(`api/animation` OPERA, gros JSON) et les fichiers dérivés sont servis par
Nginx. Recommandé si ce n'est pas déjà le cas : `--workers 3 --threads 2
--timeout 60` et `--max-requests 1000 --max-requests-jitter 100` (limite
la mémoire sur la durée). Puis `sudo systemctl restart gunicorn` (nom de
l'unité à confirmer).

### 5.8 SQLite (facultatif, recommandé)

Le mode WAL évite que les lectures du site attendent pendant qu'une collecte
écrit. Activation **après** sauvegarde (5.1) :

```bash
# hashkao/settings/prod.py (ou fichier de réglages local du serveur) :
#   HKO_SQLITE_WAL = True
sudo -u www-data sqlite3 /opt/hashkao/db.sqlite3 'PRAGMA journal_mode=WAL;'
sudo systemctl restart gunicorn
ls -la /opt/hashkao/db.sqlite3*     # db.sqlite3-wal et -shm apparaissent ; le dossier doit appartenir à www-data
```

Retour arrière : retirer le réglage, arrêter Gunicorn et les minuteries,
`sqlite3 db.sqlite3 'PRAGMA journal_mode=DELETE;'`, relancer.

Index : les requêtes de la refonte utilisent les index existants
(`ProduitMeteo (source, nature, -instant)`, `ObservationMeteo.date`).
**Aucune migration**, donc rien à défaire côté base.

### 5.9 Mise en service et contrôle

```bash
sudo systemctl restart gunicorn
sudo -u www-data env/bin/python manage.py hko_derives --settings=hashkao.settings.prod
journalctl -u gunicorn -n 50 | grep -i 'navigateur'   # incidents remontés par les navigateurs (journal client)
```

Puis le protocole de validation (section 8).

---

## 6. Retour arrière

Le retour arrière est complet et sans perte, parce qu'aucune donnée de
référence ni la base ne sont modifiées.

```bash
cd /opt/hashkao
sudo systemctl disable --now hko-derives.timer
sudo tar xzf /var/backups/hashkao/code_<DATE>.tgz -C /opt/hashkao      # ancien code
sudo -u www-data env/bin/python manage.py collectstatic --noinput --settings=hashkao.settings.prod
# Nginx : retirer la ligne « include …hko_refonte.conf; », puis
sudo nginx -t && sudo systemctl reload nginx
sudo systemctl restart gunicorn
# Facultatif : effacer les dérivés (régénérables)
sudo rm -rf /opt/hashkao/meteo_app/data/hko/publication/derives
```

Les anciennes API (`api/geocolour/`, `api/animation/`) n'ont jamais été
retirées : l'ancien code fonctionne immédiatement.

---

## 7. Réglages facultatifs (settings)

| Réglage | Défaut | Rôle |
|---|---|---|
| `HKO_SQLITE_WAL` | `False` | SQLite en mode WAL (section 5.8) |
| `HKO_FFMPEG` | — | Chemin de FFmpeg (sinon PATH, puis `imageio-ffmpeg`) |
| `HKO_DERIVES_JOURS` | `8` | Conservation des dérivés |
| `HKO_FONDU_SATELLITE` | `False` | Fondus entre observations dans la vidéo (change le rendu : non activé) |

Les clés d'API et paramètres confidentiels ne sont ni lus ni modifiés par la refonte.

---

## 8. Protocole de validation (après déploiement, puis sur vrais téléphones)

1. **Les 4 tableaux** : satellite, températures, précipitations, conditions — comparer aux captures d'avant (même heure).
2. **Satellite** : lecture d'une journée passée ; pause → l'heure de la frise correspond à l'image (« Observation ») ; curseur → image exacte ; journée en cours : dernière observation affichée et actualisée (≤ 5 min après la collecte, en images en attendant la vidéo).
3. **Lacunes** : journée avec une image manquante → « Lacune » dans la frise au-delà de 30 min sans observation.
4. **Radar** : boucle visible dès les premières trames ; hachures « sans mesure ».
5. **Navigation** : jours précédents/suivants, passage de minuit (laisser la page ouverte), défilement automatique 15 s.
6. **Réseau** : couper la connexion (mode avion) → messages « inaccessible » et bouton Réessayer.
7. **Longue durée** : page ouverte 1 h sur un téléphone → pas d'échauffement anormal, mémoire stable (onglet « Mémoire » des outils de développement).
8. **Navigateurs** : Chrome et Safari iOS (vidéo, Range), Firefox, Samsung Internet ; un téléphone d'entrée de gamme.
9. **Serveur** : `systemctl list-timers` ; `journalctl -u hko-derives` sans erreur ; `top` pendant un passage des dérivés (le site reste réactif) ; `df -h` sur 48 h.
10. **Comparaison vidéo / images** : `?lecteur=images` vs défaut, sur 4G réelle (octets transférés, fluidité). Le mode vidéo est le défaut **sous réserve** de cette validation (section 9 du rapport).

---

## 9. Fichiers devenus inutiles (non supprimés)

À ne supprimer qu'après validation en production :

| Fichier | Raison |
|---|---|
| `static/meteo_app/fonds/geocolour_jour.webp`, `geocolour_nuit.webp` | anciens fonds, non référencés |
| `static/meteo_app/fonds/satellite_2048.webp`, `satellite_4096.webp` | anciens fonds Blue Marble, non référencés |
| `static/meteo_app/relief/relief_france.json.gz` | non référencé |
| `static/meteo_app/geo/pays_monde.geojson` | non référencé |
| `static/meteo_app/relief/relief_europe.json.gz`, `geo/pays_monde_50m.geojson`, `geo/departements.geojson` | **gardés** : secours si les versions allégées manquent |
| `publication/opera/animation_*.json.gz`, `cache/animation/opera_*` | caches de l'ancienne boucle OPERA (purgés par `purger_hko`) |
| Shader satellite WebGL (`SATELLITE` dans `hko_anime.js`) et règles CSS `#gl-satellite` | plus utilisés par la page ; gardés pour le retour arrière |
| Vues `api_geocolour`, `api_animation?source=opera` | plus appelées par la page ; gardées pour compatibilité et retour arrière |

---

## 10. Informations à récupérer sur le serveur

Merci de nous transmettre (sans clé ni mot de passe) :

1. `systemctl cat gunicorn*` et la commande Gunicorn réelle (workers, socket ou port).
2. Le bloc `server` Nginx de hashkao.com (`/etc/nginx/sites-enabled/…`).
3. `systemctl list-timers --all | grep -i hko` : quelles collectes tournent vraiment (`collecter_geocolour` et `collecter_opera` n'ont pas de minuterie dans le dépôt).
4. Le dossier du projet (`/opt/hashkao` ou `/srv/hashkao`), l'utilisateur, le venv, et la valeur de `HKO_DONNEES` (variable d'environnement ou réglage).
5. `ffmpeg -version` (s'il est déjà installé), `redis-cli ping`.
6. `ls -la` du dossier de `db.sqlite3` (propriétaire, pour le mode WAL).
7. `df -h` et `nproc`, `free -h` (dimensionnement des dérivés et de l'encodage).
8. La version de Python du venv (`env/bin/python --version`).
