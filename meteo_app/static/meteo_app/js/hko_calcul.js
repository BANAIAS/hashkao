/* ==========================================================================
   HKO Météo — calculs lourds hors du fil principal

   Ce fichier sert deux fois :
     - comme Web Worker (new Worker(".../hko_calcul.js")) : les calculs se
       font en parallèle, la page reste fluide pendant le dessin des fonds,
       des températures et la préparation du radar ;
     - comme simple script (window.HKOCalcul) : même code, exécuté dans la
       page, pour les navigateurs sans Worker.

   Les algorithmes sont ceux d'origine de hko.js et hko_anime.js, à
   l'identique (relief ombré, mer, ambiances, interpolation des
   températures, estimation du mouvement radar). Seul l'endroit où ils
   s'exécutent change, et les résultats intermédiaires sont gardés :
   changer d'ambiance horaire ne recalcule plus le relief.

   Opérations (message { id, op, args }) :
     relief      { url }                     télécharge et lit le relief
     bathymetrie { bitmap }                  image des fonds marins
     cadre       { W, H, k, s, tx, ty, cadreFond, terre, mer }
                                             altitudes, ombrage, couleurs de base
     fond        { nom, ambiance }           mer et terres (images prêtes à poser)
     champ       { points, pas, zone, tailleCase, teintes }
                                             zones de températures
     trame       { octets, source, n }       trame radar -> texture RGBA + champ de suivi
     mouvement   { cle, i, nx, ny }          vecteurs de mouvement entre les trames i et i+1
     oublier     { cle }                     libère les champs gardés d'une séquence
   ========================================================================== */

(function (portee) {
"use strict";

const ESTOMPE = 1.2;              // degrés : le relief s'estompe à ses limites
const ACCENT = 7;                 // relief accentué pour rester lisible
const DEGRE = Math.PI / 180;

const memoire = {
    relief: null,
    bathymetrie: null,
    cadre: null,      // { W, H, k, altitudes, ombres, bases: { nom: { mer, terre } } }
};

// ---------------------------------------------------------------------------
// Lecture du relief
// ---------------------------------------------------------------------------

async function lireJson(reponse) {
    const octets = new Uint8Array(await reponse.arrayBuffer());
    if (octets[0] === 0x1f && octets[1] === 0x8b) {
        const flux = new Blob([octets]).stream().pipeThrough(new DecompressionStream("gzip"));
        return new Response(flux).json();
    }
    return JSON.parse(new TextDecoder().decode(octets));
}

function normaliserRelief(source) {
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

async function relief({ urls }) {
    let derniere = null;
    for (const url of urls) {
        try {
            const reponse = await fetch(url);
            if (!reponse.ok) { derniere = new Error(`${url} : ${reponse.status}`); continue; }
            memoire.relief = normaliserRelief(await lireJson(reponse));
            memoire.cadre = null;
            return { ok: true };
        } catch (erreur) {
            derniere = erreur;
        }
    }
    memoire.relief = null;
    return { ok: false, erreur: String(derniere && derniere.message) };
}

function bathymetrie({ bitmap, profondeurs }) {
    memoire.bathymetrie = bitmap || null;
    memoire.profondeursFournies = profondeurs || null;
    if (memoire.cadre) memoire.cadre.bases = {};
    return { ok: true };
}

// ---------------------------------------------------------------------------
// Projection de Mercator (celle de d3.geoMercator, sans rotation)
//   x = s·λ + tx      y = ty − s·ln(tan(π/4 + φ/2))
// ---------------------------------------------------------------------------

const longitudePixel = (c, x) => (x - c.tx) / c.s / DEGRE;
const latitudePixel = (c, y) => (2 * Math.atan(Math.exp((c.ty - y) / c.s)) - Math.PI / 2) / DEGRE;

// ---------------------------------------------------------------------------
// Relief : altitudes et éclairage par pixel (preparerRelief d'origine)
// ---------------------------------------------------------------------------

function preparerRelief(c) {
    const { W, H, k } = c;
    const relief = memoire.relief;

    const longitudes = new Float64Array(W);
    const latitudes = new Float64Array(H);
    for (let x = 0; x < W; x++) longitudes[x] = longitudePixel(c, (x + 0.5) / k);
    for (let y = 0; y < H; y++) latitudes[y] = latitudePixel(c, (y + 0.5) / k);

    const altitudes = new Float32Array(W * H).fill(NaN);
    const lumiere = new Float32Array(W * H).fill(0.7071);
    const fondu = new Float32Array(W * H).fill(0);

    if (relief) {
        const { largeur: gl, hauteur: gh, resolution: res, altitudes: grille } = relief;

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
                const cc = grille[i + gl], d = grille[i + gl + 1];
                if (a !== a || b !== b || cc !== cc || d !== d) {
                    const v = a === a ? a : b === b ? b : cc === cc ? cc : d;
                    altitudes[ligne + x] = v;
                    continue;
                }
                const haut = a + (b - a) * fx[x];
                const bas = cc + (d - cc) * fx[x];
                altitudes[ligne + x] = haut + (bas - haut) * fy;
            }
        }

        for (let y = 0; y < H; y++) {
            const fy = Math.max(0, Math.min(1,
                (latitudes[y] - relief.sud) / ESTOMPE, (relief.nord - latitudes[y]) / ESTOMPE));
            for (let x = 0; x < W; x++) {
                const fx2 = Math.max(0, Math.min(1,
                    (longitudes[x] - relief.ouest) / ESTOMPE, (relief.est - longitudes[x]) / ESTOMPE));
                fondu[y * W + x] = fx2 < fy ? fx2 : fy;
            }
        }
    }

    const degresParPixel = longitudes[1] - longitudes[0];
    const lx = -0.5, ly = 0.5, lz = 0.7071;
    for (let y = 0; y < H; y++) {
        const metresX = 111320 * Math.cos(latitudes[y] * DEGRE) * degresParPixel;
        const yh = y > 0 ? y - 1 : y, yb = y < H - 1 ? y + 1 : y;
        const metresY = 111320 * Math.abs(latitudes[yh] - latitudes[yb]) / Math.max(1, yb - yh);
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            const z = altitudes[i];
            if (z !== z) continue;
            const xg = x > 0 ? x - 1 : x, xd = x < W - 1 ? x + 1 : x;
            let zg = altitudes[y * W + xg], zd = altitudes[y * W + xd];
            let zh = altitudes[yh * W + x], zb = altitudes[yb * W + x];
            if (zg !== zg) zg = z;
            if (zd !== zd) zd = z;
            if (zh !== zh) zh = z;
            if (zb !== zb) zb = z;
            const penteEst = ACCENT * (zd - zg) / (metresX * Math.max(1, xd - xg));
            const penteNord = ACCENT * (zh - zb) / (metresY * Math.max(1, yb - yh));
            const l = (-penteEst * lx - penteNord * ly + lz) /
                Math.sqrt(penteEst * penteEst + penteNord * penteNord + 1);
            lumiere[i] = 0.7071 + (l - 0.7071) * fondu[i];
        }
    }

    const ombres = new Float32Array(W * H);
    for (let i = 0; i < ombres.length; i++) {
        const f = 1 + (lumiere[i] - 0.7071) * 1.25;
        ombres[i] = f < 0.5 ? 0.5 : f > 1.32 ? 1.32 : f;
    }
    return { altitudes, lumiere, ombres };
}

// Profondeur des mers par pixel (0 abysses .. 1 plateau)
function profondeurs(c) {
    const { W, H } = c;
    const resultat = new Float32Array(W * H).fill(0.55);
    if (memoire.profondeursFournies && memoire.profondeursFournies.length === W * H) {
        return memoire.profondeursFournies;
    }
    const image = memoire.bathymetrie;
    if (!image || typeof OffscreenCanvas === "undefined") return resultat;
    const toile = new OffscreenCanvas(W, H);
    const ctx = toile.getContext("2d", { willReadFrequently: true });
    if (!ctx) return resultat;
    ctx.fillStyle = "rgb(110,110,110)";
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, ...c.cadreFond);
    const px = ctx.getImageData(0, 0, W, H).data;
    for (let i = 0; i < resultat.length; i++) {
        const v = px[i * 4];
        resultat[i] = v === 0 ? 0.9 : (v - 1) / 254;
    }
    return resultat;
}

// ---------------------------------------------------------------------------
// Fonds en relief
//
// Couleurs de base gardées en entiers ×8 (précision 1/8 de niveau), avant
// ambiance : l'ambiance horaire n'est qu'une multiplication par pixel.
// ---------------------------------------------------------------------------

function cadre(args) {
    const c = { ...args };
    const relief = preparerRelief(c);
    c.altitudes = relief.altitudes;
    c.lumiere = relief.lumiere;
    c.ombres = relief.ombres;
    c.bases = {};
    memoire.cadre = c;
    return { ok: true, relief: Boolean(memoire.relief) };
}

function bases(nom) {
    const c = memoire.cadre;
    if (c.bases[nom]) return c.bases[nom];
    const { W, H } = c;
    const style = c.styles[nom];
    const terre = c.teintes[nom].terre, mer = c.teintes[nom].mer;
    const prof = profondeurs(c);
    const n = W * H;
    const baseMer = new Uint16Array(n * 3);
    const baseTerre = new Uint16Array(n * 3);
    const cx = W * 0.55, cy = H * 0.45, rayon = Math.hypot(W, H) * 0.62;

    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i = y * W + x, p = i * 3;
            let t = Math.round(prof[i] / mer.pas);
            t = (t < 0 ? 0 : t >= mer.taille ? mer.taille - 1 : t) * 3;
            const v = 1 - style.vignette * Math.min(1, Math.hypot(x - cx, y - cy) / rayon) ** 2;
            baseMer[p] = Math.round(mer.table[t] * v * 8);
            baseMer[p + 1] = Math.round(mer.table[t + 1] * v * 8);
            baseMer[p + 2] = Math.round(mer.table[t + 2] * v * 8);
        }
    }

    const [r0, g0, b0] = style.sansRelief;
    const altitudes = c.altitudes, lumiere = c.lumiere;
    for (let i = 0; i < n; i++) {
        const z = altitudes[i];
        let r = r0, g = g0, b = b0;
        if (z === z) {
            let t = Math.round((z < 0 ? 0 : z) / terre.pas);
            if (t >= terre.taille) t = terre.taille - 1;
            t *= 3;
            r = terre.table[t]; g = terre.table[t + 1]; b = terre.table[t + 2];
        }
        let f = 1 + (lumiere[i] - 0.7071) * style.ombre;
        f = f < style.ombreMin ? style.ombreMin : f > style.ombreMax ? style.ombreMax : f;
        const p = i * 3;
        baseTerre[p] = Math.min(65535, Math.round(r * f * 8));
        baseTerre[p + 1] = Math.min(65535, Math.round(g * f * 8));
        baseTerre[p + 2] = Math.min(65535, Math.round(b * f * 8));
    }
    c.bases[nom] = { mer: baseMer, terre: baseTerre };
    // Les deux fonds en relief sont faits : l'éclairage n'est plus utile
    if (c.bases.temperatures && c.bases.precipitations) c.lumiere = null;
    return c.bases[nom];
}

function appliquer(base, facteurs, n) {
    const px = new Uint8ClampedArray(n * 4);
    const a = facteurs[0] / 8, b = facteurs[1] / 8, cc = facteurs[2] / 8;
    for (let i = 0, p = 0, q = 0; i < n; i++, p += 4, q += 3) {
        px[p] = base[q] * a;
        px[p + 1] = base[q + 1] * b;
        px[p + 2] = base[q + 2] * cc;
        px[p + 3] = 255;
    }
    return px;
}

async function image(px, W, H) {
    const donnees = new ImageData(px, W, H);
    if (typeof createImageBitmap === "function" && typeof WorkerGlobalScope !== "undefined") {
        try { return await createImageBitmap(donnees); } catch (e) { /* ImageData */ }
    }
    return donnees;
}

async function fond({ nom, ambiance }) {
    const c = memoire.cadre;
    if (!c) throw new Error("cadre absent");
    const b = bases(nom);
    const n = c.W * c.H;
    const mer = await image(appliquer(b.mer, ambiance.mer, n), c.W, c.H);
    const terre = await image(appliquer(b.terre, ambiance.terre, n), c.W, c.H);
    return { mer, terre, W: c.W, H: c.H };
}

// ---------------------------------------------------------------------------
// Températures : interpolation (calculerChamp) et zones (dessinerChamp)
// ---------------------------------------------------------------------------

const GRADIENT_ALTITUDE = 0.0045;

function calculerChamp(points, pas, zone, tailleCase) {
    const c = memoire.cadre;
    const { W, H, k } = c;
    const { x0, y0, x1, y1 } = zone;
    const colonnes = Math.ceil((x1 - x0) / pas) + 1;
    const lignes = Math.ceil((y1 - y0) / pas) + 1;
    const valeurs = new Float32Array(colonnes * lignes);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    const nCasesX = Math.floor((maxX - minX) / tailleCase) + 1;
    const nCasesY = Math.floor((maxY - minY) / tailleCase) + 1;
    const cases = Array.from({ length: nCasesX * nCasesY }, () => []);
    for (const p of points) {
        const cx = Math.floor((p.x - minX) / tailleCase);
        const cy = Math.floor((p.y - minY) / tailleCase);
        cases[cy * nCasesX + cx].push(p);
    }

    const K = 8;
    const distances = new Float64Array(K);
    const proches = new Array(K);
    const altitudes = c.altitudes;

    for (let l = 0; l < lignes; l++) {
        const py = y0 + l * pas;
        for (let col = 0; col < colonnes; col++) {
            const px = x0 + col * pas;
            const ix = Math.min(W - 1, Math.max(0, Math.round(px * k)));
            const iy = Math.min(H - 1, Math.max(0, Math.round(py * k)));
            const altitudeCible = altitudes ? altitudes[iy * W + ix] : NaN;
            const cx = Math.floor((px - minX) / tailleCase);
            const cy = Math.floor((py - minY) / tailleCase);
            let trouves = 0;
            let anneauPlein = -1;
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
            valeurs[l * colonnes + col] = poidsTotal ? somme / poidsTotal : NaN;
        }
    }
    return { valeurs, colonnes, lignes, x0, y0, pas };
}

function pasDesZones(valeurs) {
    const v = Array.from(valeurs).filter(Number.isFinite).sort((a, b) => a - b);
    if (v.length < 10) return 2;
    const etendue = v[Math.floor(v.length * 0.95)] - v[Math.floor(v.length * 0.05)];
    return etendue <= 7 ? 1 : etendue <= 16 ? 2 : 3;
}

async function champ({ points, pas, zone, tailleCase, teintes }) {
    const c = memoire.cadre;
    if (!c || points.length < 3 || zone.x1 <= zone.x0 || zone.y1 <= zone.y0) return null;
    const { W, H, k } = c;
    const resultat = calculerChamp(points, pas, zone, tailleCase);
    const { valeurs, colonnes, lignes, x0, y0 } = resultat;
    const pasBande = pasDesZones(valeurs);

    const gx0 = Math.round(x0 * k), gy0 = Math.round(y0 * k);
    const gl = Math.min(W - gx0, Math.round((colonnes - 1) * pas * k));
    const gh = Math.min(H - gy0, Math.round((lignes - 1) * pas * k));
    if (gl <= 0 || gh <= 0) return null;

    const pixels = new Uint8ClampedArray(gl * gh * 4);
    const { table, debut, pas: pasT, taille } = teintes;
    const ombres = c.ombres;

    const couleurZone = nz => {
        let i = Math.round(((nz + 0.5) * pasBande - debut) / pasT);
        i = (i < 0 ? 0 : i >= taille ? taille - 1 : i) * 3;
        return [table[i], table[i + 1], table[i + 2]];
    };
    const zones = new Map();
    const zoneDe = nz => {
        let col = zones.get(nz);
        if (!col) zones.set(nz, col = couleurZone(nz));
        return col;
    };
    const bord = 0.07;

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
            const b = t / pasBande;
            const nz = Math.floor(b);
            const f = b - nz;
            const col = zoneDe(nz);
            let r = col[0], g = col[1], bl = col[2];
            if (f < bord || f > 1 - bord) {
                const voisine = f < bord ? zoneDe(nz - 1) : zoneDe(nz + 1);
                const m = f < bord ? 0.5 - f / (2 * bord) : 0.5 - (1 - f) / (2 * bord);
                r += (voisine[0] - r) * m;
                g += (voisine[1] - g) * m;
                bl += (voisine[2] - bl) * m;
                const l = 1 - 0.07 * (1 - Math.min(f, 1 - f) / bord);
                r *= l; g *= l; bl *= l;
            }
            const ombre = ombres ? 0.25 + 0.75 * ombres[(gy0 + y) * W + gx0 + x] : 1;
            const p = (y * gl + x) * 4;
            r *= ombre; g *= ombre; bl *= ombre;
            pixels[p] = r > 255 ? 255 : r;
            pixels[p + 1] = g > 255 ? 255 : g;
            pixels[p + 2] = bl > 255 ? 255 : bl;
            pixels[p + 3] = 255;
        }
    }
    return { image: await image(pixels, gl, gh), gx0, gy0, gl, gh, pasBande };
}

// ---------------------------------------------------------------------------
// Radar : textures et mouvement (hko_anime.js d'origine)
// ---------------------------------------------------------------------------

// Le code d'origine (hko_anime.js) est chargé tel quel : mêmes fonctions.
function anime() {
    const a = portee.HKOAnime;
    if (!a) throw new Error("hko_anime.js non chargé");
    return a;
}

// Champs de suivi gardés ici, le temps de calculer les mouvements
const suivis = new Map();     // cle de séquence -> Map(indice -> Float32Array)

function oublier({ cle }) {
    if (cle) suivis.delete(cle); else suivis.clear();
    return { ok: true };
}

function trame({ octets, source, n, cle, i }) {
    const plan1 = new Uint8Array(octets, 0, n), plan2 = new Uint8Array(octets, n, n);
    const rgba = new Uint8Array(n * 4);
    // Conversion identique à HKOAnime.creer().charger()
    if (source === "radar") {
        for (let i = 0; i < n; i++) {
            rgba[i * 4] = plan1[i];
            rgba[i * 4 + 1] = (plan2[i] >> 4) * 17;
            rgba[i * 4 + 2] = (plan2[i] & 15) * 17;
            rgba[i * 4 + 3] = 255;
        }
    } else {
        for (let i = 0; i < n; i++) {
            rgba[i * 4] = (plan1[i] >> 4) * 17;
            rgba[i * 4 + 1] = (plan1[i] & 15) * 17;
            rgba[i * 4 + 2] = (plan2[i] >> 4) * 17;
            rgba[i * 4 + 3] = (plan2[i] & 15) * 17;
        }
    }
    const suivi = anime().champSuivi(source, { plan1, plan2 }, n);
    if (cle !== undefined) {
        if (!suivis.has(cle)) {
            if (suivis.size >= 2) suivis.delete(suivis.keys().next().value);
            suivis.set(cle, new Map());
        }
        suivis.get(cle).set(i, suivi);
        return { rgba };
    }
    return { rgba, suivi };
}

// Mouvement entre les trames i et i+1 d'une séquence (champs gardés ici),
// ou entre deux champs fournis (a, b)
function mouvement({ a, b, nx, ny, cle, i, liberer }) {
    if (cle !== undefined) {
        const champs = suivis.get(cle);
        if (!champs || !champs.has(i) || !champs.has(i + 1)) return null;
        const m = anime().estimerMouvement(champs.get(i), champs.get(i + 1), nx, ny);
        if (liberer) champs.delete(i);
        return m;
    }
    return anime().estimerMouvement(a, b, nx, ny);
}

// ---------------------------------------------------------------------------
// Aiguillage
// ---------------------------------------------------------------------------

const OPERATIONS = { relief, bathymetrie, cadre, fond, champ, trame, mouvement, oublier };

async function executer(op, args) {
    const f = OPERATIONS[op];
    if (!f) throw new Error(`Opération inconnue : ${op}`);
    return f(args || {});
}

// Objets à transférer (sans copie) vers la page
function transferables(resultat, liste = []) {
    if (!resultat || typeof resultat !== "object") return liste;
    if (typeof ImageBitmap !== "undefined" && resultat instanceof ImageBitmap) { liste.push(resultat); return liste; }
    if (ArrayBuffer.isView(resultat)) { liste.push(resultat.buffer); return liste; }
    if (resultat instanceof ImageData) { liste.push(resultat.data.buffer); return liste; }
    for (const v of Object.values(resultat)) transferables(v, liste);
    return liste;
}

const dansUnWorker = typeof WorkerGlobalScope !== "undefined" && portee instanceof WorkerGlobalScope;

if (dansUnWorker) {
    portee.onmessage = async evenement => {
        const { id, op, args, script } = evenement.data;
        if (script) {
            // hko_anime.js : estimation du mouvement, sans WebGL ici
            try {
                portee.importScripts(script);
                portee.postMessage({ id, resultat: { ok: true } });
            } catch (erreur) {
                portee.postMessage({ id, erreur: String(erreur && erreur.message || erreur) });
            }
            return;
        }
        try {
            const resultat = await executer(op, args);
            const liste = [...new Set(transferables(resultat))];
            portee.postMessage({ id, resultat }, liste);
        } catch (erreur) {
            portee.postMessage({ id, erreur: String(erreur && erreur.message || erreur) });
        }
    };
} else {
    portee.HKOCalcul = { executer };
}

})(typeof self !== "undefined" ? self : window);
