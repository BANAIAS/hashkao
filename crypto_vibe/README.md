# HKO Crypto — Data visualisation et prévisions expérimentales

**Les données des cryptomonnaies mises en scène comme une chaîne d'information financière.**

🌐 **[Voir HKO Crypto](https://hashkao.com)**

HKO Crypto est une plateforme de visualisation de données financières qui associe cours des cryptomonnaies, graphiques interactifs, analyse des discussions sur Reddit, actualités et prévisions de prix à une heure.

Le projet est né d'une idée de motion design : appliquer les principes de l'habillage télévisuel à une interface de données vivantes. Les informations sont organisées pour être comprises rapidement, avec des cartes, des graphiques et des bandeaux défilants inspirés des chaînes d'information.

Il constitue également un terrain d'expérimentation autour de la collecte de données, du traitement automatique du langage et de la prévision de séries temporelles.

---

## Ce que l'on voit sur le site

| Élément | Fonction |
|---|---|
| Bandeau supérieur | Défilement des cotations et variations d'un ensemble élargi de cryptomonnaies |
| Cartes centrales | Suivi de dix cryptomonnaies, avec prix, sentiment Reddit et prévision horaire |
| Graphique interactif | Évolution historique des cours de la cryptomonnaie sélectionnée |
| Analyse de sentiment | Indicateur positif, négatif ou neutre calculé à partir de publications Reddit |
| Prévision à une heure | Estimation expérimentale du prochain cours, accompagnée d'un indicateur de confiance |
| Bandeaux d'actualités | Diffusion de titres financiers et de publications Reddit sous forme de bandeaux animés |

## Architecture et collecte des données

### Deux sources de prix complémentaires

La plateforme utilise deux API de marché pour répondre à deux besoins différents.

**CoinGecko — Les cryptomonnaies principales**

CoinGecko fournit les prix en euros utilisés pour le suivi des dix cryptomonnaies principales et leurs historiques.

Les requêtes sont regroupées afin de récupérer plusieurs cours en un seul appel. Un système de cache évite les sollicitations répétées de l'API.

**CoinCap — Le bandeau de cotations**

CoinCap alimente un ensemble plus large de cryptomonnaies destiné au bandeau supérieur.

Les données sont conservées dans une structure distincte, adaptée à l'affichage des prix et de leurs variations.

Cette séparation permet de maintenir deux usages graphiques différents tout en répartissant les demandes entre les fournisseurs.

### Gestion des quotas et des caches

L'utilisation des offres gratuites des API a constitué une contrainte de conception.

Plusieurs mécanismes ont été développés pour réduire les appels :

- Regroupement des demandes de prix.
- Mise en cache temporaire des réponses.
- Conservation d'historiques en base de données.
- Contrôle des quotas et gestion des erreurs HTTP.
- Réutilisation des dernières données disponibles lorsque la collecte échoue.

L'objectif est de maintenir une interface régulièrement actualisée sans multiplier inutilement les requêtes externes.

## Analyse des discussions Reddit

HKO Crypto collecte des publications issues de communautés Reddit consacrées aux cryptomonnaies.

Les recherches sont adaptées à chaque actif à partir de son nom, de ses symboles et de différentes appellations.

Les textes sont ensuite analysés avec **TextBlob**, qui attribue un score de polarité. Une moyenne permet de classer le sentiment observé en trois catégories :

**Positif · Neutre · Négatif**

Ces résultats sont affichés dans les cartes des cryptomonnaies, avec leur score numérique.

Cette analyse représente une mesure simplifiée du sentiment exprimé dans les publications collectées, et non une mesure exhaustive de l'opinion du marché.

## Prévisions expérimentales à une heure

Le projet intègre un système de prévision des prix utilisant **Prophet**, une bibliothèque de modélisation des séries temporelles.

Le traitement exploite les historiques de prix enregistrés en base de données. Il prévoit également l'intégration du score de sentiment Reddit comme variable explicative.

Le pipeline comprend notamment :

1. La récupération des observations historiques.
2. La préparation et le nettoyage des séries temporelles.
3. Le traitement de certaines valeurs atypiques.
4. L'entraînement du modèle Prophet.
5. La génération d'une estimation à un horizon de 60 minutes.
6. Le calcul d'un indicateur de confiance à partir de l'incertitude estimée.

Des mécanismes de repli permettent de produire une réponse lorsque les données sont insuffisantes ou que la modélisation échoue.

**Ces prévisions sont expérimentales.** Elles servent à explorer la combinaison de données financières et textuelles, et ne constituent pas des recommandations d'investissement. L'indicateur de confiance affiché ne doit pas être interprété comme une probabilité de réussite garantie.

## Actualités et habillage télévisuel

L'interface reprend plusieurs codes visuels des chaînes d'information :

- Un bandeau supérieur de cotations en mouvement continu.
- Des cartes synthétiques mettant en avant les informations essentielles.
- Un graphique central qui évolue selon la sélection.
- Des bandeaux inférieurs consacrés aux actualités financières et aux publications Reddit.

Les titres sont récupérés par le serveur puis affichés dans des éléments animés et cliquables.

Le principe est de transformer des flux de données hétérogènes en une composition graphique cohérente, avec une hiérarchie visuelle et un rythme de lecture.

## Technologies

| Domaine | Technologies |
|---|---|
| Backend | Python, Django |
| Frontend | JavaScript, HTML, CSS |
| Graphiques | Chart.js |
| Collecte financière | API CoinGecko, API CoinCap |
| Données communautaires | API Reddit, PRAW |
| Analyse de sentiment | TextBlob |
| Prévisions | Prophet, Pandas, NumPy |
| Stockage | Modèles Django, base de données |
| Optimisation | Cache, regroupement des requêtes, gestion des quotas |

## Démarche

HKO Crypto réunit trois domaines de travail :

**Motion design** — Concevoir une interface qui emprunte à la télévision sa lisibilité, ses mouvements et sa hiérarchie de l'information.

**Data analytics** — Collecter, structurer, historiser et analyser des données provenant de plusieurs sources.

**Développement interactif** — Relier les traitements Python à une interface web dynamique, capable d'actualiser et de présenter les résultats.

Le projet est évolutif. Il sert autant à expérimenter des méthodes d'analyse et de prédiction qu'à rechercher de nouvelles façons de représenter visuellement les données.

---

**HKO Crypto — Un projet personnel à la rencontre du motion design, de l'analyse de données et du développement web.**
