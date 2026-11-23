/* ==========================================================================
   HKO Météo — « Résumé du jour » : moteur de rendu du film (Canvas 2D)

   Le film est une partition calculée sur t (0 à 40 s) : chaque image est
   déterministe, ce qui permet la lecture, la pause et le retour en arrière
   sans état caché. Carte en Mercator (géographie hko_resume_geo.json),
   calques de données échantillonnés sur des grilles basse résolution,
   habillage dessiné par les éléments du film (hko_resume_film.js).
   ========================================================================== */

(() => {
/* ==========================================================================
   HKO Météo — moteur des animatiques « Résumé du jour »

   Un film est une partition : des calques de données (températures, pluie,
   nuages, brouillard, vent) évalués à l'heure voulue, une caméra, et des
   éléments graphiques posés sur une ligne de temps. Tout est calculé à
   partir du temps t (0 à 30 s) : on peut avancer, reculer, s'arrêter sur
   n'importe quelle image, le rendu est toujours le même.
   ========================================================================== */

"use strict";

const L = 1920, H = 1080;                 // image de référence (16:9)
const COULEURS = {
    nuit: "#06203f", nuitProfonde: "#03142a", ambre: "#ffb81c", ecume: "#f3f7fb",
    brume: "#b9cbe0", froid: "#8fdcff", chaud: "#ff6b57", mer: "#0b2c55", terre: "#21436a",
    voisins: "#123257"
};
// Polices du site (aucun téléchargement) : Bahnschrift sous Windows, DIN / Avenir
// Next Condensed chez Apple, Roboto Condensed sous Android
const POLICE_TITRE = '"Bahnschrift", "DIN Alternate", "Avenir Next Condensed", "Roboto Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
const POLICE_TEXTE = POLICE_TITRE;
const MOUVEMENT_REDUIT = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------

const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v;
const mix = (a, b, f) => a + (b - a) * f;
const lisse = (a, b, v) => { const x = clamp((v - a) / (b - a)); return x * x * (3 - 2 * x); };
const sortieExpo = x => x >= 1 ? 1 : 1 - Math.pow(2, -10 * x);
const entreeSortie = x => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const sortieCubique = x => 1 - Math.pow(1 - x, 3);
const prog = (t, a, b) => clamp((t - a) / (b - a));
const gauss = (lon, lat, lon0, lat0, rx, ry) => Math.exp(-(((lon - lon0) / rx) ** 2 + ((lat - lat0) / ry) ** 2));

// Piste de clés [[t, valeur], …] interpolées en douceur (nombres ou tableaux)
function piste(t, cles, courbe = entreeSortie) {
    if (t <= cles[0][0]) return cles[0][1];
    for (let i = 1; i < cles.length; i++) {
        if (t <= cles[i][0]) {
            const [ta, va] = cles[i - 1], [tb, vb] = cles[i];
            const f = courbe((t - ta) / (tb - ta || 1));
            return Array.isArray(va) ? va.map((v, k) => mix(v, vb[k], f)) : mix(va, vb, f);
        }
    }
    return cles[cles.length - 1][1];
}

// Bruit de valeur 2D (déterministe)
const PERM = new Uint8Array(512);
(() => {
    let s = 1234567;
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [p[i], p[j]] = [p[j], p[i]]; }
    for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
})();
function bruit(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = PERM[(PERM[xi & 255] + yi) & 255], b = PERM[(PERM[(xi + 1) & 255] + yi) & 255];
    const c = PERM[(PERM[xi & 255] + yi + 1) & 255], d = PERM[(PERM[(xi + 1) & 255] + yi + 1) & 255];
    return mix(mix(a, b, u), mix(c, d, u), v) / 255;
}
function fbm(x, y, octaves = 3) {
    let s = 0, a = 0.5, f = 1, n = 0;
    for (let i = 0; i < octaves; i++) { s += a * bruit(x * f, y * f); n += a; a *= 0.5; f *= 2.03; }
    return s / n;
}

function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }

// Palette des températures du site (tableau Températures)
const PALETTE_T = [
    [-15, "#3d1a78"], [-10, "#4b3aa8"], [-5, "#3b6fd0"], [0, "#5aa9e6"],
    [4, "#8fd3ec"], [8, "#c8ead0"], [11, "#eaf0a6"], [14, "#f6dd78"],
    [18, "#f7c252"], [23, "#f39b3a"], [28, "#e8662d"], [33, "#c8352a"],
    [38, "#9b1730"], [44, "#5e0b2a"]
].map(([v, c]) => [v, hexRgb(c)]);
const LUT_T = new Uint8Array(601 * 3);      // -15 à 45 °C par dixièmes
for (let i = 0; i <= 600; i++) {
    const v = -15 + i / 10;
    let k = 0;
    while (k < PALETTE_T.length - 2 && PALETTE_T[k + 1][0] < v) k++;
    const [va, ca] = PALETTE_T[k], [vb, cb] = PALETTE_T[k + 1];
    const f = clamp((v - va) / (vb - va));
    for (let j = 0; j < 3; j++) LUT_T[i * 3 + j] = Math.round(mix(ca[j], cb[j], f));
}
function couleurT(v) { const i = Math.round(clamp((v + 15) * 10, 0, 600)) * 3; return [LUT_T[i], LUT_T[i + 1], LUT_T[i + 2]]; }

// Palette du radar du site
const SEUILS_PLUIE = [0.2, 0.5, 1, 2, 4, 7, 12, 20, 35, 60];
const COULEURS_PLUIE = ["#a5d8f3", "#6fb7ea", "#3f8fd8", "#2a63c0", "#3aa655",
                        "#9fce3f", "#f3e03b", "#f4a12a", "#e8502a", "#b3207a"].map(hexRgb);
function couleurPluie(mm) {
    if (mm < 0.12) return null;
    let k = 0;
    while (k < 9 && mm > SEUILS_PLUIE[k + 1]) k++;
    const f = k < 9 ? clamp((mm - SEUILS_PLUIE[k]) / (SEUILS_PLUIE[k + 1] - SEUILS_PLUIE[k])) : 0;
    const a = COULEURS_PLUIE[k], b = COULEURS_PLUIE[Math.min(9, k + 1)];
    return [mix(a[0], b[0], f), mix(a[1], b[1], f), mix(a[2], b[2], f), 0.88 * lisse(0.12, 1.6, mm)];
}

// Nombres à la française
const fr = (v, d = 0) => v.toFixed(d).replace(".", ",").replace("-", "−");
const NBSP = " ";

// ---------------------------------------------------------------------------
// Géographie (Mercator, cadre de la France métropolitaine)
// ---------------------------------------------------------------------------

const GEO = {};
const rad = d => d * Math.PI / 180;
const merc = lat => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2));

async function chargerGeo(url) {
    const g = await (await fetch(url)).json();
    const [O, S, E, N] = g.cadre;
    GEO.X0 = rad(O); GEO.K = g.largeur / (rad(E) - rad(O)); GEO.Y0 = merc(N);
    GEO.l = g.largeur; GEO.h = g.hauteur;
    GEO.france = new Path2D(g.france);
    GEO.franceTexte = g.france;
    GEO.departements = new Path2D(g.departements);
    GEO.voisins = new Path2D(g.voisins);
    GEO.perimetre = g.perimetre;
    GEO.frontieres = new Path2D(g.frontieres || "");
    GEO.ombre = new Image();
    GEO.ombre.src = g.ombre.jpg ? "data:image/jpeg;base64," + g.ombre.jpg : "data:image/png;base64," + g.ombre.png;
    GEO.ombreRect = g.ombre.rect || [0, 0, g.largeur, g.hauteur];
    await GEO.ombre.decode();
    const octets = Uint8Array.from(atob(g.altitude.b64), c => c.charCodeAt(0));
    GEO.alt = { l: g.altitude.l, h: g.altitude.h, v: octets };
    return GEO;
}

function proj(lon, lat) { return [(rad(lon) - GEO.X0) * GEO.K, (GEO.Y0 - merc(lat)) * GEO.K]; }
function inverse(x, y) {
    return [(GEO.X0 + x / GEO.K) * 180 / Math.PI,
            (2 * Math.atan(Math.exp(GEO.Y0 - y / GEO.K)) - Math.PI / 2) * 180 / Math.PI];
}
function altitudeCarte(x, y) {           // x, y en unités de carte -> mètres
    const a = GEO.alt;
    const gx = clamp(x / GEO.l * a.l - 0.5, 0, a.l - 1.001), gy = clamp(y / GEO.h * a.h - 0.5, 0, a.h - 1.001);
    const x0 = gx | 0, y0 = gy | 0, fx = gx - x0, fy = gy - y0, v = a.v, l = a.l;
    return 16 * mix(mix(v[y0 * l + x0], v[y0 * l + x0 + 1], fx), mix(v[(y0 + 1) * l + x0], v[(y0 + 1) * l + x0 + 1], fx), fy);
}

// ---------------------------------------------------------------------------
// Grilles de données (calculées en basse résolution, agrandies en douceur)
// ---------------------------------------------------------------------------

class Grille {
    constructor(l) {
        this.l = l; this.h = Math.round(l * GEO.h / GEO.l);
        this.toile = document.createElement("canvas");
        this.toile.width = this.l; this.toile.height = this.h;
        this.ctx = this.toile.getContext("2d");
        this.image = this.ctx.createImageData(this.l, this.h);
        const n = this.l * this.h;
        this.lon = new Float32Array(n); this.lat = new Float32Array(n); this.alt = new Float32Array(n);
        this.dansFrance = new Uint8Array(n);
        const masque = document.createElement("canvas");
        masque.width = this.l; masque.height = this.h;
        const m = masque.getContext("2d");
        m.scale(this.l / GEO.l, this.h / GEO.h);
        m.fill(GEO.france);
        const alpha = m.getImageData(0, 0, this.l, this.h).data;
        for (let j = 0, i = 0; j < this.h; j++) for (let k = 0; k < this.l; k++, i++) {
            const x = (k + 0.5) / this.l * GEO.l, y = (j + 0.5) / this.h * GEO.h;
            const [lo, la] = inverse(x, y);
            this.lon[i] = lo; this.lat[i] = la; this.alt[i] = altitudeCarte(x, y);
            this.dansFrance[i] = alpha[i * 4 + 3] > 127 ? 1 : 0;
        }
        this.cle = null;
    }
    // f(lon, lat, alt) -> [r, g, b, a] ou null ; cle : évite de recalculer
    peindre(cle, f) {
        if (cle === this.cle) return this.toile;
        this.cle = cle;
        const d = this.image.data, n = this.l * this.h;
        for (let i = 0; i < n; i++) {
            const c = f(this.lon[i], this.lat[i], this.alt[i], i);
            const p = i * 4;
            if (c) { d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = (c[3] ?? 1) * 255; }
            else d[p + 3] = 0;
        }
        this.ctx.putImageData(this.image, 0, 0);
        return this.toile;
    }
    // Extrêmes d'une fonction sur la France
    extremes(f) {
        let min = Infinity, max = -Infinity, imin = 0, imax = 0;
        for (let i = 0; i < this.lon.length; i++) {
            if (!this.dansFrance[i]) continue;
            const v = f(this.lon[i], this.lat[i], this.alt[i]);
            if (v < min) { min = v; imin = i; }
            if (v > max) { max = v; imax = i; }
        }
        return { min, max, lonMin: this.lon[imin], latMin: this.lat[imin], lonMax: this.lon[imax], latMax: this.lat[imax] };
    }
}

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------

class Moteur {
    constructor(toile) {
        this.toile = toile;
        this.ctx = toile.getContext("2d");
        this.carte = document.createElement("canvas");
        this.cctx = this.carte.getContext("2d");
        this.voisins = document.createElement("canvas");
        this.vctx = this.voisins.getContext("2d");
        this.grilles = { t: new Grille(220), pluie: new Grille(360), nuages: new Grille(150), brume: new Grille(110) };
        this.film = null;
        // Image de référence : 1920 × 1080 (paysage) ou 1080 × hauteur (portrait,
        // hauteur ajustée à l'écran du téléphone)
        this.format = { L, H };
        this.redimensionner();
    }

    regler(format) {
        this.format = { L: format.L || L, H: format.H || H };
        this.redimensionner();
    }

    redimensionner() {
        const { L: fl, H: fh } = this.format;
        const r = this.toile.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const largeur = Math.max(240, Math.min(fl, Math.round(r.width * dpr)));
        this.toile.width = largeur; this.toile.height = Math.round(largeur * fh / fl);
        this.carte.width = this.toile.width; this.carte.height = this.toile.height;
        this.voisins.width = this.toile.width; this.voisins.height = this.toile.height;
        this.k = largeur / fl;
    }

    // Caméra : un point (lon, lat) placé en (fx, fy) de l'image, zoom z
    camera(c) {
        const s = this.echelleBase * c.z;
        const [x, y] = proj(c.lon, c.lat);
        return { s, ox: c.fx - x * s, oy: (c.fy ?? this.format.H / 2) - y * s };
    }
    get echelleBase() { return 960 / (proj(0, 41.25)[1] - proj(0, 51.15)[1]); }

    versImage(lon, lat) {
        const [x, y] = proj(lon, lat);
        return [x * this.cam.s + this.cam.ox, y * this.cam.s + this.cam.oy];
    }

    repere(ctx) {
        const k = this.k, c = this.cam;
        ctx.setTransform(k * c.s, 0, 0, k * c.s, k * c.ox, k * c.oy);
    }

    dessiner(t) {
        const f = this.film, ctx = this.ctx, k = this.k;
        const etat = f.etat(t);
        this.etat = etat;
        this.cam = this.camera(etat.camera);
        const h = etat.heure;

        // --- Carte, dessinée à part (pour l'effet de chaleur) ---
        const c = this.cctx;
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.globalAlpha = 1;
        c.globalCompositeOperation = "source-over";
        const fond = c.createRadialGradient(this.carte.width * 0.6, this.carte.height * 0.45, 0,
                                            this.carte.width * 0.6, this.carte.height * 0.45, this.carte.width * 0.75);
        fond.addColorStop(0, "#0d3366"); fond.addColorStop(1, COULEURS.nuitProfonde);
        c.fillStyle = fond;
        c.fillRect(0, 0, this.carte.width, this.carte.height);
        // Teinte de mer propre à un tableau (conditions : bleu du site, selon l'heure)
        if (etat.mer && etat.carte > 0) {
            c.globalAlpha = etat.carte * (etat.merForce ?? 1);
            c.fillStyle = etat.mer;
            c.fillRect(0, 0, this.carte.width, this.carte.height);
            c.globalAlpha = 1;
        }

        if (etat.carte > 0) {
            c.globalAlpha = etat.carte;
            this.repere(c);
            // Continent : les pays voisins couvrent tout l'écran, comme sur le site
            c.fillStyle = etat.voisins || COULEURS.voisins;
            c.fill(GEO.voisins);
            c.save(); c.clip(GEO.voisins);
            c.globalAlpha = etat.carte * 0.55;
            c.globalCompositeOperation = "soft-light";
            c.drawImage(GEO.ombre, ...GEO.ombreRect);
            c.restore();
            c.globalAlpha = etat.carte * 0.35;
            c.strokeStyle = etat.frontieres || "#b9cbe0";
            c.lineWidth = 0.8 / this.cam.s;
            c.stroke(GEO.frontieres);
            c.globalAlpha = etat.carte;

            // France : sol, températures, relief
            c.save();
            c.clip(GEO.france);
            c.fillStyle = etat.terre || COULEURS.terre;
            c.fillRect(0, 0, GEO.l, GEO.h);
            if (etat.temperature > 0 && f.temperature) {
                const g = this.grilles.t;
                const cle = `t${h.toFixed(2)}`;
                c.globalAlpha = etat.carte * etat.temperature;
                c.imageSmoothingQuality = "high";
                c.drawImage(g.peindre(cle, (lo, la, al) => couleurT(f.temperature(lo, la, h, al))), 0, 0, GEO.l, GEO.h);
            }
            c.globalAlpha = etat.carte * 0.85;
            c.globalCompositeOperation = "soft-light";
            c.drawImage(GEO.ombre, ...GEO.ombreRect);
            c.globalCompositeOperation = "source-over";
            c.restore();

            // Nuages, pluie, brouillard : calque à part, fondu aux bords du cadre
            const m = this.vctx, avecMeteo = (etat.nuages > 0 && f.nuages) || (etat.pluie > 0 && f.pluie) || (etat.brume > 0 && f.brume);
            if (avecMeteo) {
                m.setTransform(1, 0, 0, 1, 0, 0);
                m.globalCompositeOperation = "source-over";
                m.globalAlpha = 1;
                m.clearRect(0, 0, this.voisins.width, this.voisins.height);
                this.repere(m);
                m.imageSmoothingQuality = "high";
            if (etat.nuages > 0 && f.nuages) {
                const g = this.grilles.nuages;
                m.globalAlpha = etat.carte * etat.nuages;
                m.drawImage(g.peindre(`n${h.toFixed(2)}`, (lo, la, al) => {
                    const v = f.nuages(lo, la, h, al);
                    return v > 0.02 ? [236, 242, 250, clamp(v) * 0.82] : null;
                }), 0, 0, GEO.l, GEO.h);
            }
            if (etat.pluie > 0 && f.pluie) {
                const g = this.grilles.pluie;
                m.globalAlpha = etat.carte * etat.pluie;
                m.drawImage(g.peindre(`p${h.toFixed(2)}`, (lo, la, al) => couleurPluie(f.pluie(lo, la, h, al))), 0, 0, GEO.l, GEO.h);
            }
            if (etat.brume > 0 && f.brume) {
                const g = this.grilles.brume;
                m.globalAlpha = etat.carte * etat.brume;
                m.drawImage(g.peindre(`b${h.toFixed(2)}`, (lo, la, al) => {
                    const v = f.brume(lo, la, h, al);
                    return v > 0.02 ? [228, 233, 238, clamp(v) * 0.93] : null;
                }), 0, 0, GEO.l, GEO.h);
            }

                this.fondreBords(m, 70);
                c.setTransform(1, 0, 0, 1, 0, 0);
                c.globalAlpha = 1;
                c.drawImage(this.voisins, 0, 0);
                this.repere(c);
            }

            // Nuit : le terminateur balaie la France d'est en ouest
            if (f.soleil && (etat.nuit ?? 1) > 0) this.nuit(c, h, etat.carte * (etat.nuit ?? 1));

            // Lumière dorée (journées calmes)
            if (etat.lumiere > 0) {
                const [lx, ly] = proj(etat.lumiereLon ?? 2, 46.5);
                const lum = c.createRadialGradient(lx, ly, 0, lx, ly, 520);
                lum.addColorStop(0, `rgba(255, 196, 110, ${0.30 * etat.lumiere})`);
                lum.addColorStop(1, "rgba(255, 196, 110, 0)");
                c.globalAlpha = etat.carte;
                c.globalCompositeOperation = "soft-light";
                c.fillStyle = lum;
                c.fillRect(-GEO.l, -GEO.h, GEO.l * 3, GEO.h * 3);
                c.globalCompositeOperation = "source-over";
            }

            // Radar européen (images du film, dessinées en repère carte, nettes, après la nuit)
            if (etat.radar > 0 && f.radarCalque) {
                c.save();
                c.globalAlpha = etat.carte * etat.radar;
                f.radarCalque(c, h, this);
                c.restore();
                c.globalAlpha = etat.carte;
            }

            // Traits
            c.globalAlpha = etat.carte * (etat.departements ?? 0.16);
            c.strokeStyle = etat.traitDepartements || "#ffffff";
            c.lineWidth = 0.7 / this.cam.s;
            c.stroke(GEO.departements);
            c.globalAlpha = etat.carte * 0.9;
            c.lineWidth = 2.2 / this.cam.s;
            c.lineJoin = "round";
            c.strokeStyle = COULEURS.ecume;
            c.stroke(GEO.france);
            c.globalAlpha = 1;

            // Vent : lignes de courant animées
            if (etat.vent > 0 && f.vent) this.vent(c, t, h, etat.vent * etat.carte);
        }

        // Voile (synthèse) sur la carte
        if (etat.voile > 0) {
            c.setTransform(1, 0, 0, 1, 0, 0);
            c.globalAlpha = etat.voile;
            c.fillStyle = COULEURS.nuit;
            c.fillRect(0, 0, this.carte.width, this.carte.height);
            c.globalAlpha = 1;
        }

        // --- Composition : carte (éventuellement troublée par la chaleur) ---
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        const trouble = MOUVEMENT_REDUIT ? 0 : (etat.chaleur || 0);
        if (trouble > 0.01) {
            const bande = Math.max(2, Math.round(6 * k));
            for (let y = 0; y < this.carte.height; y += bande) {
                const dx = Math.sin(y / (14 * k) + t * 7.5) * 2.6 * k * trouble + Math.sin(y / (37 * k) - t * 3.1) * 1.6 * k * trouble;
                ctx.drawImage(this.carte, 0, y, this.carte.width, bande, dx, y, this.carte.width, bande);
            }
        } else {
            ctx.drawImage(this.carte, 0, 0);
        }

        // --- Habillage : chaque élément de la partition se dessine lui-même ---
        ctx.setTransform(k, 0, 0, k, 0, 0);
        for (const el of f.elements) {
            if (t >= el.debut - 0.001 && t <= el.fin + 0.001) {
                ctx.save();
                el.dessiner(this, ctx, t, prog(t, el.debut, el.fin));
                ctx.restore();
            }
        }

        // Éclairs (orages) : brefs, jamais plus d'un par seconde
        if (!MOUVEMENT_REDUIT && etat.eclair > 0) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = etat.eclair;
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, this.toile.width, this.toile.height);
            ctx.globalAlpha = 1;
        }
    }

    // Fond les bords du cadre géographique (repère carte déjà posé sur vc)
    fondreBords(vc, bord = 90) {
        vc.globalCompositeOperation = "destination-in";
        vc.globalAlpha = 1;
        const gx = vc.createLinearGradient(0, 0, GEO.l, 0);
        gx.addColorStop(0, "rgba(0,0,0,0)"); gx.addColorStop(bord / GEO.l, "#000");
        gx.addColorStop(1 - bord / GEO.l, "#000"); gx.addColorStop(1, "rgba(0,0,0,0)");
        vc.fillStyle = gx; vc.fillRect(-GEO.l, -GEO.h, GEO.l * 3, GEO.h * 3);
        const gy = vc.createLinearGradient(0, 0, 0, GEO.h);
        gy.addColorStop(0, "rgba(0,0,0,0)"); gy.addColorStop(bord / GEO.h, "#000");
        gy.addColorStop(1 - bord / GEO.h, "#000"); gy.addColorStop(1, "rgba(0,0,0,0)");
        vc.fillStyle = gy; vc.fillRect(-GEO.l, -GEO.h, GEO.l * 3, GEO.h * 3);
        vc.globalCompositeOperation = "source-over";
    }

    // Fondu elliptique autour de la France : pas de bord rectangulaire visible
    fondreMeteo(vc) {
        const [cx, cy] = proj(3.0, 46.2);
        vc.save();
        vc.globalCompositeOperation = "destination-in";
        vc.globalAlpha = 1;
        vc.translate(cx, cy);
        vc.scale(1.3, 1);
        const r = 640;
        const g = vc.createRadialGradient(0, 0, 0, 0, 0, r);
        g.addColorStop(0, "#000"); g.addColorStop(0.72, "#000"); g.addColorStop(1, "rgba(0,0,0,0)");
        vc.fillStyle = g;
        vc.fillRect(-4000, -4000, 8000, 8000);
        vc.restore();
        vc.globalCompositeOperation = "source-over";
    }

    nuit(c, h, alpha) {
        const s = this.film.soleil;
        // Heure solaire locale : 4 min par degré de longitude
        const ombre = lon => {
            const hl = h + (lon - 2.35) / 15;
            const jour = lisse(s.lever - 0.6, s.lever + 0.6, hl) * (1 - lisse(s.coucher - 0.6, s.coucher + 0.6, hl));
            return 1 - jour;
        };
        const [xa] = proj(-6.5, 46), [xb] = proj(10.5, 46);
        const grad = c.createLinearGradient(xa, 0, xb, 0);
        for (let i = 0; i <= 8; i++) {
            const lon = -6.5 + 17 * i / 8;
            grad.addColorStop(i / 8, `rgba(2, 10, 28, ${0.62 * ombre(lon)})`);
        }
        c.globalAlpha = alpha;
        c.fillStyle = grad;
        c.fillRect(-GEO.l, -GEO.h, GEO.l * 3, GEO.h * 3);
        c.globalAlpha = 1;
    }

    // Lignes de courant : tracées dans le champ de vent du moment, et
    // parcourues par des traits qui avancent avec le temps
    vent(c, t, h, alpha) {
        const f = this.film;
        const pas = 9, n = 34;
        c.save();
        c.lineCap = "round";
        for (let j = 0; j < 15; j++) for (let i = 0; i < 17; i++) {
            const graine = bruit(i * 3.7, j * 5.3);
            let lon = -6.2 + i * 1.0 + graine * 0.8, lat = 41.2 + j * 0.72 + bruit(j * 2.1, i * 1.3) * 0.6;
            const points = [];
            let vmax = 0;
            for (let s = 0; s < n; s++) {
                const [u, v] = f.vent(lon, lat, h);
                const vit = Math.hypot(u, v);
                vmax = Math.max(vmax, vit);
                points.push(proj(lon, lat));
                const d = pas / Math.max(vit, 1e-3) / 140;
                lon += u * d / Math.cos(rad(lat)); lat += v * d;
            }
            if (vmax < 30) continue;
            const decalage = (t * (vmax / 18) + graine * 40) % 1;
            const debut = Math.floor(decalage * n * 1.6) - 10;
            for (let s = Math.max(1, debut); s < Math.min(n, debut + 10); s++) {
                const a = (s - debut) / 10;
                c.globalAlpha = alpha * a * clamp((vmax - 30) / 70, 0.15, 0.9);
                c.lineWidth = (0.6 + 2.4 * a) / this.cam.s * clamp(vmax / 90, 0.6, 1.6);
                c.strokeStyle = vmax > 100 ? "#ffe3a0" : "#e9f4ff";
                c.beginPath();
                c.moveTo(points[s - 1][0], points[s - 1][1]);
                c.lineTo(points[s][0], points[s][1]);
                c.stroke();
            }
        }
        c.restore();
    }
}

// ---------------------------------------------------------------------------
// Typographie animée
// ---------------------------------------------------------------------------

function police(taille, graisse = 600, famille = POLICE_TITRE) { return `${graisse} ${taille}px ${famille}`; }

// Ligne révélée par un masque : le texte monte dans sa propre boîte
function ligneMasquee(ctx, texte, x, y, taille, p, opts = {}) {
    const { graisse = 600, famille = POLICE_TITRE, couleur = COULEURS.ecume, align = "left", espacement = 0 } = opts;
    ctx.save();
    ctx.font = police(taille, graisse, famille);
    ctx.textAlign = align;
    ctx.textBaseline = "alphabetic";
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${espacement}px`;
    const larg = ctx.measureText(texte).width;
    const gx = align === "center" ? x - larg / 2 : align === "right" ? x - larg : x;
    ctx.beginPath();
    ctx.rect(gx - taille * 0.2, y - taille * 1.05, larg + taille * 0.4, taille * 1.35);
    ctx.clip();
    const e = sortieExpo(clamp(p));
    ctx.fillStyle = couleur;
    ctx.globalAlpha *= clamp(p * 3);
    ctx.fillText(texte, x, y + (1 - e) * taille * 1.15);
    ctx.restore();
    return larg;
}

// Lettres qui montent une à une
function lettresDecalees(ctx, texte, x, y, taille, t, debut, opts = {}) {
    const { graisse = 700, couleur = COULEURS.ecume, ecart = 0.045, duree = 0.55, align = "left", sortie = null, amplitude = 1.1, fondu = false, basMasque = null } = opts;
    ctx.save();
    const alpha0 = ctx.globalAlpha;
    ctx.font = police(taille, graisse);
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    const largeurs = [...texte].map(ch => ctx.measureText(ch).width);
    const total = largeurs.reduce((a, b) => a + b, 0);
    let cx = align === "center" ? x - total / 2 : x;
    ctx.beginPath();
    // basMasque : bord bas du masque (les lettres sortent de sous ce bord, sans être coupées au départ)
    ctx.rect(cx - taille, y - taille * 1.1, total + taille * 2, taille * 1.1 + (basMasque ?? taille * 0.3));
    ctx.clip();
    [...texte].forEach((ch, i) => {
        const p = sortieExpo(prog(t, debut + i * ecart, debut + i * ecart + duree));
        let dy = (1 - p) * taille * amplitude;
        if (fondu) ctx.globalAlpha = alpha0 * p;
        if (sortie) dy -= sortieCubique(prog(t, sortie + i * ecart * 0.5, sortie + i * ecart * 0.5 + 0.35)) * taille * 1.2;
        ctx.fillStyle = couleur;
        ctx.fillText(ch, cx, y + dy);
        cx += largeurs[i];
    });
    ctx.restore();
    return total;
}

// Nombre à rouleaux (compteur) : chaque chiffre défile verticalement
function nombreRouleaux(ctx, valeur, x, y, taille, opts = {}) {
    const { couleur = COULEURS.ecume, unite = "°", graisse = 600, align = "left" } = opts;
    ctx.save();
    ctx.font = police(taille, graisse);
    ctx.textBaseline = "alphabetic";
    const cellule = ctx.measureText("0").width * 1.02;
    const neg = valeur < -0.5;
    const absv = Math.abs(valeur);
    const entier = Math.floor(absv);
    const frac = absv - entier;
    const chiffres = String(entier).split("").map(Number);
    const largeur = (neg ? cellule * 0.7 : 0) + chiffres.length * cellule + ctx.measureText(unite).width;
    let cx = align === "right" ? x - largeur : align === "center" ? x - largeur / 2 : x;
    ctx.beginPath();
    ctx.rect(cx - 4, y - taille * 0.9, largeur + 8, taille * 1.05);
    ctx.clip();
    ctx.fillStyle = couleur;
    if (neg) { ctx.fillText("−", cx, y); cx += cellule * 0.7; }
    // Le défilement ne commence qu'en fin d'unité, comme un compteur mécanique
    const glisse = lisse(0.78, 1, frac);
    chiffres.forEach((d, i) => {
        const apres = chiffres.slice(i + 1);
        const roule = apres.every(v => v === 9) ? glisse : 0;
        const suivant = (d + 1) % 10;
        ctx.textAlign = "center";
        ctx.fillText(String(d), cx + cellule / 2, y - roule * taille * 1.0);
        if (roule > 0) ctx.fillText(String(suivant), cx + cellule / 2, y + (1 - roule) * taille * 1.0);
        cx += cellule;
    });
    ctx.textAlign = "left";
    ctx.fillText(unite, cx, y);
    ctx.restore();
    return largeur;
}

// Découpe d'un paragraphe en lignes
function couper(ctx, texte, largeurMax) {
    const mots = texte.split(" "), lignes = [];
    let ligne = "";
    for (const m of mots) {
        const essai = ligne ? ligne + " " + m : m;
        if (ctx.measureText(essai).width > largeurMax && ligne) { lignes.push(ligne); ligne = m; }
        else ligne = essai;
    }
    if (ligne) lignes.push(ligne);
    return lignes;
}

// Extrêmes de température sur la France à l'heure affichée (échantillonnés)
Moteur.prototype.extremes = function () {
    const h = this.etat.heure, cle = h.toFixed(2);
    if (this._extremes && this._extremes.cle === cle) return this._extremes;
    const g = this.grilles.t, f = this.film;
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < g.lon.length; i += 2) {
        if (!g.dansFrance[i]) continue;
        const v = f.temperature(g.lon[i], g.lat[i], h, g.alt[i]);
        if (v < min) min = v;
        if (v > max) max = v;
    }
    this._extremes = { cle, min, max };
    return this._extremes;
};

window.HKOAnimatique = {
    SEUILS_PLUIE, couleurPluie,
    geo: () => GEO, geoPerimetre: () => GEO.perimetre,
    altitude: (lon, lat) => { const [x, y] = proj(lon, lat); return altitudeCarte(x, y); },
    L, H, COULEURS, POLICE_TITRE, POLICE_TEXTE, MOUVEMENT_REDUIT,
    clamp, mix, lisse, sortieExpo, entreeSortie, sortieCubique, prog, gauss, piste, bruit, fbm, fr, NBSP,
    chargerGeo, proj, Moteur, police, ligneMasquee, lettresDecalees, nombreRouleaux, couper, couleurT, PALETTE_T
};
})();
