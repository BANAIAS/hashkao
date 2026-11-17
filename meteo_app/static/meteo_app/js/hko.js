/* ==========================================================================
   HKO Météo — expérience principale (trois tableaux)

   Organisation du fichier :
     1. État et réglages
     2. Ouverture : chargement réel et jauge
     3. Cadrage (projection D3)
     4. Fond de carte : mer, relief teinté, frontières
     5. Tableau 1 — températures (champ interpolé + valeurs)
     6. Tableau 2 — radar de précipitations
     7. Tableau 3 — conditions météo (symboles animés)
     8. Habillage : bandeau, légendes, bulle, états indisponibles
     9. Navigation : tableaux, défilement automatique, jours
    10. Démarrage
   ========================================================================== */

(() => {
"use strict";

// ---------------------------------------------------------------------------
// 1. État et réglages
// ---------------------------------------------------------------------------

const scene = document.getElementById("scene");
const $ = id => document.getElementById(id);

const URL_API = scene.dataset.apiCarte;
const STATIQUE = scene.dataset.statique;

const TABLEAUX = ["temperatures", "precipitations", "conditions"];
const DUREE_TABLEAU = 15000;        // défilement automatique
const REPRISE_AUTO = 60000;         // après un choix manuel
const RAFRAICHISSEMENT = 6 * 60000; // nouvelles observations du jour

// Cadre géographique à faire tenir à l'écran : la France métropolitaine
const CADRE_FRANCE = {
    type: "MultiPoint",
    coordinates: [[-5.25, 41.3], [9.7, 51.15]]
};

// Gradient thermique vertical utilisé pour l'interpolation (°C par mètre)
const GRADIENT_ALTITUDE = 0.0045;

// Stations d'altitude écartées des valeurs affichées (peu représentatives)
const ALTITUDE_MAX_AFFICHEE = 600;

// Couleurs des températures (°C -> couleur)
const PALETTE_TEMPERATURE = [
    [-15, "#3d1a78"], [-10, "#4a2c9a"], [-5, "#2c55b3"], [0, "#3c8fd9"],
    [5, "#86c7ea"], [10, "#dcecdf"], [14, "#f6e7a1"], [18, "#f9c85a"],
    [23, "#f3923b"], [28, "#e2532d"], [34, "#b01f2e"], [42, "#6a0f2b"]
];

// Teintes du relief (altitude en mètres -> couleur)
const PALETTE_RELIEF = [
    [0, "#6f9c58"], [120, "#83a85d"], [300, "#a3b56a"], [600, "#c4b877"],
    [1000, "#c2a06c"], [1500, "#a98763"], [2000, "#a39a92"],
    [2500, "#d9d6d1"], [3000, "#ffffff"]
];
const TERRE_SANS_RELIEF = [132, 166, 96];

const etat = {
    largeur: 0,
    hauteur: 0,
    echelle: 1,          // pixels de canvas par pixel CSS
    projection: null,
    pays: null,
    departements: null,
    relief: null,
    altitudes: null,     // altitude par pixel du fond
    ombres: null,        // facteur d'ombrage par pixel du fond
    jours: new Map(),    // réponses de l'API par jour
    donnees: null,       // réponse du jour affiché
    jour: null,
    tableau: "temperatures",
    auto: true,
    rotation: 0,
    radar: undefined,    // undefined : pas encore demandé ; null : absent
    conditions: new Map(), // cartes fusionnées par jour
    radarImage: null,
    radarCouverture: null,
    conditionsPretes: false,
    ouverte: false
};

const reduitMouvement = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

function heureParis(iso) {
    const parties = new Intl.DateTimeFormat("fr-FR", {
        timeZone: "Europe/Paris", hour: "numeric", minute: "2-digit"
    }).formatToParts(new Date(iso));

    const h = parties.find(p => p.type === "hour").value;
    const m = parties.find(p => p.type === "minute").value;

    return `${Number(h)} h ${m}`;
}

function jourParis(iso) {
    // AAAA-MM-JJ du jour civil à Paris
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" })
        .format(new Date(iso));
}

function libelleJour(jour) {
    const [a, m, j] = jour.split("-").map(Number);
    const texte = new Intl.DateTimeFormat("fr-FR", {
        weekday: "long", day: "numeric", month: "long", timeZone: "UTC"
    }).format(new Date(Date.UTC(a, m - 1, j)));

    return texte.charAt(0).toUpperCase() + texte.slice(1);
}

function decalerJour(jour, pas) {
    const [a, m, j] = jour.split("-").map(Number);
    return new Date(Date.UTC(a, m - 1, j + pas)).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// 2. Ouverture : chargement réel et jauge
// ---------------------------------------------------------------------------

// Chaque étape pèse dans la jauge selon son coût réel approximatif.
const etapes = {
    pays:         { poids: 8,  part: 0, nom: "Contours de l'Europe" },
    departements: { poids: 12, part: 0, nom: "Contours de la France" },
    relief:       { poids: 28, part: 0, nom: "Relief" },
    observations: { poids: 20, part: 0, nom: "Observations Météo-France" },
    fond:         { poids: 16, part: 0, nom: "Dessin de la carte" },
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

function cadrer() {
    const cadre = scene.getBoundingClientRect();

    etat.largeur = Math.max(200, Math.round(cadre.width));
    etat.hauteur = Math.max(200, Math.round(cadre.height));

    // Marges réservées à l'habillage : la France reste dégagée.
    const etroit = etat.largeur < 760;
    const haut = etroit ? 104 : 74;
    const bas = etroit
        ? Math.min(250, etat.hauteur * 0.36)
        : Math.min(150, etat.hauteur * 0.2);
    const cote = etroit ? 8 : Math.min(60, etat.largeur * 0.04);

    etat.projection = d3.geoMercator().fitExtent(
        [[cote, haut], [etat.largeur - cote, Math.max(haut + 120, etat.hauteur - bas)]],
        CADRE_FRANCE
    );

    // Résolution des canvas : nette sur écran dense, sans excès de pixels
    const dpr = window.devicePixelRatio || 1;
    const budget = Math.sqrt(2.6e6 / (etat.largeur * etat.hauteur));
    etat.echelle = Math.max(1, Math.min(dpr, 2, budget));

    for (const id of ["fond", "champ", "hachures"]) {
        const canvas = $(id);
        canvas.width = Math.round(etat.largeur * etat.echelle);
        canvas.height = Math.round(etat.hauteur * etat.echelle);
    }

    d3.select("#traits").attr("viewBox", `0 0 ${etat.largeur} ${etat.hauteur}`);
}

// Largeur de la France à l'écran : sert d'unité pour les tailles de texte.
function largeurFrance() {
    const p = etat.projection;
    return p([9.7, 46])[0] - p([-5.25, 46])[0];
}

// ---------------------------------------------------------------------------
// 4. Fond de carte
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

let teintesRelief = null;
let teintesTemperature = null;

function tracerSurCanvas(contexte, geometrie) {
    const chemin = d3.geoPath(etat.projection, contexte);
    contexte.beginPath();
    chemin(geometrie);
}

function dessinerFond() {
    const canvas = $("fond");
    const W = canvas.width, H = canvas.height, k = etat.echelle;
    const ctx = canvas.getContext("2d");
    const projection = etat.projection;

    // --- Mer : dégradé du large vers les côtes ---------------------------
    const centre = projection([2.5, 46.6]);
    const mer = ctx.createRadialGradient(
        centre[0] * k, centre[1] * k, 0,
        centre[0] * k, centre[1] * k, Math.hypot(W, H) * 0.62
    );
    mer.addColorStop(0, "#2a78c2");
    mer.addColorStop(0.45, "#1a5fa6");
    mer.addColorStop(1, "#0b3468");

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = mer;
    ctx.fillRect(0, 0, W, H);

    const terres = {
        type: "FeatureCollection",
        features: [...etat.pays.features, ...etat.departements.features]
    };

    // --- Halo clair le long des côtes -------------------------------------
    ctx.save();
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.shadowColor = "rgba(150, 210, 255, 0.55)";
    ctx.shadowBlur = 16 * k;
    ctx.fillStyle = "#2a78c2";
    tracerSurCanvas(ctx, terres);
    ctx.fill();
    ctx.restore();

    // --- Relief teinté et ombré -------------------------------------------
    const relief = etat.relief;
    const longitudes = new Float64Array(W);
    const latitudes = new Float64Array(H);

    for (let x = 0; x < W; x++) longitudes[x] = projection.invert([(x + 0.5) / k, 0])[0];
    for (let y = 0; y < H; y++) latitudes[y] = projection.invert([0, (y + 0.5) / k])[1];

    const altitudes = new Float32Array(W * H).fill(NaN);

    if (relief) {
        const { largeur: gl, hauteur: gh, resolution: res, altitudes: grille } = relief;

        // Position de chaque colonne dans la grille de relief (calculée une fois)
        const gx0 = new Int32Array(W), fx = new Float32Array(W);
        for (let x = 0; x < W; x++) {
            const g = (longitudes[x] - relief.ouest) * res - 0.5;
            gx0[x] = Math.floor(g);
            fx[x] = g - Math.floor(g);
        }

        for (let y = 0; y < H; y++) {
            const g = (relief.nord - latitudes[y]) * res - 0.5;
            const y0 = Math.floor(g), fy = g - y0;
            if (y0 < 0 || y0 >= gh - 1) continue;

            const ligne = y * W;

            for (let x = 0; x < W; x++) {
                const x0 = gx0[x];
                if (x0 < 0 || x0 >= gl - 1) continue;

                const i = y0 * gl + x0;
                const a = grille[i], b = grille[i + 1];
                const c = grille[i + gl], d = grille[i + gl + 1];

                if (a !== a || b !== b || c !== c || d !== d) {
                    // Bord de mer : on garde la valeur connue la plus proche
                    const v = a === a ? a : b === b ? b : c === c ? c : d;
                    altitudes[ligne + x] = v;
                    continue;
                }

                const haut = a + (b - a) * fx[x];
                const bas = c + (d - c) * fx[x];
                altitudes[ligne + x] = haut + (bas - haut) * fy;
            }
        }
    }

    // Ombrage : lumière venant du nord-ouest, relief accentué pour rester
    // lisible à cette échelle.
    const ombres = new Float32Array(W * H).fill(1);
    const image = ctx.createImageData(W, H);
    const pixels = image.data;

    // Aux limites des données de relief, le modelé s'estompe vers l'aplat
    // au lieu de s'arrêter net.
    const fonduX = new Float32Array(W).fill(1), fonduY = new Float32Array(H).fill(1);
    if (relief) {
        const marge = 1.2;   // degrés
        for (let x = 0; x < W; x++) {
            fonduX[x] = Math.max(0, Math.min(1,
                (longitudes[x] - relief.ouest) / marge, (relief.est - longitudes[x]) / marge));
        }
        for (let y = 0; y < H; y++) {
            fonduY[y] = Math.max(0, Math.min(1,
                (latitudes[y] - relief.sud) / marge, (relief.nord - latitudes[y]) / marge));
        }
    }

    const degresParPixel = longitudes[1] - longitudes[0];
    const accent = 7;
    const lx = -0.5, ly = 0.5, lz = 0.7071;   // azimut 315°, hauteur 45°
    const { table, pas: pasTeinte, taille: nTeintes } = teintesRelief;

    for (let y = 0; y < H; y++) {
        const metresX = 111320 * Math.cos(latitudes[y] * Math.PI / 180) * degresParPixel;
        const yh = y > 0 ? y - 1 : y, yb = y < H - 1 ? y + 1 : y;
        const metresY = 111320 * Math.abs(latitudes[yh] - latitudes[yb]) / Math.max(1, yb - yh);

        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            const z = altitudes[i];
            const p = i * 4;

            if (z !== z) {
                pixels[p] = TERRE_SANS_RELIEF[0];
                pixels[p + 1] = TERRE_SANS_RELIEF[1];
                pixels[p + 2] = TERRE_SANS_RELIEF[2];
                pixels[p + 3] = 255;
                continue;
            }

            const xg = x > 0 ? x - 1 : x, xd = x < W - 1 ? x + 1 : x;
            let zg = altitudes[y * W + xg], zd = altitudes[y * W + xd];
            let zh = altitudes[yh * W + x], zb = altitudes[yb * W + x];
            if (zg !== zg) zg = z;
            if (zd !== zd) zd = z;
            if (zh !== zh) zh = z;
            if (zb !== zb) zb = z;

            const penteEst = accent * (zd - zg) / (metresX * Math.max(1, xd - xg));
            const penteNord = accent * (zh - zb) / (metresY * Math.max(1, yb - yh));

            const lumiere = (-penteEst * lx - penteNord * ly + lz) /
                Math.sqrt(penteEst * penteEst + penteNord * penteNord + 1);

            let facteur = 1 + (lumiere - 0.7071) * 1.25;
            facteur = facteur < 0.5 ? 0.5 : facteur > 1.32 ? 1.32 : facteur;
            ombres[i] = facteur;

            let t = Math.round((z < 0 ? 0 : z) / pasTeinte);
            if (t >= nTeintes) t = nTeintes - 1;
            t *= 3;

            const f = fonduX[x] < fonduY[y] ? fonduX[x] : fonduY[y];
            const r = TERRE_SANS_RELIEF[0] + (table[t] * facteur - TERRE_SANS_RELIEF[0]) * f;
            const g = TERRE_SANS_RELIEF[1] + (table[t + 1] * facteur - TERRE_SANS_RELIEF[1]) * f;
            const b = TERRE_SANS_RELIEF[2] + (table[t + 2] * facteur - TERRE_SANS_RELIEF[2]) * f;
            pixels[p] = r > 255 ? 255 : r;
            pixels[p + 1] = g > 255 ? 255 : g;
            pixels[p + 2] = b > 255 ? 255 : b;
            pixels[p + 3] = 255;
        }
    }

    etat.altitudes = altitudes;
    etat.ombres = ombres;

    // Les terres : l'image du relief découpée selon les côtes
    const calque = document.createElement("canvas");
    calque.width = W;
    calque.height = H;
    const c2 = calque.getContext("2d");

    // Masque des terres ; le trait referme les joints entre pays voisins
    const masque = document.createElement("canvas");
    masque.width = W;
    masque.height = H;
    const cm = masque.getContext("2d");
    cm.setTransform(k, 0, 0, k, 0, 0);
    tracerSurCanvas(cm, terres);
    cm.fillStyle = "#000";
    cm.fill();
    cm.lineWidth = 0.8;
    cm.strokeStyle = "#000";
    cm.stroke();

    c2.putImageData(image, 0, 0);
    c2.globalCompositeOperation = "destination-in";
    c2.drawImage(masque, 0, 0);

    ctx.drawImage(calque, 0, 0);

    // --- Frontières et trait de côte --------------------------------------
    ctx.save();
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.lineJoin = "round";

    tracerSurCanvas(ctx, { type: "FeatureCollection", features: etat.pays.features });
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = "rgba(20, 45, 30, 0.38)";
    ctx.stroke();
    ctx.restore();

    // Contour de la France : on trace tous les départements, puis on efface
    // l'intérieur ; il ne reste que le liseré extérieur.
    c2.setTransform(1, 0, 0, 1, 0, 0);
    c2.globalCompositeOperation = "source-over";
    c2.clearRect(0, 0, W, H);
    c2.setTransform(k, 0, 0, k, 0, 0);
    tracerSurCanvas(c2, etat.departements);
    c2.lineJoin = "round";
    c2.lineWidth = 2.6;
    c2.strokeStyle = "rgba(255, 255, 255, 0.85)";
    c2.stroke();
    c2.globalCompositeOperation = "destination-out";
    c2.fillStyle = "#000";
    c2.fill();

    ctx.drawImage(calque, 0, 0);
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
// proches, avec correction d'altitude. Les stations sont rangées dans une
// grille de cases pour ne comparer chaque point qu'à ses voisines.
function calculerChamp(stations, pas) {
    const projection = etat.projection;
    const k = etat.echelle;
    const W = $("fond").width, H = $("fond").height;

    const points = stations.map(s => {
        const p = projection([s.longitude, s.latitude]);
        return {
            x: p[0], y: p[1], t: s.temperature,
            a: Number.isFinite(s.altitude) ? s.altitude : NaN
        };
    });

    if (points.length < 3) return null;

    // Zone de calcul : la France à l'écran
    const hg = projection([-5.6, 51.6]), bd = projection([10.1, 41.0]);
    const x0 = Math.max(0, Math.floor(hg[0])), y0 = Math.max(0, Math.floor(hg[1]));
    const x1 = Math.min(etat.largeur, Math.ceil(bd[0])), y1 = Math.min(etat.hauteur, Math.ceil(bd[1]));

    if (x1 <= x0 || y1 <= y0) return null;

    const colonnes = Math.ceil((x1 - x0) / pas) + 1;
    const lignes = Math.ceil((y1 - y0) / pas) + 1;
    const valeurs = new Float32Array(colonnes * lignes);

    // Rangement des stations par cases
    const tailleCase = Math.max(24, largeurFrance() / 22);
    const minX = d3.min(points, p => p.x), minY = d3.min(points, p => p.y);
    const nCasesX = Math.floor((d3.max(points, p => p.x) - minX) / tailleCase) + 1;
    const nCasesY = Math.floor((d3.max(points, p => p.y) - minY) / tailleCase) + 1;
    const cases = Array.from({ length: nCasesX * nCasesY }, () => []);

    for (const p of points) {
        const cx = Math.floor((p.x - minX) / tailleCase);
        const cy = Math.floor((p.y - minY) / tailleCase);
        cases[cy * nCasesX + cx].push(p);
    }

    const K = 8;
    const distances = new Float64Array(K);
    const proches = new Array(K);

    for (let l = 0; l < lignes; l++) {
        const py = y0 + l * pas;

        for (let c = 0; c < colonnes; c++) {
            const px = x0 + c * pas;

            const ix = Math.min(W - 1, Math.max(0, Math.round(px * k)));
            const iy = Math.min(H - 1, Math.max(0, Math.round(py * k)));
            const altitudeCible = etat.altitudes ? etat.altitudes[iy * W + ix] : NaN;

            const cx = Math.floor((px - minX) / tailleCase);
            const cy = Math.floor((py - minY) / tailleCase);

            let trouves = 0;
            let anneauPlein = -1;

            // On élargit la recherche case par case, puis d'un anneau de plus
            // pour être certain de tenir les plus proches.
            for (let rayon = 0; rayon < 40; rayon++) {
                for (let dy = -rayon; dy <= rayon; dy++) {
                    const yy = cy + dy;
                    if (yy < 0 || yy >= nCasesY) continue;

                    const bord = Math.abs(dy) === rayon;

                    for (let dx = -rayon; dx <= rayon; dx += (bord ? 1 : 2 * rayon || 1)) {
                        const xx = cx + dx;
                        if (xx < 0 || xx >= nCasesX) continue;

                        for (const p of cases[yy * nCasesX + xx]) {
                            const d2 = (p.x - px) * (p.x - px) + (p.y - py) * (p.y - py);

                            // Insertion triée dans les K plus proches
                            let pos = trouves < K ? trouves : K;
                            while (pos > 0 && distances[pos - 1] > d2) pos--;
                            if (pos >= K) continue;

                            for (let j = Math.min(trouves, K - 1); j > pos; j--) {
                                distances[j] = distances[j - 1];
                                proches[j] = proches[j - 1];
                            }
                            distances[pos] = d2;
                            proches[pos] = p;
                            if (trouves < K) trouves++;
                        }
                    }
                }

                if (trouves >= K && anneauPlein < 0) anneauPlein = rayon;
                if (anneauPlein >= 0 && rayon >= anneauPlein + 1) break;
            }

            let somme = 0, poidsTotal = 0;

            for (let j = 0; j < trouves; j++) {
                const p = proches[j];
                const poids = 1 / Math.max(distances[j], 1);
                let t = p.t;

                if (altitudeCible === altitudeCible && p.a === p.a) {
                    t -= GRADIENT_ALTITUDE * (altitudeCible - p.a);
                }

                somme += t * poids;
                poidsTotal += poids;
            }

            valeurs[l * colonnes + c] = poidsTotal ? somme / poidsTotal : NaN;
        }
    }

    return { valeurs, colonnes, lignes, x0, y0, pas };
}

function dessinerChamp() {
    const canvas = $("champ");
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height, k = etat.echelle;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, W, H);

    const stations = stationsValides();
    const champ = stations.length ? calculerChamp(stations, 4) : null;

    if (!champ) return;

    const { valeurs, colonnes, lignes, x0, y0, pas } = champ;

    const gx0 = Math.round(x0 * k), gy0 = Math.round(y0 * k);
    const gl = Math.min(W - gx0, Math.round((colonnes - 1) * pas * k));
    const gh = Math.min(H - gy0, Math.round((lignes - 1) * pas * k));

    if (gl <= 0 || gh <= 0) return;

    const image = ctx.createImageData(gl, gh);
    const pixels = image.data;
    const { table, debut, pas: pasT, taille } = teintesTemperature;
    const ombres = etat.ombres;

    for (let y = 0; y < gh; y++) {
        const fy0 = (y / k) / pas;
        const l0 = Math.min(lignes - 2, Math.floor(fy0));
        const fy = fy0 - l0;

        for (let x = 0; x < gl; x++) {
            const fx0 = (x / k) / pas;
            const c0 = Math.min(colonnes - 2, Math.floor(fx0));
            const fx = fx0 - c0;

            const i = l0 * colonnes + c0;
            const haut = valeurs[i] + (valeurs[i + 1] - valeurs[i]) * fx;
            const bas = valeurs[i + colonnes] + (valeurs[i + colonnes + 1] - valeurs[i + colonnes]) * fx;
            const t = haut + (bas - haut) * fy;

            if (t !== t) continue;

            let n = Math.round((t - debut) / pasT);
            n = n < 0 ? 0 : n >= taille ? taille - 1 : n;
            n *= 3;

            // Le relief reste lisible sous la couleur : même ombrage que le fond
            const ombre = ombres ? 0.25 + 0.75 * ombres[(gy0 + y) * W + gx0 + x] : 1;
            const p = (y * gl + x) * 4;

            const r = table[n] * ombre, g = table[n + 1] * ombre, b = table[n + 2] * ombre;
            pixels[p] = r > 255 ? 255 : r;
            pixels[p + 1] = g > 255 ? 255 : g;
            pixels[p + 2] = b > 255 ? 255 : b;
            pixels[p + 3] = 255;
        }
    }

    ctx.putImageData(image, gx0, gy0);

    // Découpe selon les frontières françaises
    ctx.globalCompositeOperation = "destination-in";
    ctx.setTransform(k, 0, 0, k, 0, 0);
    tracerSurCanvas(ctx, etat.departements);
    ctx.fillStyle = "#000";
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
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
    const tailleCase = Math.max(54, unite / 7.2);
    const corps = Math.max(15, Math.min(30, unite / 26));

    let choix = choisirParCases(stations, tailleCase, etat.rotation);

    // Les deux extrêmes du moment sont toujours affichés
    const mini = stations.reduce((a, b) => (b.temperature < a.temperature ? b : a));
    const maxi = stations.reduce((a, b) => (b.temperature > a.temperature ? b : a));
    etat.extremes = { mini, maxi };

    const extremes = [mini, maxi].map(station => {
        const [x, y] = etat.projection([station.longitude, station.latitude]);
        return { station, x, y };
    });

    choix = choix.filter(c =>
        extremes.every(e => e.station.id === c.station.id ||
            Math.hypot(c.x - e.x, c.y - e.y) >= corps * 2)
    );

    for (const extreme of extremes) {
        if (!choix.some(c => c.station.id === extreme.station.id)) choix.push(extreme);
    }

    // Écarter les valeurs qui se chevaucheraient
    const places = [];
    for (const c of choix.sort((a, b) =>
        (b.station.id === mini.id || b.station.id === maxi.id) -
        (a.station.id === mini.id || a.station.id === maxi.id))) {
        if (places.every(p => Math.hypot(p.x - c.x, p.y - c.y) >= corps * 1.7)) places.push(c);
    }

    calque.selectAll("text")
        .data(places, d => d.station.id)
        .join("text")
        .attr("class", d =>
            "temp" + (d.station.id === mini.id ? " mini" : d.station.id === maxi.id ? " maxi" : ""))
        .attr("x", d => d.x)
        .attr("y", d => d.y)
        .attr("font-size", corps)
        .attr("stroke-width", corps * 0.2)
        .attr("tabindex", 0)
        .text(d => Math.round(d.station.temperature))
        .on("pointerenter focus", (evenement, d) => montrerBulle(d, bulleTemperature(d.station)))
        .on("pointerleave blur", cacherBulle);
}

// ---------------------------------------------------------------------------
// 6. Tableau 2 — radar
// ---------------------------------------------------------------------------

function chargerImage(url) {
    return new Promise((resoudre, rejeter) => {
        const image = new Image();
        image.onload = () => resoudre(image);
        image.onerror = () => rejeter(new Error(`Image illisible : ${url}`));
        image.src = url;
    });
}

async function chargerRadar() {
    // Fichiers publiés par collecter_radar ; à défaut, l'ancien emplacement
    // dans static (radar converti à la main avec convertir_radar).
    let base = scene.dataset.radar.replace(/radar\.json$/, "");

    try {
        let reponse = await fetch(base + "radar.json", { cache: "no-store" });
        if (reponse.status === 404) {
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
    m.strokeStyle = "rgba(255, 255, 255, 0.34)";
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

// ---------------------------------------------------------------------------
// 7. Tableau 3 — conditions météo
//
// Source : la carte fusionnée calculée sur le serveur (fusionner_conditions),
// qui croise radar, satellite, stations et AROME sur une grille de 0,05°.
// Le navigateur ne décide d'aucun phénomène : il met en images ce que la
// grille contient (catégorie, nébulosité, intensité, vent, confiance).
// Faute de carte fusionnée, l'ancien rendu par stations sert de repli.
// ---------------------------------------------------------------------------

const NUAGE = "M-13 8a7 7 0 0 1-1-13.9a10 10 0 0 1 19-2.6a8.3 8.3 0 0 1 8.5 16.5z";
const LUNE = "M3.5-10.5a10.5 10.5 0 1 0 8.6 15.6a8.6 8.6 0 0 1-8.6-15.6z";

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

const URL_CONDITIONS = scene.dataset.apiConditions;

function dessinSymbole(code, jour) {
    const astre = jour
        ? `<g class="rayons">${d3.range(8).map(i => {
              const a = i * Math.PI / 4;
              return `<line x1="${11.5 * Math.cos(a)}" y1="${11.5 * Math.sin(a)}" x2="${16 * Math.cos(a)}" y2="${16 * Math.sin(a)}"/>`;
          }).join("")}</g><circle class="astre contour" r="8.2"/>`
        : `<path class="lune contour" d="${LUNE}"/>`;

    const nuage = (classe = "", transformation = "") =>
        `<g transform="${transformation}"><path class="nuage contour derive ${classe}" d="${NUAGE}"/></g>`;

    const gouttes = n => d3.range(n).map(i => {
        const x = n === 1 ? 0 : -7 + i * (14 / (n - 1));
        return `<line class="goutte" x1="${x + 1.2}" y1="11.5" x2="${x - 1.2}" y2="18"/>`;
    }).join("");

    switch (code) {
        case "soleil":
            return astre;
        case "peu-nuageux":
            return `<g transform="translate(-3,-3)">${astre}</g>${nuage("", "translate(8,7) scale(0.55)")}`;
        case "eclaircies":
            return `<g transform="translate(-6,-6) scale(0.82)">${astre}</g>${nuage("", "translate(3,4) scale(0.92)")}`;
        case "nuageux":
            return nuage("gris", "translate(5,-5) scale(0.78)") + nuage("", "translate(-2,3)");
        case "couvert":
            return nuage("sombre", "translate(5,-5) scale(0.82)") + nuage("gris", "translate(-2,3)");
        case "pluie-faible":
            return `<g transform="translate(0,-4)">${nuage("gris")}${gouttes(1)}</g>`;
        case "pluie":
            return `<g transform="translate(0,-4)">${nuage("gris")}${gouttes(2)}</g>`;
        case "pluie-forte":
            return `<g transform="translate(0,-4)">${nuage("sombre")}${gouttes(3)}</g>`;
        case "averses":
            return `<g transform="translate(-7,-10) scale(0.7)">${astre}</g>` +
                `<g transform="translate(2,-1) scale(0.9)">${nuage("gris")}${gouttes(2)}</g>`;
        case "neige":
            return `<g transform="translate(0,-4)">${nuage("gris")}${[-7, 0, 7].map(x =>
                `<circle class="flocon contour" cx="${x}" cy="14" r="1.9"/>`).join("")}</g>`;
        case "brouillard":
            return [-7, 0, 7].map((y, i) =>
                `<line class="brume" x1="${-13 + i * 2}" y1="${y}" x2="${13 - (2 - i) * 2}" y2="${y}"/>`).join("");
        case "orage":
            return `<g transform="translate(0,-4)">${nuage("sombre")}<path class="eclair contour" d="M1 9l-6 9h4l-2 7 8-10h-4.5l3-6z"/></g>`;
        default:
            return `<circle class="sec" r="3.6"/>`;
    }
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

// Valeur d'un champ au point (lon, lat) : cellule la plus proche
function cellule(carte, lon, lat) {
    const g = carte.grille;
    const i = Math.floor((lon - g.ouest) / g.pas);
    const j = Math.floor((g.nord - lat) / g.pas);
    if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) return -1;
    return j * g.nx + i;
}

// --- Rendu du ciel : nuages, soleil, pluie, neige, brume -------------------

// Texture de bruit (fBm) pour donner du modelé aux nuages ; tirée une fois.
let textureBruit = null;

function bruit() {
    if (textureBruit) return textureBruit;

    const taille = 256;
    let graine = 1234567;
    const alea = () => ((graine = (graine * 1103515245 + 12345) % 2147483648) / 2147483648);

    const somme = new Float32Array(taille * taille);
    let amplitude = 1, total = 0;

    for (let octave = 0; octave < 5; octave++) {
        const n = 4 << octave;              // 4, 8, 16, 32, 64 cellules
        const reseau = new Float32Array((n + 1) * (n + 1));
        for (let k = 0; k < reseau.length; k++) reseau[k] = alea();
        for (let k = 0; k <= n; k++) {      // raccord : texture répétable
            reseau[k * (n + 1) + n] = reseau[k * (n + 1)];
            reseau[n * (n + 1) + k] = reseau[k];
        }
        for (let y = 0; y < taille; y++) {
            const fy = y / taille * n, y0 = Math.floor(fy), ty = fy - y0;
            const sy = ty * ty * (3 - 2 * ty);
            for (let x = 0; x < taille; x++) {
                const fx = x / taille * n, x0 = Math.floor(fx), tx = fx - x0;
                const sx = tx * tx * (3 - 2 * tx);
                const a = reseau[y0 * (n + 1) + x0], b = reseau[y0 * (n + 1) + x0 + 1];
                const c = reseau[(y0 + 1) * (n + 1) + x0], d = reseau[(y0 + 1) * (n + 1) + x0 + 1];
                somme[y * taille + x] += amplitude * ((a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy);
            }
        }
        total += amplitude;
        amplitude *= 0.55;
    }

    for (let k = 0; k < somme.length; k++) somme[k] /= total;
    textureBruit = { valeurs: somme, taille };
    return textureBruit;
}

function lissage(a, b, x) {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}

function dessinerCiel() {
    const canvas = $("ciel");
    const carte = carteConditions();
    const ctx = canvas.getContext("2d");

    // Les nuages sont doux : une demi-résolution suffit et reste rapide
    const W = Math.round(etat.largeur / 2), H = Math.round(etat.hauteur / 2);
    canvas.width = W;
    canvas.height = H;
    ctx.clearRect(0, 0, W, H);

    const masques = { pluie: null, neige: null, brume: null };

    if (!carte) {
        appliquerMasques(masques);
        return;
    }

    const g = carte.grille;
    const nebulosite = carte.donnees.nebulosite;
    const intensite = carte.donnees.intensite;
    const drapeaux = carte.donnees.drapeaux;
    const categorie = carte.donnees.categorie;
    const codeBrouillard = carte.categories.indexOf("brouillard");

    // Position de chaque colonne / ligne dans la grille (Mercator : séparable)
    const gx = new Float32Array(W), gy = new Float32Array(H);
    for (let x = 0; x < W; x++) gx[x] = (etat.projection.invert([(x + 0.5) * 2, 0])[0] - g.ouest) / g.pas - 0.5;
    for (let y = 0; y < H; y++) gy[y] = (g.nord - etat.projection.invert([0, (y + 0.5) * 2])[1]) / g.pas - 0.5;

    // France à l'écran, pour atténuer le ciel des pays voisins
    const masqueFrance = document.createElement("canvas");
    masqueFrance.width = W; masqueFrance.height = H;
    const mf = masqueFrance.getContext("2d");
    mf.setTransform(0.5, 0, 0, 0.5, 0, 0);
    tracerSurCanvas(mf, etat.departements);
    mf.fillStyle = "#000";
    mf.fill();
    const dansFrance = mf.getImageData(0, 0, W, H).data;

    const image = ctx.createImageData(W, H);
    const px = image.data;
    const mPluie = new Uint8ClampedArray(W * H), mNeige = new Uint8ClampedArray(W * H), mBrume = new Uint8ClampedArray(W * H);

    const { valeurs: tex, taille: T } = bruit();
    const echelleBruit = largeurFrance() / 2 / 1.7;   // ~2 motifs sur la largeur de la France

    function bilineaire(champ, fx, fy) {
        const i0 = Math.floor(fx), j0 = Math.floor(fy);
        const tx = fx - i0, ty = fy - j0;
        let somme = 0, poids = 0;
        for (let dj = 0; dj <= 1; dj++) {
            const j = j0 + dj;
            if (j < 0 || j >= g.ny) continue;
            for (let di = 0; di <= 1; di++) {
                const i = i0 + di;
                if (i < 0 || i >= g.nx) continue;
                const v = champ[j * g.nx + i];
                if (v === 255) continue;
                const w = (di ? tx : 1 - tx) * (dj ? ty : 1 - ty);
                somme += v * w;
                poids += w;
            }
        }
        return poids > 0.25 ? somme / poids : -1;
    }

    for (let y = 0; y < H; y++) {
        const fy = gy[y];
        if (fy < -1 || fy > g.ny) continue;

        for (let x = 0; x < W; x++) {
            const fx = gx[x];
            if (fx < -1 || fx > g.nx) continue;

            const n = bilineaire(nebulosite, fx, fy);
            if (n < 0) continue;

            const i = Math.max(0, Math.min(g.nx - 1, Math.round(fx)));
            const j = Math.max(0, Math.min(g.ny - 1, Math.round(fy)));
            const c = j * g.nx + i;
            const fl = drapeaux[c];
            const jour = (fl & 32) !== 0;

            const k = (y * W + x);
            const p = k * 4;
            const france = dansFrance[p + 3] > 0;
            // Hors de France, ciel atténué ; près du bord de la grille, fondu
            // progressif pour ne jamais laisser voir le rectangle de calcul.
            const bord = Math.min(fx, fy, g.nx - 1 - fx, g.ny - 1 - fy);
            const attenuation = (france ? 1 : 0.6) * lissage(0, 22, bord);
            if (attenuation <= 0) continue;

            // Texture : deux échelles de bruit pour un modelé de cumulus
            const u = (x / echelleBruit) * T, v = (y / echelleBruit) * T;
            const b1 = tex[((v | 0) % T) * T + ((u | 0) % T)];
            const b2 = tex[(((v * 2.7) | 0) % T) * T + (((u * 2.7) | 0) % T)];
            const b = 0.78 * b1 + 0.22 * b2;

            const d = n / 100;
            // Plus la nébulosité est forte, plus le seuil baisse : le ciel se
            // ferme. Bords nets pour des nuages dessinés, pas un voile.
            const seuil = 0.74 - 0.6 * d;
            let alpha = lissage(seuil - 0.015, seuil + 0.07, b) * (0.62 + 0.33 * d);
            if (d > 0.85) alpha = Math.max(alpha, 0.5 + 0.35 * b);

            const pluie = bilineaire(intensite, fx, fy);       // dixièmes de mm/h
            const gris = pluie > 2 ? Math.min(1, 0.4 + pluie / 100) : d > 0.85 ? 0.3 : 0;

            // Modelé : sommets éclairés en haut à gauche, cœurs plus denses
            // légèrement ombrés, comme des cumulus vus d'en haut.
            const bh = tex[((((v - 4) | 0) % T + T) % T) * T + ((((u - 4) | 0) % T + T) % T)];
            const relief = Math.max(-0.16, Math.min(0.16, (bh - b) * 2.2));
            const epaisseur = lissage(seuil, seuil + 0.35, b);

            const blanc = 252 - gris * 105 - epaisseur * 26 + relief * 190;
            px[p] = blanc - 5;
            px[p + 1] = blanc - 2;
            px[p + 2] = blanc + 3;
            px[p + 3] = Math.round(255 * Math.min(0.94, alpha) * attenuation);

            // Soleil : voile chaud sur les zones dégagées de France, de jour
            if (france && jour && d < 0.45 && px[p + 3] < 70) {
                const chaleur = (1 - d / 0.45) * 0.42 * attenuation;
                const a0 = px[p + 3] / 255;
                const a1 = a0 + chaleur * (1 - a0);
                px[p] = (px[p] * a0 + 255 * chaleur * (1 - a0)) / a1;
                px[p + 1] = (px[p + 1] * a0 + 196 * chaleur * (1 - a0)) / a1;
                px[p + 2] = (px[p + 2] * a0 + 74 * chaleur * (1 - a0)) / a1;
                px[p + 3] = Math.round(a1 * 255);
            }

            if (pluie >= 2) {
                const force = lissage(2, 30, pluie) * 0.75 + 0.25;
                if (fl & 1) mNeige[k] = 255 * force * attenuation;
                else mPluie[k] = 255 * force * attenuation;
            }
            if (categorie[c] === codeBrouillard) mBrume[k] = 200 * attenuation;
        }
    }

    ctx.putImageData(image, 0, 0);

    const fabrique = valeurs => {
        let present = false;
        for (let k = 0; k < valeurs.length; k += 7) if (valeurs[k]) { present = true; break; }
        if (!present) return null;
        const c2 = document.createElement("canvas");
        c2.width = W; c2.height = H;
        const ctx2 = c2.getContext("2d");
        const im = ctx2.createImageData(W, H);
        for (let k = 0; k < valeurs.length; k++) im.data[k * 4 + 3] = valeurs[k];
        ctx2.putImageData(im, 0, 0);
        // Bords adoucis
        const c3 = document.createElement("canvas");
        c3.width = W; c3.height = H;
        const ctx3 = c3.getContext("2d");
        ctx3.filter = "blur(2px)";
        ctx3.drawImage(c2, 0, 0);
        return c3.toDataURL("image/png");
    };

    masques.pluie = fabrique(mPluie);
    masques.neige = fabrique(mNeige);
    masques.brume = fabrique(mBrume);
    appliquerMasques(masques);
}

function appliquerMasques(masques) {
    for (const [nom, url] of Object.entries(masques)) {
        const element = $(`anim-${nom}`);
        if (!element) continue;
        if (!url) {
            element.style.display = "none";
            continue;
        }
        element.style.display = "";
        element.style.webkitMaskImage = element.style.maskImage = `url(${url})`;
    }
}

// --- Symboles répartis sur le territoire -----------------------------------

let cheminFrance = null;

function construireCheminFrance() {
    cheminFrance = new Path2D();
    d3.geoPath(etat.projection, cheminFrance)(etat.departements);
}

function positionsSymboles(espacement) {
    // Maille triangulaire : la répartition la plus régulière possible,
    // légèrement décalée de façon déterministe pour éviter l'effet grille.
    const positions = [];
    const hauteurLigne = espacement * 0.866;
    const hg = etat.projection([-5.4, 51.3]), bd = etat.projection([9.8, 41.2]);
    const ctx = $("hachures").getContext("2d");
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    let ligne = 0;
    for (let y = hg[1] + hauteurLigne / 2; y < bd[1]; y += hauteurLigne, ligne++) {
        const decalage = (ligne % 2) * espacement / 2;
        for (let x = hg[0] + decalage; x < bd[0]; x += espacement) {
            const jx = Math.sin(x * 12.9898 + y * 78.233) * 0.12 * espacement;
            const jy = Math.cos(x * 39.346 + y * 11.135) * 0.12 * espacement;
            const px = x + jx, py = y + jy;
            if (px < 16 || py < 16 || px > etat.largeur - 16 || py > etat.hauteur - 16) continue;
            if (ctx.isPointInPath(cheminFrance, px, py)) positions.push([px, py]);
        }
    }
    ctx.restore();
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
            if (nom === "inconnu") continue;
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
    const carte = carteConditions();
    const calque = d3.select("#calque-conditions");

    if (!carte) {
        dessinerCiel();
        placerConditionsStations();
        return;
    }

    construireCheminFrance();
    dessinerCiel();

    const unite = largeurFrance();
    const espacement = Math.max(46, Math.min(96, unite / 10.5));
    const grandeur = Math.max(0.75, Math.min(1.55, espacement / 60));

    const symboles = [];
    for (const [x, y] of positionsSymboles(espacement)) {
        const s = situationAutour(carte, x, y, espacement * 0.55);
        if (s) symboles.push({ id: `${Math.round(x)}:${Math.round(y)}`, x, y, ...s });
    }

    calque.selectAll("g.vent-fort").remove();

    calque.selectAll("g.symbole")
        .data(symboles, d => d.id)
        .join("g")
        .attr("class", d => "symbole" + (d.confiance < 1.5 ? " estime" : ""))
        .attr("tabindex", 0)
        .attr("transform", d => `translate(${d.x},${d.y}) scale(${grandeur})`)
        .html(d => `<circle r="20" fill="transparent"/>${dessinSymbole(DESSIN_CATEGORIE[d.categorie], d.jour)}`)
        .on("pointerenter focus", (evenement, d) => montrerBulle(d, bulleConditionFusion(d, carte)))
        .on("pointerleave blur", cacherBulle);

    placerVents(carte, espacement, grandeur, symboles);
    etat.conditionsPretes = true;
}

// Flèches de vent fort, plutôt sur les côtes et en mer (comme à la télévision),
// là où les rafales observées ou prévues atteignent 50 km/h.
function placerVents(carte, espacement, grandeur, symboles = []) {
    const g = carte.grille;
    const candidats = [];
    const hg = etat.projection([-6.4, 51.9]), bd = etat.projection([10.9, 40.6]);
    const pas = Math.max(2, Math.round(espacement / 2 / ((bd[0] - hg[0]) / g.nx)));

    const ctx = $("hachures").getContext("2d");
    for (let j = 0; j < g.ny; j += pas) {
        for (let i = 0; i < g.nx; i += pas) {
            const c = j * g.nx + i;
            const r = carte.donnees.rafale[c];
            if (r === 255 || r < 50 || carte.donnees.direction[c] === 255) continue;
            const lon = g.ouest + (i + 0.5) * g.pas, lat = g.nord - (j + 0.5) * g.pas;
            const [x, y] = etat.projection([lon, lat]);
            if (x < 24 || y < 70 || x > etat.largeur - 40 || y > etat.hauteur - 40) continue;
            if (ctx.isPointInPath(cheminFrance, x, y)) continue;   // la France porte les symboles
            if (symboles.some(s => Math.hypot(s.x - x, s.y - y) < espacement * 0.75)) continue;
            candidats.push({ x, y, rafale: r, direction: carte.donnees.direction[c] * 2 });
        }
    }

    candidats.sort((a, b) => b.rafale - a.rafale);
    const retenus = [];
    for (const c of candidats) {
        if (retenus.length >= 9) break;
        if (retenus.every(r => Math.hypot(r.x - c.x, r.y - c.y) > espacement * 1.6)) retenus.push(c);
    }

    d3.select("#calque-conditions").selectAll("g.vent-fort")
        .data(retenus)
        .join("g")
        .attr("class", "vent-fort")
        .attr("transform", d => `translate(${d.x},${d.y}) scale(${grandeur})`)
        .html(d => `<path class="vent-chevron" transform="rotate(${d.direction + 180})" d="M0-15l9 22-9-6-9 6z"/>` +
            `<text class="vent-chiffre" x="15" y="-6">${d.rafale}</text>`);
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
    const tailleCase = Math.max(58, unite / 6.4);
    const grandeur = Math.max(0.8, Math.min(1.9, tailleCase / 62));

    const famille = s => s.condition.code.split("-")[0];
    const choix = choisirParCases(stations, tailleCase, 0, famille);

    calque.selectAll("g.symbole")
        .data(choix, d => d.station.id)
        .join("g")
        .attr("class", "symbole")
        .attr("tabindex", 0)
        .attr("transform", d => `translate(${d.x},${d.y}) scale(${grandeur})`)
        .html(d => {
            const c = d.station.condition;
            let dessin = dessinSymbole(c.code, c.jour);

            if (c.vent && Number.isFinite(d.station.rafale)) {
                const cap = Number.isFinite(d.station.direction_vent)
                    ? d.station.direction_vent + 180 : null;
                const fleche = cap === null ? "" :
                    `<path class="vent-fleche contour" transform="translate(-9,22) rotate(${cap}) scale(0.8)" d="M0-7l4.2 9.5-4.2-2.4-4.2 2.4z"/>`;
                dessin += `<g class="vent">${fleche}<text class="vent-valeur" x="${cap === null ? 0 : 5}" y="26">${Math.round(d.station.rafale * 3.6)}</text></g>`;
            }

            return `<circle r="20" fill="transparent"/>${dessin}`;
        })
        .on("pointerenter focus", (evenement, d) => montrerBulle(d, bulleCondition(d.station)))
        .on("pointerleave blur", cacherBulle);

    etat.conditionsPretes = true;
}

// ---------------------------------------------------------------------------
// 8. Habillage
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
    const arrets = PALETTE_TEMPERATURE
        .filter(([t]) => t >= -10 && t <= 40)
        .map(([t, c]) => `${c} ${(t + 10) * 2}%`);

    let reperes = "";
    if (etat.extremes) {
        const { mini, maxi } = etat.extremes;
        const lieu = s => s.source === "arome" ? "" : echapper(s.commune || s.nom);
        reperes = `<div class="legende-reperes">
            <span>Plus froid <b class="mini">${nombre(mini.temperature, 1)} °C</b> ${lieu(mini)}</span>
            <span>Plus chaud <b class="maxi">${nombre(maxi.temperature, 1)} °C</b> ${lieu(maxi)}</span>
        </div>`;
    }

    return `<div class="echelle-temp">
        <div class="degrade" style="background:linear-gradient(to right, ${PALETTE_TEMPERATURE[1][1]} 0%, ${arrets.join(", ")}, ${PALETTE_TEMPERATURE.at(-1)[1]} 100%)"></div>
        <div class="graduations"><span>−10</span><span>0</span><span>10</span><span>20</span><span>30</span><span>40 °C</span></div>
    </div>${reperes}`;
}

function legendeRadar() {
    const r = etat.radar;

    const classes = r.seuils.map((seuil, i) => {
        const dernier = i === r.seuils.length - 1;
        return `<span style="background-image:linear-gradient(${r.couleurs[i]}, ${r.couleurs[i]})">` +
            `${String(seuil).replace(".", ",")}${dernier ? "+" : ""}</span>`;
    }).join("");

    const hors = etat.radarCouverture
        ? `<div class="note-legende"><span class="hachure-exemple"></span>Hachures : zone sans mesure radar</div>`
        : "";

    return `<div class="classes" aria-label="Intensité en ${echapper(r.unite)}">${classes}<span style="min-width:0;padding-left:6px">${echapper(r.unite)}</span></div>${hors}`;
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
    const resume = Object.entries(carte.resume_france || {})
        .filter(([nom, n]) => nom !== "inconnu" && n > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6);

    const symboles = resume.map(([nom]) => {
        const code = DESSIN_CATEGORIE[nom];
        return `<span class="cle-symbole"><svg viewBox="-20 -20 40 40" aria-hidden="true"><g class="symbole">${dessinSymbole(code, true)}</g></svg>${echapper(LIBELLES_CONDITION[code][0])}</span>`;
    }).join("");

    const attributions = Object.values(p).filter(s => s && s.retenue && s.attribution).map(s => s.attribution);
    const estime = carte.mode !== "prevision"
        ? `<div class="note-legende"><span class="estime-exemple"></span>Symbole estompé : estimation, sources incomplètes</div>` : "";

    const legende = `<div class="cles-conditions">${symboles}</div>${estime}` +
        (attributions.length ? `<div class="attributions">${echapper(attributions.join(" — "))}</div>` : "");

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
        if (etat.radar === undefined) return null;   // encore en chargement
        if (!etat.radar) {
            return ["Image radar absente",
                "Aucune mosaïque radar n'a encore été convertie pour la carte."];
        }
        if (!radarDuJour()) {
            return ["Pas d'image radar pour ce jour",
                `La dernière image disponible date du ${libelleJour(jourParis(etat.radar.date_utc)).toLowerCase()}.`];
        }
        return null;
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
        if (radarDuJour()) {
            sousTitre = `Image radar Météo-France de ${heureParis(etat.radar.date_utc)}. ` +
                "Pluie mesurée, pas une prévision.";
            legende = legendeRadar();
        } else if (etat.radar === undefined) {
            sousTitre = "Chargement de l'image radar…";
        }
    } else {
        titre = "Conditions météo";
        const carte = carteConditions();
        if (carte) {
            [sousTitre, legende] = habillageConditions(carte);
        } else if (d && d.disponible && d.type !== "prevision") {
            sousTitre = `Observées à ${heureParis(d.date)} par les stations. ` + (d.ciel_mesure
                ? "Pluie, neige, brouillard et état du ciel d'après leurs mesures."
                : "L'état du ciel n'est pas mesuré : radar et satellite ne sont pas encore disponibles.");
            legende = `<div class="note-legende">Chiffre sous un symbole : rafales de 50 km/h ou plus.</div>`;
        } else if (etat.jour && !etat.conditions.get(etat.jour)) {
            sousTitre = "Chargement de la carte des conditions…";
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

    // Jour consulté
    if (etat.jour) {
        const aujourdhui = d && d.aujourdhui;
        let libelle = libelleJour(etat.jour);
        if (etat.jour === aujourdhui) libelle = `Aujourd'hui, ${libelle.toLowerCase()}`;

        $("jour-libelle").textContent = libelle;
        $("jour-precedent").disabled = !d || !d.premier_jour || etat.jour <= d.premier_jour;
        $("jour-suivant").disabled = !d || !d.dernier_jour_navigable || etat.jour >= d.dernier_jour_navigable;
    }
}

// ---------------------------------------------------------------------------
// 9. Navigation
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

function afficherTableau(tableau, manuel = false) {
    const change = tableau !== etat.tableau;

    if (manuel) {
        // Un choix manuel suspend le défilement ; il reprend seul après une minute.
        etat.auto = false;
        clearTimeout(minuterieReprise);
        minuterieReprise = setTimeout(() => reglerLecture(true), REPRISE_AUTO);
        majBoutonLecture();
    }

    etat.tableau = tableau;
    scene.dataset.tableau = tableau;
    cacherBulle();

    for (const bouton of document.querySelectorAll(".tableaux button[data-tableau]")) {
        bouton.setAttribute("aria-pressed", String(bouton.dataset.tableau === tableau));
    }

    if (tableau === "temperatures" && change) {
        // Autres stations à chaque passage
        etat.rotation = (etat.rotation + 1) % 4;
        placerTemperatures();
    }

    if (tableau === "conditions") preparerConditions();

    actualiserHabillage();

    if (change && !reduitMouvement) {
        const bandeau = $("bandeau");
        bandeau.classList.remove("change");
        void bandeau.offsetWidth;
        bandeau.classList.add("change");
    }

    // Préparation du tableau suivant pendant que celui-ci est à l'écran
    if (tableau === "precipitations") {
        (window.requestIdleCallback || setTimeout)(() => preparerConditions());
    }

    planifierDefilement();
}

// Charge la carte fusionnée du jour affiché (une seule fois), puis la dessine
let conditionsEnCours = null;

async function preparerConditions() {
    const jour = etat.jour;
    if (!jour) return;

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
    clearTimeout(minuterieReprise);
    majBoutonLecture();
    planifierDefilement();
}

async function chargerJour(jour, cleProgression) {
    const enCache = jour && etat.jours.get(jour);

    if (enCache && Date.now() - enCache.recu < RAFRAICHISSEMENT) return enCache;
    if (enCache && enCache.jour !== enCache.aujourdhui && enCache.disponible) return enCache;

    const url = jour ? `${URL_API}?jour=${encodeURIComponent(jour)}` : URL_API;
    const donnees = await lireJson(await telecharger(url, cleProgression));

    donnees.recu = Date.now();
    etat.jours.set(donnees.jour, donnees);

    return donnees;
}

function installerDonnees(donnees) {
    etat.donnees = donnees;
    etat.jour = donnees.jour;
    etat.conditionsPretes = false;
}

let demandeJour = 0;

async function allerAuJour(jour) {
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
    await attendreImage();

    dessinerChamp();
    placerTemperatures();
    placerRadar();
    if (etat.tableau === "conditions") await preparerConditions();

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
        allerAuJour(etat.jour);
    });

    document.addEventListener("keydown", evenement => {
        if (evenement.target.closest("input, select, textarea")) return;
        if (evenement.key === "ArrowLeft" && !$("jour-precedent").disabled) $("jour-precedent").click();
        if (evenement.key === "ArrowRight" && !$("jour-suivant").disabled) $("jour-suivant").click();
    });

    document.addEventListener("visibilitychange", planifierDefilement);

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

    // Nouvelles observations du jour, sans recharger la page
    setInterval(async () => {
        const d = etat.donnees;
        if (document.hidden || !d || etat.jour !== d.aujourdhui) return;
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
        if (etat.tableau === "conditions") preparerConditions();
    }, RAFRAICHISSEMENT);
}

function redessiner() {
    cacherBulle();
    cadrer();
    dessinerFond();
    dessinerChamp();
    placerTemperatures();
    placerRadar();
    etat.conditionsPretes = false;
    if (etat.tableau === "conditions") placerConditions();
    actualiserHabillage();
}

// ---------------------------------------------------------------------------
// 10. Démarrage
// ---------------------------------------------------------------------------

function echecFatal(message) {
    $("intro-secours").hidden = false;
    $("intro-message").textContent = message;
    $("intro-passer").textContent = "Réessayer";
    $("intro-passer").onclick = () => location.reload();
    $("intro-etape").textContent = "Chargement interrompu";
}

async function demarrer() {
    if (typeof d3 === "undefined") {
        return echecFatal("La bibliothèque de cartographie n'a pas pu être chargée. Vérifiez la connexion.");
    }

    const debut = performance.now();

    teintesRelief = tableCouleurs(PALETTE_RELIEF, 0, 3200, 10);
    teintesTemperature = tableCouleurs(PALETTE_TEMPERATURE, -15, 42, 0.1);

    cadrer();
    installerCommandes();

    // Chargement trop long : on propose de voir la carte sans attendre.
    const alerte = setTimeout(() => {
        if (etat.ouverte) return;
        $("intro-secours").hidden = false;
        $("intro-passer").onclick = fermerIntro;
    }, 10000);

    // Tout ce qui sert au premier tableau part en même temps.
    const promessePays = chargerRessource("pays", "geo/hko_pays.geojson", "geo/pays_monde_50m.geojson");
    const promesseDepartements = chargerRessource(
        "departements", "geo/hko_departements.geojson", "geo/departements.geojson");

    const promesseRelief = chargerRessource("relief", "relief/hko_relief.json.gz", "relief/relief_europe.json.gz")
        .then(normaliserRelief)
        .catch(erreur => {
            // Sans relief, la carte reste utilisable (terres en aplat).
            console.warn("HKO : relief indisponible —", erreur.message);
            progresser("relief", 1);
            return null;
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

    try {
        const [pays, departements] = await Promise.all([promessePays, promesseDepartements]);

        etat.pays = pays;
        etat.departements = {
            type: "FeatureCollection",
            features: departements.features.filter(d =>
                !String((d.properties || {}).code || "").startsWith("97"))
        };
    } catch (erreur) {
        console.error(erreur);
        clearTimeout(alerte);
        return echecFatal("Les contours de la carte n'ont pas pu être chargés.");
    }

    etat.relief = await promesseRelief;

    await attendreImage();
    dessinerFond();
    progresser("fond", 1);

    installerDonnees(await promesseObservations);

    await attendreImage();
    dessinerChamp();
    placerTemperatures();
    actualiserHabillage();
    progresser("champ", 1);

    clearTimeout(alerte);

    // La marque reste lisible un instant, même si tout est déjà en cache.
    const reste = Math.max(0, 1300 - (performance.now() - debut));
    setTimeout(fermerIntro, reste);

    // Tableau suivant préparé en arrière-plan, pendant l'affichage du premier.
    setTimeout(chargerRadar, reste + 400);
}

demarrer();

})();
