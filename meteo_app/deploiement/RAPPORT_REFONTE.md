# HKO Météo — rapport comparatif de la refonte technique

Mêmes scénarios que l'audit, sur la même machine, avec les mêmes données
d'essai (1 565 stations réelles, 21 images GeoColour au format d'origine,
16 trames OPERA, journée du 18 novembre 2026), ancien code (`8820e46`)
et nouveau code servis côte à côte.

**Limites de l'environnement de mesure.** Chromium sans carte graphique
(WebGL émulé par SwiftShader, vidéo décodée par logiciel), serveur de
développement Django sur la même machine (réseau local), mobile simulé
(390 × 844, ×3, processeur ralenti ×4). Les durées WebGL sont donc très
pessimistes pour les deux versions ; les comparaisons restent valables,
pas les valeurs absolues.

## 1. Résultats mesurés

| Scénario | Mesure | Avant | Après |
|---|---|---|---|
| Ordinateur 1440 × 860 | Fermeture de l'ouverture | 2,8 s | **1,7–1,8 s** |
| | Octets transférés (scénario complet) | 25,1 Mo | **8,9–9,6 Mo** |
| | Clic Températures (fond complet compris) | 1,92 s | **0,06–0,12 s** |
| | Clic Précipitations | 0,94 s | 1,22–1,37 s (*) |
| | Clic Conditions | 0,64 s | **0,30–0,46 s** |
| | Clic Satellite | 0,32 s | **0,04–0,07 s** |
| | Tâches longues, total | 22,1 s | 15,4–16,1 s (*) |
| | Tâche la plus longue | 961 ms | **483–653 ms** |
| Mobile simulé | Fermeture de l'ouverture | 5,8 s | **2,1–3,1 s** |
| | Octets transférés | 23,5 Mo | **5,7–6,0 Mo** |
| | Clic Températures | 3,38 s | **0,13–0,18 s** |
| | Clic Précipitations | 3,16 s | **0,93–1,07 s** |
| | Clic Conditions | 2,38 s | **0,30–0,46 s** |
| | Clic Satellite | 1,13 s | **0,08–0,11 s** |
| | Tâches longues, total | 41,1 s | **16,1–17,1 s** |
| | Tâche la plus longue | 2 914 ms | **576–695 ms** |
| Mobile + 4G lente (1,6 Mbit/s, 150 ms) | Fermeture de l'ouverture | 40,8 s | **8,4 s** |
| | Octets avant ouverture | 7,1 Mo | **0,94 Mo** |
| | Octets transférés | 13,7 Mo | **3,7 Mo** |
| | Tâche la plus longue | 3 119 ms | **709 ms** |
| | Tas JavaScript | 15,0 Mo | **12,6 Mo** |
| Serveur | `api/carte` (compressée, en cache) | 520 Ko, 150–260 ms | **53 Ko**, quelques ms en cache |
| | Boucle OPERA (16 trames) | 950 Ko gzip en un bloc, 1,9 s de calcul | ≈ 40 Ko par trame (leger : ≈ 15 Ko), servies à part |

(*) Le reste des tâches longues vient presque entièrement du dessin WebGL
du radar émulé par logiciel (≈ 250–450 ms par image, profil CPU : moins de
1 % de JavaScript). Sur un vrai processeur graphique, ce coût disparaît
dans les deux versions. Le clic Précipitations attend maintenant aussi la
fin du fond calculé par le Worker ; à valider sur un vrai appareil.

Fourchettes : plusieurs passages, dont certains avec d'autres essais en parallèle.

## 2. Fidélité visuelle (mesurée)

| Tableau | Écart moyen par pixel (0–255) | Commentaire |
|---|---|---|
| Températures | 0,53 | identique à l'œil |
| Conditions | 0,44 | identique à l'œil |
| Précipitations | 2,56 | animation à une minute près dans les deux captures |
| Satellite, image figée, ordinateur | 3,9 (p99 : 19) | même observation ; la netteté est appliquée à la résolution de l'image et non plus à celle de l'écran |
| Satellite, image figée, mobile | 6,7 (p99 : 36) | profil léger (1280 px) : un peu plus doux, invisible à la taille d'un téléphone |

Correction de couleur du serveur comparée au filtre du navigateur
(Chromium, même image) : écart moyen 0,31, maximum 2 niveaux.

Différence visible voulue : le bouton de défilement du pied de page
contient enfin son icône (HTML d'origine mal fermé).

## 3. Robustesse (testé)

| Essai | Résultat |
|---|---|
| Synchronisation vidéo / frise (25 relevés en lecture) | écart 0 ms entre l'heure affichée et l'image présentée |
| Pause pendant la lecture | vidéo masquée, image exacte de l'observation, « Observation » |
| Perte du contexte WebGL simulée (`WEBGL_lose_context`) | contexte rétabli, trames rechargées progressivement depuis le cache |
| Navigation entre journées | sans erreur |
| API satellite injoignable | « Satellite inaccessible » + Réessayer |
| Lecture prolongée 2 min 30 avec défilement automatique | tas JavaScript stable (9,7–10,0 Mo) |
| Tests Django | 53 tests (40 anciens, 13 nouveaux) : tous réussis |

## 4. Vidéo ou images : comparaison

Même scénario (ordinateur), lecteur vidéo vs lecteur d'images optimisé :

| | Vidéo | Images |
|---|---|---|
| Octets transférés | 8,9 Mo | 21,9 Mo |
| Fermeture de l'ouverture | 1,8 s | 2,0 s |
| Tâches longues | 15,8 s | 15,4 s |
| Stockage par observation (standard) | ≈ 0,29 Mo | ≈ 0,68 Mo |

La vidéo transfère 2,5 fois moins pour la même lecture, et le décodage
vidéo est matériel sur les vrais appareils (logiciel ici). Elle est donc
le mode par défaut, avec retour automatique aux images en cas d'erreur ou
de blocage du chargement (> 8 s). **Cette décision doit être confirmée sur
de vrais téléphones et en 4G réelle** (`?lecteur=images` pour comparer).

## 5. Classement des constats

**Mesuré ici** : tableaux 1 à 4 ci-dessus ; tailles des fichiers dérivés ;
fidélité des couleurs.

**Estimé** : place disque en production (≈ 0,35 Go/jour de dérivés pour
trois profils) ; durée d'encodage sur le serveur ; taux de compression
des vraies images GeoColour (les images d'essai sont synthétiques).

**Testé** : tout le tableau 3 ; idempotence, observation tardive, journées
de 23/25 h, requêtes partielles, purge (tests automatisés).

**Non testé** : perte d'un contexte canvas 2D (impossible à provoquer
ici ; le code de reprise existe) ; passage réel de minuit ; Safari,
Firefox (seul Chromium est disponible ici) ; requestVideoFrameCallback
absent (Firefox < 132 : repli sur currentTime, non essayé).

**À valider sur le serveur** : FFmpeg et libx264, chemins réels, Nginx
(Range, `Content-Encoding` des trames OPERA), charge de `hko-derives`
pendant les collectes, place disque sur 48 h, Redis.

**À valider sur de vrais téléphones** : fluidité de la vidéo, décodage
matériel, mémoire sur 1 h, échauffement, 4G réelle, choix automatique du
profil (léger/standard/riche).

## 6. Ce qui n'a pas été fait

- Aucun push, aucun déploiement, aucune modification du serveur, aucune donnée effacée.
- Récapitulatifs de 30 s : non développés (seulement préparés, voir le guide).
- Le radar Météo-France d'origine (`?opera=0`) garde son ancien format JSON (hors du parcours par défaut).
- Pas de nouvelle minuterie pour `collecter_geocolour` ni `collecter_opera` : leur planification réelle en production est inconnue (question posée).
