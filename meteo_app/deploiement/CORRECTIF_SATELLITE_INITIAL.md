# Correctif — fond bleu à l'ouverture du tableau Satellite

Base : branche `refonte-meteo`, commit `0c6803b`.

## Cause (constatée en production le 20 novembre 2026 vers 23 h)

1. `api/satellite/` annonce, pour chaque observation, l'image adaptée
   `derives/geocolour/<profil>/…webp`. Pour les observations les plus
   récentes, ce fichier n'existe pas encore : production des dérivés en
   retard (la vidéo s'arrêtait à 20 h 20 UTC, les images adaptées
   manquaient de 20 h 30 à 21 h 50 UTC, alors que les originaux étaient là).
2. Nginx répond alors son propre 404 : le passage à Django, qui devait
   fabriquer l'image à la demande, ne se fait pas.
3. Le lecteur n'avait qu'une source par observation : sur erreur, il
   écrivait un avertissement en console et laissait la toile vide. Le fond
   bleu de la scène apparaissait. Relancer le dessin ne pouvait rien changer :
   la même adresse renvoyait le même 404.
4. En lecture, la vidéo (présente jusqu'à 20 h 20) s'affichait. Au retour sur
   la dernière observation, l'image fixe échouait encore, mais la vidéo
   restait visible : on voyait l'image de 20 h 20 sous l'étiquette « 22 h 30 ».

## Correction

- `hko_satellite.js` : deux sources par observation (image adaptée, puis
  original du collecteur, corrigé à l'affichage avec l'ancien filtre). Un
  échec est mémorisé une minute. L'image est reposée après un recadrage.
  Changer de jour vide la toile. Si aucune source ne répond, un état
  d'erreur explicite s'affiche. La vidéo n'est gardée à l'arrêt que si elle
  montre bien l'observation demandée.
- `hko.js` : message « Image satellite indisponible » si aucune source ne
  répond. Le nouvel essai passe par l'actualisation existante, toutes les
  30 s (aucune minuterie ajoutée).
- `views_ressources.py` : champ `derivee` par observation (l'image adaptée
  existe-t-elle ?). Le navigateur prend directement l'original sans
  passer par un 404.
- `hko_derives.py` : les images fixes sont produites avant les vidéos, les
  plus récentes d'abord.
- `nginx_hko_refonte.conf` : `try_files … @hko_django` à la place de
  `error_page` pour le passage à Django.
- `tests_refonte.py` : test du champ `derivee`.

## À vérifier sur le serveur (production des dérivés en retard)

    systemctl list-timers | grep -i derives
    journalctl -u hko-derives.service -n 100 --no-pager
    ls -la /opt/hashkao/meteo_app/data/hko/publication/derives/geocolour/haute | tail -3
    sudo nginx -T | grep -n -A12 "derives"

## Tests

Locaux (avant publication) :

    python manage.py test meteo_app           # 54 tests
    python manage.py hko_derives --jours 1
    python manage.py runserver

1. Ouvrir `/meteo/` : la dernière image s'affiche dès l'ouverture, la frise est en pause sur la dernière observation.
2. Supprimer l'image adaptée de la dernière observation dans `publication/derives/geocolour/<profil>/`, puis actualiser : l'image s'affiche toujours (original).
3. Lecture, puis pause, puis curseur en fin de frise : l'image affichée est celle de la dernière observation.
4. Changer de jour (précédent, puis suivant) : aucune image de l'autre jour ne reste affichée.
5. Redimensionner la fenêtre pendant l'ouverture : l'image reste affichée.
6. Précipitations, Températures, Conditions : comportement inchangé (lecture automatique du radar).

En production, après publication :

1. `curl -s https://hashkao.com/meteo/api/satellite/ | grep -o '"derivee":false' | wc -l` (images adaptées encore absentes).
2. Ouverture de la page : image immédiate, y compris juste après une nouvelle collecte.
3. Outils de développement > Réseau : aucune erreur 404 sur `derives/geocolour` au chargement.
