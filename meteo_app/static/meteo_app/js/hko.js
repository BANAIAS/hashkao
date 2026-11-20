/* ==========================================================================
   HKO Météo — expérience principale (quatre tableaux)

   Chaque tableau a son propre fond et sa propre logique graphique :

     Températures    relief bleuté, quadrillage, zones de températures
     Précipitations  fond sombre, radar animé
     Conditions      aplats de couleurs, pictogrammes
     Satellite       vue de la Terre (Blue Marble), nuages observés animés

   Refonte technique (comportement et rendu inchangés) :
     - calculs lourds (relief, mer, températures, radar) dans un Worker
       (hko_calcul.js), résultats gardés : changer d'ambiance horaire ne
       recalcule plus le relief ;
     - contours projetés une fois (Path2D), redessinés par simple
       transformation à chaque taille d'écran ;
     - satellite : images adaptées à l'écran et vidéo H.264 (hko_satellite.js),
       correction de couleur déjà appliquée par le serveur ;
     - radar OPERA en trames binaires, chargées et préparées progressivement ;
     - démarrage par le satellite, les autres tableaux préparés ensuite ;
     - boucle d'animation arrêtée quand rien ne bouge ;
     - reprise après perte du contexte graphique ;
     - profils d'appareil (léger, standard, riche).

   Organisation du fichier :
     1. État et réglages
     2. Ouverture : chargement réel et jauge
     3. Cadrage (projection D3)
     4. Fonds de carte (un par tableau, dessinés à la demande)
     5. Tableau 1 — températures
     6. Tableau 2 — précipitations (radar)
     7. Tableau 3 — conditions météo (pictogrammes)
     8. Tableau 4 — satellite
     9. Lecture des animations (frise temporelle)
    10. Habillage : bandeau, légendes, bulle, états indisponibles
    11. Navigation : tableaux, défilement automatique, jours
    12. Démarrage
   ========================================================================== */

(() => {
"use strict";

// ---------------------------------------------------------------------------
// 1. État et réglages
// ---------------------------------------------------------------------------

const scene = document.getElementById("scene");
const $ = id => document.getElementById(id);

const URL_API = scene.dataset.apiCarte;
const URL_CONDITIONS = scene.dataset.apiConditions;
const URL_ANIMATION = scene.dataset.apiAnimation;
const URL_SATELLITE = scene.dataset.apiSatellite;
const URL_RADAR = scene.dataset.apiRadar;
const URL_JOURNAL = scene.dataset.apiJournal;
const SCRIPT_CALCUL = scene.dataset.scriptCalcul;
const SCRIPT_ANIME = scene.dataset.scriptAnime;
const STATIQUE = scene.dataset.statique;
const PARAMETRES = new URLSearchParams(window.location.search);

const TABLEAUX = ["satellite", "temperatures", "precipitations", "conditions"];
const DUREE_TABLEAU = 15000;        // défilement automatique
const REPRISE_AUTO = 60000;         // après un choix manuel
const RAFRAICHISSEMENT = 6 * 60000; // nouvelles observations du jour
const RAFRAICHISSEMENT_SATELLITE = 30000;

// Cadre géographique à faire tenir à l'écran : la France métropolitaine
const CADRE_FRANCE = {
    type: "MultiPoint",
    coordinates: [[-5.25, 41.3], [9.7, 51.15]]
};

// Emprise des images de fond (Mercator), voir preparer_fonds_cartes.py
const FOND_EMPRISE = { ouest: -16, sud: 34, est: 22, nord: 60 };

// Gradient thermique vertical utilisé pour l'interpolation (°C par mètre)
const GRADIENT_ALTITUDE = 0.0045;

// Stations d'altitude écartées des valeurs affichées (peu représentatives)
const ALTITUDE_MAX_AFFICHEE = 600;

// Couleurs des températures (°C -> couleur). Échelle absolue : la carte
// passe d'elle-même des bleus de l'hiver aux orangés de l'été.
const PALETTE_TEMPERATURE = [
    [-15, "#3d1a78"], [-10, "#4b3aa8"], [-5, "#3b6fd0"], [0, "#5aa9e6"],
    [4, "#8fd3ec"], [8, "#c8ead0"], [11, "#eaf0a6"], [14, "#f6dd78"],
    [18, "#f7c252"], [23, "#f39b3a"], [28, "#e8662d"], [33, "#c8352a"],
    [38, "#9b1730"], [44, "#5e0b2a"]
];

// Fonds en relief : couleurs du sol selon l'altitude, de la mer selon la
// profondeur (0 abysses, 1 plateau continental), force de l'ombrage.
const STYLES_RELIEF = {
    temperatures: {
        terre: [[0, "#608fbe"], [300, "#6899c8"], [800, "#76a3d0"], [1500, "#85afd8"],
                [2500, "#96bcdf"], [3500, "#aacbe7"]],
        sansRelief: [96, 143, 190],
        mer: [[0, "#0b2f63"], [0.6, "#14457f"], [1, "#2a6aaa"]],
        ombre: 1.5, ombreMin: 0.45, ombreMax: 1.18,
        vignette: 0.32
    },
    precipitations: {
        terre: [[0, "#262a30"], [500, "#2d3138"], [1500, "#3d424a"], [3000, "#5b6069"]],
        sansRelief: [38, 42, 48],
        mer: [[0, "#080d15"], [0.7, "#0d1622"], [1, "#132233"]],
        ombre: 1.5, ombreMin: 0.5, ombreMax: 1.55,
        vignette: 0.4
    }
};

// Villes repères du radar (longitude, latitude)
const VILLES = [
    ["Paris", 2.35, 48.86], ["Lyon", 4.84, 45.76], ["Marseille", 5.37, 43.3],
    ["Bordeaux", -0.58, 44.84], ["Toulouse", 1.44, 43.6], ["Nantes", -1.55, 47.22],
    ["Lille", 3.06, 50.63], ["Strasbourg", 7.75, 48.58], ["Rennes", -1.68, 48.11],
    ["Brest", -4.49, 48.39], ["Nice", 7.26, 43.7], ["Montpellier", 3.88, 43.61],
    ["Limoges", 1.26, 45.83], ["Clermont-Ferrand", 3.08, 45.78], ["Dijon", 5.04, 47.32],
    ["Rouen", 1.1, 49.44], ["Tours", 0.69, 47.39], ["Ajaccio", 8.74, 41.93],
    ["Perpignan", 2.9, 42.7], ["Reims", 4.03, 49.26], ["La Rochelle", -1.15, 46.16],
    ["Grenoble", 5.72, 45.19], ["Caen", -0.37, 49.18], ["Metz", 6.18, 49.12]
];

const etat = {
    largeur: 0,
    hauteur: 0,
    echelle: 1,          // pixels de canvas par pixel CSS
    projection: null,
    pays: null,
    departements: null,
    relief: null,
    bathymetrie: null,   // image (Mercator) de la profondeur des mers
    imageSatellite: null,
    altitudes: null,     // altitude par pixel du fond
    lumiere: null,       // éclairage du relief par pixel (0,7 = terrain plat)
    ombres: null,        // facteur d'ombrage appliqué sous les températures
    masqueTerres: null,  // canvas : terres en noir
    fondsAJour: new Set(),
    jours: new Map(),    // réponses de l'API par jour
    donnees: null,       // réponse du jour affiché
    jour: null,
    tableau: "satellite",
    auto: true,
    rotation: 0,
    radar: undefined,    // image radar publiée ; undefined : pas encore demandée
    radarImage: null,
    radarCouverture: null,
    conditions: new Map(), // cartes fusionnées par jour
    conditionsPretes: false,
    nuitConditions: false,
    animations: { radar: new Map(), satellite: new Map() },   // séquences par jour
    rendus: { radar: undefined, satellite: undefined },
    pasBande: 2,
    ouverte: false,
    generation: 0,          // change à chaque recadrage : résultats anciens ignorés
    versionAmbiance: 0,     // change avec l'heure des observations (fond des températures)
    cadreCalcul: null       // promesse : Worker prêt pour la taille d'écran courante
};

const reduitMouvement = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------------------
// Journal du navigateur : incidents envoyés au serveur (sans donnée personnelle)
// ---------------------------------------------------------------------------

let journalEnvois = 0;
function journal(evenement) {
    if (!URL_JOURNAL || journalEnvois >= 20) return;
    journalEnvois++;
    const corps = JSON.stringify({ ...evenement, profil: PROFIL.nom, page: location.pathname });
    try {
        if (!navigator.sendBeacon || !navigator.sendBeacon(URL_JOURNAL, new Blob([corps], { type: "application/json" }))) {
            fetch(URL_JOURNAL, { method: "POST", body: corps, keepalive: true }).catch(() => {});
        }
    } catch (e) { /* le journal ne doit jamais gêner la carte */ }
}

// ---------------------------------------------------------------------------
// Profil de l'appareil
//
//   léger     petite mémoire, peu de processeurs, économie de données ou
//             connexion lente, ou page déjà trop lente sur cet appareil
//   standard  le cas courant
//   riche     ordinateur puissant : satellite en pleine résolution
//
// ?profil=leger|standard|riche force le choix (essais).
// ---------------------------------------------------------------------------

const CLE_PROFIL = "hko-profil-lent";

function profilAppareil() {
    const force = PARAMETRES.get("profil");
    const tactile = window.matchMedia("(pointer: coarse)").matches;
    const memoire = navigator.deviceMemory || (tactile ? 4 : 8);
    const coeurs = navigator.hardwareConcurrency || 4;
    const connexion = navigator.connection || {};
    const lente = connexion.saveData || /(^|-)2g|3g/.test(connexion.effectiveType || "");
    let rapporte = false;
    try {
        const v = JSON.parse(localStorage.getItem(CLE_PROFIL) || "null");
        rapporte = Boolean(v && v.jusqua > Date.now());
    } catch (e) { /* stockage indisponible */ }

    let nom = "standard";
    if (memoire <= 2 || coeurs <= 2 || lente || rapporte || (tactile && memoire <= 3 && coeurs <= 4)) nom = "leger";
    else if (!tactile && memoire >= 8 && coeurs >= 8) nom = "riche";
    if (["leger", "standard", "riche"].includes(force)) nom = force;
    return { nom, tactile, lente: Boolean(lente) };
}

const PROFIL = profilAppareil();

// Appareil trop lent pour le profil choisi : le suivant sera plus léger (7 jours)
function surveillerLenteur() {
    if (PROFIL.nom === "leger" || typeof PerformanceObserver === "undefined") return;
    let lourdes = 0;
    try {
        const observateur = new PerformanceObserver(liste => {
            if (!etat.ouverte) return;
            for (const t of liste.getEntries()) if (t.duration > 400) lourdes++;
            if (lourdes >= 4) {
                observateur.disconnect();
                try {
                    localStorage.setItem(CLE_PROFIL, JSON.stringify({ jusqua: Date.now() + 7 * 86400000 }));
                } catch (e) { /* stockage indisponible */ }
                journal({ type: "profil_allege", lourdes });
            }
        });
        observateur.observe({ type: "longtask", buffered: false });
        setTimeout(() => observateur.disconnect(), 120000);
    } catch (e) { /* longtask non pris en charge */ }
}

const attendreImage = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

function echapper(texte) {
    return String(texte ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

function nombre(valeur, decimales = 0) {
    return Number(valeur).toLocaleString("fr-FR", {
        minimumFractionDigits: decimales,
        maximumFractionDigits: decimales
    });
}

// Formats de date créés une seule fois (leur création est coûteuse)
const FORMATS = {
    heure: new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "numeric", minute: "2-digit" }),
    jour: new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }),
    libelle: new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }),
    date: new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }),
    heureMinute: new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
    heure24: new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" })
};
const memoHeures = new Map();

function heureParis(iso) {
    const cle = typeof iso === "string" ? iso : new Date(iso).toISOString();
    const connue = memoHeures.get(cle);
    if (connue) return connue;
    const parties = FORMATS.heure.formatToParts(new Date(iso));

    const h = parties.find(p => p.type === "hour").value;
    const m = parties.find(p => p.type === "minute").value;

    const texte = `${Number(h)} h ${m}`;
    if (memoHeures.size > 2000) memoHeures.clear();
    memoHeures.set(cle, texte);
    return texte;
}

function jourParis(iso) {
    // AAAA-MM-JJ du jour civil à Paris
    return FORMATS.jour.format(new Date(iso));
}

function libelleJour(jour) {
    const [a, m, j] = jour.split("-").map(Number);
    const texte = FORMATS.libelle.format(new Date(Date.UTC(a, m - 1, j)));

    return texte.charAt(0).toUpperCase() + texte.slice(1);
}

function decalerJour(jour, pas) {
    const [a, m, j] = jour.split("-").map(Number);
    return new Date(Date.UTC(a, m - 1, j + pas)).toISOString().slice(0, 10);
}

function lissage(a, b, x) {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}

function rgb(hex) {
    const c = d3.rgb(hex);
    return [c.r, c.g, c.b];
}

// ---------------------------------------------------------------------------
// 2. Ouverture : chargement réel et jauge
// ---------------------------------------------------------------------------

// Chaque étape pèse dans la jauge selon son coût réel approximatif.
const etapes = {
    pays:         { poids: 8,  part: 0, nom: "Contours de l'Europe" },
    departements: { poids: 12, part: 0, nom: "Contours de la France" },
    relief:       { poids: 26, part: 0, nom: "Relief" },
    bathymetrie:  { poids: 4,  part: 0, nom: "Fonds marins" },
    observations: { poids: 20, part: 0, nom: "Observations Météo-France" },
    fond:         { poids: 14, part: 0, nom: "Dessin de la carte" },
    champ:        { poids: 16, part: 0, nom: "Carte des températures" }
};

// Taille approximative des fichiers (octets), si le serveur ne l'annonce pas
const TAILLE_ESTIMEE = {
    pays: 400e3, departements: 1.3e6, relief: 7e6, observations: 450e3
};

function progresser(cle, part) {
    const etape = etapes[cle];
    etape.part = Math.max(etape.part, Math.min(part, 1));

    let total = 0, fait = 0;
    for (const e of Object.values(etapes)) {
        total += e.poids;
        fait += e.poids * e.part;
    }

    const fraction = fait / total;

    $("intro-trait").style.transform = `scaleX(${fraction})`;
    $("intro-pourcent").textContent = `${Math.round(fraction * 100)} %`;

    // Libellé : la première étape encore en cours
    const enCours = Object.values(etapes).find(e => e.part < 1);
    $("intro-etape").textContent = enCours ? enCours.nom : "Carte prête";
}

async function telecharger(url, cle) {
    const reponse = await fetch(url);

    if (!reponse.ok) {
        const erreur = new Error(`${url} : ${reponse.status}`);
        erreur.statut = reponse.status;
        throw erreur;
    }

    const annonce = Number(reponse.headers.get("Content-Length")) || 0;
    const compresse = reponse.headers.get("Content-Encoding");
    const attendu = annonce && !compresse ? annonce : (TAILLE_ESTIMEE[cle] || 1e6);

    if (!reponse.body) {
        return new Uint8Array(await reponse.arrayBuffer());
    }

    const lecteur = reponse.body.getReader();
    const morceaux = [];
    let recu = 0;

    for (;;) {
        const { done, value } = await lecteur.read();
        if (done) break;
        morceaux.push(value);
        recu += value.length;
        if (cle) progresser(cle, Math.min(recu / attendu, 0.95));
    }

    const octets = new Uint8Array(recu);
    let position = 0;
    for (const morceau of morceaux) {
        octets.set(morceau, position);
        position += morceau.length;
    }

    return octets;
}

async function lireJson(octets) {
    // Fichier .gz servi tel quel (sans en-tête de compression) : on le décompresse ici.
    if (octets[0] === 0x1f && octets[1] === 0x8b) {
        if (typeof DecompressionStream === "undefined") {
            throw new Error("Décompression gzip indisponible dans ce navigateur.");
        }
        const flux = new Blob([octets]).stream()
            .pipeThrough(new DecompressionStream("gzip"));
        return new Response(flux).json();
    }
    return JSON.parse(new TextDecoder().decode(octets));
}

// Charge la version allégée d'une ressource, ou à défaut le fichier d'origine.
async function chargerRessource(cle, allege, origine) {
    let octets;
    try {
        octets = await telecharger(STATIQUE + allege, cle);
    } catch (erreur) {
        if (erreur.statut !== 404) throw erreur;
        console.info(`HKO : ${allege} absent, utilisation de ${origine}. ` +
                     "Lancez « python manage.py preparer_hko » pour alléger le chargement.");
        octets = await telecharger(STATIQUE + origine, cle);
    }
    const json = await lireJson(octets);
    progresser(cle, 1);
    return json;
}

function chargerImage(url) {
    return new Promise((resoudre, rejeter) => {
        const image = new Image();
        image.decoding = "async";
        image.onload = () => resoudre(image);
        image.onerror = () => rejeter(new Error(`Image illisible : ${url}`));
        image.src = url;
    });
}

function normaliserRelief(source) {
    // Accepte le format allégé (tableau à plat) et le format d'origine (lignes).
    const { largeur, hauteur } = source;
    const altitudes = new Float32Array(largeur * hauteur);

    if (Array.isArray(source.altitudes[0])) {
        for (let l = 0; l < hauteur; l++) {
            const ligne = source.altitudes[l];
            for (let c = 0; c < largeur; c++) {
                const v = ligne[c];
                altitudes[l * largeur + c] = v === null ? NaN : v;
            }
        }
    } else {
        for (let i = 0; i < altitudes.length; i++) {
            const v = source.altitudes[i];
            altitudes[i] = v === null ? NaN : v;
        }
    }

    return {
        largeur, hauteur, altitudes,
        resolution: source.resolution,
        ouest: source.bounds[0], sud: source.bounds[1],
        est: source.bounds[2], nord: source.bounds[3]
    };
}

function fermerIntro() {
    if (etat.ouverte) return;
    etat.ouverte = true;
    $("intro").classList.add("terminee");
    planifierDefilement();
}

// ---------------------------------------------------------------------------
// 3. Cadrage
// ---------------------------------------------------------------------------

const CANVAS_2D = ["fond-temperatures", "fond-precipitations", "fond-conditions",
                   "fond-satellite", "voile-satellite", "champ", "hachures"];
const CANVAS_GL = ["gl-radar"];

function cadrer() {
    const cadre = scene.getBoundingClientRect();

    etat.largeur = Math.max(200, Math.round(cadre.width));
    etat.hauteur = Math.max(200, Math.round(cadre.height));

    // Marges réservées à l'habillage : la France reste dégagée.
    const etroit = etat.largeur < 760;
    const haut = etroit ? 104 : 74;
    const bas = etroit
        ? Math.min(270, etat.hauteur * 0.38)
        : Math.min(150, etat.hauteur * 0.2);
    const cote = etroit ? 8 : Math.min(60, etat.largeur * 0.04);

    etat.projection = d3.geoMercator().fitExtent(
        [[cote, haut], [etat.largeur - cote, Math.max(haut + 120, etat.hauteur - bas)]],
        CADRE_FRANCE
    );

    // Résolution des canvas : nette sur écran dense, sans excès de pixels
    const mobile = window.matchMedia("(pointer: coarse)").matches;
    const dpr = window.devicePixelRatio || 1;
    const pixelsMax = PROFIL.nom === "leger" ? 0.75e6 : mobile ? 1e6 : 2.6e6;
    const budget = Math.sqrt(pixelsMax / (etat.largeur * etat.hauteur));

    etat.echelle = Math.max(1, Math.min(dpr, mobile ? 1.25 : 2, budget));

    for (const id of [...CANVAS_2D, ...CANVAS_GL]) {
        const canvas = $(id);
        canvas.width = Math.round(etat.largeur * etat.echelle);
        canvas.height = Math.round(etat.hauteur * etat.echelle);
    }

    d3.select("#traits").attr("viewBox", `0 0 ${etat.largeur} ${etat.hauteur}`);

    etat.fondsAJour.clear();
    etat.masqueTerres = null;
    etat.cadreCalcul = null;          // le Worker recalcule le relief à cette taille
    etat.generation++;
    if (etat.rendus.satellite) etat.rendus.satellite.cadrer();
}

// Largeur de la France à l'écran : sert d'unité pour les tailles de texte.
function largeurFrance() {
    const p = etat.projection;
    return p([9.7, 46])[0] - p([-5.25, 46])[0];
}

// ---------------------------------------------------------------------------
// 4. Fonds de carte
//
// Les quatre fonds sont des canvas superposés ; seul celui du tableau
// affiché est visible. Chacun est dessiné la première fois qu'on en a
// besoin, puis après un changement de taille.
// ---------------------------------------------------------------------------

function tableCouleurs(palette, debut, fin, pas) {
    const echelle = d3.scaleLinear()
        .domain(palette.map(p => p[0]))
        .range(palette.map(p => p[1]))
        .interpolate(d3.interpolateRgb)
        .clamp(true);

    const taille = Math.round((fin - debut) / pas) + 1;
    const table = new Uint8Array(taille * 3);

    for (let i = 0; i < taille; i++) {
        const c = d3.rgb(echelle(debut + i * pas));
        table[i * 3] = c.r;
        table[i * 3 + 1] = c.g;
        table[i * 3 + 2] = c.b;
    }

    return { table, debut, pas, taille };
}

let teintesTemperature = null;
const teintesRelief = {};
const teintesMer = {};

// Contours projetés une seule fois, dans un repère Mercator fixe (échelle
// 1000, sans translation). À chaque dessin, une transformation les amène à
// la taille de l'écran : plus de reprojection D3 à chaque fois.
const ECHELLE_CHEMINS = 1000;
const chemins = {};

function construireChemins() {
    const unite = d3.geoMercator().scale(ECHELLE_CHEMINS).translate([0, 0]);
    const tracer = geometrie => {
        const chemin = new Path2D();
        d3.geoPath(unite, chemin)(geometrie);
        return chemin;
    };
    chemins.pays = tracer({ type: "FeatureCollection", features: etat.pays.features });
    chemins.departements = tracer(etat.departements);
    chemins.terres = new Path2D();
    chemins.terres.addPath(chemins.pays);
    chemins.terres.addPath(chemins.departements);
}

// Place le contexte dans le repère des chemins ; renvoie le facteur
// (pixels de canvas par unité de chemin) pour régler les épaisseurs.
function repereChemins(ctx) {
    const k = etat.echelle, p = etat.projection;
    const f = p.scale() / ECHELLE_CHEMINS;
    const [tx, ty] = p.translate();
    ctx.setTransform(k * f, 0, 0, k * f, k * tx, k * ty);
    return k * f;
}

// Épaisseur de trait en pixels CSS, quelle que soit la transformation
function epaisseur(ctx, largeur) {
    ctx.lineWidth = largeur * etat.echelle / ctx.getTransform().a;
}

function nouveauCanvas(W, H) {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    return c;
}

// Masque des terres à la taille des canvas ; le trait referme les joints
function masqueTerres() {
    if (etat.masqueTerres) return etat.masqueTerres;
    const W = $("champ").width, H = $("champ").height;
    const masque = nouveauCanvas(W, H);
    const cm = masque.getContext("2d");
    repereChemins(cm);
    cm.fillStyle = "#000";
    cm.fill(chemins.terres);
    epaisseur(cm, 0.8);
    cm.strokeStyle = "#000";
    cm.stroke(chemins.terres);
    etat.masqueTerres = masque;
    return masque;
}

// Rectangle (en pixels de canvas) où poser une image de fond Mercator
function cadreImageFond() {
    const k = etat.echelle;
    const [x0, y0] = etat.projection([FOND_EMPRISE.ouest, FOND_EMPRISE.nord]);
    const [x1, y1] = etat.projection([FOND_EMPRISE.est, FOND_EMPRISE.sud]);
    return [x0 * k, y0 * k, (x1 - x0) * k, (y1 - y0) * k];
}

// ---------------------------------------------------------------------------
// Calculs lourds : Worker (hko_calcul.js), ou la page à défaut
// ---------------------------------------------------------------------------

const calcul = (() => {
    let worker = null, numero = 0, pret = null;
    const attentes = new Map();
    if (window.Worker && SCRIPT_CALCUL && PARAMETRES.get("worker") !== "0") {
        try {
            worker = new Worker(SCRIPT_CALCUL);
            worker.onmessage = e => {
                const a = attentes.get(e.data.id);
                if (!a) return;
                attentes.delete(e.data.id);
                e.data.erreur ? a.rejeter(new Error(e.data.erreur)) : a.resoudre(e.data.resultat);
            };
            worker.onerror = e => {
                console.warn("HKO : Worker indisponible —", e.message);
                journal({ type: "worker", message: String(e.message).slice(0, 200) });
                worker = null;
                for (const a of attentes.values()) a.rejeter(new Error("Worker arrêté"));
                attentes.clear();
            };
        } catch (e) {
            worker = null;
        }
    }
    const poster = (message, transfert) => new Promise((resoudre, rejeter) => {
        const id = ++numero;
        attentes.set(id, { resoudre, rejeter });
        worker.postMessage({ id, ...message }, transfert || []);
    });
    if (worker && SCRIPT_ANIME) pret = poster({ script: new URL(SCRIPT_ANIME, location.href).href }).catch(() => null);

    return {
        get parallele() { return Boolean(worker); },
        async executer(op, args, transfert) {
            if (worker) {
                if (pret) await pret;
                if (worker) return poster({ op, args }, transfert);
            }
            return window.HKOCalcul.executer(op, args);
        }
    };
})();

// Relief chargé et lu par le Worker (le fichier pèse plusieurs mégaoctets)
let promesseRelief = null;
function chargerRelief() {
    if (!promesseRelief) {
        const urls = [STATIQUE + "relief/hko_relief.json.gz", STATIQUE + "relief/relief_europe.json.gz"]
            .map(u => new URL(u, location.href).href);
        promesseRelief = calcul.executer("relief", { urls })
            .then(r => {
                if (!r.ok) console.warn("HKO : relief indisponible —", r.erreur);
                etat.relief = r.ok;
                return r.ok;
            })
            .catch(erreur => {
                console.warn("HKO : relief indisponible —", erreur.message);
                return false;
            });
    }
    return promesseRelief;
}

let promesseBathymetrie = null;
function chargerBathymetrie() {
    if (!promesseBathymetrie) {
        promesseBathymetrie = fetch(STATIQUE + "fonds/bathymetrie.jpg")
            .then(r => { if (!r.ok) throw new Error(`bathymétrie : ${r.status}`); return r.blob(); })
            .then(blob => createImageBitmap(blob))
            .then(async bitmap => {
                if (!calcul.parallele || typeof OffscreenCanvas === "undefined") {
                    etat.bathymetrie = bitmap;            // profondeurs calculées dans la page
                    return true;
                }
                await calcul.executer("bathymetrie", { bitmap }, [bitmap]);
                etat.bathymetrieTransmise = true;
                return true;
            })
            .catch(erreur => {
                console.info("HKO : fonds marins indisponibles —", erreur.message);
                return false;
            });
    }
    return promesseBathymetrie;
}

// Profondeurs calculées dans la page (navigateur sans OffscreenCanvas dans les Workers)
function profondeursPage(W, H) {
    const resultat = new Float32Array(W * H).fill(0.55);
    if (!etat.bathymetrie) return resultat;
    const c = nouveauCanvas(W, H);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "rgb(110,110,110)";
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(etat.bathymetrie, ...cadreImageFond());
    const px = ctx.getImageData(0, 0, W, H).data;
    for (let i = 0; i < resultat.length; i++) {
        const v = px[i * 4];
        resultat[i] = v === 0 ? 0.9 : (v - 1) / 254;
    }
    return resultat;
}

// Prépare le Worker pour la taille d'écran courante (relief, ombrage)
function preparerCadreCalcul() {
    if (etat.cadreCalcul) return etat.cadreCalcul;
    const generation = etat.generation;
    etat.cadreCalcul = (async () => {
        await Promise.all([chargerRelief(), chargerBathymetrie()]);
        const W = $("champ").width, H = $("champ").height, k = etat.echelle;
        if (!etat.bathymetrieTransmise) {
            const profondeurs = profondeursPage(W, H);
            await calcul.executer("bathymetrie", { profondeurs }, calcul.parallele ? [profondeurs.buffer] : undefined);
        }
        for (const nom of Object.keys(STYLES_RELIEF)) {
            if (!teintesRelief[nom]) {
                teintesRelief[nom] = tableCouleurs(STYLES_RELIEF[nom].terre, 0, 4000, 10);
                teintesMer[nom] = tableCouleurs(STYLES_RELIEF[nom].mer, 0, 1, 0.005);
            }
        }
        const p = etat.projection;
        await calcul.executer("cadre", {
            W, H, k, s: p.scale(), tx: p.translate()[0], ty: p.translate()[1],
            cadreFond: cadreImageFond(),
            styles: STYLES_RELIEF,
            teintes: Object.fromEntries(Object.keys(STYLES_RELIEF).map(nom =>
                [nom, { terre: teintesRelief[nom], mer: teintesMer[nom] }]))
        });
        return generation;
    })();
    return etat.cadreCalcul;
}

// Ambiances horaires du fond des temperatures.
// Multiplicateurs RVB appliques aux couleurs du relief et de la mer.
const AMBIANCES_TEMPERATURES = [
    { heure: 0,  terre: [0.42, 0.48, 0.66], mer: [0.38, 0.45, 0.65] },
    { heure: 5,  terre: [0.42, 0.48, 0.66], mer: [0.38, 0.45, 0.65] },
    { heure: 7,  terre: [1.40, 0.91, 0.76], mer: [1.10, 0.76, 0.80] },
    { heure: 9,  terre: [0.94, 0.96, 1.03], mer: [0.92, 0.96, 1.02] },
    { heure: 12, terre: [1, 1, 1],          mer: [1, 1, 1] },
    { heure: 13, terre: [1, 1, 1],          mer: [1, 1, 1] },
    { heure: 15, terre: [1.12, 1.12, 0.88], mer: [1.05, 1.08, 0.92] },
    { heure: 18, terre: [1.40, 0.68, 0.82], mer: [1.10, 0.55, 0.78] },
    { heure: 21, terre: [0.42, 0.48, 0.66], mer: [0.38, 0.45, 0.65] },
    { heure: 24, terre: [0.42, 0.48, 0.66], mer: [0.38, 0.45, 0.65] }
];

// Estimation des horaires solaires au centre de la France.
// Les horaires renvoyes sont exprimes en heure civile de Paris.
function horairesSolaires(instant) {
    const date = new Date(instant);

    const parties = FORMATS.date.formatToParts(date);

    const a = Number(parties.find(p => p.type === "year").value);
    const m = Number(parties.find(p => p.type === "month").value);
    const j = Number(parties.find(p => p.type === "day").value);

    const n = Math.round(
        (Date.UTC(a, m - 1, j) - Date.UTC(a, 0, 1))
        / 86400000
    ) + 1;

    const rad = Math.PI / 180;
    const latitude = 46.6 * rad;
    const longitude = 2.5;

    const gamma = 2 * Math.PI / 365 * (n - 1);

    // Equation du temps, en minutes.
    const eqTemps = 229.18 * (
        0.000075
        + 0.001868 * Math.cos(gamma)
        - 0.032077 * Math.sin(gamma)
        - 0.014615 * Math.cos(2 * gamma)
        - 0.040849 * Math.sin(2 * gamma)
    );

    // Declinaison du soleil.
    const declinaison =
        0.006918
        - 0.399912 * Math.cos(gamma)
        + 0.070257 * Math.sin(gamma)
        - 0.006758 * Math.cos(2 * gamma)
        + 0.000907 * Math.sin(2 * gamma)
        - 0.002697 * Math.cos(3 * gamma)
        + 0.001480 * Math.sin(3 * gamma);

    const angle = Math.acos(
        Math.cos(90.833 * rad)
        / (Math.cos(latitude) * Math.cos(declinaison))
        - Math.tan(latitude) * Math.tan(declinaison)
    ) / rad;

    // Decalage UTC de Paris, heure d'ete comprise.
    const midiUTC = new Date(Date.UTC(a, m - 1, j, 12));

    const heureParis = Number(
        FORMATS.heure24.formatToParts(midiUTC)
            .find(p => p.type === "hour").value
    );

    const decalage = heureParis - 12;

    const midi = (
        720 - 4 * longitude - eqTemps
    ) / 60 + decalage;



    return {
        lever: midi - angle / 15,
        midi: midi,
        coucher: midi + angle / 15
    };
}

function ambianceTemperatures(instant) {
    const date = new Date(instant);

    const parties = FORMATS.heureMinute.formatToParts(date);

    const h = Number(parties.find(p => p.type === "hour").value);
    const m = Number(parties.find(p => p.type === "minute").value);
    const heure = h + m / 60;

    const { lever, midi, coucher } = horairesSolaires(date);



    // Correspondance entre les horaires solaires reels
    // et les reperes de notre palette artistique.
    const reperes = [
        [0, 0],
        [lever - 1.5, 5],
        [lever, 7],
        [lever + (midi - lever) * 0.4, 9],
        [midi - 0.5, 12],
        [midi + 0.5, 13],
        [midi + (coucher - midi) * 0.5, 15],
        [coucher, 18],
        [coucher + 1.5, 21],
        [24, 24]
    ];

    for (let i = 1; i < reperes.length; i++) {
        const [h0, p0] = reperes[i - 1];
        const [h1, p1] = reperes[i];

        if (heure <= h1) {
            const t = (heure - h0) / (h1 - h0);
            const heurePalette = p0 + (p1 - p0) * t;

            return ambianceTemperaturesHeure(heurePalette);
        }
    }

    return ambianceTemperaturesHeure(0);
}

function ambianceTemperaturesHeure(heure) {
    if (!Number.isFinite(heure)) {
        console.warn("Heure palette invalide :", heure);
        heure = 12;
    }

    heure = ((heure % 24) + 24) % 24;

    const i = AMBIANCES_TEMPERATURES.findIndex(
        a => a.heure > heure
    );

    if (i <= 0) {
        console.warn("Repere colorimetrique introuvable :", heure);

        return {
            terre: [1, 1, 1],
            mer: [1, 1, 1]
        };
    }

    const a = AMBIANCES_TEMPERATURES[i - 1];
    const b = AMBIANCES_TEMPERATURES[i];

    let t = (heure - a.heure) / (b.heure - a.heure);
    t = t * t * (3 - 2 * t);

    const melanger = (x, y) =>
        x.map((v, j) => v + (y[j] - v) * t);

    return {
        terre: melanger(a.terre, b.terre),
        mer: melanger(a.mer, b.mer)
    };
}

function ambianceDuFond(nom) {
    if (nom !== "temperatures") return { terre: [1, 1, 1], mer: [1, 1, 1] };
    const heureTest = PARAMETRES.get("heure");
    const simulation = heureTest !== null
        && heureTest.trim() !== ""
        && Number.isFinite(Number(heureTest))
        && Number(heureTest) >= 0
        && Number(heureTest) <= 24;
    return simulation
        ? ambianceTemperaturesHeure(Number(heureTest))
        : ambianceTemperatures(etat.donnees?.date || new Date());
}

// Toile de travail réutilisée (découpe des terres)
let toileTravail = null;
function travail(W, H) {
    if (!toileTravail || toileTravail.width !== W || toileTravail.height !== H) {
        toileTravail = nouveauCanvas(W, H);
    }
    const c = toileTravail.getContext("2d");
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = "source-over";
    c.clearRect(0, 0, W, H);
    return c;
}

function poserImage(ctx, image, x = 0, y = 0) {
    if (image instanceof ImageData) ctx.putImageData(image, x, y);
    else {
        ctx.drawImage(image, x, y);
        if (image.close) image.close();
    }
}

// Fond en relief (températures, précipitations) : mer, halo des côtes,
// puis terres ombrées découpées selon les côtes. Les pixels viennent du
// Worker ; l'ambiance horaire n'y est qu'une multiplication.
async function peindreRelief(canvas, nom) {
    const generation = etat.generation;
    await preparerCadreCalcul();
    if (generation !== etat.generation) return false;
    const { mer, terre, W, H } = await calcul.executer("fond", { nom, ambiance: ambianceDuFond(nom) });
    if (generation !== etat.generation || W !== canvas.width || H !== canvas.height) {
        for (const i of [mer, terre]) if (i && i.close) i.close();
        return false;
    }
    const k = etat.echelle;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    poserImage(ctx, mer);

    const c2 = travail(W, H);
    poserImage(c2, terre);
    c2.globalCompositeOperation = "destination-in";
    c2.drawImage(masqueTerres(), 0, 0);

    // Halo le long des côtes
    ctx.save();
    repereChemins(ctx);
    ctx.shadowColor = nom === "temperatures" ? "rgba(150, 205, 255, 0.5)" : "rgba(90, 120, 150, 0.35)";
    ctx.shadowBlur = (nom === "temperatures" ? 14 : 9) * k;
    ctx.fillStyle = nom === "temperatures" ? "#2a6aaa" : "#141c26";
    ctx.fill(chemins.terres);
    ctx.restore();

    ctx.drawImage(toileTravail, 0, 0);
    return true;
}

// Contour extérieur de la France : le trait des départements, seulement
// à l'extérieur du territoire (découpe pair-impair : écran moins France).
function lisereFrance(ctx, largeur, couleur) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.save();
    const f = repereChemins(ctx);
    const exterieur = new Path2D();
    exterieur.rect(-ctx.getTransform().e / f, -ctx.getTransform().f / f, W / f, H / f);
    exterieur.addPath(chemins.departements);
    ctx.clip(exterieur, "evenodd");
    ctx.lineJoin = "round";
    epaisseur(ctx, largeur);
    ctx.strokeStyle = couleur;
    ctx.stroke(chemins.departements);
    ctx.restore();
}

function frontieres(ctx, largeur, couleur) {
    ctx.save();
    repereChemins(ctx);
    ctx.lineJoin = "round";
    epaisseur(ctx, largeur);
    ctx.strokeStyle = couleur;
    ctx.stroke(chemins.pays);
    ctx.restore();
}

// Quadrillage géographique (parallèles et méridiens), comme à l'antenne
function quadrillage(ctx) {
    const k = etat.echelle, p = etat.projection;
    const [lonMin, latMax] = p.invert([0, 0]);
    const [lonMax, latMin] = p.invert([etat.largeur, etat.hauteur]);

    ctx.save();
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = "rgba(225, 240, 255, 0.22)";
    ctx.beginPath();
    for (let lon = Math.ceil(lonMin); lon <= lonMax; lon++) {
        const x = Math.round(p([lon, 0])[0]) + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, etat.hauteur);
    }
    for (let lat = Math.ceil(latMin); lat <= latMax; lat++) {
        const y = Math.round(p([0, lat])[1]) + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(etat.largeur, y);
    }
    ctx.stroke();

    // Graduations : latitudes à gauche, longitudes en haut, tous les 2°
    const corps = Math.max(10, Math.min(13, etat.largeur / 110));
    ctx.font = `600 ${corps}px ${getComputedStyle(document.body).fontFamily}`;
    ctx.fillStyle = "rgba(225, 240, 255, 0.62)";
    ctx.textBaseline = "bottom";
    const gauche = etat.largeur < 760 ? 6 : Math.min(60, etat.largeur * 0.04) + 4;
    for (let lat = Math.ceil(latMin); lat <= latMax; lat++) {
        if (lat % 2) continue;
        const y = p([0, lat])[1];
        if (y < 90 || y > etat.hauteur - 40) continue;
        ctx.fillText(`${lat}°`, gauche, y - 3);
    }
    const haut = etat.largeur < 760 ? 112 : 84;
    for (let lon = Math.ceil(lonMin); lon <= lonMax; lon++) {
        if (lon % 2) continue;
        const x = p([lon, 0])[0];
        if (x < 40 || x > etat.largeur - 40) continue;
        ctx.fillText(lon === 0 ? "0°" : lon < 0 ? `${-lon}° O` : `${lon}° E`, x + 4, haut);
    }
    ctx.restore();
}

async function dessinerFondTemperatures() {
    const canvas = $("fond-temperatures");
    if (!await peindreRelief(canvas, "temperatures")) return false;
    const ctx = canvas.getContext("2d");
    quadrillage(ctx);
    frontieres(ctx, 0.8, "rgba(255, 255, 255, 0.5)");
    lisereFrance(ctx, 2.4, "rgba(255, 255, 255, 0.9)");
    return true;
}

async function dessinerFondPrecipitations() {
    const canvas = $("fond-precipitations");
    if (!await peindreRelief(canvas, "precipitations")) return false;
    const ctx = canvas.getContext("2d");

    // Départements, très discrets : repères pour situer la pluie
    ctx.save();
    repereChemins(ctx);
    epaisseur(ctx, 0.5);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.11)";
    ctx.stroke(chemins.departements);
    ctx.restore();

    frontieres(ctx, 0.9, "rgba(255, 255, 255, 0.55)");
    lisereFrance(ctx, 1.4, "rgba(255, 255, 255, 0.78)");
    return true;
}

// Aplats : jour (vert franc sur mer bleue) ou nuit (mêmes teintes, assombries)
const APLATS = {
    jour: {
        merCentre: "#3fa6e6", merBord: "#1462b0", voisins: "#7cb6e2", voisinsBord: "rgba(255,255,255,0.45)",
        franceHaut: "#a9d64c", franceBas: "#87bd35", departements: "rgba(52, 96, 18, 0.32)",
        lisere: "rgba(255, 255, 255, 0.95)", halo: "rgba(255, 255, 255, 0.5)"
    },
    nuit: {
        merCentre: "#163f78", merBord: "#081c3d", voisins: "#24466f", voisinsBord: "rgba(255,255,255,0.22)",
        franceHaut: "#4e7d2e", franceBas: "#3a6522", departements: "rgba(0, 0, 0, 0.28)",
        lisere: "rgba(255, 255, 255, 0.7)", halo: "rgba(140, 190, 255, 0.35)"
    }
};

function dessinerFondConditions() {
    const canvas = $("fond-conditions");
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height, k = etat.echelle;
    const a = APLATS[etat.nuitConditions ? "nuit" : "jour"];

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const centre = etat.projection([2.5, 46.6]);
    const mer = ctx.createRadialGradient(centre[0] * k, centre[1] * k, 0,
        centre[0] * k, centre[1] * k, Math.hypot(W, H) * 0.6);
    mer.addColorStop(0, a.merCentre);
    mer.addColorStop(1, a.merBord);
    ctx.fillStyle = mer;
    ctx.fillRect(0, 0, W, H);

    const f = repereChemins(ctx);
    const ty = etat.projection.translate()[1];

    // Pays voisins : un ton à peine plus clair que la mer
    ctx.fillStyle = a.voisins;
    ctx.fill(chemins.pays);
    epaisseur(ctx, 0.8);
    ctx.lineJoin = "round";
    ctx.strokeStyle = a.voisinsBord;
    ctx.stroke(chemins.pays);

    // France : aplat franc avec une légère profondeur (dégradé en pixels CSS,
    // exprimé dans le repère des chemins)
    const [, yHaut] = etat.projection([2, 51.1]);
    const [, yBas] = etat.projection([2, 42.3]);
    const versChemin = y => (y - ty) * k / f;
    const vert = ctx.createLinearGradient(0, versChemin(yHaut), 0, versChemin(yBas));
    vert.addColorStop(0, a.franceHaut);
    vert.addColorStop(1, a.franceBas);

    ctx.save();
    ctx.shadowColor = a.halo;
    ctx.shadowBlur = 18;
    ctx.fillStyle = vert;
    ctx.fill(chemins.departements);
    ctx.restore();

    epaisseur(ctx, 0.6);
    ctx.strokeStyle = a.departements;
    ctx.stroke(chemins.departements);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    lisereFrance(ctx, 2.2, a.lisere);
    return true;
}

// Le fond satellite est posé par le lecteur satellite (hko_satellite.js)
function dessinerFondSatellite() {
    if (etat.rendus.satellite) etat.rendus.satellite.dessinerVoile();
    return true;
}

const DESSINS_FOND = {
    temperatures: dessinerFondTemperatures,
    precipitations: dessinerFondPrecipitations,
    conditions: dessinerFondConditions,
    satellite: dessinerFondSatellite
};

// Dessine le fond d'un tableau s'il n'est pas à jour. Les fonds en relief
// sont calculés par le Worker : la promesse se résout quand ils sont posés.
const fondsEnCours = new Map();
function assurerFond(tableau) {
    if (etat.fondsAJour.has(tableau)) return Promise.resolve(true);
    if (tableau !== "satellite" && !chemins.departements) return Promise.resolve(false);
    const cle = `${tableau}:${etat.generation}:${etat.versionAmbiance}`;
    if (fondsEnCours.has(cle)) return fondsEnCours.get(cle);
    const generation = etat.generation;
    const promesse = Promise.resolve()
        .then(() => DESSINS_FOND[tableau]())
        .then(fait => {
            if (fait !== false && generation === etat.generation) etat.fondsAJour.add(tableau);
            return fait !== false;
        })
        .catch(erreur => {
            console.warn(`HKO : fond ${tableau} —`, erreur);
            journal({ type: "fond", tableau, message: String(erreur.message || erreur).slice(0, 200) });
            return false;
        })
        .finally(() => fondsEnCours.delete(cle));
    fondsEnCours.set(cle, promesse);
    return promesse;
}

// ---------------------------------------------------------------------------
// 5. Tableau 1 — températures
// ---------------------------------------------------------------------------

function stationsValides() {
    if (!etat.donnees || !etat.donnees.disponible) return [];

    return etat.donnees.stations.filter(s =>
        Number.isFinite(s.temperature) &&
        Number.isFinite(s.latitude) &&
        Number.isFinite(s.longitude)
    );
}

// Interpolation par l'inverse de la distance sur les 8 stations les plus
// proches, avec correction d'altitude (calcul dans hko_calcul.js, à
// l'identique). Le résultat est une estimation entre les stations, pas une
// mesure. Les zones de couleur suivent l'ombrage du relief.
let jetonChamp = 0;

async function dessinerChamp() {
    const canvas = $("champ");
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    const jeton = ++jetonChamp;
    const generation = etat.generation;

    const stations = stationsValides();
    const projection = etat.projection;
    const points = stations.map(s => {
        const p = projection([s.longitude, s.latitude]);
        return { x: p[0], y: p[1], t: s.temperature, a: Number.isFinite(s.altitude) ? s.altitude : NaN };
    });

    let resultat = null;
    if (points.length >= 3) {
        const hg = projection([-5.6, 51.6]), bd = projection([10.1, 41.0]);
        const zone = {
            x0: Math.max(0, Math.floor(hg[0])), y0: Math.max(0, Math.floor(hg[1])),
            x1: Math.min(etat.largeur, Math.ceil(bd[0])), y1: Math.min(etat.hauteur, Math.ceil(bd[1]))
        };
        await preparerCadreCalcul();
        if (jeton !== jetonChamp || generation !== etat.generation) return false;
        resultat = await calcul.executer("champ", {
            points, pas: 4, zone,
            tailleCase: Math.max(24, largeurFrance() / 22),
            teintes: teintesTemperature
        });
    }
    if (jeton !== jetonChamp || generation !== etat.generation) {
        if (resultat && resultat.image.close) resultat.image.close();
        return false;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, W, H);
    if (!resultat) return true;

    etat.pasBande = resultat.pasBande;
    poserImage(ctx, resultat.image, resultat.gx0, resultat.gy0);

    // Découpe selon les frontières françaises
    ctx.globalCompositeOperation = "destination-in";
    repereChemins(ctx);
    ctx.fillStyle = "#000";
    ctx.fill(chemins.departements);
    ctx.globalCompositeOperation = "source-over";

    // Liseré blanc par-dessus les couleurs
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    lisereFrance(ctx, 2.4, "rgba(255, 255, 255, 0.92)");
    if (etat.tableau === "temperatures") actualiserHabillage();
    return true;
}

// Une valeur par case d'une grille régulière : la station la plus proche du
// centre de la case. « rotation » décale le choix d'un affichage au suivant.
function choisirParCases(stations, tailleCase, rotation, cleGroupe) {
    const projection = etat.projection;
    const cases = new Map();

    for (const station of stations) {
        const [x, y] = projection([station.longitude, station.latitude]);

        if (x < 12 || y < 12 || x > etat.largeur - 12 || y > etat.hauteur - 12) continue;

        const colonne = Math.floor(x / tailleCase), ligne = Math.floor(y / tailleCase);
        const cle = `${colonne}:${ligne}`;

        const distance = Math.hypot(
            x - (colonne + 0.5) * tailleCase,
            y - (ligne + 0.5) * tailleCase
        );

        const variation = rotation === 0 ? 0 :
            0.8 * tailleCase * Math.sin(rotation * 2.4 + x * 0.037 + y * 0.053);

        let contenu = cases.get(cle);
        if (!contenu) cases.set(cle, contenu = []);
        contenu.push({ station, x, y, score: distance + variation });
    }

    const choix = [];

    for (const contenu of cases.values()) {
        let candidats = contenu;

        if (cleGroupe) {
            // Situation majoritaire de la case, puis sa station la mieux placée
            const comptes = d3.rollup(contenu, v => v.length, d => cleGroupe(d.station));
            const majoritaire = [...comptes].sort((a, b) => b[1] - a[1])[0][0];
            candidats = contenu.filter(d => cleGroupe(d.station) === majoritaire);
        }

        choix.push(candidats.reduce((a, b) => (b.score < a.score ? b : a)));
    }

    return choix;
}

// Relevés à l'antenne : un point carré à la station, le chiffre à côté
function placerTemperatures() {
    const calque = d3.select("#calque-temperatures");
    const stations = stationsValides().filter(s =>
        Number.isFinite(Number(s.altitude)) && s.altitude !== null &&
        Number(s.altitude) <= ALTITUDE_MAX_AFFICHEE
    );

    if (!stations.length) {
        calque.selectAll("*").remove();
        etat.extremes = null;
        return;
    }

    const unite = largeurFrance();
    const tailleCase = Math.max(56, unite / 7);
    const corps = Math.max(17, Math.min(34, unite / 22));

    let choix = choisirParCases(stations, tailleCase, etat.rotation);

    // Les deux extrêmes du moment sont toujours affichés
    const mini = stations.reduce((a, b) => (b.temperature < a.temperature ? b : a));
    const maxi = stations.reduce((a, b) => (b.temperature > a.temperature ? b : a));
    etat.extremes = { mini, maxi };

    const extremes = [mini, maxi].map(station => {
        const [x, y] = etat.projection([station.longitude, station.latitude]);
        return { station, x, y };
    });

    for (const extreme of extremes) {
        if (!choix.some(c => c.station.id === extreme.station.id)) choix.push(extreme);
    }

    // Emprise d'un relevé : le point et le chiffre à sa droite
    const emprise = d => {
        const largeurTexte = corps * 0.58 * String(Math.round(d.station.temperature)).length;
        return [d.x - corps * 0.3, d.y - corps * 0.85, d.x + corps * 0.55 + largeurTexte, d.y + corps * 0.35];
    };
    const chevauche = (a, b) => !(a[2] + 4 < b[0] || b[2] + 4 < a[0] || a[3] + 3 < b[1] || b[3] + 3 < a[1]);

    // Écarter les relevés qui se chevaucheraient (les extrêmes d'abord)
    const places = [];
    const prioritaire = d => d.station.id === mini.id || d.station.id === maxi.id;
    for (const c of choix.sort((a, b) => prioritaire(b) - prioritaire(a))) {
        const e = emprise(c);
        if (places.every(p => !chevauche(p.e, e))) places.push({ ...c, e });
    }

    const point = Math.max(6, corps * 0.32);

    calque.selectAll("g.releve")
        .data(places, d => d.station.id)
        .join(entree => {
            const g = entree.append("g").attr("tabindex", 0);
            g.append("rect").attr("class", "releve-point");
            g.append("text").attr("class", "temp");
            return g;
        })
        .attr("class", d =>
            "releve" + (d.station.id === mini.id ? " mini" : d.station.id === maxi.id ? " maxi" : ""))
        .attr("transform", d => `translate(${d.x},${d.y})`)
        .call(g => g.select("rect")
            .attr("x", -point / 2).attr("y", -point / 2)
            .attr("width", point).attr("height", point))
        .call(g => g.select("text")
            .attr("x", point * 0.75)
            .attr("y", -corps * 0.22)
            .attr("font-size", corps)
            .attr("stroke-width", corps * 0.2)
            .text(d => Math.round(d.station.temperature)))
        .on("pointerenter focus", (evenement, d) => montrerBulle(d, bulleTemperature(d.station)))
        .on("pointerleave blur", cacherBulle);
}

// ---------------------------------------------------------------------------
// 6. Tableau 2 — précipitations
//
// Animation : grilles radar archivées (0,05°, toutes les 5 minutes), avec
// images intermédiaires calculées. Dernière image du jour : l'image radar
// publiée en pleine résolution (1 km), fondue par-dessus si elle correspond
// à la dernière grille.
// ---------------------------------------------------------------------------
const MODE_OPERA =
    new URLSearchParams(window.location.search).get("opera") !== "0";

async function chargerRadar() {
    // Fichiers publiés par collecter_radar ; à défaut, l'ancien emplacement
    // dans static (radar converti à la main avec convertir_radar).
    let base = scene.dataset.radar.replace(/radar\.json$/, "");

    if (MODE_OPERA) {
        base = base.replace(/radar\/$/, "opera/");
    }

    try {
        let reponse = await fetch(base + "radar.json", { cache: "no-store" });
        if (reponse.status === 404 && !MODE_OPERA) {
            base = STATIQUE + "radar/";
            reponse = await fetch(base + "radar.json", { cache: "no-store" });
        }
        if (!reponse.ok) throw new Error(`radar.json : ${reponse.status}`);

        const meta = await reponse.json();

        const valide = meta && meta.projection === "mercator" &&
            Array.isArray(meta.emprise) && meta.emprise.length === 4 &&
            meta.emprise.every(Number.isFinite) &&
            Array.isArray(meta.seuils) && Array.isArray(meta.couleurs) &&
            typeof meta.image === "string";

        if (!valide) throw new Error("radar.json : contenu inattendu");

        if (etat.radar && etat.radar.date_utc === meta.date_utc) return;

        const version = `?v=${encodeURIComponent(meta.date_utc || "")}`;

        const image = await chargerImage(base + meta.image + version);
        let couverture = null;

        if (typeof meta.couverture === "string") {
            couverture = await chargerImage(base + meta.couverture + version).catch(() => null);
        }

        etat.radar = meta;
        etat.radarImage = image;
        etat.radarCouverture = couverture;

        $("radar").src = image.src;
        placerRadar();
    } catch (erreur) {
        console.info("HKO : radar indisponible —", erreur.message);
        if (etat.radar === undefined) etat.radar = null;
    }

    if (etat.tableau === "precipitations") actualiserHabillage();
}

function radarDuJour() {
    return Boolean(
        etat.radar && etat.radar.date_utc &&
        jourParis(etat.radar.date_utc) === etat.jour
    );
}

// Seuils et couleurs : ceux de l'image publiée, sinon ceux de radar.py
const SEUILS_RADAR = [0.2, 0.5, 1, 2, 4, 7, 12, 20, 35, 60];
const COULEURS_RADAR = ["#a5d8f3", "#6fb7ea", "#3f8fd8", "#2a63c0", "#3aa655",
                        "#9fce3f", "#f3e03b", "#f4a12a", "#e8502a", "#b3207a"];

function paletteRadar() {
    const r = etat.radar;
    const seuils = r && r.seuils && r.seuils.length === 10 ? r.seuils : SEUILS_RADAR;
    const couleurs = r && r.couleurs && r.couleurs.length === 10 ? r.couleurs : COULEURS_RADAR;
    return { seuils, couleurs };
}

function placerRadar() {
    const image = $("radar");
    const hachures = $("hachures");
    const ctx = hachures.getContext("2d");
    const k = etat.echelle;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, hachures.width, hachures.height);

    if (!etat.radar || !radarDuJour()) {
        image.style.display = "none";
        return;
    }

    const [ouest, sud, est, nord] = etat.radar.emprise;
    const [x0, y0] = etat.projection([ouest, nord]);
    const [x1, y1] = etat.projection([est, sud]);

    image.style.display = "";
    image.style.left = `${x0}px`;
    image.style.top = `${y0}px`;
    image.style.width = `${x1 - x0}px`;
    image.style.height = `${y1 - y0}px`;

    // Zones sans mesure radar : fines hachures claires, pour ne pas les
    // confondre avec une absence de pluie.
    if (!etat.radarCouverture) return;

    const motif = document.createElement("canvas");
    const pas = Math.round(7 * k);
    motif.width = motif.height = pas;
    const m = motif.getContext("2d");
    m.strokeStyle = "rgba(255, 255, 255, 0.3)";
    m.lineWidth = Math.max(1, k * 0.9);
    m.beginPath();
    m.moveTo(-1, pas + 1); m.lineTo(pas + 1, -1);
    m.moveTo(-1, 1); m.lineTo(1, -1);
    m.moveTo(pas - 1, pas + 1); m.lineTo(pas + 1, pas - 1);
    m.stroke();

    ctx.fillStyle = ctx.createPattern(motif, "repeat");
    ctx.fillRect(0, 0, hachures.width, hachures.height);

    // On retire les hachures partout où le radar mesure
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(etat.radarCouverture, x0 * k, y0 * k, (x1 - x0) * k, (y1 - y0) * k);
    ctx.globalCompositeOperation = "source-over";
}

// Villes repères, au-dessus de la pluie
function placerVilles() {
    const unite = largeurFrance();
    const corps = Math.max(10, Math.min(13.5, unite / 48));
    const retenues = [];
    for (const [nom, lon, lat] of VILLES) {
        const [x, y] = etat.projection([lon, lat]);
        if (x < 20 || y < 80 || x > etat.largeur - 20 || y > etat.hauteur - 30) continue;
        // Sur petit écran, on garde les villes les plus espacées
        if (retenues.some(v => Math.hypot(v.x - x, v.y - y) < corps * 6)) continue;
        retenues.push({ nom, x, y });
    }

    d3.select("#calque-radar").selectAll("g.ville")
        .data(retenues, d => d.nom)
        .join(entree => {
            const g = entree.append("g").attr("class", "ville");
            g.append("circle").attr("r", 2.2);
            g.append("text").attr("x", 5).attr("y", -4);
            return g;
        })
        .attr("transform", d => `translate(${d.x},${d.y})`)
        .call(g => g.select("text").attr("font-size", corps).text(d => d.nom.toUpperCase()));
}

// ---------------------------------------------------------------------------
// 7. Tableau 3 — conditions météo
//
// Source : la carte fusionnée calculée sur le serveur (fusionner_conditions),
// qui croise radar, satellite, stations et AROME sur une grille de 0,05°.
// Le navigateur ne décide d'aucun phénomène : il choisit la situation
// dominante autour de chaque emplacement et la dessine. Pas de texture de
// nuages ici : la vue satellite a son propre tableau.
// ---------------------------------------------------------------------------

// Libellés : [de jour, de nuit]
const LIBELLES_CONDITION = {
    "soleil": ["Ensoleillé", "Ciel dégagé"],
    "peu-nuageux": ["Quelques nuages", "Quelques nuages"],
    "eclaircies": ["Éclaircies", "Nuages épars"],
    "nuageux": ["Très nuageux", "Très nuageux"],
    "couvert": ["Ciel couvert", "Ciel couvert"],
    "pluie-faible": ["Pluie faible", "Pluie faible"],
    "pluie": ["Pluie modérée", "Pluie modérée"],
    "pluie-forte": ["Forte pluie", "Forte pluie"],
    "averses": ["Averses", "Averses"],
    "neige": ["Neige", "Neige"],
    "brouillard": ["Brouillard", "Brouillard"],
    "orage": ["Orage probable", "Orage probable"],
    "sec": ["Temps sec, ciel non mesuré", "Temps sec, ciel non mesuré"]
};

// Catégories de la fusion (meteo_app/fusion.py) -> dessin
const DESSIN_CATEGORIE = {
    soleil: "soleil", peu_nuageux: "peu-nuageux", eclaircies: "eclaircies",
    tres_nuageux: "nuageux", couvert: "couvert", brouillard: "brouillard",
    pluie_faible: "pluie-faible", pluie_moderee: "pluie", pluie_forte: "pluie-forte",
    averses: "averses", neige: "neige", orage: "orage"
};

// Poids donnés aux phénomènes pour qu'un épisode localisé ne soit pas
// effacé par la majorité de ciel gris autour (sans jamais en créer).
const POIDS_CATEGORIE = {
    orage: 4, neige: 2.5, pluie_forte: 2.2, averses: 1.8, pluie_moderee: 1.6,
    pluie_faible: 1.3, brouillard: 1.4
};

const SOURCES_CONDITION = {
    "precipitation": "pluie mesurée par la station",
    "precipitation+temperature": "précipitation mesurée, type estimé d'après la température",
    "visibilite": "visibilité mesurée",
    "nebulosite": "nébulosité observée",
    "rayonnement": "rayonnement solaire mesuré"
};

// --- Pictogrammes ------------------------------------------------------------

// Silhouette de nuage : enveloppe de trois lobes, base plate
function silhouetteNuage(lobes, base) {
    const gauche = Math.min(...lobes.map(([x, , r]) => x - r));
    const droite = Math.max(...lobes.map(([x, , r]) => x + r));
    const n = 48;
    let d = "";
    for (let i = 0; i <= n; i++) {
        const x = gauche + (droite - gauche) * i / n;
        let y = base;
        for (const [cx, cy, r] of lobes) {
            const dx = x - cx;
            if (Math.abs(dx) <= r) y = Math.min(y, cy - Math.sqrt(r * r - dx * dx));
        }
        d += `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
    }
    // Base arrondie aux deux extrémités
    return `${d}L${droite.toFixed(2)} ${base}Q${droite.toFixed(2)} ${base + 4} ${(droite - 4).toFixed(2)} ${base + 4}` +
        `L${(gauche + 4).toFixed(2)} ${base + 4}Q${gauche.toFixed(2)} ${base + 4} ${gauche.toFixed(2)} ${base}Z`;
}

const NUAGE = silhouetteNuage([[-11, 3, 8.5], [-0.5, -4.5, 11.5], [11.5, 2, 8.5]], 7);
const LUNE = "M4-13a13 13 0 1 0 10.6 19.2a10.6 10.6 0 0 1-10.6-19.2z";
const GOUTTE = "M0-4.6C1.9-1.6 3.2 0.4 3.2 2a3.2 3.2 0 0 1-6.4 0c0-1.6 1.3-3.6 3.2-6.6z";
const ECLAIR = "M2.5 7l-8 11h5l-3 9.5 10.5-13h-5.5l4-7.5z";

function rayonsSoleil(r1, r2) {
    let d = "";
    for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 6;
        const l = i % 2 ? r2 * 0.86 : r2;
        const c = Math.cos(a), s = Math.sin(a);
        const pc = Math.cos(a + 0.13), ps = Math.sin(a + 0.13);
        const mc = Math.cos(a - 0.13), ms = Math.sin(a - 0.13);
        d += `M${(r1 * mc).toFixed(2)} ${(r1 * ms).toFixed(2)}L${(l * c).toFixed(2)} ${(l * s).toFixed(2)}` +
             `L${(r1 * pc).toFixed(2)} ${(r1 * ps).toFixed(2)}Z`;
    }
    return d;
}
const RAYONS = rayonsSoleil(13.5, 21);

function astre(jour, echelle = 1, x = 0, y = 0) {
    const t = `translate(${x},${y}) scale(${echelle})`;
    if (jour) {
        return `<g transform="${t}" class="p-astre"><circle r="22" fill="url(#p-halo)"/>` +
            `<path class="p-rayons" d="${RAYONS}"/>` +
            `<circle r="12" fill="url(#p-soleil)" class="p-disque"/></g>`;
    }
    return `<g transform="${t}" class="p-astre"><path d="${LUNE}" fill="url(#p-lune)" class="p-trait"/>` +
        `<path class="p-etoile" d="M17-13l1 2.4 2.4 1-2.4 1-1 2.4-1-2.4-2.4-1 2.4-1z"/></g>`;
}

function nuage(teinte, echelle = 1, x = 0, y = 0) {
    return `<g transform="translate(${x},${y}) scale(${echelle})" class="p-nuage">` +
        `<path d="${NUAGE}" transform="translate(0,2.4)" class="p-ombre"/>` +
        `<path d="${NUAGE}" fill="url(#p-nuage-${teinte})" class="p-trait"/></g>`;
}

function gouttes(n, y = 15) {
    const ecart = n > 3 ? 6 : 8;
    return d3.range(n).map(i => {
        const x = (i - (n - 1) / 2) * ecart;
        const dy = (i % 2) * 4;
        return `<g transform="translate(${x},${y + dy})"><path class="p-goutte" d="${GOUTTE}" style="animation-delay:${(i * 0.37) % 1.1}s"/></g>`;
    }).join("");
}

function flocons(n, y = 16) {
    const branche = "M0-4.2V4.2M-3.6-2.1L3.6 2.1M-3.6 2.1L3.6-2.1";
    return d3.range(n).map(i => {
        const x = (i - (n - 1) / 2) * 9;
        const dy = (i % 2) * 5;
        return `<g transform="translate(${x},${y + dy})"><path class="p-flocon" d="${branche}" style="animation-delay:${i * 0.8}s"/></g>`;
    }).join("");
}

function dessinSymbole(code, jour) {
    switch (code) {
        case "soleil":
            return astre(jour, 1.12);
        case "peu-nuageux":
            return astre(jour, 1, -3, -4) + nuage("blanc", 0.62, 10, 9);
        case "eclaircies":
            return astre(jour, 0.92, -8, -8) + nuage("blanc", 0.95, 4, 5);
        case "nuageux":
            return nuage("gris", 0.82, 7, -6) + nuage("blanc", 1, -2, 4);
        case "couvert":
            return nuage("sombre", 0.85, 7, -6) + nuage("gris", 1.02, -2, 4);
        case "pluie-faible":
            return `<g transform="translate(0,-6)">${gouttes(2)}${nuage("gris")}</g>`;
        case "pluie":
            return `<g transform="translate(0,-6)">${gouttes(3)}${nuage("gris")}</g>`;
        case "pluie-forte":
            return `<g transform="translate(0,-6)">${gouttes(5)}${nuage("sombre", 1.06)}</g>`;
        case "averses":
            return astre(jour, 0.8, -9, -11) + `<g transform="translate(3,-2)">${gouttes(2)}${nuage("gris", 0.92)}</g>`;
        case "neige":
            return `<g transform="translate(0,-6)">${flocons(3)}${nuage("gris")}</g>`;
        case "brouillard":
            return (jour ? astre(true, 0.7, 0, -10) : "") +
                [-3, 4, 11].map((y, i) =>
                    `<path class="p-brume" style="animation-delay:${-i * 1.7}s" d="M${-17 + i * 3} ${y}H${17 - (2 - i) * 3}"/>`).join("");
        case "orage":
            return `<g transform="translate(0,-6)">${gouttes(2, 16)}<path class="p-eclair" d="${ECLAIR}"/>${nuage("sombre", 1.06)}</g>`;
        default:
            return `<circle class="p-sec" r="4"/>`;
    }
}

// Étiquette de température à côté du pictogramme
function etiquette(t, grandeur) {
    if (t === null || !Number.isFinite(t)) return "";
    const valeur = Math.round(t);
    const largeur = 13 + 9.5 * String(valeur).length;
    const couleur = d3.color(teinteTemperature(t)).formatHex();
    return `<g class="p-etiquette" transform="translate(${25 * grandeur},${-1 * grandeur}) scale(${grandeur})">` +
        `<rect x="0" y="-12" width="${largeur + 5}" height="24" rx="3"/>` +
        `<rect class="p-repere" x="${largeur}" y="-12" width="5" height="24" fill="${couleur}"/>` +
        `<text x="${largeur / 2}" y="0.5">${valeur}</text></g>`;
}

function teinteTemperature(t) {
    const { table, debut, pas, taille } = teintesTemperature;
    let i = Math.round((t - debut) / pas);
    i = (i < 0 ? 0 : i >= taille ? taille - 1 : i) * 3;
    return `rgb(${table[i]},${table[i + 1]},${table[i + 2]})`;
}

// --- Chargement de la carte fusionnée -------------------------------------

function decoderChamp(texte) {
    const binaire = atob(texte);
    const octets = new Uint8Array(binaire.length);
    for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
    return octets;
}

async function chargerConditions(jour) {
    const enCache = etat.conditions.get(jour);
    const aujourdhui = etat.donnees && etat.donnees.aujourdhui;

    if (enCache && (jour !== aujourdhui || Date.now() - enCache.recu < 3 * 60000)) return enCache;

    let carte;
    try {
        const reponse = await fetch(`${URL_CONDITIONS}?jour=${encodeURIComponent(jour)}`);
        const corps = await reponse.json().catch(() => ({}));

        if (!reponse.ok) {
            carte = { absente: true, motif: corps.erreur || `Erreur ${reponse.status}` };
        } else {
            carte = corps;
            carte.donnees = {};
            for (const [nom, texte] of Object.entries(corps.champs)) carte.donnees[nom] = decoderChamp(texte);
            delete carte.champs;
        }
    } catch (erreur) {
        carte = { absente: true, motif: "Le serveur n'a pas répondu.", reseau: true };
    }

    carte.recu = Date.now();
    etat.conditions.set(jour, carte);
    return carte;
}

function carteConditions() {
    const carte = etat.jour && etat.conditions.get(etat.jour);
    return carte && !carte.absente ? carte : null;
}

// Nuit sur la France si la majorité des cellules françaises sont de nuit
function nuitSurLaFrance(carte) {
    if (!carte) return false;
    const fl = carte.donnees.drapeaux, cat = carte.donnees.categorie;
    let nuit = 0, total = 0;
    for (let i = 0; i < fl.length; i += 3) {
        if (cat[i] === 0 || cat[i] === 255) continue;
        total++;
        if (!(fl[i] & 32)) nuit++;
    }
    return total > 0 && nuit / total > 0.5;
}

// --- Symboles répartis sur le territoire -----------------------------------

const contexteTest = nouveauCanvas(1, 1).getContext("2d");

// Point (pixels CSS) en France : test sur le chemin des départements déjà
// projeté, ramené au repère de l'écran (pas de reprojection)
function dansFrance(x, y) {
    const p = etat.projection;
    const f = p.scale() / ECHELLE_CHEMINS;
    const [tx, ty] = p.translate();
    contexteTest.setTransform(f, 0, 0, f, tx, ty);
    return contexteTest.isPointInPath(chemins.departements, x, y);
}

function positionsSymboles(espacement) {
    // Maille triangulaire : la répartition la plus régulière possible,
    // légèrement décalée de façon déterministe pour éviter l'effet grille.
    const positions = [];
    const hauteurLigne = espacement * 0.866;
    const hg = etat.projection([-5.4, 51.3]), bd = etat.projection([9.8, 41.2]);

    let ligne = 0;
    for (let y = hg[1] + hauteurLigne / 2; y < bd[1]; y += hauteurLigne, ligne++) {
        const decalage = (ligne % 2) * espacement / 2;
        for (let x = hg[0] + decalage; x < bd[0]; x += espacement) {
            const jx = Math.sin(x * 12.9898 + y * 78.233) * 0.1 * espacement;
            const jy = Math.cos(x * 39.346 + y * 11.135) * 0.1 * espacement;
            const px = x + jx, py = y + jy;
            if (px < 16 || py < 16 || px > etat.largeur - 16 || py > etat.hauteur - 16) continue;
            if (dansFrance(px, py)) positions.push([px, py]);
        }
    }

    // La Corse est petite : au moins un symbole
    const corse = etat.projection([9.05, 42.15]);
    if (!positions.some(([x, y]) => Math.hypot(x - corse[0], y - corse[1]) < espacement * 0.6)) {
        positions.push(corse);
    }
    return positions;
}

function situationAutour(carte, x, y, rayon) {
    // Catégorie dominante autour d'un point, pondérée par la confiance
    const g = carte.grille;
    const [lon, lat] = etat.projection.invert([x, y]);
    const pasLon = (etat.projection.invert([x + rayon, y])[0] - lon) / g.pas;
    const pasLat = (lat - etat.projection.invert([x, y + rayon])[1]) / g.pas;
    const ci = Math.floor((lon - g.ouest) / g.pas), cj = Math.floor((g.nord - lat) / g.pas);
    const ri = Math.max(1, Math.round(pasLon)), rj = Math.max(1, Math.round(pasLat));

    const poids = new Map();
    let confiance = 0, n = 0, rafale = -1, direction = null, temperature = 0, nt = 0, jour = 0, sources = 0;

    for (let dj = -rj; dj <= rj; dj++) {
        for (let di = -ri; di <= ri; di++) {
            if ((di * di) / (ri * ri) + (dj * dj) / (rj * rj) > 1) continue;
            const i = ci + di, j = cj + dj;
            if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) continue;
            const c = j * g.nx + i;
            const code = carte.donnees.categorie[c];
            const nom = carte.categories[code];
            if (!nom || nom === "inconnu") continue;
            const conf = carte.donnees.confiance[c];
            const w = (POIDS_CATEGORIE[nom] || 1) * (0.5 + conf / 3);
            poids.set(nom, (poids.get(nom) || 0) + w);
            confiance += conf;
            n++;
            sources |= carte.donnees.sources[c];
            jour += (carte.donnees.drapeaux[c] & 32) ? 1 : 0;
            const r = carte.donnees.rafale[c];
            if (r !== 255 && r > rafale) {
                rafale = r;
                direction = carte.donnees.direction[c] === 255 ? null : carte.donnees.direction[c] * 2;
            }
            const t = carte.donnees.temperature[c];
            if (t !== 255) { temperature += t / 2 - 40; nt++; }
        }
    }

    if (!n) return null;

    let meilleur = null;
    for (const [nom, w] of poids) if (!meilleur || w > meilleur[1]) meilleur = [nom, w];

    return {
        categorie: meilleur[0],
        confiance: confiance / n,
        jour: jour / n >= 0.5,
        rafale: rafale >= 0 ? rafale : null,
        direction,
        temperature: nt ? temperature / nt : null,
        sources
    };
}

function placerConditions() {
    if (!chemins.departements) return;
    const carte = carteConditions();
    const calque = d3.select("#calque-conditions");

    // Fond de jour ou de nuit, selon la situation sur la France
    const nuit = nuitSurLaFrance(carte);
    if (nuit !== etat.nuitConditions) {
        etat.nuitConditions = nuit;
        etat.fondsAJour.delete("conditions");
    }
    scene.classList.toggle("conditions-nuit", nuit);
    assurerFond("conditions");

    if (!carte) {
        placerConditionsStations();
        return;
    }

    const unite = largeurFrance();
    const espacement = Math.max(62, Math.min(150, unite / 6.4));
    const grandeur = Math.max(0.78, Math.min(1.55, espacement / 92));

    const symboles = [];
    for (const [x, y] of positionsSymboles(espacement)) {
        const s = situationAutour(carte, x, y, espacement * 0.5);
        // L'étiquette est à droite : le pictogramme se décale un peu à gauche
        if (s) symboles.push({ id: `${Math.round(x)}:${Math.round(y)}`, x, y, ...s });
    }

    calque.selectAll("g.vent-fort").remove();

    calque.selectAll("g.symbole")
        .data(symboles, d => d.id)
        .join("g")
        .attr("class", d => "symbole" + (d.confiance < 1.5 ? " estime" : ""))
        .attr("tabindex", 0)
        .attr("transform", d => `translate(${d.x},${d.y})`)
        .html(d => `<circle r="${26 * grandeur}" fill="transparent"/>` +
            `<g transform="scale(${grandeur})" class="picto">${dessinSymbole(DESSIN_CATEGORIE[d.categorie], d.jour)}</g>`)
        .on("pointerenter focus", (evenement, d) => montrerBulle(d, bulleConditionFusion(d, carte)))
        .on("pointerleave blur", cacherBulle);

    placerVents(carte, espacement, grandeur, symboles);
    etat.conditionsPretes = true;
}

// Flèches de vent fort, plutôt sur les côtes et en mer (comme à la télévision),
// là où les rafales observées ou prévues atteignent 50 km/h.
function placerVents(carte, espacement, grandeur, symboles = []) {
    const calque = d3.select("#calque-conditions");
    calque.selectAll("g.vent-fort").remove();

    // Ne pas mélanger observations et prévisions.
    if (carte.mode === "prevision") return;

    const donnees = etat.donnees;
    if (!donnees || !donnees.disponible ||
        donnees.type === "prevision") return;

    // Vérifier la proximité temporelle des observations.
    const ecartMinutes = Math.abs(
        new Date(donnees.date) - new Date(carte.instant)
    ) / 60000;

    if (!Number.isFinite(ecartMinutes) || ecartMinutes > 60) return;

    const candidats = (donnees.stations || [])
        .filter(s =>
            Number.isFinite(s.vent) &&
            s.vent * 3.6 >= 1 &&
            s.vent * 3.6 <= 250 &&
            Number.isFinite(s.direction_vent) &&
            s.direction_vent >= 0 &&
            s.direction_vent <= 360
        )
        .map(s => {
            const [x, y] = etat.projection([
                s.longitude, s.latitude
            ]);

            return {
                station: s,
                x,
                y,
                vitesse: Math.round(s.vent * 3.6),
                direction: s.direction_vent
            };
        })
        .filter(d =>
            dansFrance(d.x, d.y) &&
            symboles.every(s =>
                Math.hypot(s.x - d.x, s.y - d.y)
                    > espacement * 0.48
            )
        );

    // Répartition géographique régulière.
    const retenus = [];

    for (const [x, y] of positionsSymboles(espacement * 1.35)) {
        const proches = candidats
            .filter(d =>
                Math.hypot(d.x - x, d.y - y) < espacement &&
                retenus.every(r =>
                    Math.hypot(r.x - d.x, r.y - d.y)
                        > espacement * 1.05
                )
            )
            .sort((a, b) =>
                Math.hypot(a.x - x, a.y - y) -
                Math.hypot(b.x - x, b.y - y)
            );

        if (proches.length) retenus.push(proches[0]);
    }

    calque.selectAll("g.vent-fort")
        .data(retenus, d => d.station.id)
        .join("g")
        .attr("class", "vent-fort")
        .attr("transform", d =>
            `translate(${d.x},${d.y}) scale(${grandeur * 0.85})`
        )
        .html(d => {
            const couleur = d.vitesse >= 60 ? "#ffad55" :
                            d.vitesse >= 40 ? "#ffe36b" :
                            "#ffffff";

            const fleche = d.vitesse === 0
                ? `<circle r="5" fill="none"
                    stroke="${couleur}" stroke-width="2"/>`
                : `<path
                    transform="rotate(${d.direction + 180})"
                    d="M0 12 V-13 M-6 -6 L0 -13 6 -6"
                    fill="none"
                    stroke="${couleur}"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"/>`;

            return fleche +
                `<text class="vent-chiffre"
                    x="13" y="5">${d.vitesse}</text>`;
        });
}

function bulleConditionFusion(d, carte) {
    const libelle = LIBELLES_CONDITION[DESSIN_CATEGORIE[d.categorie]][d.jour ? 0 : 1];
    const lignes = [];
    if (d.temperature !== null) lignes.push(["Température", `${nombre(d.temperature, 0)} °C`]);
    if (d.rafale !== null) lignes.push(["Rafales", `${d.rafale} km/h`]);

    const noms = [];
    if (d.sources & 1) noms.push("radar");
    if (d.sources & 2) noms.push("satellite");
    if (d.sources & 8) noms.push("stations");
    if (d.sources & 4) noms.push("modèle AROME");

    const fiabilite = carte.mode === "prevision"
        ? "Prévision du modèle AROME"
        : d.confiance >= 2.5 ? "Observé (radar et satellite)"
        : d.confiance >= 1.5 ? "Observé en partie, complété par d'autres sources"
        : "Estimation : sources incomplètes ou en désaccord";

    return `<div class="lieu">${echapper(libelle)}</div>` +
        `<div class="station">${echapper(fiabilite)}</div>` +
        listeBulle(lignes) +
        (noms.length ? `<div class="station" style="margin-top:8px">D'après : ${echapper(noms.join(", "))}</div>` : "");
}

// --- Repli : conditions déduites des seules stations ------------------------

function placerConditionsStations() {
    const calque = d3.select("#calque-conditions");
    calque.selectAll("g.vent-fort").remove();

    const stations = (etat.donnees && etat.donnees.disponible ? etat.donnees.stations : [])
        .filter(s => s.condition && Number.isFinite(s.latitude) && Number.isFinite(s.longitude));

    if (!stations.length) {
        calque.selectAll("*").remove();
        etat.conditionsPretes = true;
        return;
    }

    const unite = largeurFrance();
    const tailleCase = Math.max(62, unite / 6.4);
    const grandeur = Math.max(0.78, Math.min(1.55, tailleCase / 92));

    const famille = s => s.condition.code.split("-")[0];
    const choix = choisirParCases(stations, tailleCase, 0, famille);

    calque.selectAll("g.symbole")
        .data(choix, d => d.station.id)
        .join("g")
        .attr("class", "symbole")
        .attr("tabindex", 0)
        .attr("transform", d => `translate(${d.x},${d.y})`)
        .html(d => {
            const c = d.station.condition;
            return `<circle r="${26 * grandeur}" fill="transparent"/>` +
                `<g transform="scale(${grandeur})" class="picto">${dessinSymbole(c.code, c.jour)}</g>`;
                    })
        .on("pointerenter focus", (evenement, d) => montrerBulle(d, bulleCondition(d.station)))
        .on("pointerleave blur", cacherBulle);

    etat.conditionsPretes = true;
}

// ---------------------------------------------------------------------------
// 8. Tableau 4 — satellite
// ---------------------------------------------------------------------------

// Images satellite : profil choisi selon la finesse utile à l'écran.
//   leger     1280 px pour 38° de longitude
//   standard  1990 px
//   haute     pleine résolution, Europe de l'Ouest seulement
// Les petits écrans n'ont pas besoin de plus que « leger » : rien d'inutile
// n'est téléchargé ni décodé. Les grands écrans gardent la pleine finesse.
const PROFILS_SATELLITE = {
    leger: { pxParDegre: 1280 / 38, emprise: [-16, 34, 22, 60] },
    standard: { pxParDegre: 1990 / 38, emprise: [-16, 34, 22, 60] },
    haute: { pxParDegre: 2514 / 24, emprise: [-9.5, 37, 14.5, 56] }
};

function profilSatellite() {
    const force = PARAMETRES.get("satellite");
    if (PROFILS_SATELLITE[force]) return force;
    const p = etat.projection;
    const [o, n] = p.invert([0, 0]);
    const [e, s] = p.invert([etat.largeur, etat.hauteur]);
    const besoin = etat.largeur * etat.echelle / (e - o);        // pixels de toile par degré
    const tient = ([eo, es, ee, en]) => o >= eo && e <= ee && s >= es && n <= en;
    if (PROFIL.lente) return "leger";
    if (besoin <= PROFILS_SATELLITE.leger.pxParDegre * 1.15) return "leger";
    if (PROFIL.nom === "leger") return "standard";
    if (besoin <= PROFILS_SATELLITE.standard.pxParDegre * 1.15 || !tient(PROFILS_SATELLITE.haute.emprise)) return "standard";
    return "haute";
}

// Le dernier état connu du satellite, pour le sous-titre et l'état « indisponible »
function satelliteAffiche() {
    const r = etat.rendus.satellite;
    return r && r.pret;
}

// ---------------------------------------------------------------------------
// 9. Lecture des animations (frise temporelle)
// ---------------------------------------------------------------------------

const DUREE_BOUCLE = 10000;   // une boucle complète, en millisecondes
const ARRET_FIN = 2600;       // pause sur la dernière observation

// Tableau animé -> source des images
const SOURCE_ANIMEE = { precipitations: "radar", satellite: "satellite" };
const sourceAffichee = () => SOURCE_ANIMEE[etat.tableau] || null;

const lecteur = {
    source: null,             // "radar" ou "satellite"
    instant: 0,               // ms, temps de la séquence affichée
    lecture: !reduitMouvement,
    pause: 0,                 // temps restant sur la dernière image
    precedent: 0,
    boucle: 0,
    sale: false               // à redessiner au prochain passage
};

async function chargerAnimation(source, jour) {
    const cache = etat.animations[source];
    const connue = cache.get(jour);
    const aujourdhui = etat.donnees && etat.donnees.aujourdhui;

    const dureeCache = source === "satellite"
        ? RAFRAICHISSEMENT_SATELLITE
        : 3 * 60000;

    if (connue && (connue.absente
        ? Date.now() - connue.recu < 60000
        : jour !== aujourdhui ||
          Date.now() - connue.recu < dureeCache)) {
        return connue;
    }

    let resultat;
    try {
        const profilRadar = PROFIL.nom === "leger" ? "leger" : "standard";
        const url = MODE_OPERA && source === "radar"
            ? `${URL_RADAR}?jour=${encodeURIComponent(jour)}&profil=${profilRadar}`
            : source === "satellite"
                ? `${URL_SATELLITE}?jour=${encodeURIComponent(jour)}&profil=${profilSatellite()}`
                : `${URL_ANIMATION}?source=${source}&jour=${encodeURIComponent(jour)}`;

        const reponse = await fetch(url);
        if (!reponse.ok) {
            const corps = await reponse.json().catch(() => ({}));
            resultat = { absente: true, motif: corps.erreur || `Erreur ${reponse.status}` };
        } else {
            const donnees = await reponse.json();

            if (MODE_OPERA && source === "radar" && donnees.jour !== jour) {
                const absente = {
                    absente: true,
                    motif: "Observation OPERA indisponible pour ce jour.",
                    recu: Date.now()
                };
                cache.set(jour, absente);
                return absente;
            }

            if (source === "satellite") {
                resultat = {
                    ...donnees,
                    trames: donnees.observations.map(trame => ({
                        ...trame,
                        ms: Date.parse(trame.instant)
                    }))
                };
                // Journée sans observation : la dernière image connue, à défaut
                if (!resultat.trames.length && donnees.secours) {
                    resultat.trames = [{ ...donnees.secours, ms: Date.parse(donnees.secours.instant) }];
                    resultat.video = null;
                    resultat.secours = true;
                }
            } else if (MODE_OPERA) {
                resultat = HKOAnime.sequenceBinaire(donnees);
            } else {
                resultat = HKOAnime.decoder(donnees);
            }
            if (!resultat.trames.length) resultat = { absente: true, motif: "Aucune image." };
        }
    } catch (erreur) {
        resultat = { absente: true, motif: "Le serveur n'a pas répondu.", reseau: true };
    }
    resultat.recu = Date.now();

    // Même séquence qu'avant : on garde celle déjà envoyée au rendu
    if (connue && !connue.absente && !resultat.absente &&
        connue.trames.length === resultat.trames.length &&
        connue.trames.every((trame, i) =>
            trame.ms === resultat.trames[i].ms) &&
        (connue.video && connue.video.url) === (resultat.video && resultat.video.url)) {
        connue.recu = resultat.recu;
        return connue;
    }

    if (source === "satellite" &&
        resultat.absente && connue && !connue.absente) {
        connue.recu = Date.now();
        return connue;
    }

    cache.set(jour, resultat);
    // Mémoire bornée : les trois dernières journées consultées
    while (cache.size > 3) {
        const ancienne = [...cache.keys()].find(j => j !== jour && j !== etat.jour);
        if (!ancienne) break;
        cache.delete(ancienne);
    }
    return resultat;
}

function sequenceDuJour(source) {
    const s = etat.jour && etat.animations[source].get(etat.jour);
    return s && !s.absente ? s : null;
}

function creerRenduSatellite() {
    const mode = PARAMETRES.get("lecteur") === "images" ? "images" : "video";
    const peutLireH264 = document.createElement("video").canPlayType('video/mp4; codecs="avc1.640033"');
    return HKOSatellite.creer({
        toile: $("fond-satellite"),
        voile: $("voile-satellite"),
        conteneur: $("video-satellite"),
        projection: () => etat.projection,
        echelle: () => etat.echelle,
        mode: peutLireH264 ? mode : "images",
        maxImages: PROFIL.nom === "leger" ? 2 : PROFIL.nom === "riche" ? 4 : 3,
        dureeBoucle: DUREE_BOUCLE,
        journal,
        surImage(trame) {
            etat.instantGeocolour = trame.instant;
            if (etat.tableau === "satellite") actualiserHabillage();
        }
    });
}

// Trames OPERA binaires : téléchargées, converties (Worker) et envoyées au
// processeur graphique une à une ; l'animation est visible dès la première.
const remplissages = new WeakMap();

function remplirRadar(sequence, r) {
    if (remplissages.get(r) === sequence) return;
    remplissages.set(r, sequence);
    const { nx, ny } = sequence.grille;
    const n = nx * ny;
    const cle = `${sequence.jour}:${sequence.trames[0].instant}:${sequence.trames.length}:${Math.random()}`;
    const recues = new Set();
    const t = sequence.trames;
    // D'abord la dernière (affichée à l'arrêt), puis dans l'ordre
    const ordre = [t.length - 1, ...t.keys()].filter((v, i, a) => a.indexOf(v) === i);
    const actif = () => r.sequence === sequence && remplissages.get(r) === sequence;

    const mouvementEntre = async i => {
        if (!recues.has(i) || !recues.has(i + 1) || !actif()) return;
        if (t[i + 1].ms - t[i].ms > sequence.pas * 2.5) return;   // lacune : pas de mouvement deviné
        try {
            const m = await calcul.executer("mouvement", { cle, i, nx, ny, liberer: recues.has(i - 1) || i === 0 });
            if (actif() && m) r.definirFlux(i, m);
        } catch (e) { /* fondu simple */ }
    };

    let suivant = 0;
    const charger = async () => {
        while (suivant < ordre.length && actif()) {
            const i = ordre[suivant++];
            try {
                const reponse = await fetch(t[i].url);
                if (!reponse.ok) throw new Error(`${reponse.status}`);
                const octets = await reponse.arrayBuffer();
                if (!actif()) return;
                const { rgba } = await calcul.executer("trame", { octets, source: "radar", n, cle, i },
                                                       calcul.parallele ? [octets] : undefined);
                if (!actif()) return;
                r.ajouterTrame(i, rgba);
                recues.add(i);
                await mouvementEntre(i - 1);
                await mouvementEntre(i);
                if (!lecteur.boucle && lecteur.source === "radar") dessinerAnimation();
            } catch (erreur) {
                console.info("HKO : trame radar manquante —", erreur.message);
            }
        }
        if (suivant >= ordre.length) calcul.executer("oublier", { cle }).catch(() => {});
    };
    // Deux téléchargements à la fois : rapide sans saturer une connexion lente
    charger();
    if (!PROFIL.lente) charger();
}

function creerRenduRadar() {
    const options = {
        surPerte() {
            journal({ type: "webgl_perdu", source: "radar" });
            scene.classList.add("radar-statique");
        },
        surRestauration(sequence) {
            journal({ type: "webgl_retabli", source: "radar" });
            const r = etat.rendus.radar;
            remplissages.delete(r);
            if (sequence) {
                if (sequence.opera) { r.charger(sequence, true); remplirRadar(sequence, r); }
                else r.charger(sequence);
            }
            actualiserHabillage();
            if (lecteur.source === "radar") demarrerLecture("radar");
        }
    };
    return window.HKOAnime ? HKOAnime.creer($("gl-radar"), "radar", options) : null;
}

function rendu(source) {
    if (source === "satellite") {
        if (!etat.rendus.satellite) etat.rendus.satellite = creerRenduSatellite();
        return etat.rendus.satellite;
    }
    if (etat.rendus[source] === undefined) {
        etat.rendus[source] = creerRenduRadar();
        if (!etat.rendus[source]) scene.classList.add(`sans-gl-${source}`);
    }
    return etat.rendus[source];
}

// Prépare l'animation du tableau affiché (ou du suivant, en avance)
async function preparerAnimation(source) {
    const jour = etat.jour;
    if (!jour || !etat.donnees || etat.donnees.type === "prevision") return null;

    const sequence = await chargerAnimation(source, jour);
    if (etat.jour !== jour) return null;

    const r = rendu(source);

    if (source === "satellite" && sequence.absente) {
        return null;
    }

    if (r && !sequence.absente && r.sequence !== sequence) {

        const conserverLecture =
            source === "satellite" &&
            lecteur.source === source &&
            lecteur.sequence &&
            lecteur.sequence.jour === jour;

        if (conserverLecture) {
            const ancienneFin = lecteur.sequence.trames.at(-1).ms;
            const suivaitDirect =
                !lecteur.lecture && lecteur.instant >= ancienneFin;

            r.charger(sequence);
            lecteur.sequence = sequence;

            const debut = sequence.trames[0].ms;
            const fin = sequence.trames.at(-1).ms;

            lecteur.instant = suivaitDirect
                ? fin
                : Math.max(debut, Math.min(fin, lecteur.instant));

            construireFrise(sequence);
        } else {
            if (sequence.opera) {
                r.charger(sequence, true);
                remplirRadar(sequence, r);
            } else {
                r.charger(sequence);
            }

            if (lecteur.source === source) {
                lecteur.instant = sequence.trames.at(-1).ms;
            }
        }
    }

    if (sourceAffichee() === source) {
        demarrerLecture(source);
        actualiserHabillage();
    }

    return sequence;
}

function demarrerLecture(source) {
    const sequence = sequenceDuJour(source);
    const r = etat.rendus[source];
    if (!sequence || !r) {
        arreterLecture();
        $("frise").hidden = true;
        return;
    }

    const nouvelle = lecteur.source !== source || lecteur.sequence !== sequence;
    lecteur.source = source;
    lecteur.sequence = sequence;

    if (nouvelle) {
        if (source === "satellite") {
            lecteur.lecture = etat.jour !== etat.donnees?.aujourdhui
                && !reduitMouvement;
        }
        construireFrise(sequence);
        // On commence au début de la boucle (ou sur la dernière image, sans animation)
        lecteur.instant = lecteur.lecture ? sequence.trames[0].ms : sequence.trames.at(-1).ms;
        lecteur.pause = 0;
    }
    $("frise").hidden = false;

    cancelAnimationFrame(lecteur.boucle);
    lecteur.precedent = performance.now();
    lecteur.boucle = requestAnimationFrame(avancer);
}

function arreterLecture() {
    cancelAnimationFrame(lecteur.boucle);
    lecteur.boucle = 0;
}

// Une image par rafraîchissement d'écran pendant la lecture ; à l'arrêt, la
// boucle s'interrompt (rien n'est redessiné tant que rien ne change).
function avancer(maintenant) {
    const sequence = lecteur.sequence;
    if (!sequence || sourceAffichee() !== lecteur.source || document.hidden) {
        lecteur.boucle = 0;
        return;
    }

    const dt = Math.min(100, maintenant - lecteur.precedent);
    lecteur.precedent = maintenant;

    const debut = sequence.trames[0].ms, fin = sequence.trames.at(-1).ms;
    const r = etat.rendus[lecteur.source];
    const video = lecteur.source === "satellite" && r && r.utiliseVideo;
    const avant = lecteur.instant;

    if (lecteur.lecture && fin > debut) {
        if (lecteur.instant >= fin) {
            lecteur.pause += dt;
            if (lecteur.pause >= ARRET_FIN) {
                lecteur.instant = debut;
                lecteur.pause = 0;
            }
        } else if (video && r.utiliseVideo(lecteur.instant)) {
            // La vidéo donne l'heure : l'image affichée et la frise ne font qu'un
            const v = r.instantVideo();
            if (v !== null) lecteur.instant = Math.max(debut, Math.min(fin, v));
        } else {
            lecteur.instant = Math.min(fin, lecteur.instant + dt * (fin - debut) / DUREE_BOUCLE);
        }
    }

    if (lecteur.lecture || lecteur.instant !== avant || lecteur.sale) {
        lecteur.sale = false;
        dessinerAnimation();
    }

    if (!lecteur.lecture) {
        lecteur.boucle = 0;
        return;
    }
    lecteur.boucle = requestAnimationFrame(avancer);
}

function relancerBoucle() {
    if (lecteur.boucle || !lecteur.sequence) return;
    lecteur.precedent = performance.now();
    lecteur.boucle = requestAnimationFrame(avancer);
}

function dessinerAnimation() {
    const source = lecteur.source;
    const r = source && etat.rendus[source];
    if (!r || !lecteur.sequence) return;

    const commun = {
        instant: lecteur.instant,
        projection: etat.projection,
        echelle: etat.echelle
    };

    if (source === "radar") {
        const { seuils, couleurs } = paletteRadar();
        // Image pleine résolution par-dessus la dernière grille, si elle lui correspond
        const s = r.situation(lecteur.instant);
        const derniere = s && s.observee && s.avant === lecteur.sequence.trames.length - 1;
        const hd = !MODE_OPERA && derniere && radarDuJour() &&
            Date.parse(etat.radar.date_utc) === lecteur.sequence.trames.at(-1).ms;
        scene.classList.toggle("radar-hd", Boolean(hd));

        r.dessiner({
            ...commun,
            seuils: new Float32Array(seuils),
            couleurs: new Float32Array(couleurs.flatMap(c => rgb(c).map(v => v / 255))),
            hachures: true
        });
    } else {
        r.dessiner({ ...commun, lecture: lecteur.lecture && !document.hidden });
    }

    majFrise();
}

// --- Frise ------------------------------------------------------------------

function construireFrise(sequence) {
    const debut = sequence.trames[0].ms, fin = sequence.trames.at(-1).ms;
    const etendue = Math.max(1, fin - debut);
    $("frise-reperes").innerHTML = sequence.trames.map(t =>
        `<span style="left:${((t.ms - debut) / etendue * 100).toFixed(2)}%"></span>`).join("");
    // Heures rondes sous la frise
    const heures = [];
    const premiere = Math.ceil(debut / 3600000) * 3600000;
    for (let h = premiere; h <= fin; h += 3600000) {
        heures.push(`<span style="left:${((h - debut) / etendue * 100).toFixed(2)}%">${heureParis(new Date(h).toISOString()).replace(" 00", "")}</span>`);
    }
    $("frise-heures").innerHTML = heures.join("");
    majBoutonAnimation();
}

function majFrise() {
    const sequence = lecteur.sequence;
    if (!sequence) return;
    const debut = sequence.trames[0].ms, fin = sequence.trames.at(-1).ms;
    const part = fin > debut ? (lecteur.instant - debut) / (fin - debut) : 1;
    const curseur = $("frise-curseur");
    if (document.activeElement !== curseur) curseur.value = Math.round(part * 1000);
    $("frise").style.setProperty("--avance", part.toFixed(4));

    const r = etat.rendus[lecteur.source];
    const s = r && r.situation(lecteur.instant);
    if (!s) return;

    const heure = s.observee
        ? heureParis(sequence.trames[s.avant].instant)
        : heureParis(new Date(lecteur.instant).toISOString());
    const nature = s.observee ? "Observation"
        : s.lacune ? "Lacune"
        : "Interpolation";

    const cle = heure + nature;
    if (cle !== majFrise.derniere) {
        majFrise.derniere = cle;
        $("frise-heure").textContent = heure;
        $("frise-nature").textContent = nature;
        $("frise").classList.toggle("calculee", !s.observee);
    }
}

function majBoutonAnimation() {
    $("frise-lecture").setAttribute("aria-label",
        lecteur.lecture ? "Mettre l'animation en pause" : "Lire l'animation");
    $("frise").classList.toggle("en-pause", !lecteur.lecture);
}

function installerFrise() {
    $("frise-lecture").addEventListener("click", () => {
        lecteur.lecture = !lecteur.lecture;
        if (lecteur.lecture && lecteur.sequence && lecteur.instant >= lecteur.sequence.trames.at(-1).ms) {
            lecteur.instant = lecteur.sequence.trames[0].ms;
        }
        lecteur.pause = 0;
        majBoutonAnimation();
        suspendreDefilement();
        lecteur.sale = true;
        relancerBoucle();
    });

    $("frise-curseur").addEventListener("input", evenement => {
        const sequence = lecteur.sequence;
        if (!sequence) return;
        lecteur.lecture = false;
        majBoutonAnimation();
        suspendreDefilement();
        const debut = sequence.trames[0].ms, fin = sequence.trames.at(-1).ms;
        lecteur.instant = debut + (fin - debut) * Number(evenement.target.value) / 1000;
        if (!lecteur.boucle) dessinerAnimation();
        else lecteur.sale = true;
    });
}

// ---------------------------------------------------------------------------
// 10. Habillage
// ---------------------------------------------------------------------------

function bulleTemperature(s) {
    const lignes = [["Température", `${nombre(s.temperature, 1)} °C`]];

    if (Number.isFinite(s.humidite)) lignes.push(["Humidité", `${Math.round(s.humidite)} %`]);
    if (Number.isFinite(s.vent)) lignes.push(["Vent", `${Math.round(s.vent * 3.6)} km/h`]);
    if (Number.isFinite(s.altitude)) lignes.push(["Altitude", `${Math.round(s.altitude)} m`]);

    return enteteBulle(s) + listeBulle(lignes);
}

function bulleCondition(s) {
    const c = s.condition;
    const lignes = [];

    if (Number.isFinite(s.temperature)) lignes.push(["Température", `${nombre(s.temperature, 1)} °C`]);
    if (Number.isFinite(s.precipitation) && s.precipitation > 0) {
        lignes.push(["Pluie", `${nombre(s.precipitation * 10, 1)} mm/h`]);
    }
    if (Number.isFinite(s.rafale)) lignes.push(["Rafales", `${Math.round(s.rafale * 3.6)} km/h`]);

    const libelle = LIBELLES_CONDITION[c.code][c.jour ? 0 : 1];
    const source = SOURCES_CONDITION[c.source];

    return enteteBulle(s, libelle) + listeBulle(lignes) +
        (source ? `<div class="station" style="margin-top:8px">D'après : ${echapper(source)}</div>` : "");
}

function enteteBulle(s, surtitre) {
    if (s.source === "arome") {
        return `<div class="lieu">${echapper(surtitre || "Prévision AROME")}</div>` +
            `<div class="station">Point de grille du modèle, pas une station</div>`;
    }
    const lieu = s.commune || s.nom;
    return `<div class="lieu">${echapper(surtitre || lieu)}</div>` +
        `<div class="station">${surtitre ? echapper(lieu) + " — " : ""}Station ${echapper(s.nom)}</div>`;
}

function listeBulle(lignes) {
    return `<dl>${lignes.map(([nom, valeur]) =>
        `<dt>${echapper(nom)}</dt><dd>${echapper(valeur)}</dd>`).join("")}</dl>`;
}

let survol = false;

function montrerBulle(d, html) {
    const bulle = $("bulle");
    bulle.innerHTML = html;
    bulle.hidden = false;

    const largeur = bulle.offsetWidth, hauteur = bulle.offsetHeight;
    let x = d.x + 18, y = d.y - hauteur - 14;

    if (x + largeur > etat.largeur - 8) x = d.x - largeur - 18;
    if (x < 8) x = 8;
    if (y < 8) y = d.y + 22;

    bulle.style.left = `${x}px`;
    bulle.style.top = `${y}px`;

    survol = true;
    clearTimeout(minuterieDefilement);
    $("lecture").parentElement.classList.remove("defile");
}

function cacherBulle() {
    $("bulle").hidden = true;
    if (survol) {
        survol = false;
        planifierDefilement();
    }
}

function legendeTemperatures() {
    // Échelle en zones, au pas du jour, autour des valeurs observées
    const pas = etat.pasBande || 2;
    let bas = -10, haut = 40;
    if (etat.extremes) {
        bas = Math.floor((etat.extremes.mini.temperature - 2) / pas) * pas;
        haut = Math.ceil((etat.extremes.maxi.temperature + 2) / pas) * pas;
        while ((haut - bas) / pas > 16) { bas += pas; haut -= pas; }
        if (haut - bas < 6 * pas) { bas -= pas; haut += pas; }
    }
    const zones = [];
    for (let t = bas; t < haut; t += pas) zones.push(t);
    const cases = zones.map(t =>
        `<span style="background:${teinteTemperature(t + pas / 2)}"></span>`).join("");
    const etiquettes = zones.filter((t, i) => i % Math.ceil(zones.length / 7) === 0)
        .map(t => `<span style="left:${((t - bas) / (haut - bas) * 100).toFixed(1)}%">${t}</span>`).join("");

    let reperes = "";
    if (etat.extremes) {
        const { mini, maxi } = etat.extremes;
        const lieu = s => s.source === "arome" ? "" : echapper(s.commune || s.nom);
        reperes = `<div class="legende-reperes">
            <span>Plus froid <b class="mini">${nombre(mini.temperature, 1)} °C</b> ${lieu(mini)}</span>
            <span>Plus chaud <b class="maxi">${nombre(maxi.temperature, 1)} °C</b> ${lieu(maxi)}</span>
        </div>`;
    }

    return `<div class="echelle-zones" aria-label="Zones de ${pas} °C">
        <div class="cases">${cases}</div>
        <div class="graduations">${etiquettes}<span class="unite">°C</span></div>
    </div>${reperes}
    <div class="note-legende">Chiffres : mesures des stations. Zones colorées : estimation entre les stations.</div>`;
}

function legendeRadar(animation) {
    const { seuils, couleurs } = paletteRadar();
    const unite = (etat.radar && etat.radar.unite) || "mm/h";

    const classes = seuils.map((seuil, i) => {
        const dernier = i === seuils.length - 1;
        return `<span style="background-image:linear-gradient(${couleurs[i]}, ${couleurs[i]})">` +
            `${String(seuil).replace(".", ",")}${dernier ? "+" : ""}</span>`;
    }).join("");

    const hors = animation || etat.radarCouverture
        ? `<div class="note-legende"><span class="hachure-exemple"></span>Hachures : zone sans mesure radar</div>`
        : "";
    const source = MODE_OPERA
        ? `<div class="attributions">Radar : EUMETNET OPERA — <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a> — Données reprojetées et colorisées par HKO Météo</div>`
        : `<div class="attributions">Radar : Météo-France</div>`;

        return `<div class="classes" aria-label="Intensité en ${echapper(unite)}">${classes}<span style="min-width:0;padding-left:6px">${echapper(unite)}</span></div>${hors}${source}`;
    }

function habillageConditions(carte) {
    const p = carte.provenance || {};
    let sousTitre;

    if (carte.mode === "prevision") {
        const run = p.arome && p.arome.run;
        sousTitre = `Prévues pour ${heureParis(carte.instant)} par le modèle AROME de Météo-France` +
            (run ? ` (calcul de ${heureParis(run)}).` : ".");
    } else {
        const observees = [];
        if (p.radar && p.radar.retenue) observees.push("radar");
        if (p.satellite && p.satellite.retenue) observees.push("satellite");
        if (p.stations && p.stations.retenue) observees.push("stations");
        const complement = p.arome && p.arome.retenue ? ", complétées par le modèle AROME" : "";
        const age = (Date.now() - new Date(carte.instant)) / 60000;
        const ancienne = carte.mode === "observation" && etat.jour === (etat.donnees && etat.donnees.aujourdhui) && age > 60
            ? ` Dernière situation disponible : il y a ${age < 120 ? Math.round(age) + " min" : Math.round(age / 60) + " h"}.`
            : "";
        sousTitre = `Situation de ${heureParis(carte.instant)} d'après ${observees.length ? observees.join(", ") : "le modèle seul"}` +
            `${complement}.${ancienne}`;
    }

    // Légende : les situations présentes sur la France, des plus fréquentes aux plus rares
    const jour = !etat.nuitConditions;
    const resume = Object.entries(carte.resume_france || {})
        .filter(([nom, n]) => nom !== "inconnu" && n > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6);

    const symboles = resume.map(([nom]) => {
        const code = DESSIN_CATEGORIE[nom];
        return `<span class="cle-symbole"><svg viewBox="-26 -26 52 52" aria-hidden="true"><g class="picto">${dessinSymbole(code, jour)}</g></svg>${echapper(LIBELLES_CONDITION[code][jour ? 0 : 1])}</span>`;
    }).join("");

    const attributions = Object.values(p).filter(s => s && s.retenue && s.attribution).map(s => s.attribution);
    const estime = carte.mode !== "prevision"
        ? `<div class="note-legende"><span class="estime-exemple"></span>Symbole estompé : estimation, sources incomplètes</div>` : "";

    const legende = `<div class="cles-conditions">${symboles}</div>` +
        (carte.mode !== "prevision"
            ? `<div class="note-legende">➝ Vent moyen mesuré (km/h)</div>`
            : "") +
        `${estime}` +
        (attributions.length ? `<div class="attributions">${echapper(attributions.join(" — "))}</div>` : "");

    return [sousTitre, legende];
}

function habillageSatellite(sequence) {
    // Comme avant : l'heure de la dernière observation de la journée
    const instant = sequence && sequence.trames.length
        ? sequence.trames.at(-1).instant
        : etat.instantGeocolour;

    const date = instant
        ? new Date(instant).toLocaleDateString("fr-FR", {
            day: "numeric",
            month: "long",
            timeZone: "Europe/Paris"
        })
        : "";

    const sousTitre = instant
        ? `Observation du ${date} à ${heureParis(instant)}`
        : "Images satellite Meteosat";

    const legende =
        `<div class="attributions">
            EUMETSAT Meteosat · NASA Black Marble
            · Traitement visuel HKO
        </div>`;

    return [sousTitre, legende];
}

function etatIndisponible() {
    // Renvoie [titre, motif] si le tableau courant n'a rien à montrer, sinon null
    const d = etat.donnees;

    if (!d) return null;

    if (d.erreur) return ["Observations inaccessibles", d.erreur, true];

    if (etat.tableau === "conditions") {
        const carte = etat.jour && etat.conditions.get(etat.jour);
        if (!carte) return null;                       // encore en chargement
        if (!carte.absente) return null;
        if (d.type === "prevision") return ["Pas encore de prévision pour ce jour", carte.motif];
        // Repli sur les stations si elles ont des observations ce jour-là
        if (d.disponible) return null;
        return ["Pas de carte des conditions pour ce jour", carte.motif, Boolean(carte.reseau)];
    }

    if (etat.tableau === "satellite") {
        if (d.type === "prevision") {
            return ["Pas d'image satellite pour un jour à venir",
                "Le satellite montre les nuages observés. Les nuages prévus apparaissent dans les conditions météo."];
        }
        if (satelliteAffiche()) return null;
        const sequence = etat.jour && etat.animations.satellite.get(etat.jour);
        if (!sequence || !sequence.absente) return null;          // encore en chargement
        if (sequence.reseau) return ["Satellite inaccessible", sequence.motif, true];
        return [
            "Pas d'image satellite pour ce jour",
            sequence.motif || "Aucune observation GeoColour disponible."
        ];
    }

    if (d.type === "prevision") {
        if (etat.tableau === "precipitations") {
            return ["Pas de radar pour un jour à venir",
                "La carte des précipitations montre des mesures radar. Les précipitations prévues " +
                "apparaissent dans les conditions météo."];
        }
        if (!d.disponible) return ["Pas encore de prévision pour ce jour", d.motif || ""];
        return null;
    }

    if (etat.tableau === "precipitations") {
        const animation = etat.animations.radar.get(etat.jour);
        if (animation && !animation.absente && etat.rendus.radar) return null;
        if (radarDuJour()) return null;
        if (!animation || etat.radar === undefined) return null;   // encore en chargement
        if (animation.reseau) return ["Radar inaccessible", animation.motif, true];
        return ["Pas d'image radar pour ce jour", animation.motif ||
            "Aucune mosaïque radar n'a été archivée pour ce jour."];
    }

    if (!d.disponible) return ["Pas d'observations pour ce jour", d.motif || ""];

    return null;
}

function tableauDisponible(tableau) {
    const precedent = etat.tableau;
    etat.tableau = tableau;
    const vide = etatIndisponible();
    etat.tableau = precedent;
    return !vide;
}

function actualiserHabillage() {
    const d = etat.donnees;
    let titre, sousTitre = "", legende = "";

    if (etat.tableau === "temperatures") {
        titre = "Températures";
        if (d && d.disponible && d.type === "prevision") {
            sousTitre = `Prévues pour ${heureParis(d.date)} par le modèle AROME de Météo-France` +
                (d.run ? ` (calcul de ${heureParis(d.run)}).` : ".");
            legende = legendeTemperatures();
        } else if (d && d.disponible) {
            const n = stationsValides().length;
            sousTitre = `Mesurées à ${heureParis(d.date)} par ${nombre(n)} stations Météo-France.`;
            legende = legendeTemperatures();
        }
    } else if (etat.tableau === "precipitations") {
        titre = "Précipitations";
        const animation = sequenceDuJour("radar");
        if (animation && etat.rendus.radar) {
            const origine = MODE_OPERA
                ? "les radars européens OPERA"
                : "les radars Météo-France";

            const debut = heureParis(animation.trames[0].instant);
            const fin = heureParis(animation.trames.at(-1).instant);

            const periode = debut === fin
                ? `à ${debut}`
                : `de ${debut} à ${fin}`;

            sousTitre = `Intensité des précipitations d'après ${origine}, ${periode}. Pas une prévision.`;

            legende = legendeRadar(true);
        } else if (radarDuJour()) {
            sousTitre = `Image radar ${MODE_OPERA ? "EUMETNET OPERA" : "Météo-France"} de ${heureParis(etat.radar.date_utc)}. ` +
                "Pluie mesurée, pas une prévision.";
            legende = legendeRadar(false);
        } else if (d && d.type !== "prevision" &&
                   (etat.radar === undefined || !etat.animations.radar.get(etat.jour))) {
            sousTitre = "Chargement du radar…";
        }
    } else if (etat.tableau === "conditions") {
        titre = "Conditions météo";
        const carte = carteConditions();
        if (carte) {
            [sousTitre, legende] = habillageConditions(carte);
        } else if (d && d.disponible && d.type !== "prevision") {
            sousTitre = `Observées à ${heureParis(d.date)} par les stations. ` + (d.ciel_mesure
                ? "Pluie, neige, brouillard et état du ciel d'après leurs mesures."
                : "L'état du ciel n'est pas mesuré : radar et satellite ne sont pas encore disponibles.");
        } else if (etat.jour && !etat.conditions.get(etat.jour)) {
            sousTitre = "Chargement de la carte des conditions…";
        }
    } else {
        titre = "Satellite";
        const sequence = sequenceDuJour("satellite");
        if (sequence && etat.rendus.satellite) {
            [sousTitre, legende] = habillageSatellite(sequence);
        } else if (d && d.type !== "prevision" && !etat.animations.satellite.get(etat.jour)) {
            sousTitre = "Chargement des images satellite…";
        }
    }

    $("titre-tableau").textContent = titre;
    $("soustitre-tableau").innerHTML = echapper(sousTitre) || "&nbsp;";
    $("legende").innerHTML = legende;

    const vide = etatIndisponible();
    const panneau = $("indisponible");

    scene.classList.toggle("vide", Boolean(vide));
    panneau.hidden = !vide;

    if (vide) {
        $("indisponible-titre").textContent = vide[0];
        $("indisponible-motif").textContent = vide[1];
        $("indisponible-action").hidden = !vide[2];
    }

    const anime = (etat.tableau === "precipitations" || etat.tableau === "satellite") &&
        !vide && lecteur.source === sourceAffichee() && sequenceDuJour(sourceAffichee());
    $("frise").hidden = !anime;

    // Radar sans animation (pas d'archive, pas de WebGL) : image publiée seule
    scene.classList.toggle("radar-statique", !(sequenceDuJour("radar") && etat.rendus.radar));

    // Jour consulté
    if (etat.jour) {
        const aujourdhui = d && d.aujourdhui;
        let libelle = libelleJour(etat.jour);
        if (etat.jour === aujourdhui) libelle = `Aujourd'hui, ${libelle.toLowerCase()}`;

        $("jour-libelle").textContent = libelle;
        $("jour-precedent").disabled =
            !d || !d.premier_jour || etat.jour <= d.premier_jour;

        $("jour-suivant").disabled =
            !d || !aujourdhui || etat.jour >= aujourdhui;

        $("jour-suivant").style.visibility =
            $("jour-suivant").disabled ? "hidden" : "visible";
    }
}

// ---------------------------------------------------------------------------
// 11. Navigation
// ---------------------------------------------------------------------------

let minuterieDefilement = null;
let minuterieReprise = null;

function planifierDefilement() {
    clearTimeout(minuterieDefilement);

    const barre = $("lecture").parentElement;
    const actif = etat.auto && etat.ouverte && !document.hidden && !survol;

    // Relance l'animation du trait de progression
    barre.classList.remove("defile");
    if (!actif) return;

    void barre.offsetWidth;
    barre.classList.add("defile");

    minuterieDefilement = setTimeout(() => {
        let suivant = etat.tableau;

        // Tableau suivant ayant quelque chose à montrer
        for (let i = 0; i < TABLEAUX.length; i++) {
            suivant = TABLEAUX[(TABLEAUX.indexOf(suivant) + 1) % TABLEAUX.length];
            if (tableauDisponible(suivant)) break;
        }

        afficherTableau(suivant);
    }, DUREE_TABLEAU);
}

// Un choix manuel suspend le défilement ; il reprend seul après une minute.
function suspendreDefilement() {
    etat.auto = false;
    clearTimeout(minuterieReprise);
    minuterieReprise = setTimeout(() => reglerLecture(true), REPRISE_AUTO);
    majBoutonLecture();
    planifierDefilement();
}

function afficherTableau(tableau, manuel = false) {
    const change = tableau !== etat.tableau;

    if (manuel) suspendreDefilement();

    etat.tableau = tableau;
    scene.dataset.tableau = tableau;
    cacherBulle();

    for (const bouton of document.querySelectorAll(".tableaux button[data-tableau]")) {
        bouton.setAttribute("aria-pressed", String(bouton.dataset.tableau === tableau));
    }

    assurerFond(tableau);

    if (tableau === "temperatures" && change) {
        // Autres stations à chaque passage
        etat.rotation = (etat.rotation + 1) % 4;
        placerTemperatures();
    }

    if (tableau === "precipitations") {
        placerVilles();
        preparerAnimation("radar");
    }

    if (tableau === "conditions") preparerConditions();

    if (tableau === "satellite") {
        preparerAnimation("satellite");
    } else if (etat.rendus.satellite) {
        etat.rendus.satellite.suspendre();     // plus aucun décodage hors du tableau
    }

    if (tableau !== "precipitations" && tableau !== "satellite") arreterLecture();
    else if (change) demarrerLecture(SOURCE_ANIMEE[tableau]);

    actualiserHabillage();

    if (change && !reduitMouvement) {
        const bandeau = $("bandeau");
        bandeau.classList.remove("change");
        void bandeau.offsetWidth;
        bandeau.classList.add("change");
    }

    // Préparation du tableau suivant pendant que celui-ci est à l'écran
    const plusTard = window.requestIdleCallback || (f => setTimeout(f, 300));
    if (tableau === "temperatures") plusTard(() => { assurerFond("precipitations"); preparerAnimation("radar"); });
    if (tableau === "precipitations") plusTard(() => preparerConditions());
    if (tableau === "conditions") plusTard(() => preparerAnimation("satellite"));

    planifierDefilement();
}

// Charge la carte fusionnée du jour affiché (une seule fois), puis la dessine
let conditionsEnCours = null;

async function preparerConditions() {
    const jour = etat.jour;
    if (!jour || !chemins.departements) return;

    const connue = etat.conditions.get(jour);
    const aujourdhui = etat.donnees && etat.donnees.aujourdhui;
    const perimee = connue && jour === aujourdhui && Date.now() - connue.recu > 3 * 60000;

    if (!connue || perimee) {
        if (conditionsEnCours !== jour) {
            conditionsEnCours = jour;
            await chargerConditions(jour);
            conditionsEnCours = null;
            if (etat.jour !== jour) return;
            etat.conditionsPretes = false;
        } else {
            return;
        }
    }

    if (!etat.conditionsPretes) placerConditions();
    if (etat.tableau === "conditions") actualiserHabillage();
}

function majBoutonLecture() {
    $("lecture").setAttribute("aria-label",
        etat.auto ? "Mettre le défilement en pause" : "Reprendre le défilement");
}

function reglerLecture(actif) {
    etat.auto = actif;
    // Le défilement reprend : les animations aussi
    if (actif && !reduitMouvement && !lecteur.lecture) {
        lecteur.lecture = true;
        majBoutonAnimation();
        relancerBoucle();
    }
    clearTimeout(minuterieReprise);
    majBoutonLecture();
    planifierDefilement();
}

async function chargerJour(jour, cleProgression) {
    const enCache = jour && etat.jours.get(jour);

    const maintenant = jourParis(new Date());

    if (enCache && enCache.aujourdhui === maintenant) {
        if (Date.now() - enCache.recu < RAFRAICHISSEMENT) {
            return enCache;
        }

        if (enCache.jour < maintenant && enCache.disponible) {
            return enCache;
        }
    }

    const url = jour ? `${URL_API}?jour=${encodeURIComponent(jour)}` : URL_API;
    const donnees = await lireJson(await telecharger(url, cleProgression));

    donnees.recu = Date.now();
    etat.jours.set(donnees.jour, donnees);
    // Mémoire bornée : quelques journées seulement
    for (const j of [...etat.jours.keys()]) {
        if (etat.jours.size <= 4) break;
        if (j !== donnees.jour && j !== etat.jour) etat.jours.delete(j);
    }
    for (const j of [...etat.conditions.keys()]) {
        if (etat.conditions.size <= 3) break;
        if (j !== etat.jour) etat.conditions.delete(j);
    }

    return donnees;
}

function installerDonnees(donnees) {
    const ancienneDate = etat.donnees?.date;

    etat.donnees = donnees;
    etat.jour = donnees.jour;
    etat.conditionsPretes = false;

    if (ancienneDate !== donnees.date) {
        // Nouvelle heure d'observation : nouvelle ambiance du fond des
        // températures (le relief, lui, n'est pas recalculé)
        etat.fondsAJour.delete("temperatures");
        etat.versionAmbiance++;
        if (etat.tableau === "temperatures") assurerFond("temperatures");
    }
}

let demandeJour = 0;

async function allerAuJour(jour) {
    if (jour > jourParis(new Date())) return;
    const demande = ++demandeJour;

    cacherBulle();
    etat.jour = jour;
    $("jour-libelle").textContent = libelleJour(jour);
    $("jour-precedent").disabled = $("jour-suivant").disabled = true;

    let donnees;
    try {
        donnees = await chargerJour(jour);
    } catch (erreur) {
        console.error(erreur);
        donnees = {
            ...(etat.donnees || {}), jour, disponible: false, stations: [],
            type: "observation",
            erreur: "Le serveur n'a pas répondu. Vérifiez la connexion, puis réessayez."
        };
    }

    if (demande !== demandeJour) return;   // une autre demande est passée devant

    installerDonnees(donnees);
    lecteur.source = null;                 // la frise repart sur le nouveau jour
    await attendreImage();

    dessinerChamp();
    placerTemperatures();
    placerRadar();
    if (etat.tableau === "conditions") await preparerConditions();
    if (sourceAffichee()) await preparerAnimation(sourceAffichee());

    // Si le tableau affiché n'a rien pour ce jour mais qu'un autre en a, on y va.
    if (!tableauDisponible(etat.tableau) && donnees.type !== "prevision") {
        const autre = TABLEAUX.find(tableauDisponible);
        if (autre) return afficherTableau(autre);
    }

    actualiserHabillage();
    planifierDefilement();
}

function installerCommandes() {
    for (const bouton of document.querySelectorAll(".tableaux button[data-tableau]")) {
        bouton.addEventListener("click", () => afficherTableau(bouton.dataset.tableau, true));
    }

    $("lecture").addEventListener("click", () => reglerLecture(!etat.auto));

    // Les flèches restent sans effet tant que le premier jour n'est pas chargé
    $("jour-precedent").addEventListener("click", () => etat.jour && allerAuJour(decalerJour(etat.jour, -1)));
    $("jour-suivant").addEventListener("click", () => etat.jour && allerAuJour(decalerJour(etat.jour, 1)));

    $("indisponible-action").addEventListener("click", () => {
        etat.jours.delete(etat.jour);
        etat.conditions.delete(etat.jour);
        etat.animations.radar.delete(etat.jour);
        etat.animations.satellite.delete(etat.jour);
        allerAuJour(etat.jour);
    });

    installerFrise();

    document.addEventListener("keydown", evenement => {
        if (evenement.target.closest("input, select, textarea")) return;
        if (evenement.key === "ArrowLeft" && !$("jour-precedent").disabled) $("jour-precedent").click();
        if (evenement.key === "ArrowRight" && !$("jour-suivant").disabled) $("jour-suivant").click();
    });

    document.addEventListener("visibilitychange", () => {
        planifierDefilement();
        if (!document.hidden && (etat.tableau === "precipitations" || etat.tableau === "satellite")) {
            demarrerLecture(sourceAffichee());
        }
    });

    // La carte suit la taille de la fenêtre
    let minuterie = null;
    let derniere = `${etat.largeur}x${etat.hauteur}`;

    new ResizeObserver(() => {
        clearTimeout(minuterie);
        minuterie = setTimeout(() => {
            const cadre = scene.getBoundingClientRect();
            const taille = `${Math.round(cadre.width)}x${Math.round(cadre.height)}`;
            if (taille === derniere || !etat.pays) return;
            derniere = taille;
            redessiner();
        }, 250);
    }).observe(scene);

    // Nouvelles observations et changement automatique de journée
    setInterval(async () => {
        const d = etat.donnees;

        if (document.hidden || !d) return;

        const maintenant = jourParis(new Date());

        // Passage à minuit en heure de Paris
        if (etat.jour === d.aujourdhui && maintenant !== d.aujourdhui) {
            await allerAuJour(maintenant);
            return;
        }

        // Respecter la consultation volontaire d'une autre journée
        if (etat.jour !== maintenant) return;
        try {
            const frais = await chargerJour(etat.jour);
            if (frais.date !== d.date && etat.jour === frais.jour) {
                installerDonnees(frais);
                dessinerChamp();
                placerTemperatures();
                actualiserHabillage();
            }
        } catch (erreur) { /* on réessaiera au prochain passage */ }
        chargerRadar();

        // Le satellite n'est actualisé que s'il est affiché (minuterie dédiée) :
        // aucune image n'est téléchargée ni décodée pour un tableau caché.

        if (etat.tableau === "conditions") preparerConditions();

        if (sourceAffichee() === "radar") {
            preparerAnimation("radar");
        }
    }, RAFRAICHISSEMENT);

    // Actualisation légère des observations satellite
    let actualisationSatelliteEnCours = false;

    setInterval(async () => {
        if (document.hidden ||
            etat.tableau !== "satellite" ||
            !etat.donnees ||
            etat.donnees.type === "prevision" ||
            etat.jour !== jourParis(new Date()) ||
            actualisationSatelliteEnCours) {
            return;
        }

        actualisationSatelliteEnCours = true;

        try {
            await preparerAnimation("satellite");
        } catch (erreur) {
            console.warn("HKO : actualisation satellite", erreur);
        } finally {
            actualisationSatelliteEnCours = false;
        }

    }, RAFRAICHISSEMENT_SATELLITE);
}

function redessiner() {
    cacherBulle();
    cadrer();
    assurerFond(etat.tableau);
    dessinerChamp();
    placerTemperatures();
    placerRadar();
    placerVilles();
    etat.conditionsPretes = false;
    if (etat.tableau === "conditions") placerConditions();
    if (lecteur.boucle === 0 && lecteur.source === sourceAffichee()) dessinerAnimation();
    actualiserHabillage();
    preparerTableauxSuivants();
}

// Les autres tableaux sont préparés pendant que le premier est à l'écran,
// quand la page est au repos : le clic sur un tableau est alors immédiat.
function preparerTableauxSuivants() {
    const auRepos = window.requestIdleCallback
        ? f => requestIdleCallback(f, { timeout: 2000 })
        : f => setTimeout(f, 200);
    const suite = ["temperatures", "precipitations", "conditions"].filter(t => t !== etat.tableau);
    const generation = etat.generation;
    const prochain = () => {
        if (generation !== etat.generation || !suite.length) return;
        const t = suite.shift();
        assurerFond(t).then(() => auRepos(prochain));
    };
    auRepos(prochain);
}

// Canvas 2D effacé par le navigateur (mémoire reprise, onglet en
// arrière-plan sur mobile) : tout est redessiné à son retour.
function surveillerContextes() {
    for (const id of CANVAS_2D) {
        $(id).addEventListener("contextlost", () => journal({ type: "canvas_perdu", id }));
        $(id).addEventListener("contextrestored", () => {
            etat.masqueTerres = null;
            etat.fondsAJour.clear();
            if (etat.rendus.satellite) etat.rendus.satellite.cadrer();
            redessiner();
            if (lecteur.source) { lecteur.sale = true; dessinerAnimation(); }
        });
    }
}

// ---------------------------------------------------------------------------
// 12. Démarrage
// ---------------------------------------------------------------------------

function echecFatal(message) {
    $("intro-secours").hidden = false;
    $("intro-message").textContent = message;
    $("intro-passer").textContent = "Réessayer";
    $("intro-passer").onclick = () => location.reload();
    $("intro-etape").textContent = "Chargement interrompu";
}

// Démarrage progressif : le tableau satellite (le premier) n'a besoin que
// des observations du jour et d'une image ; l'ouverture se ferme dès qu'il
// est prêt. Contours, relief et autres tableaux suivent en arrière-plan.
async function demarrer() {
    if (typeof d3 === "undefined") {
        return echecFatal("La bibliothèque de cartographie n'a pas pu être chargée. Vérifiez la connexion.");
    }

    const debut = performance.now();

    teintesTemperature = tableCouleurs(PALETTE_TEMPERATURE, -15, 44, 0.1);

    cadrer();
    installerCommandes();
    surveillerContextes();
    surveillerLenteur();

    // Chargement trop long : on propose de voir la carte sans attendre.
    const alerte = setTimeout(() => {
        if (etat.ouverte) return;
        $("intro-secours").hidden = false;
        $("intro-passer").onclick = fermerIntro;
    }, 10000);

    // Contours, relief (lu et préparé par le Worker) et fonds marins : tout
    // de suite si le premier tableau en a besoin, sinon juste après le
    // satellite, pour ne pas lui disputer la connexion.
    let lancerReste;
    const reste = new Promise(r => { lancerReste = r; });
    if (etat.tableau !== "satellite") lancerReste();
    setTimeout(lancerReste, 8000);          // au plus tard

    reste.then(() => {
        chargerRelief().finally(() => progresser("relief", 1));
        chargerBathymetrie().finally(() => progresser("bathymetrie", 1));
    });

    const promesseContours = reste.then(() => Promise.all([
        chargerRessource("pays", "geo/hko_pays.geojson", "geo/pays_monde_50m.geojson"),
        chargerRessource("departements", "geo/hko_departements.geojson", "geo/departements.geojson")
    ])).then(([pays, departements]) => {
        etat.pays = pays;
        etat.departements = {
            type: "FeatureCollection",
            features: departements.features.filter(d =>
                !String((d.properties || {}).code || "").startsWith("97"))
        };
        construireChemins();
        return true;
    });

    const promesseObservations = chargerJour(null, "observations")
        .catch(erreur => {
            console.error(erreur);
            return {
                jour: jourParis(new Date().toISOString()), disponible: false, stations: [],
                type: "observation",
                erreur: "Le serveur n'a pas répondu. Vérifiez la connexion, puis réessayez."
            };
        })
        .finally(() => progresser("observations", 1));

    installerDonnees(await promesseObservations);

    // Premier tableau
    const premier = etat.tableau;
    if (premier === "satellite" && etat.donnees.type !== "prevision") {
        const sequence = await preparerAnimation("satellite");
        // L'image du moment, posée avant d'ouvrir
        const r = etat.rendus.satellite;
        if (sequence && r) {
            const attente = Date.now();
            while (!r.pret && Date.now() - attente < 6000) await new Promise(f => setTimeout(f, 50));
        }
        assurerFond("satellite");
        for (const cle of Object.keys(etapes)) progresser(cle, 1);
        lancerReste();
    } else {
        try {
            await promesseContours;
        } catch (erreur) {
            console.error(erreur);
            clearTimeout(alerte);
            return echecFatal("Les contours de la carte n'ont pas pu être chargés.");
        }
        await assurerFond(premier);
        progresser("fond", 1);
        await dessinerChamp();
        placerTemperatures();
        progresser("champ", 1);
    }
    lancerReste();
    actualiserHabillage();
    clearTimeout(alerte);

    // La marque reste lisible un instant, même si tout est déjà en cache.
    const delai = Math.max(0, 1300 - (performance.now() - debut));
    setTimeout(fermerIntro, delai);

    // Tableaux suivants, en arrière-plan
    promesseContours.then(async () => {
        await dessinerChamp();
        placerTemperatures();
        placerRadar();
        preparerTableauxSuivants();
        if (etat.tableau !== premier) afficherTableau(etat.tableau);
    }).catch(erreur => {
        console.error(erreur);
        journal({ type: "contours", message: String(erreur.message).slice(0, 200) });
    });
    setTimeout(chargerRadar, delai + 400);
}

// Essais automatisés (?essai=1) : accès à l'état, sans effet sur la page
if (PARAMETRES.has("essai")) {
    window.HKOEssai = { etat, lecteur, assurerFond, dessinerChamp, rendu, calcul, PROFIL };
}

demarrer();

})();
