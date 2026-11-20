/* ==========================================================================
   HKO Météo — champs animés (radar, satellite) en WebGL

   Ce module dessine une suite de grilles observées (0,05°, 350 × 230) sur
   la carte, et calcule les images intermédiaires entre deux observations.

   Images intermédiaires : le mouvement entre deux observations est estimé
   par corrélation de blocs (un vecteur par bloc de 12 × 12 cellules), puis
   chaque image intermédiaire déplace les deux observations le long de ce
   mouvement avant de les fondre. Rien n'est ajouté : une image
   intermédiaire ne montre que ce que contiennent les deux observations qui
   l'encadrent. L'interface indique toujours si l'image affichée est une
   observation ou une image calculée.

   Satellite : la grille donne, par cellule, la part de nuages opaques et
   partiels. Le grain fin des nuages (en dessous de 5 km), leur modelé et
   leurs ombres portées sont un rendu graphique : ils suivent la couverture
   mesurée sans prétendre la préciser.

   API (window.HKOAnime) :
     decoder(reponse)            réponse de /api/animation/ -> séquence
     sequenceBinaire(index)      index de /api/radar/ -> séquence à remplir
     creer(canvas, source, options)
                                 moteur de rendu, ou null sans WebGL
       .charger(sequence)        envoie les trames au processeur graphique,
                                 par petits paquets (la page reste fluide)
       .ajouterTrame(i, rgba)    texture déjà convertie (Worker)
       .definirFlux(i, m)        mouvement calculé ailleurs (Worker)
       .dessiner(etat)           dessine l'instant etat.instant (ms)
       .situation(instant)       { avant, apres, fraction, observee }
       .liberer()                rend la mémoire graphique
     options.surPerte / options.surRestauration : perte du contexte WebGL
     (mémoire graphique reprise par le système, pilote réinitialisé…).
     Ce fichier est aussi chargé par le Worker de calcul (hko_calcul.js),
     qui n'en utilise que estimerMouvement et champSuivi.
   ========================================================================== */

((portee) => {
"use strict";

// ---------------------------------------------------------------------------
// Décodage des trames
// ---------------------------------------------------------------------------

function base64VersOctets(texte) {
    const binaire = atob(texte);
    const octets = new Uint8Array(binaire.length);
    for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
    return octets;
}

// Index de /api/radar/ (trames binaires servies à part) -> séquence vide,
// complétée trame par trame (plan1/plan2 ou rgba) à mesure du chargement.
function sequenceBinaire(index) {
    const g = index.grille;
    return {
        source: index.source,
        jour: index.jour,
        grille: g,
        opera: true,
        pas: (index.pas_minutes || 15) * 60000,
        attribution: index.attribution,
        trames: index.trames.map(t => ({ instant: t.instant, ms: Date.parse(t.instant), url: t.url }))
            .sort((a, b) => a.ms - b.ms)
    };
}

function decoder(reponse) {
    const g = reponse.grille;
    const n = g.nx * g.ny;

    const trames = reponse.trames.map(t => {
        const octets = base64VersOctets(t.donnees);
        return {
            instant: t.instant,
            ms: Date.parse(t.instant),
            plan1: octets.subarray(0, n),
            plan2: octets.subarray(n, 2 * n)
        };
    }).sort((a, b) => a.ms - b.ms);

    return {
        source: reponse.source,
        jour: reponse.jour,
        grille: g,
        pas: (reponse.pas_minutes || 5) * 60000,
        attribution: reponse.attribution,
        trames
    };
}

// Valeur scalaire servant à suivre le mouvement (0..15 environ)
function champSuivi(source, trame, n) {
    const v = new Float32Array(n);
    if (source === "radar") {
        for (let i = 0; i < n; i++) {
            const pluie = trame.plan2[i] >> 4;
            v[i] = pluie ? trame.plan1[i] / 16 + pluie * 0.4 : 0;
        }
    } else {
        for (let i = 0; i < n; i++) {
            v[i] = (trame.plan1[i] >> 4) + 0.55 * (trame.plan1[i] & 15);
        }
    }
    return v;
}

// ---------------------------------------------------------------------------
// Estimation du mouvement entre deux trames
// ---------------------------------------------------------------------------

const BLOC = 12;          // cellules par bloc
const RECHERCHE = 5;      // ± déplacement cherché, en demi-cellules × 2 (soit ± 10 cellules)

function demiResolution(v, nx, ny) {
    const w = nx >> 1, h = ny >> 1;
    const r = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = 2 * y * nx + 2 * x;
            r[y * w + x] = 0.25 * (v[i] + v[i + 1] + v[i + nx] + v[i + nx + 1]);
        }
    }
    return { v: r, w, h };
}

function estimerMouvement(a, b, nx, ny) {
    const A = demiResolution(a, nx, ny), B = demiResolution(b, nx, ny);
    const w = A.w, h = A.h, taille = BLOC / 2;
    const bw = Math.ceil(nx / BLOC), bh = Math.ceil(ny / BLOC);
    const vx = new Float32Array(bw * bh), vy = new Float32Array(bw * bh);
    const fiable = new Uint8Array(bw * bh);
    const R = RECHERCHE;
    const couts = new Float32Array((2 * R + 1) * (2 * R + 1));

    for (let by = 0; by < bh; by++) {
        for (let bx = 0; bx < bw; bx++) {
            const x0 = bx * taille, y0 = by * taille;
            const x1 = Math.min(w, x0 + taille), y1 = Math.min(h, y0 + taille);

            // Bloc sans contenu (ciel clair, pas de pluie) : rien à suivre
            let somme = 0, carre = 0, nb = 0;
            for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
                const s = A.v[y * w + x]; somme += s; carre += s * s; nb++;
            }
            const moyenne = somme / nb;
            if (moyenne < 0.4 || carre / nb - moyenne * moyenne < 0.15) continue;

            let meilleur = Infinity, mdx = 0, mdy = 0;
            for (let dy = -R; dy <= R; dy++) {
                for (let dx = -R; dx <= R; dx++) {
                    let cout = 0;
                    for (let y = y0; y < y1; y++) {
                        const yy = Math.min(h - 1, Math.max(0, y + dy));
                        for (let x = x0; x < x1; x++) {
                            const xx = Math.min(w - 1, Math.max(0, x + dx));
                            cout += Math.abs(A.v[y * w + x] - B.v[yy * w + xx]);
                        }
                    }
                    cout = cout / nb + 0.04 * Math.hypot(dx, dy);   // préférence pour l'immobilité
                    couts[(dy + R) * (2 * R + 1) + dx + R] = cout;
                    if (cout < meilleur) { meilleur = cout; mdx = dx; mdy = dy; }
                }
            }

            // Affinage sous la cellule (parabole sur les voisins)
            const c = (dx, dy) => couts[(dy + R) * (2 * R + 1) + dx + R];
            let fx = 0, fy = 0;
            if (Math.abs(mdx) < R) {
                const g = c(mdx - 1, mdy), d = c(mdx + 1, mdy), m = c(mdx, mdy);
                const den = g - 2 * m + d;
                if (den > 1e-6) fx = Math.max(-0.5, Math.min(0.5, 0.5 * (g - d) / den));
            }
            if (Math.abs(mdy) < R) {
                const g = c(mdx, mdy - 1), d = c(mdx, mdy + 1), m = c(mdx, mdy);
                const den = g - 2 * m + d;
                if (den > 1e-6) fy = Math.max(-0.5, Math.min(0.5, 0.5 * (g - d) / den));
            }

            const k = by * bw + bx;
            vx[k] = 2 * (mdx + fx);   // en cellules pleines
            vy[k] = 2 * (mdy + fy);
            fiable[k] = 1;
        }
    }

    // Blocs sans contenu : mouvement des voisins (diffusion), à défaut nul
    for (let passe = 0; passe < 12; passe++) {
        let reste = 0;
        const nvx = vx.slice(), nvy = vy.slice(), nf = fiable.slice();
        for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
            const k = y * bw + x;
            if (fiable[k]) continue;
            let sx = 0, sy = 0, n = 0;
            for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
                const xx = x + i, yy = y + j;
                if (xx < 0 || yy < 0 || xx >= bw || yy >= bh) continue;
                const kk = yy * bw + xx;
                if (fiable[kk]) { sx += vx[kk]; sy += vy[kk]; n++; }
            }
            if (n) { nvx[k] = sx / n; nvy[k] = sy / n; nf[k] = 2; } else reste++;
        }
        vx.set(nvx); vy.set(nvy); fiable.set(nf);
        if (!reste) break;
    }

    // Lissage : un champ de mouvement régulier évite les déchirures
    for (let passe = 0; passe < 2; passe++) {
        const nvx = vx.slice(), nvy = vy.slice();
        for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
            let sx = 0, sy = 0, n = 0;
            for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
                const xx = x + i, yy = y + j;
                if (xx < 0 || yy < 0 || xx >= bw || yy >= bh) continue;
                const p = i === 0 && j === 0 ? 2 : 1;
                sx += vx[yy * bw + xx] * p; sy += vy[yy * bw + xx] * p; n += p;
            }
            nvx[y * bw + x] = sx / n; nvy[y * bw + x] = sy / n;
        }
        vx.set(nvx); vy.set(nvy);
    }

    // Texture : 128 = immobile, 1/8 de cellule par unité (± 16 cellules)
    const octets = new Uint8Array(bw * bh * 4);
    for (let k = 0; k < bw * bh; k++) {
        octets[k * 4] = Math.max(0, Math.min(255, Math.round(128 + vx[k] * 8)));
        octets[k * 4 + 1] = Math.max(0, Math.min(255, Math.round(128 + vy[k] * 8)));
        octets[k * 4 + 2] = 128;
        octets[k * 4 + 3] = 255;
    }
    return { octets, bw, bh };
}

// ---------------------------------------------------------------------------
// WebGL
// ---------------------------------------------------------------------------

const SOMMETS = `
attribute vec2 aPosition;
void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }`;

// Partie commune : pixel écran -> longitude, latitude -> cellule de grille
const COMMUN = `
precision highp float;
uniform vec2 uTaille;        // pixels du canvas
uniform float uEchelle;      // pixels de canvas par pixel CSS
uniform float uScale;        // projection D3 : échelle (px CSS par radian)
uniform vec2 uTranslate;     // projection D3 : translation (px CSS)
uniform vec4 uGrille;        // ouest, nord, pas, (inutilisé)
uniform vec2 uCellules;      // nx, ny
uniform sampler2D uA;
uniform sampler2D uB;
uniform sampler2D uFlux;
uniform vec2 uFluxEchelle;
uniform float uT;            // 0 : trame A, 1 : trame B
uniform float uFlux0;        // 1 si le mouvement est disponible
uniform float uFinesse;      // 1 : grille d'origine ; 0,5 : grille deux fois plus grossière

const float PI = 3.14159265;

vec2 lonLat() {
    vec2 css = vec2(gl_FragCoord.x, uTaille.y - gl_FragCoord.y) / uEchelle;
    float lon = (css.x - uTranslate.x) / uScale;
    float lat = 2.0 * atan(exp((uTranslate.y - css.y) / uScale)) - 0.5 * PI;
    return degrees(vec2(lon, lat));
}

vec2 versGrille(vec2 ll) {
    return vec2((ll.x - uGrille.x) / uGrille.z, (uGrille.y - ll.y) / uGrille.z);
}

vec2 mouvement(vec2 uv) {
    vec2 v = (texture2D(uFlux, uv * uFluxEchelle).rg * 255.0 - 128.0) / 8.0;
    return v / uCellules * uFlux0;
}

// Valeur interpolée dans le temps, le long du mouvement
vec4 echantillon(vec2 uv) {
    vec2 v = mouvement(uv);
    vec4 a = texture2D(uA, uv - uT * v);
    vec4 b = texture2D(uB, uv + (1.0 - uT) * v);
    return mix(a, b, uT);
}

// 1 au cœur de la grille, 0 à l'extérieur, fondu sur quelques cellules
float dansGrille(vec2 g, float fondu) {
    float bord = min(min(g.x, g.y), min(uCellules.x - g.x, uCellules.y - g.y));
    return smoothstep(0.0, fondu, bord);
}

vec4 sur(vec4 dessous, vec3 couleur, float alpha) {
    return vec4(couleur * alpha + dessous.rgb * (1.0 - alpha), alpha + dessous.a * (1.0 - alpha));
}
`;
// Paramètres expérimentaux du rendu OPERA
const RADAR_OPERA = !(portee.location &&
    new URLSearchParams(portee.location.search).get("opera") === "0");

const OPERA_LISSAGE = 1.50;
const OPERA_TRANSITION = 0.30;
const OPERA_OPACITE = 0.85;

const RADAR = COMMUN + `
uniform vec3 uCouleurs[10];
uniform float uSeuils[10];
uniform float uHachures;

void main() {
    vec2 g = versGrille(lonLat());
    vec2 uv = g / uCellules;
    float dedans = dansGrille(g, 8.0 * uFinesse);


    vec4 f = dedans > 0.0 ? echantillon(uv) : vec4(0.0);
    float mmh = exp2(f.r * 255.0 / 40.0) - 1.0;
    float pluie = f.g;
    float couverture = f.b;

    ${RADAR_OPERA ? `
    if (dedans > 0.0 && couverture > 0.5) {
        vec2 d = vec2(${OPERA_LISSAGE.toFixed(3)} * uFinesse) / uCellules;

        vec4 voisins[4];
        voisins[0] = echantillon(uv + vec2(d.x, 0.0));
        voisins[1] = echantillon(uv - vec2(d.x, 0.0));
        voisins[2] = echantillon(uv + vec2(0.0, d.y));
        voisins[3] = echantillon(uv - vec2(0.0, d.y));

        float somme = mmh * 4.0;
        float sommePluie = pluie * 4.0;
        float poids = 4.0;

        for (int j = 0; j < 4; j++) {
            vec4 v = voisins[j];
            if (v.b > 0.5) {
                somme += exp2(v.r * 255.0 / 40.0) - 1.0;
                sommePluie += v.g;
                poids += 1.0;
            }
        }

        mmh = somme / poids;
        pluie = sommePluie / poids;
    }
    ` : ""}


    // Couleur par classe, transitions courtes pour garder des contours nets
    vec3 c = uCouleurs[0];
    for (int i = 1; i < 10; i++) {
        c = mix(c, uCouleurs[i], smoothstep(
            uSeuils[i] * ${RADAR_OPERA ? (1 - OPERA_TRANSITION).toFixed(3) : "0.93"},
            uSeuils[i] * ${RADAR_OPERA ? (1 + OPERA_TRANSITION).toFixed(3) : "1.07"},
            mmh
        ));
    }
    float alpha = ${RADAR_OPERA
        ? "smoothstep(0.20, 0.75, pluie)"
        : "smoothstep(0.12, 0.42, pluie)"}
        * smoothstep(0.12, 0.2, mmh)
        * ${RADAR_OPERA ? OPERA_OPACITE.toFixed(3) : "0.94"};

    ${RADAR_OPERA ? `
    alpha *= smoothstep(0.5, 0.9, couverture);
    ` : ""}

    vec4 res = vec4(0.0);

    // Zone sans mesure radar : hachures fines (à ne pas confondre avec « pas de pluie »)
    float sans = (1.0 - smoothstep(0.3, 0.6, couverture)) * uHachures;
    if (sans > 0.0) {
        float d = mod(gl_FragCoord.x + gl_FragCoord.y, 7.0 * uEchelle);
        float trait = 1.0 - smoothstep(0.0, 1.2 * uEchelle, abs(d - 0.6 * uEchelle));
        res = sur(res, vec3(1.0), 0.22 * trait * sans);
    }

    res = sur(res, c, alpha * dedans);
    gl_FragColor = res;
}`;

const SATELLITE = COMMUN + `
uniform sampler2D uBruit;
uniform float uTemps;        // en trames, continu
uniform vec3 uSoleil;        // déclinaison (rad), heure solaire de Greenwich (h), (inutilisé)
uniform float uDetail;       // 0 : rendu simple, 1 : rendu complet

// Taille d'un motif de bruit, en degrés (lon, lat) : nuages de 2 à 20 km
const vec2 MOTIF = vec2(1.1, 0.78);

// Hauteur du soleil (rad) et direction (est, nord) au point ll (degrés)
vec3 soleil(vec2 ll) {
    float lat = radians(ll.y);
    float h = radians((uSoleil.y - 12.0) * 15.0 + ll.x);
    float decl = uSoleil.x;
    float sinE = sin(lat) * sin(decl) + cos(lat) * cos(decl) * cos(h);
    float e = asin(clamp(sinE, -1.0, 1.0));
    vec2 dir = vec2(-sin(h) * cos(decl), cos(lat) * sin(decl) - sin(lat) * cos(decl) * cos(h));
    return vec3(normalize(dir + 1e-5), e);
}

// Grain (0..1, uniforme) entraîné par le mouvement observé : deux couches
// en fondu alterné pour qu'elles ne se déforment jamais trop.
float grain(vec2 ll, vec2 uv, float canal) {
    vec2 v = mouvement(uv) * uCellules * uGrille.z;     // degrés par trame
    v.y = -v.y;
    float periode = 6.0;
    float p0 = fract(uTemps / periode);
    float p1 = fract(uTemps / periode + 0.5);
    vec2 base = ll / MOTIF;
    vec2 q0 = base - v * p0 * periode / MOTIF;
    vec2 q1 = base - v * p1 * periode / MOTIF + 0.37;
    vec4 a = texture2D(uBruit, q0), b = texture2D(uBruit, q1);
    float n0 = mix(a.r, a.g, canal), n1 = mix(b.r, b.g, canal);
    float w = abs(1.0 - 2.0 * p0);
    return mix(n1, n0, w);
}

// Part du ciel couverte au point : nuage là où le grain est sous la
// couverture mesurée (bord adouci sur quelques kilomètres)
float nuages(float couverture, float n) {
    return smoothstep(n - 0.13, n + 0.13, couverture);
}

// Bord de la zone de données : fondu large et irrégulier, pour ne jamais
// dessiner un rectangle (la limite reste signalée dans la légende).
float bordOrganique(vec2 g, vec2 ll) {
    float bord = min(min(g.x, g.y), min(uCellules.x - g.x, uCellules.y - g.y));
    float n = texture2D(uBruit, ll / vec2(9.0, 6.5)).g;
    return smoothstep(0.0, 26.0, bord + (n - 0.5) * 30.0);
}

void main() {
    vec2 ll = lonLat();
    vec2 g = versGrille(ll);
    vec2 uv = g / uCellules;
    float dedans = bordOrganique(g, ll);

    vec3 s = soleil(ll);
    float hauteur = degrees(s.z);
    float jour = smoothstep(-6.0, 3.0, hauteur);

    vec4 res = vec4(0.0);

    // Hors de la zone de données : la Terre reste visible, à peine assombrie,
    // pour ne pas laisser croire à un ciel dégagé que personne n'a mesuré.
    res = sur(res, vec3(0.01, 0.03, 0.08), 0.22 * (1.0 - dedans));

    // Soleil bas : le sol s'assombrit avant la nuit ; nuit : sol presque
    // noir, bleuté ; terminateur progressif
    float penombre = 0.45 * (1.0 - smoothstep(0.0, 22.0, hauteur)) * jour;
    res = sur(res, vec3(0.01, 0.02, 0.05), penombre);
    res = sur(res, vec3(0.005, 0.012, 0.035), 0.82 * (1.0 - jour));

    if (dedans <= 0.0) { gl_FragColor = res; return; }

    vec4 f = echantillon(uv);
    float opaque = f.r, partiel = f.g, neige = f.b, valide = f.a;
    float mesure = smoothstep(0.2, 0.5, valide);
    float couverture = clamp(opaque + partiel, 0.0, 1.0) * mesure;
    // Part épaisse de la couverture (le reste est un voile)
    float epaisseur = opaque / max(opaque + partiel, 0.01);

    float n = uDetail > 0.5 ? grain(ll, uv, 0.0) : 0.5;
    float densite = uDetail > 0.5 ? nuages(couverture, n) : couverture;

    // Texture interne : variation douce de brillance (quelques dizaines de km)
    float t2 = uDetail > 0.5 ? grain(ll * 0.45, uv, 1.0) : 0.5;

    // Neige au sol observée (de jour, sous ciel clair)
    float blanc = smoothstep(0.08, 0.45, neige) * (1.0 - densite) * jour * dedans;
    res = sur(res, vec3(0.93, 0.95, 0.99), 0.85 * blanc);

    // Ombre portée des nuages, à l'opposé du soleil, de même forme
    if (jour > 0.0 && uDetail > 0.5) {
        float longueur = clamp(0.5 / max(tan(max(s.z, 0.05)), 0.25), 0.0, 4.0);   // cellules
        vec2 decalage = vec2(s.x, -s.y) * longueur;
        vec2 ll2 = ll + vec2(s.x, s.y) * longueur * uGrille.z;
        vec4 o = echantillon(uv + decalage / uCellules);
        float co = clamp(o.r + o.g, 0.0, 1.0) * smoothstep(0.2, 0.5, o.a);
        float ombre = nuages(co, grain(ll2, uv, 0.0)) * (1.0 - densite);
        res = sur(res, vec3(0.0, 0.01, 0.03), 0.22 * ombre * jour * dedans);
    }

    // Modelé : sommets éclairés côté soleil
    float eclairage = 0.0;
    if (uDetail > 0.5) {
        vec2 e = vec2(0.02, 0.0);
        float gx = grain(ll + e.xy, uv, 1.0) - grain(ll - e.xy, uv, 1.0);
        float gy = grain(ll + e.yx, uv, 1.0) - grain(ll - e.yx, uv, 1.0);
        eclairage = clamp(-(gx * s.x + gy * s.y) * 0.9, -0.05, 0.05);
    }

    // Couleur : nuages épais très blancs, voiles légèrement bleutés ;
    // soleil bas : teinte chaude ; nuit : gris infrarouge, plus sombre.
    float lumiere = mix(0.84, 0.98, epaisseur) - 0.09 * (t2 - 0.5) + eclairage * epaisseur;
    vec3 couleurJour = vec3(lumiere) * mix(vec3(0.95, 0.96, 0.98), vec3(1.0), epaisseur);
    float bas = 1.0 - smoothstep(2.0, 14.0, hauteur);
    couleurJour *= mix(vec3(1.0), vec3(1.03, 0.92, 0.82), bas * jour);
    couleurJour *= 1.0 - 0.3 * bas * jour;
    vec3 couleurNuit = vec3(0.4, 0.45, 0.54) * (0.85 + 0.2 * epaisseur);
    vec3 couleur = mix(couleurNuit, couleurJour, jour);

    // Opacité : voiles translucides et fibreux, nuages épais presque opaques
    float voile = 0.22 + 0.3 * t2;
    float alpha = densite * mix(voile, 0.95, epaisseur) * dedans;
    res = sur(res, couleur, alpha);

    gl_FragColor = res;
}`;

function compiler(gl, type, code) {
    const s = gl.createShader(type);
    gl.shaderSource(s, code);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const erreur = gl.getShaderInfoLog(s);
        gl.deleteShader(s);
        throw new Error("Shader : " + erreur);
    }
    return s;
}

function programme(gl, fragment) {
    const p = gl.createProgram();
    gl.attachShader(p, compiler(gl, gl.VERTEX_SHADER, SOMMETS));
    gl.attachShader(p, compiler(gl, gl.FRAGMENT_SHADER, fragment));
    gl.bindAttribLocation(p, 0, "aPosition");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
}

function texture(gl, largeur, hauteur, octets, repeter = false) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, largeur, hauteur, 0, gl.RGBA, gl.UNSIGNED_BYTE, octets);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const mode = repeter ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, mode);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, mode);
    return t;
}

// Bruit fractal répétable (256 × 256, deux tirages indépendants), égalisé :
// ses valeurs sont réparties uniformément entre 0 et 1. Ainsi, dessiner un
// nuage partout où le bruit est inférieur à la couverture mesurée c couvre
// exactement la part c de chaque cellule : le grain ne change pas la
// quantité de nuages observée, seulement sa répartition à l'intérieur.
function texteBruit() {
    const taille = 256;
    const octets = new Uint8Array(taille * taille * 4);
    let graine = 97531;
    const alea = () => ((graine = (graine * 1103515245 + 12345) % 2147483648) / 2147483648);

    for (let canal = 0; canal < 2; canal++) {
        const somme = new Float32Array(taille * taille);
        let amplitude = 1;
        // Octaves fines surtout : la grande échelle vient des données
        for (let octave = 0; octave < 6; octave++) {
            const n = 4 << octave;
            const reseau = new Float32Array(n * n);
            for (let k = 0; k < reseau.length; k++) reseau[k] = alea();
            for (let y = 0; y < taille; y++) {
                const fy = y / taille * n, y0 = Math.floor(fy), ty = fy - y0;
                const sy = ty * ty * (3 - 2 * ty), y1 = (y0 + 1) % n;
                for (let x = 0; x < taille; x++) {
                    const fx = x / taille * n, x0 = Math.floor(fx), tx = fx - x0;
                    const sx = tx * tx * (3 - 2 * tx), x1 = (x0 + 1) % n;
                    const a = reseau[y0 * n + x0], b = reseau[y0 * n + x1];
                    const c = reseau[y1 * n + x0], d = reseau[y1 * n + x1];
                    somme[y * taille + x] += amplitude * ((a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy);
                }
            }
            amplitude *= 0.66;
        }
        // Égalisation par le rang
        const ordre = Array.from(somme.keys()).sort((i, j) => somme[i] - somme[j]);
        for (let r = 0; r < ordre.length; r++) {
            octets[ordre[r] * 4 + canal] = Math.round(r / (ordre.length - 1) * 255);
        }
    }
    for (let k = 0; k < taille * taille; k++) octets[k * 4 + 3] = 255;
    return { octets, taille };
}

// Position du soleil : déclinaison (radians) et équation du temps (heures)
function soleilDuJour(ms) {
    const debut = Date.UTC(new Date(ms).getUTCFullYear(), 0, 1);
    const jour = (ms - debut) / 86400000;
    const B = 2 * Math.PI * (jour - 81) / 364;
    return {
        declinaison: -0.4093 * Math.cos(2 * Math.PI * (jour + 10) / 365.25),
        equation: (9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B)) / 60
    };
}

function creer(canvas, source, options = {}) {
    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false })
        || canvas.getContext("experimental-webgl", { premultipliedAlpha: true, alpha: true });
    if (!gl) return null;

    // Ressources graphiques : recréées à l'identique après une perte de contexte
    let prog, tampon, u, bruit, fluxNul;
    let perdu = false;

    function initialiser() {
        prog = programme(gl, source === "radar" ? RADAR : SATELLITE);
        tampon = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, tampon);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

        u = {};
        const nb = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < nb; i++) {
            const info = gl.getActiveUniform(prog, i);
            const nom = info.name.replace(/\[0\]$/, "");
            u[nom] = gl.getUniformLocation(prog, info.name);
        }

        bruit = null;
        if (source === "satellite") {
            const b = texteBruit();
            bruit = texture(gl, b.taille, b.taille, b.octets, true);
            // Le motif est affiché plus petit que sa texture : sans mipmaps, il scintille
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        }
        fluxNul = texture(gl, 1, 1, new Uint8Array([128, 128, 128, 255]));
    }

    try {
        initialiser();
    } catch (erreur) {
        console.warn("HKO : WebGL indisponible —", erreur.message);
        return null;
    }

    let sequence = null;
    let textures = [];
    let flux = [];
    let calculEnCours = 0;

    canvas.addEventListener("webglcontextlost", evenement => {
        // Sans preventDefault, le navigateur ne rendrait jamais le contexte
        evenement.preventDefault();
        perdu = true;
        textures = [];
        flux = [];
        calculEnCours++;
        if (options.surPerte) options.surPerte();
    });

    canvas.addEventListener("webglcontextrestored", () => {
        perdu = false;
        try {
            initialiser();
        } catch (erreur) {
            console.warn("HKO : WebGL non rétabli —", erreur.message);
            return;
        }
        const ancienne = sequence;
        sequence = null;
        if (options.surRestauration) options.surRestauration(ancienne);
        else if (ancienne) charger(ancienne);
    });

    function liberer() {
        calculEnCours++;
        if (!perdu) {
            for (const t of textures) if (t) gl.deleteTexture(t);
            for (const f of flux) if (f) gl.deleteTexture(f.texture);
        }
        textures = [];
        flux = [];
    }

    function rgbaDe(trame, n) {
        if (trame.rgba) return trame.rgba;
        const octets = new Uint8Array(n * 4);
        if (source === "radar") {
            for (let i = 0; i < n; i++) {
                octets[i * 4] = trame.plan1[i];
                octets[i * 4 + 1] = (trame.plan2[i] >> 4) * 17;
                octets[i * 4 + 2] = (trame.plan2[i] & 15) * 17;
                octets[i * 4 + 3] = 255;
            }
        } else {
            for (let i = 0; i < n; i++) {
                octets[i * 4] = (trame.plan1[i] >> 4) * 17;
                octets[i * 4 + 1] = (trame.plan1[i] & 15) * 17;
                octets[i * 4 + 2] = (trame.plan2[i] >> 4) * 17;
                octets[i * 4 + 3] = (trame.plan2[i] & 15) * 17;
            }
        }
        return octets;
    }

    // Les trames sont envoyées au processeur graphique par paquets de
    // quelques millisecondes : la page ne se fige pas pendant le chargement.
    // externe : textures et mouvements fournis plus tard (ajouterTrame, definirFlux).
    function charger(nouvelle, externe = false) {
        liberer();
        sequence = nouvelle;
        textures = new Array(sequence.trames.length).fill(null);
        flux = new Array(Math.max(0, sequence.trames.length - 1)).fill(null);
        if (perdu) return;
        const jeton = ++calculEnCours;
        if (externe) return;

        const { nx, ny } = sequence.grille;
        const n = nx * ny;
        let i = 0;
        const etape = () => {
            if (jeton !== calculEnCours || !sequence || perdu) return;
            const debut = performance.now();
            while (i < textures.length && performance.now() - debut < 10) {
                textures[i] = texture(gl, nx, ny, rgbaDe(sequence.trames[i], n));
                i++;
            }
            if (i < textures.length) setTimeout(etape, 0);
            else calculerFlux(jeton);
        };
        etape();
    }

    function ajouterTrame(i, rgba) {
        if (!sequence || perdu || i >= textures.length) return;
        const { nx, ny } = sequence.grille;
        if (textures[i]) gl.deleteTexture(textures[i]);
        textures[i] = texture(gl, nx, ny, rgba);
    }

    function definirFlux(i, m) {
        if (!sequence || perdu || i >= flux.length) return;
        if (flux[i]) gl.deleteTexture(flux[i].texture);
        flux[i] = m ? { texture: texture(gl, m.bw, m.bh, m.octets), bw: m.bw, bh: m.bh } : null;
    }

    // Mouvements calculés par petits paquets, sans figer la page.
    // Tant qu'un mouvement manque, la transition est un simple fondu.
    function calculerFlux(jeton) {
        const { nx, ny } = sequence.grille;
        const n = nx * ny;
        const champs = new Array(sequence.trames.length);
        const suivi = j => champs[j] || (champs[j] = champSuivi(source, sequence.trames[j], n));
        let i = 0;

        const etape = () => {
            if (jeton !== calculEnCours || !sequence || perdu) return;
            const debut = performance.now();
            while (i < flux.length && performance.now() - debut < 12) {
                const ecart = sequence.trames[i + 1].ms - sequence.trames[i].ms;
                // Après une lacune, pas de mouvement : on ne devine pas.
                if (ecart <= sequence.pas * 2.5) {
                    const m = estimerMouvement(suivi(i), suivi(i + 1), nx, ny);
                    flux[i] = { texture: texture(gl, m.bw, m.bh, m.octets), bw: m.bw, bh: m.bh };
                }
                champs[i] = null;
                i++;
            }
            if (i < flux.length) setTimeout(etape, 0);
        };
        etape();
    }

    function situation(instant) {
        const trames = sequence ? sequence.trames : [];
        if (!trames.length) return null;
        if (instant <= trames[0].ms) return { avant: 0, apres: 0, fraction: 0, observee: true };
        const dernier = trames.length - 1;
        if (instant >= trames[dernier].ms) return { avant: dernier, apres: dernier, fraction: 0, observee: true };

        let i = 0;
        while (i < dernier && trames[i + 1].ms <= instant) i++;
        const fraction = (instant - trames[i].ms) / (trames[i + 1].ms - trames[i].ms);
        // À moins de 30 s d'une observation, c'est cette observation qui s'affiche
        if (instant - trames[i].ms < 30000) return { avant: i, apres: i, fraction: 0, observee: true };
        if (trames[i + 1].ms - instant < 30000) return { avant: i + 1, apres: i + 1, fraction: 0, observee: true };
        return {
            avant: i, apres: i + 1, fraction, observee: false,
            lacune: trames[i + 1].ms - trames[i].ms > sequence.pas * 2.5
        };
    }

    // Trame chargée la plus proche (pendant le chargement progressif)
    function disponible(i) {
        if (textures[i]) return i;
        for (let d = 1; d < textures.length; d++) {
            if (textures[i - d]) return i - d;
            if (textures[i + d]) return i + d;
        }
        return -1;
    }

    function dessiner(e) {
        if (perdu || gl.isContextLost()) return false;
        const W = canvas.width, H = canvas.height;
        gl.viewport(0, 0, W, H);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (!sequence || !textures.length) return false;

        const s = { ...situation(e.instant) };
        s.avant = disponible(s.avant);
        s.apres = disponible(s.apres);
        if (s.avant < 0) return false;
        const g = sequence.grille;

        gl.useProgram(prog);
        gl.bindBuffer(gl.ARRAY_BUFFER, tampon);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

        gl.uniform2f(u.uTaille, W, H);
        gl.uniform1f(u.uEchelle, e.echelle);
        gl.uniform1f(u.uScale, e.projection.scale());
        const t = e.projection.translate();
        gl.uniform2f(u.uTranslate, t[0], t[1]);
        gl.uniform4f(u.uGrille, g.ouest, g.nord, g.pas, 0);
        gl.uniform2f(u.uCellules, g.nx, g.ny);
        gl.uniform1f(u.uT, s.fraction);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, textures[s.avant]);
        gl.uniform1i(u.uA, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, textures[s.apres]);
        gl.uniform1i(u.uB, 1);

        const f = s.apres === s.avant + 1 ? flux[s.avant] : null;
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, f ? f.texture : fluxNul);
        gl.uniform1i(u.uFlux, 2);
        gl.uniform2f(u.uFluxEchelle, f ? g.nx / (f.bw * BLOC) : 1, f ? g.ny / (f.bh * BLOC) : 1);
        gl.uniform1f(u.uFlux0, f ? 1 : 0);
        // Grille OPERA allégée (0,05°) : lissage et fondu gardent leur taille réelle
        gl.uniform1f(u.uFinesse, sequence.opera ? 0.025 / g.pas : 1);

        if (source === "radar") {
            gl.uniform3fv(u.uCouleurs, e.couleurs);
            gl.uniform1fv(u.uSeuils, e.seuils);
            gl.uniform1f(u.uHachures, e.hachures ? 1 : 0);
        } else {
            gl.activeTexture(gl.TEXTURE3);
            gl.bindTexture(gl.TEXTURE_2D, bruit);
            gl.uniform1i(u.uBruit, 3);
            // Temps continu en « trames » : entraîne le grain des nuages
            gl.uniform1f(u.uTemps, (e.instant - sequence.trames[0].ms) / sequence.pas);
            const date = new Date(e.instant);
            const astre = soleilDuJour(e.instant);
            // Heure solaire à Greenwich : heure UTC corrigée de l'équation du temps
            const heure = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600 + astre.equation;
            gl.uniform3f(u.uSoleil, astre.declinaison, heure, 0);
            gl.uniform1f(u.uDetail, e.detail === false ? 0 : 1);
        }

        gl.drawArrays(gl.TRIANGLES, 0, 3);
        return true;
    }

    return {
        charger,
        ajouterTrame,
        definirFlux,
        dessiner,
        situation,
        liberer,
        get sequence() { return sequence; },
        get pretes() { return textures.filter(Boolean).length; },
        perdu: () => perdu || gl.isContextLost(),
        // Test : simule une perte de contexte (extension WEBGL_lose_context)
        simulerPerte() {
            const ext = gl.getExtension("WEBGL_lose_context");
            if (!ext) return false;
            ext.loseContext();
            setTimeout(() => ext.restoreContext(), 500);
            return true;
        }
    };
}

portee.HKOAnime = { decoder, sequenceBinaire, creer, estimerMouvement, champSuivi, soleilDuJour };

})(typeof self !== "undefined" ? self : window);
