/* ==========================================================================
   HKO Météo — « Résumé du jour » : un seul film, nourri par la partition.

   Intégré à la page principale (tableau « Résumé » des journées passées) :
   chargé à la demande par hko.js, avec hko_resume_moteur.js. La partition
   vient de api/resume/ (produite chaque nuit par hko_derives --etapes resume).

   construireFilm(partition) renvoie un film pour le moteur. Rien n'est écrit
   à la main pour une date donnée : titres, phrases, villes, chiffres, champs
   animés et événements viennent tous de la partition produite après la
   clôture de la journée (resume_du_jour.py).

   Déroulé (40 s, identique chaque jour) :
     0,0  Ouverture   isobares du site, marque, jauge, date, lever et coucher
     3,6  Titre       mot du jour, phénomène, commentaire des températures
     8,2  Températures  carte heure par heure, villes, curseur du maximum
    15,6  Radar       la journée entière en 4 s, événements horodatés
    19,8  Le ciel     symboles des villes, matin puis après-midi
    25,0  Synthèse    deux phrases, trois chiffres
    28,3  Signature
   ========================================================================== */

(() => {
"use strict";

const A = window.HKOAnimatique;
const { COULEURS, POLICE_TITRE, POLICE_TEXTE, clamp, mix, lisse, sortieExpo, entreeSortie, sortieCubique,
        prog, piste, fr, NBSP, police, ligneMasquee, lettresDecalees, nombreRouleaux, couper } = A;

// Format de l'image : paysage 1920 × 1080, ou portrait 1080 × H (téléphone tenu
// droit, H ajustée à l'écran). Réglé par construireFilm ; un seul film à la fois.
let L = 1920, H = 1080, PORTRAIT = false, MARGE = 120;
let MISE = {};

function reglerFormat(portrait, hauteur) {
    PORTRAIT = Boolean(portrait);
    L = PORTRAIT ? 1080 : 1920;
    H = PORTRAIT ? Math.round(clamp(hauteur || 1920, 1350, 2400)) : 1080;
    MARGE = PORTRAIT ? 64 : 120;
    MISE = PORTRAIT ? {
        ouvertureY: (H - 1080) / 2 + 30, titreY: 380, largeurTexte: L - 2 * MARGE,
        echelleX: 150, echelle: [H - 130, H - 430], momentsX: 330, momentsY: H - 92,
        syntheseY: Math.round(H * 0.28), signatureY: Math.round(H / 2 - 40), ancreCiel: [L - 40, 290]
    } : {
        ouvertureY: 110, titreY: 470, largeurTexte: 900,
        echelleX: MARGE, echelle: [860, 520], momentsX: MARGE, momentsY: 980,
        syntheseY: 330, signatureY: 520, ancreCiel: [L - 40, 222]
    };
}
reglerFormat(false);
const ACTES = [
    { nom: "Ouverture", debut: 0, fin: 6 }, { nom: "Titre", debut: 6, fin: 12 },
    { nom: "Températures", debut: 12, fin: 22 }, { nom: "Précipitations", debut: 22, fin: 28 },
    { nom: "Conditions", debut: 28, fin: 34 }, { nom: "Synthèse", debut: 34, fin: 38.2 },
    { nom: "Signature", debut: 38.2, fin: 40 }
];

const HEURE = h => {
    const hh = Math.floor(h + 1e-6) % 24, mm = Math.round((h - Math.floor(h + 1e-6)) * 60);
    return mm ? `${hh}${NBSP}h${NBSP}${String(mm).padStart(2, "0")}` : `${hh}${NBSP}h`;
};

function apparition(t, debut, fin, entree = 0.5, sortie = 0.4) {
    return Math.min(sortieExpo(prog(t, debut, debut + entree)), 1 - entreeSortie(prog(t, fin - sortie, fin)));
}

// ---------------------------------------------------------------------------
// Champs de la partition : images PNG empilées (une par instant) -> échantillonneurs
// ---------------------------------------------------------------------------

async function decoder(champ) {
    const img = new Image();
    img.src = "data:image/png;base64," + champ.png;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const rgba = ctx.getImageData(0, 0, c.width, c.height).data;
    const octets = new Uint8Array(c.width * c.height);
    for (let i = 0; i < octets.length; i++) octets[i] = rgba[i * 4];
    return octets;
}

// Bilinéaire dans l'espace, linéaire dans le temps (heures depuis minuit, Paris)
function echantillonneur(champ, octets, table) {
    const { ouest, nord, pas, nx, ny, heures: hs } = champ;
    const taille = nx * ny;
    const lire = (f, x, y) => table[octets[f * taille + y * nx + x]];
    const spatial = (f, lon, lat) => {
        const gx = (lon - ouest) / pas - 0.5, gy = (nord - lat) / pas - 0.5;
        const x0 = Math.max(0, Math.min(nx - 2, Math.floor(gx))), y0 = Math.max(0, Math.min(ny - 2, Math.floor(gy)));
        const fx = clamp(gx - x0), fy = clamp(gy - y0);
        return (lire(f, x0, y0) * (1 - fx) + lire(f, x0 + 1, y0) * fx) * (1 - fy)
             + (lire(f, x0, y0 + 1) * (1 - fx) + lire(f, x0 + 1, y0 + 1) * fx) * fy;
    };
    return (lon, lat, hu) => {
        if (hu <= hs[0]) return spatial(0, lon, lat);
        if (hu >= hs[hs.length - 1]) return spatial(hs.length - 1, lon, lat);
        let a = 0, b = hs.length - 1;
        while (b - a > 1) { const m = (a + b) >> 1; if (hs[m] <= hu) a = m; else b = m; }
        const f = (hu - hs[a]) / (hs[b] - hs[a]);
        return f < 0.02 ? spatial(a, lon, lat) : f > 0.98 ? spatial(b, lon, lat)
            : spatial(a, lon, lat) * (1 - f) + spatial(b, lon, lat) * f;
    };
}

const TABLE_T = Float32Array.from({ length: 256 }, (_, v) => v / 4 - 20);
const TABLE_PLUIE = Float32Array.from({ length: 256 }, (_, v) => Math.pow(2, v / 40) - 1);
const TABLE_NUAGES = Float32Array.from({ length: 256 }, (_, v) => v / 255);

// ---------------------------------------------------------------------------
// Symboles du site (tableau « conditions »), redessinés au canevas
// ---------------------------------------------------------------------------

const NUAGE = new Path2D("M-13 8a7 7 0 0 1-1-13.9a10 10 0 0 1 19-2.6a8.3 8.3 0 0 1 8.5 16.5z");
const ECLAIR = new Path2D("M1 9l-6 9h4l-2 7 8-10h-4.5l3-6z");
const TEINTES = { "": "#ffffff", gris: "#c3ccd8", sombre: "#8d9aad" };

function symbole(ctx, code, x, y, echelle, t) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(echelle, echelle);
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    const contour = () => { ctx.strokeStyle = "rgba(6, 32, 63, 0.55)"; ctx.lineWidth = 1.4; ctx.stroke(); };
    const astre = () => {
        ctx.save();
        ctx.rotate(t * 0.24);
        ctx.strokeStyle = "#ffc533"; ctx.lineWidth = 2.4;
        for (let i = 0; i < 8; i++) {
            const a = i * Math.PI / 4;
            ctx.beginPath(); ctx.moveTo(11.5 * Math.cos(a), 11.5 * Math.sin(a)); ctx.lineTo(16 * Math.cos(a), 16 * Math.sin(a)); ctx.stroke();
        }
        ctx.restore();
        ctx.beginPath(); ctx.arc(0, 0, 8.2, 0, Math.PI * 2);
        ctx.fillStyle = "#ffc533"; ctx.fill(); contour();
    };
    const nuage = (teinte = "", tx = 0, ty = 0, s = 1) => {
        ctx.save();
        ctx.translate(tx + Math.sin(t * 0.9 + tx) * 1.2, ty); ctx.scale(s, s);
        ctx.fillStyle = TEINTES[teinte];
        ctx.strokeStyle = "rgba(6, 32, 63, 0.55)"; ctx.lineWidth = 1.4;
        ctx.stroke(NUAGE); ctx.fill(NUAGE);
        ctx.restore();
    };
    const gouttes = n => {
        ctx.strokeStyle = "#d8f1ff"; ctx.lineWidth = 2.6;
        for (let i = 0; i < n; i++) {
            const x0 = n === 1 ? 0 : -7 + i * (14 / (n - 1));
            const ph = (t / 1.1 + i * 0.33) % 1;
            ctx.globalAlpha = Math.min(1, ph * 4) * (1 - ph);
            const dx = 1.5 - 3 * ph, dy = -3 + 9 * ph;
            ctx.beginPath(); ctx.moveTo(x0 + 1.2 + dx, 11.5 + dy); ctx.lineTo(x0 - 1.2 + dx, 18 + dy); ctx.stroke();
        }
        ctx.globalAlpha = 1;
    };
    switch (code) {
        case "soleil": astre(); break;
        case "eclaircies":
            ctx.save(); ctx.translate(-6, -6); ctx.scale(0.82, 0.82); astre(); ctx.restore();
            nuage("", 3, 4, 0.92); break;
        case "nuageux": nuage("gris", 5, -5, 0.78); nuage("", -2, 3); break;
        case "couvert": nuage("sombre", 5, -5, 0.82); nuage("gris", -2, 3); break;
        case "pluie-faible": ctx.translate(0, -4); nuage("gris"); gouttes(1); break;
        case "pluie": ctx.translate(0, -4); nuage("gris"); gouttes(2); break;
        case "pluie-forte": ctx.translate(0, -4); nuage("sombre"); gouttes(3); break;
        case "neige":
            ctx.translate(0, -4); nuage("gris");
            for (const fx of [-7, 0, 7]) { ctx.beginPath(); ctx.arc(fx, 14 + ((t * 0.6 + fx) % 1) * 3, 1.9, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill(); }
            break;
        case "brouillard":
            ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3; ctx.globalAlpha = 0.9;
            [-7, 0, 7].forEach((yy, i) => {
                const g = Math.sin(t * 1.2 + i * 2) * 2.5;
                ctx.beginPath(); ctx.moveTo(-13 + i * 2 + g, yy); ctx.lineTo(13 - (2 - i) * 2 + g, yy); ctx.stroke();
            });
            break;
        case "orage":
            ctx.translate(0, -4); nuage("sombre");
            ctx.fillStyle = "#ffd93b"; ctx.globalAlpha = ((t * 0.3) % 1) < 0.12 ? 1 : 0.35; ctx.fill(ECLAIR);
            break;
        default:
            ctx.beginPath(); ctx.arc(0, 0, 3.6, 0, Math.PI * 2); ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 1.6; ctx.stroke();
    }
    ctx.restore();
}

const LIBELLES = { "soleil": "Soleil", "eclaircies": "Éclaircies", "nuageux": "Nuageux", "couvert": "Couvert",
    "pluie-faible": "Pluie faible", "pluie": "Pluie", "pluie-forte": "Forte pluie", "neige": "Neige",
    "brouillard": "Brouillard", "orage": "Orage" };

// ---------------------------------------------------------------------------
// Éléments graphiques (communs à toutes les journées)
// ---------------------------------------------------------------------------

// Isobares de l'écran de chargement du site (mêmes tracés, viewBox 1200 × 700, « slice »)
const ISOBARES = [
    "M-50 520 C 180 420, 330 600, 560 470 S 930 300, 1250 420",
    "M-50 430 C 200 330, 360 520, 590 380 S 950 210, 1250 330",
    "M-50 340 C 220 240, 390 430, 620 290 S 970 130, 1250 240",
    "M-50 250 C 240 150, 420 340, 650 200 S 990 50, 1250 150",
    "M-50 610 C 160 510, 300 690, 530 560 S 910 390, 1250 510"
].map(d => new Path2D(d));

function isobares(ctx, t, debut, alpha, derive = 0, duree = 1.7, ecart = 0.22) {
    const s = PORTRAIT ? 2.3 : 1.6, oy = (H - 700 * s) / 2, ox = (L - 1200 * s) / 2;
    ctx.save();
    ctx.translate(ox - derive * 40, oy);
    ctx.scale(s, s);
    ctx.lineWidth = 1.5 / s * 1.4;
    ctx.strokeStyle = `rgba(160, 205, 255, ${0.3 * alpha})`;
    ISOBARES.forEach((p, i) => {
        const q = entreeSortie(prog(t, debut + i * ecart, debut + duree + i * ecart));
        ctx.setLineDash([1600 * q, 1600]);
        ctx.stroke(p);
    });
    ctx.restore();
}

function marque(ctx, x, y, taille, p, alignement = "center") {
    ctx.font = police(taille, 700);
    const lh = ctx.measureText("HKO").width;
    ctx.font = police(taille, 300);
    const lm = ctx.measureText("Météo").width;
    const ecart = taille * 0.28, largeur = lh + ecart + lm;
    const x0 = alignement === "center" ? x - largeur / 2 : x;
    ctx.save();
    // Masque arrêté juste au-dessus de la jauge : au départ, les lettres sont entièrement dessous
    ctx.beginPath(); ctx.rect(x0 - 10, y - taille * 1.05, largeur + 20, taille * 1.05 + taille * 0.34); ctx.clip();
    const e1 = sortieExpo(clamp(p * 1.25)), e2 = sortieExpo(clamp(p * 1.25 - 0.2));
    ctx.textAlign = "left";
    ctx.fillStyle = COULEURS.ecume; ctx.globalAlpha *= 1;
    ctx.font = police(taille, 700);
    ctx.fillText("HKO", x0, y + (1 - e1) * taille * 1.15);
    ctx.fillStyle = COULEURS.brume;
    ctx.font = police(taille, 300);
    ctx.fillText("Météo", x0 + lh + ecart, y + (1 - e2) * taille * 1.15);
    ctx.restore();
    return { x0, largeur };
}

function iconeSoleil(ctx, x, y, r, monte) {
    // Demi-soleil posé sur l'horizon, flèche montante ou descendante
    ctx.save();
    ctx.strokeStyle = COULEURS.ambre; ctx.fillStyle = COULEURS.ambre; ctx.lineWidth = 3; ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(x, y, r, Math.PI, 0); ctx.fill();
    for (let i = 0; i < 5; i++) {
        const a = Math.PI + (i + 0.5) * Math.PI / 5;
        ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * (r + 6), y + Math.sin(a) * (r + 6));
        ctx.lineTo(x + Math.cos(a) * (r + 13), y + Math.sin(a) * (r + 13)); ctx.stroke();
    }
    ctx.strokeStyle = COULEURS.ecume; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x - r - 16, y + 5); ctx.lineTo(x + r + 16, y + 5); ctx.stroke();
    ctx.restore();
}

function ouverture(P) {
    const debut = 0, fin = 6.0;
    const date = P.date_longue[0].toUpperCase() + P.date_longue.slice(1);
    return {
        debut, fin,
        dessiner(m, ctx, t) {
            const sortie = entreeSortie(prog(t, fin - 0.6, fin));
            // Les isobares restent en fond jusqu'à la carte
            isobares(ctx, t, 0, 1 - sortie, prog(t, 0, fin) * 0.6);
            const cx = L / 2;
            ctx.globalAlpha = 1 - sortie;
            ctx.save();
            ctx.translate(0, MISE.ouvertureY - sortie * 40);
            // Jingle (0 - 3 s) : la marque, puis la jauge ambre qui se remplit
            const { largeur } = marque(ctx, cx, 330, 112, prog(t, 0.4, 1.5));
            const lj = Math.min(Math.max(largeur, 820), L - 2 * MARGE), xj = cx - lj / 2;
            ctx.fillStyle = "rgba(255, 255, 255, 0.14)";
            ctx.fillRect(xj, 372, lj * sortieExpo(prog(t, 0.05, 0.6)), 5);
            const remplissage = entreeSortie(prog(t, 0.7, 2.7));
            ctx.fillStyle = COULEURS.ambre;
            ctx.fillRect(xj, 372, lj * remplissage, 5);
            ligneMasquee(ctx, "Résumé du jour", xj, 430, 38, prog(t, 1.1, 1.8), { graisse: 500, famille: POLICE_TEXTE, couleur: COULEURS.brume });
            ctx.save();
            ctx.globalAlpha = (1 - sortie) * sortieExpo(prog(t, 0.9, 1.3)) * (1 - prog(t, 2.8, 3.2));
            ctx.textAlign = "right"; ctx.font = police(30, 500, POLICE_TEXTE); ctx.fillStyle = COULEURS.brume;
            ctx.fillText(`${Math.round(100 * remplissage)}${NBSP}%`, xj + lj, 430);
            ctx.restore();
            // La date : lettres plus lentes, faible amplitude, en fondu
            ctx.font = police(124, 700);
            const tDate = Math.min(124, 124 * (L - 2 * MARGE) / ctx.measureText(date).width);
            lettresDecalees(ctx, date, cx, 590, tDate, t, 3.0, { align: "center", ecart: 0.045, duree: 0.9, amplitude: 0.32, fondu: true });
            // Lever, puis coucher
            const yl = 735;
            const lever = `Lever ${HEURE(P.soleil.lever)}`, coucher = `Coucher ${HEURE(P.soleil.coucher)}`;
            ctx.font = police(50, 600);
            const ll = ctx.measureText(lever).width, lc = ctx.measureText(coucher).width;
            const total = 64 + ll + 120 + 64 + lc;
            const xL = cx - total / 2, xC = xL + 64 + ll + 120;
            [[xL, lever, 3.55], [xC, coucher, 3.95]].forEach(([x, texte, d]) => {
                const p = sortieExpo(prog(t, d, d + 0.7));
                ctx.save();
                ctx.globalAlpha = (1 - sortie) * p;
                iconeSoleil(ctx, x + 24, yl - 14 + (1 - p) * 12, 14, texte === lever);
                ctx.textAlign = "left"; ctx.fillStyle = COULEURS.ecume; ctx.font = police(50, 600);
                ctx.fillText(texte, x + 64, yl + (1 - p) * 12);
                ctx.restore();
            });
            ctx.globalAlpha = (1 - sortie) * sortieExpo(prog(t, 4.9, 5.4));
            ctx.font = police(26, 500, POLICE_TEXTE); ctx.fillStyle = COULEURS.brume; ctx.textAlign = "center";
            ctx.fillText(`à ${P.soleil.lieu}`, cx, yl + 54);
            ctx.restore();
        }
    };
}

// Carte du titre : seulement les contours et les départements, sur fond nuit.
// Le littoral se trace d'un seul geste ; chaque île s'allume quand le tracé passe au plus près.
let TRACE = null;
function preparerTrace() {
    if (TRACE) return TRACE;
    const morceaux = A.geo().franceTexte.split("M").filter(Boolean).map(m => {
        const n = m.replace(/Z/g, "").trim().split(/\s+/).map(Number), pts = [];
        for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i], n[i + 1]]);
        let l = 0; for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        const p = new Path2D(); pts.forEach(([x, y], i) => i ? p.lineTo(x, y) : p.moveTo(x, y)); p.closePath();
        return { pts, l, p };
    });
    morceaux.sort((a, b) => b.l - a.l);
    const terre = morceaux[0];
    const cumul = [0];
    for (let i = 1; i < terre.pts.length; i++) cumul.push(cumul[i - 1] + Math.hypot(terre.pts[i][0] - terre.pts[i - 1][0], terre.pts[i][1] - terre.pts[i - 1][1]));
    const iles = morceaux.slice(1).map(m => {
        const [cx, cy] = m.pts[0];
        let best = Infinity, s = 0;
        terre.pts.forEach(([x, y], i) => { const d = (x - cx) ** 2 + (y - cy) ** 2; if (d < best) { best = d; s = cumul[i]; } });
        return { ...m, s };
    });
    TRACE = { terre, iles };
    return TRACE;
}

function carteTrait({ debut, fin }) {
    return {
        debut, fin,
        dessiner(m, ctx, t) {
            const p = entreeSortie(prog(t, debut, debut + 1.8));
            const f = 1 - entreeSortie(prog(t, fin - 0.6, fin));
            if (p <= 0) return;                                   // première image vide
            const { terre, iles } = preparerTrace();
            m.repere(ctx);
            ctx.lineJoin = "round";
            ctx.globalAlpha = 0.28 * f * sortieExpo(prog(t, debut + 0.9, debut + 2.0));
            ctx.strokeStyle = COULEURS.brume; ctx.lineWidth = 0.9 / m.cam.s;
            ctx.stroke(A.geo().departements);
            ctx.globalAlpha = f;
            ctx.lineWidth = 2.6 / m.cam.s;
            ctx.strokeStyle = COULEURS.ecume;
            const avance = terre.l * p;
            ctx.setLineDash([avance, terre.l]);
            ctx.stroke(terre.p);
            for (const ile of iles) {
                const q = clamp((avance - ile.s) / 40);
                if (q <= 0) continue;
                ctx.setLineDash([ile.l * q, ile.l]);
                ctx.stroke(ile.p);
            }
            ctx.setLineDash([]);
        }
    };
}

// Titre du jour : un mot choisi par les règles, puis deux puces l'une après l'autre
function titre(P, { debut, fin }) {
    return {
        debut, fin,
        dessiner(m, ctx, t) {
            const x = MARGE, y = MISE.titreY;
            ctx.font = police(200, 700);
            const taille = Math.min(200, 200 * MISE.largeurTexte / ctx.measureText(P.titre).width);
            const larg = lettresDecalees(ctx, P.titre, x, y, taille, t, debut + 0.35,
                { ecart: 0.04, duree: 0.8, amplitude: 1.05, basMasque: 20, sortie: fin - 0.55 });
            const pt = sortieExpo(prog(t, debut, debut + 0.6)), pf = entreeSortie(prog(t, fin - 0.5, fin));
            ctx.fillStyle = COULEURS.ambre;
            ctx.fillRect(x + larg * pf, y + 26, Math.max(0, larg * (pt - pf)), 8);
            const sortie = 1 - entreeSortie(prog(t, fin - 0.45, fin));
            (P.puces || []).slice(0, 2).forEach((puce, i) => {
                const d = debut + 1.3 + i * 0.9;
                const yy = y + 130 + i * 84;
                const p = sortieExpo(prog(t, d, d + 0.6));
                ctx.save();
                ctx.globalAlpha = sortie * p;
                // Petite flèche ambre
                const fx = x + (1 - p) * -16;
                ctx.strokeStyle = COULEURS.ambre; ctx.lineWidth = 5; ctx.lineCap = "round"; ctx.lineJoin = "round";
                ctx.beginPath(); ctx.moveTo(fx, yy - 17); ctx.lineTo(fx + 30, yy - 17); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(fx + 19, yy - 28); ctx.lineTo(fx + 31, yy - 17); ctx.lineTo(fx + 19, yy - 6); ctx.stroke();
                ctx.restore();
                ctx.save(); ctx.globalAlpha = sortie;
                ctx.font = police(54, 500, POLICE_TEXTE);
                const tPuce = Math.min(54, 54 * (L - 2 * MARGE - 56) / ctx.measureText(puce).width);
                ligneMasquee(ctx, puce, x + 56, yy, tPuce, prog(t, d + 0.1, d + 0.75), { graisse: 500, famille: POLICE_TEXTE });
                ctx.restore();
            });
        }
    };
}

function sequence({ debut, fin, nom, detail }) {
    return {
        debut, fin,
        dessiner(m, ctx, t) {
            ctx.globalAlpha = apparition(t, debut, fin, 0.5, 0.35);
            ctx.fillStyle = COULEURS.ambre;
            ctx.fillRect(MARGE, 76, 6, 74 * sortieExpo(prog(t, debut, debut + 0.6)));
            ligneMasquee(ctx, nom, MARGE + 26, 116, 42, prog(t, debut + 0.1, debut + 0.7), { graisse: 600 });
            ligneMasquee(ctx, detail, MARGE + 26, 150, 26, prog(t, debut + 0.25, debut + 0.85), { graisse: 500, famille: POLICE_TEXTE, couleur: COULEURS.brume });
        }
    };
}

function horloge(P, { debut, fin }) {
    // Seulement l'heure, en haut à droite (alignée sur le titre de séquence)
    return {
        debut, fin,
        dessiner(m, ctx, t) {
            ctx.globalAlpha = apparition(t, debut, fin, 0.5, 0.35);
            const h = m.etat.heure;
            ctx.font = police(64, 600); ctx.fillStyle = COULEURS.ecume; ctx.textAlign = "right";
            const hh = Math.floor(h) % 24, mm = Math.floor((h - Math.floor(h)) * 6) * 10;
            ctx.fillText(`${hh}${NBSP}h${NBSP}${String(mm).padStart(2, "0")}`, L - MARGE, 130);
        }
    };
}

function echelle({ debut, fin, min, max, phase }) {
    return {
        debut, fin,
        dessiner(m, ctx, t) {
            const a = apparition(t, debut, fin, 0.5, 0.35);
            ctx.globalAlpha = a;
            const x = MISE.echelleX, [y0, y1] = MISE.echelle, l = 14;
            const p = sortieExpo(prog(t, debut, debut + 0.8));
            const yv = v => mix(y0, y1, (v - min) / (max - min));
            const grad = ctx.createLinearGradient(0, y0, 0, y1);
            for (let i = 0; i <= 10; i++) {
                const c = A.couleurT(mix(min, max, i / 10));
                grad.addColorStop(i / 10, `rgb(${c[0]},${c[1]},${c[2]})`);
            }
            ctx.fillStyle = grad;
            ctx.fillRect(x, y0 + (y1 - y0) * (1 - p) * 0, l, (y1 - y0) * p);
            ctx.font = police(24, 500, POLICE_TEXTE); ctx.fillStyle = COULEURS.brume; ctx.textAlign = "left";
            ctx.globalAlpha = a * clamp(p * 2 - 0.5);
            const pasG = max - min > 25 ? 10 : 5;
            for (let v = min; v <= max + 0.01; v += pasG) ctx.fillText(`${fr(v)}°`, x + l + 12, yv(v) + 8);
            // Le curseur suit le maximum national du moment
            const e = m.extremes();
            const enMin = phase && phase(t) < 0.5;
            const ve = enMin ? e.min : e.max;
            const yy = yv(clamp(ve, min, max));
            ctx.globalAlpha = a * clamp(p * 2 - 0.8);
            ctx.fillStyle = COULEURS.ecume;
            ctx.beginPath(); ctx.moveTo(x - 6, yy); ctx.lineTo(x - 20, yy - 9); ctx.lineTo(x - 20, yy + 9); ctx.fill();
            ctx.textAlign = "right";
            ctx.font = police(22, 500, POLICE_TEXTE); ctx.fillStyle = COULEURS.brume;
            ctx.fillText(enMin ? "min." : "max.", x - 28, yy - 10);
            ctx.font = police(34, 600); ctx.fillStyle = COULEURS.ecume;
            ctx.fillText(`${fr(ve, 1)}°`, x - 28, yy + 22);
        }
    };
}

// Places des étiquettes : fixes par ville (la liste de villes est fixe)
const PLACE = {
    "Lille": [-22, 40], "Paris": [22, -14], "Strasbourg": [-22, -14], "Brest": [22, 96], "Nantes": [-22, -14],
    "Dijon": [22, -14], "Lyon": [22, -14], "Clermont-Ferrand": [22, -14], "Clermont": [22, -14], "Bordeaux": [-22, -14],
    "Toulouse": [22, 92], "Marseille": [-22, 94], "Nice": [22, -14], "Ajaccio": [-22, -14], "Rouen": [-22, -14]
};

function valeurVille(v, hu) {
    const s = v.t, i = Math.max(0, Math.min(s.length - 2, Math.floor(hu))), f = clamp(hu - i);
    const a = s[i], b = s[i + 1];
    if (a == null && b == null) return null;
    if (a == null) return b; if (b == null) return a;
    return a + (b - a) * f;
}

function villesTemperatures(P, { debut, fin, noms, phase }) {
    const liste = noms.map(n => P.villes.find(v => v.nom === n)).filter(Boolean);
    return {
        debut, fin,
        dessiner(m, ctx, t) {
            const hu = m.etat.heure;
            liste.forEach((v, i) => {
                const a = apparition(t, debut + i * 0.12, fin - (liste.length - i) * 0.03, 0.5, 0.35);
                // Valeurs arrondies aux deux extrémités : le compteur s'arrête toujours sur un nombre entier
                const valeur = phase ? mix(Math.round(v.tmin), Math.round(v.tmax), phase(t)) : valeurVille(v, hu);
                if (a <= 0 || valeur == null) return;
                const [x, y] = m.versImage(v.lon, v.lat);
                ctx.globalAlpha = a;
                ctx.fillStyle = COULEURS.ecume;
                ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
                const [dx, dy] = PLACE[v.nom] || [22, -14], droite = dx < 0;
                ctx.font = police(26, 500, POLICE_TEXTE);
                const ln = ctx.measureText(v.nom).width;
                ctx.font = police(54, 600);
                const lv = ctx.measureText(`${Math.round(Math.abs(valeur))}°`).width + (valeur < -0.5 ? 20 : 0);
                const larg = Math.max(ln, lv) + 28, haut = 92;
                const bx = droite ? x + dx - larg : x + dx, by = y + dy - haut + 18;
                ctx.fillStyle = "rgba(3, 20, 42, 0.66)";
                ctx.fillRect(bx, by, larg, haut);
                // Petit filet à la couleur de la température
                const c = A.couleurT(valeur);
                ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
                ctx.fillRect(droite ? bx + larg - 5 : bx, by, 5, haut);
                ctx.textAlign = "left"; ctx.font = police(26, 500, POLICE_TEXTE); ctx.fillStyle = COULEURS.brume;
                ctx.fillText(v.nom, bx + 16, by + 32);
                nombreRouleaux(ctx, valeur, bx + 16, by + 82, 54, { couleur: COULEURS.ecume });
            });
        }
    };
}

function appel({ debut, fin, lon, lat, heure, texte, dx = 60, dy = -90, couleur = COULEURS.ambre, grand = false, ancre = null }) {
    const TT0 = grand ? 54 : 44, TH = grand ? 32 : 28, HB = grand ? 130 : 106;
    return {
        debut, fin,
        dessiner(m, ctx, t) {
            const [x, y] = m.versImage(lon, lat);
            let boiteAGauche = null;
            if (ancre) { dx = ancre[0] - x; dy = ancre[1] - y; boiteAGauche = true; }
            // Le cartouche change de côté s'il sortirait de l'image
            ctx.font = police(TT0, 600);
            const largeurPrevue = ctx.measureText(texte).width + 44;
            const placeD = L - 40 - (x + Math.abs(dx)), placeG = x - Math.abs(dx) - 40;
            if (!ancre && dx > 0 && largeurPrevue > placeD && placeG > placeD) dx = -dx;
            else if (!ancre && dx < 0 && largeurPrevue > placeG && placeD > placeG) dx = -dx;
            // Texte trop long des deux côtés : la typo se réduit pour tenir
            const place = dx > 0 ? placeD : placeG;
            const TT = !ancre && largeurPrevue > place ? Math.max(32, TT0 * (place - 44) / (largeurPrevue - 44)) : TT0;
            const a = apparition(t, debut, fin, 0.4, 0.35);
            const pl = sortieExpo(prog(t, debut + 0.1, debut + 0.55));
            const pt = prog(t, debut + 0.3, debut + 0.85);
            const pulse = (t - debut) * 1.5 % 1;
            ctx.strokeStyle = couleur; ctx.lineWidth = 3;
            ctx.globalAlpha = a * (1 - pulse);
            ctx.beginPath(); ctx.arc(x, y, 8 + pulse * 30, 0, Math.PI * 2); ctx.stroke();
            ctx.globalAlpha = a;
            ctx.fillStyle = couleur;
            ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
            const ex = x + dx * 0.35, ey = y + dy, fx = x + dx, fy = y + dy;
            ctx.strokeStyle = COULEURS.ecume; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(x, y);
            const s1 = Math.min(1, pl * 2), s2 = clamp(pl * 2 - 1);
            ctx.lineTo(mix(x, ex, s1), mix(y, ey, s1));
            if (s2 > 0) ctx.lineTo(mix(ex, fx, s2), fy);
            ctx.stroke();
            const droite = boiteAGauche ?? dx < 0;
            ctx.font = police(TT, 600);
            const lt = ctx.measureText(texte).width;
            ctx.font = police(TH, 600);
            const lh = ctx.measureText(heure).width;
            const larg = Math.max(lt, lh) + 44, haut = HB;
            const bx = droite ? fx - larg : fx, by = fy - haut / 2;
            ctx.save();
            ctx.beginPath(); ctx.rect(bx, by, larg * sortieExpo(pt), haut); ctx.clip();
            ctx.fillStyle = "rgba(3, 20, 42, 0.8)"; ctx.fillRect(bx, by, larg, haut);
            ctx.fillStyle = couleur; ctx.fillRect(droite ? bx + larg - 6 : bx, by, 6, haut);
            ctx.restore();
            ligneMasquee(ctx, heure, bx + 24, by + HB * 0.36, TH, prog(t, debut + 0.4, debut + 0.9), { couleur, graisse: 600 });
            ligneMasquee(ctx, texte, bx + 24, by + HB * 0.84, TT, prog(t, debut + 0.5, debut + 1.0), { graisse: 600 });
        }
    };
}

// Le ciel des villes, au graphisme du tableau « Conditions météo » du site
function villesCiel(P, { debut, fin, bascule, noms, hMatin, hApres }) {
    const liste = noms.map(n => P.villes.find(v => v.nom === n)).filter(Boolean);
    const code = (v, hLocale) => {
        const cible = Math.round(hLocale);
        for (let d = 0; d <= 3; d++) for (const s of [cible - d, cible + d]) if (v.conditions[String(s)]) return v.conditions[String(s)];
        return null;
    };
    const vent = (v, hLocale) => {
        const s = v.vent || [], i = Math.max(0, Math.min(s.length - 1, Math.round(hLocale)));
        return s[i] || null;
    };
    return {
        debut, fin,
        dessiner(m, ctx, t) {
            liste.forEach((v, i) => {
                const a = apparition(t, debut + 0.3 + i * 0.06, fin - 0.1, 0.5, 0.4);
                if (a <= 0) return;
                const [x, y] = m.versImage(v.lon, v.lat);
                const tb = bascule + i * 0.04;
                const p = prog(t, tb - 0.3, tb + 0.3);
                const matin = code(v, hMatin), apres = code(v, hApres);
                const actuel = p < 0.5 ? matin : apres, change = matin !== apres;
                const pop = change ? (p < 0.5 ? 1 - lisse(0, 0.5, p) : lisse(0.5, 1, p)) : 1;
                const e = sortieExpo(clamp(a * 1.2)) * (change ? mix(0.6, 1, pop) : 1);
                // Symbole, avec une ombre douce comme sur le site
                ctx.save();
                ctx.globalAlpha = a * (change ? mix(0.15, 1, pop) : 1);
                ctx.shadowColor = "rgba(0, 30, 10, 0.45)"; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
                if (actuel) symbole(ctx, actuel, x, y - 4, 2.7 * e, t);
                ctx.restore();
                // Vent : flèche dans le sens où il souffle, vitesse en km/h
                const w = vent(v, p < 0.5 ? hMatin : hApres);
                if (w && w[1] >= 5) {
                    const ang = (w[0] + 180) * Math.PI / 180;            // vers où va le vent
                    const dx = Math.sin(ang), dy = -Math.cos(ang);
                    const bx = x + 58, by = y + 34;
                    ctx.save();
                    ctx.globalAlpha = a;
                    ctx.strokeStyle = "#ffffff"; ctx.fillStyle = "#ffffff"; ctx.lineWidth = 3.4; ctx.lineCap = "round";
                    ctx.shadowColor = "rgba(0, 30, 10, 0.5)"; ctx.shadowBlur = 4;
                    ctx.beginPath(); ctx.moveTo(bx - dx * 16, by - dy * 16); ctx.lineTo(bx + dx * 14, by + dy * 14); ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(bx + dx * 20, by + dy * 20);
                    ctx.lineTo(bx + dx * 8 - dy * 8, by + dy * 8 + dx * 8);
                    ctx.lineTo(bx + dx * 8 + dy * 8, by + dy * 8 - dx * 8);
                    ctx.closePath(); ctx.fill();
                    ctx.font = police(28, 700); ctx.textAlign = "left";
                    ctx.lineWidth = 5; ctx.strokeStyle = "rgba(20, 50, 20, 0.85)"; ctx.shadowBlur = 0;
                    ctx.strokeText(String(w[1]), bx + 24, by + 10); ctx.fillText(String(w[1]), bx + 24, by + 10);
                    ctx.restore();
                }
                // Nom de la ville, discret
                ctx.save();
                ctx.globalAlpha = a * 0.95;
                ctx.font = police(24, 600); ctx.textAlign = "center";
                ctx.lineWidth = 4; ctx.strokeStyle = "rgba(20, 50, 20, 0.8)"; ctx.fillStyle = "#ffffff";
                const nom = (v.nom === "Clermont-Ferrand" ? "Clermont" : v.nom).toUpperCase();
                ctx.strokeText(nom, x, y + 70); ctx.fillText(nom, x, y + 70);
                ctx.restore();
            });
        }
    };
}

// Bandeau « Matin / Après-midi » : le sélecteur qui bascule
function moments({ debut, fin, bascule, hMatin, hApres, libelles = null }) {
    return {
        debut, fin,
        dessiner(m, ctx, t) {
            ctx.globalAlpha = apparition(t, debut, fin, 0.5, 0.35);
            const x = MISE.momentsX, y = MISE.momentsY;
            ctx.font = police(42, 600);
            const [t1, t2] = libelles || [`Matin · ${HEURE(hMatin)}`, `Après-midi · ${HEURE(hApres)}`];
            const l1 = ctx.measureText(t1).width, l2 = ctx.measureText(t2).width, ecart = 46;
            const p = entreeSortie(prog(t, bascule - 0.35, bascule + 0.35));
            ctx.textAlign = "left";
            ctx.fillStyle = "rgba(3, 20, 42, 0.55)";
            ctx.fillRect(x - 20, y - 52, l1 + l2 + ecart + 40, 86);
            ctx.fillStyle = p < 0.5 ? COULEURS.ecume : "rgba(185,203,224,0.6)";
            ctx.fillText(t1, x, y);
            ctx.fillStyle = p >= 0.5 ? COULEURS.ecume : "rgba(185,203,224,0.6)";
            ctx.fillText(t2, x + l1 + ecart, y);
            ctx.fillStyle = COULEURS.ambre;
            ctx.fillRect(mix(x, x + l1 + ecart, p), y + 16, mix(l1, l2, p), 6);
        }
    };
}

// Noms de villes sur le radar, à la manière du tableau « Précipitations » du site
function villesRadar(P, { debut, fin, noms }) {
    const liste = noms.map(n => P.villes.find(v => v.nom === n)).filter(Boolean);
    return {
        debut, fin,
        dessiner(m, ctx, t) {
            ctx.globalAlpha = 0.9 * apparition(t, debut, fin, 0.6, 0.4);
            ctx.font = police(22, 600); ctx.textAlign = "left";
            for (const v of liste) {
                const [x, y] = m.versImage(v.lon, v.lat);
                ctx.fillStyle = "#ffffff";
                ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
                ctx.lineWidth = 4; ctx.strokeStyle = "rgba(10, 14, 22, 0.85)";
                const nom = (v.nom === "Clermont-Ferrand" ? "Clermont-Ferrand" : v.nom).toUpperCase();
                ctx.strokeText(nom, x + 9, y - 6); ctx.fillText(nom, x + 9, y - 6);
            }
        }
    };
}

function synthese(P, { debut, fin }) {
    const { phrases, chiffres } = P.synthese;
    const chiffre = chiffres[0];
    return {
        debut, fin,
        dessiner(m, ctx, t) {
            ctx.globalAlpha = 1 - entreeSortie(prog(t, fin - 0.5, fin));
            // Deux phrases courtes, l'une après l'autre
            let y = MISE.syntheseY;
            phrases.slice(0, 2).forEach((phrase, i) => {
                const taille = i ? 58 : 72;
                ctx.font = police(taille, i ? 500 : 600, i ? POLICE_TEXTE : POLICE_TITRE);
                couper(ctx, phrase, L - 2 * MARGE).forEach((ligne, j) => {
                    const d = debut + 0.3 + i * 0.8 + j * 0.12;
                    ligneMasquee(ctx, ligne, MARGE, y, taille, prog(t, d, d + 0.8),
                        { graisse: i ? 500 : 600, famille: i ? POLICE_TEXTE : POLICE_TITRE, couleur: i ? COULEURS.brume : COULEURS.ecume });
                    y += taille * 1.22;
                });
                y += 14;
            });
            // Un seul chiffre qui résume la journée
            if (chiffre) {
                const d = debut + 1.6, haut = Math.max(y + 60, PORTRAIT ? y + 120 : 600);
                ctx.fillStyle = COULEURS.ambre;
                ctx.fillRect(MARGE, haut, 8, 210 * sortieExpo(prog(t, d, d + 0.7)));
                ligneMasquee(ctx, chiffre.valeur, MARGE + 36, haut + 130, 150, prog(t, d + 0.1, d + 0.8), { graisse: 700 });
                ctx.font = police(38, 500, POLICE_TEXTE);
                couper(ctx, chiffre.legende, L - 2 * MARGE - 40).forEach((ligne, j) => {
                    ligneMasquee(ctx, ligne, MARGE + 40, haut + 192 + j * 46, 38, prog(t, d + 0.35 + j * 0.1, d + 1.0 + j * 0.1),
                        { graisse: 500, famille: POLICE_TEXTE, couleur: COULEURS.brume });
                });
            }
        }
    };
}

// Isobares en fond, de la synthèse jusqu'à la signature (sans se redessiner)
function fondIsobares({ debut, fin }) {
    return {
        debut, fin,
        dessiner(m, ctx, t) {
            isobares(ctx, t, debut, sortieExpo(prog(t, debut, debut + 1.2)), prog(t, debut, fin) * 0.4, 3.4, 0.5);
        }
    };
}

// Signature : la marque du chargement, jauge pleine
function signature(P, { debut, fin }) {
    return {
        debut, fin,
        dessiner(m, ctx, t) {
            const cx = L / 2;
            const y = MISE.signatureY;
            const { largeur } = marque(ctx, cx, y, 112, prog(t, debut + 0.35, debut + 1.2));
            const lj = Math.min(Math.max(largeur, 820), L - 2 * MARGE);
            ctx.fillStyle = COULEURS.ambre;
            const p = entreeSortie(prog(t, debut, debut + 0.6));
            ctx.fillRect(cx - lj / 2 * p, y + 42, lj * p, 5);
            ligneMasquee(ctx, `Résumé du ${P.date_courte}`, cx, y + 120, 40, prog(t, debut + 0.6, debut + 1.2),
                { graisse: 500, famille: POLICE_TEXTE, couleur: COULEURS.brume, align: "center" });
            ctx.globalAlpha = 0.8 * sortieExpo(prog(t, debut + 0.8, debut + 1.4));
            ctx.font = police(22, 500, POLICE_TEXTE); ctx.fillStyle = COULEURS.brume; ctx.textAlign = "center";
            const lignes = couper(ctx, P.sources, L - 2 * MARGE);
            lignes.forEach((ligne, i) => ctx.fillText(ligne, cx, H - 60 - (lignes.length - 1 - i) * 30));
        }
    };
}

function mention({ debut, fin, texte }) {
    return {
        debut, fin,
        dessiner(m, ctx, t) {
            ctx.globalAlpha = 0.75 * apparition(t, debut, fin, 0.6, 0.4);
            ctx.font = police(22, 500, POLICE_TEXTE); ctx.fillStyle = COULEURS.brume; ctx.textAlign = "right";
            ctx.fillText(texte, L - MARGE, H - 46);
        }
    };
}

// ---------------------------------------------------------------------------
// Palettes des tableaux (raccord avec le site)
// ---------------------------------------------------------------------------

const hex = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const melange = (a, b, f) => { const x = hex(a), y = hex(b); return `rgb(${x.map((v, i) => Math.round(mix(v, y[i], f))).join(",")})`; };

// ---------------------------------------------------------------------------
// Construction du film à partir de la partition
// ---------------------------------------------------------------------------

// Radar OPERA : une image colorée par pas de 15 min, posée en bandes de latitude
// (grille régulière en degrés -> carte Mercator), nette, fondu enchaîné entre pas
async function calqueRadar(R) {
    if (!R) return null;
    const octets = await decoder(R);
    const { nx, ny, heures: hs } = R;
    const COUL = ["#a5d8f3", "#6fb7ea", "#3f8fd8", "#2a63c0", "#3aa655", "#9fce3f", "#f3e03b", "#f4a12a", "#e8502a", "#b3207a"].map(hex);
    const lut = new Uint8ClampedArray(256 * 4);
    for (let v = 0; v < 256; v++) {
        const mm = Math.pow(2, v / 40) - 1;
        if (mm < 0.15) continue;
        let k = 0;
        while (k < 9 && mm >= A.SEUILS_PLUIE[k + 1]) k++;
        lut.set([...COUL[k], 238], v * 4);
    }
    const images = hs.map((_, f) => {
        const c = document.createElement("canvas"); c.width = nx; c.height = ny;
        const ctx = c.getContext("2d"), img = ctx.createImageData(nx, ny), d = img.data;
        const base = f * nx * ny;
        for (let i = 0; i < nx * ny; i++) { const q = octets[base + i] * 4; d[i * 4] = lut[q]; d[i * 4 + 1] = lut[q + 1]; d[i * 4 + 2] = lut[q + 2]; d[i * 4 + 3] = lut[q + 3]; }
        ctx.putImageData(img, 0, 0);
        return c;
    });
    const NB = 64, bandes = [];
    const [x0] = A.proj(R.ouest, 46), [x1] = A.proj(R.est, 46);
    for (let b = 0; b < NB; b++) {
        const r0 = Math.round(b * ny / NB), r1 = Math.round((b + 1) * ny / NB);
        const y0 = A.proj(0, R.nord - r0 * R.pas)[1], y1 = A.proj(0, R.nord - r1 * R.pas)[1];
        bandes.push([r0, r1 - r0, y0, y1 - y0]);
    }
    const poser = (c, img) => { for (const [r, n, y, hgt] of bandes) c.drawImage(img, 0, r, nx, n, x0, y, x1 - x0, hgt + 0.3); };
    return {
        debut: hs[0], fin: hs[hs.length - 1],
        dessiner(c, hu) {
            const f = clamp((hu - hs[0]) / (hs[hs.length - 1] - hs[0])) * (hs.length - 1);
            const a = Math.floor(f), b = Math.min(hs.length - 1, a + 1), x = f - a;
            c.imageSmoothingEnabled = true;
            const g = c.globalAlpha;
            poser(c, images[a]);
            if (x > 0.01 && b !== a) { c.globalAlpha = g * x; poser(c, images[b]); c.globalAlpha = g; }
        }
    };
}

// Décodages coûteux (images des champs, calque radar) gardés par partition :
// changer d'orientation reconstruit le film sans tout redécoder.
const DECODAGES = new WeakMap();

async function construireFilm(P, options = {}) {
    reglerFormat(options.portrait, options.hauteur);
    if (!DECODAGES.has(P)) DECODAGES.set(P, Promise.all([decoder(P.temperatures), calqueRadar(P.radar)]));
    const [oT, radar] = await DECODAGES.get(P);
    const champT = echantillonneur(P.temperatures, oT, TABLE_T);
    const temperature = (lo, la, h) => champT(lo, la, h);

    const tx = P.evenements.find(e => e.type === "tx"), tn = P.evenements.find(e => e.type === "tn");
    const bas = Math.floor(Math.min(...P.villes.map(v => v.tmin), tn ? tn.valeur : 99) / 5) * 5;
    const haut = Math.ceil(Math.max(...P.villes.map(v => v.tmax), tx ? tx.valeur : -99) / 5) * 5;

    const [, , [T0, T1], [R0, R1], [C0, C1], [S0, S1]] = ACTES.map(a => [a.debut, a.fin]);

    // Températures : les minimales du matin, puis les maximales de l'après-midi
    const hMin = 7, hMax = 15, tBascule = (T0 + T1) / 2;
    const phaseT = t => entreeSortie(prog(t, tBascule - 0.9, tBascule + 0.9));
    const heureT = t => mix(hMin, hMax, phaseT(t));

    // Radar : fenêtre choisie par la chaîne, à vitesse constante (1 h par seconde environ)
    const hR0 = radar ? radar.debut : 0, hR1 = radar ? radar.fin : 24;
    const rA = R0 + 0.3, rB = R1 - 0.2;
    const heureR = t => mix(hR0, hR1, prog(t, rA, rB));
    const tDeR = h => rA + (h - hR0) / (hR1 - hR0) * (rB - rA);

    const bascule = (C0 + C1) / 2 + 0.2, hMatin = 9, hApres = 15;
    const heureC = t => mix(hMatin, hApres, entreeSortie(prog(t, C0 + 0.5, C1 - 0.6)));
    const { lever, coucher } = P.soleil;
    const jourLumiere = h => Math.sqrt(Math.max(0, Math.sin(Math.PI * clamp((h - lever) / (coucher - lever)))));

    const cible = tx || { lon: 2.4, lat: 46.4 };
    const lonT = mix(2.4, cible.lon, 0.2);
    const wCiel = t => lisse(R1 - 0.5, R1 + 0.5, t);
    const mixRgb = (a, b, f) => {
        const pa = a.match(/\d+/g).map(Number), pb = b.match(/\d+/g).map(Number);
        return `rgb(${pa.map((v, i) => Math.round(mix(v, pb[i], f))).join(",")})`;
    };

    // Caméras : paysage (carte à droite du titre, puis plein cadre) ou portrait
    // (carte sous le titre, puis France agrandie sur toute la largeur)
    const camera = PORTRAIT ? (() => {
        const zTitre = clamp((H - 720) / 1000, 0.62, 0.95), fyTitre = 720 + (H - 720) / 2;
        const zCarte = clamp((H - 560) / 1080, 0.85, 1.14), fyCarte = H / 2 + 30;
        return t => ({
            lon: piste(t, [[0, 2.2], [T0, 2.2], [T1 - 2, mix(2.2, cible.lon, 0.15)], [T1 + 0.4, 2.2], [40, 2.2]]),
            lat: piste(t, [[0, 46.2], [40, 46.2]]),
            z: piste(t, [[0, zTitre], [11.4, zTitre], [T0 + 0.6, zCarte], [T1 - 2, zCarte * 1.04], [T1 + 0.4, zCarte], [40, zCarte]]),
            fx: L / 2,
            fy: piste(t, [[0, fyTitre], [11.4, fyTitre], [T0 + 0.6, fyCarte], [40, fyCarte]])
        });
    })() : t => ({
        lon: piste(t, [[0, 2.4], [T0, 2.4], [T1 - 2, lonT], [T1 + 0.4, 2.4], [40, 2.4]]),
        lat: piste(t, [[0, 46.4], [40, 46.4]]),
        z: piste(t, [[0, 0.86], [11.4, 0.86], [T0 + 0.6, 1.0], [T0 + 0.61, 1.0], [T1 - 2, 1.05], [T1 + 0.4, 1.0], [40, 1.0]]),
        fx: piste(t, [[0, 960], [5.6, 960], [6.6, 1500], [11.4, 1500], [T0 + 0.6, 1100], [40, 1100]])
    });

    const etat = t => {
        const h = t < T1 ? heureT(t) : t < R1 ? heureR(t) : heureC(t);
        const wc = wCiel(t), lum = jourLumiere(h);
        // Conditions : vert et bleu du site, un peu assombris, plus lumineux vers midi
        const terreCiel = melange("#2c5524", "#74b33e", lum), merCiel = melange("#122247", "#285a99", lum), voisinsCiel = melange("#1f3c69", "#4f7cb0", lum);
        return {
            heure: h,
            camera: camera(t),
            carte: piste(t, [[0, 0], [T0 - 0.6, 0], [T0 + 0.4, 1], [C1 - 0.2, 1], [C1 + 0.6, 0]]),
            temperature: piste(t, [[0, 1], [T1 - 0.4, 1], [T1 + 0.5, 0]]),
            radar: piste(t, [[T1 - 0.3, 0], [T1 + 0.5, 1], [R1 - 0.4, 1], [R1 + 0.4, 0]]),
            terre: mixRgb("rgb(23,49,82)", terreCiel, wc),
            voisins: mixRgb("rgb(16,42,76)", voisinsCiel, wc),
            mer: merCiel, merForce: wc,
            frontieres: wc > 0.5 ? "#dfe9f5" : "#b9cbe0",
            traitDepartements: wc > 0.5 ? "#0e2a0e" : "#ffffff",
            departements: mix(0.12, 0.28, wc),
            nuit: lisse(T1 - 0.4, T1 + 0.6, t),
            voile: 0
        };
    };

    const villesT = ["Paris", "Brest", "Strasbourg", "Clermont-Ferrand", "Bordeaux", "Marseille", "Ajaccio"];
    const villesC = ["Lille", "Paris", "Strasbourg", "Brest", "Nantes", "Dijon", "Lyon", "Bordeaux", "Toulouse", "Marseille", "Nice", "Ajaccio"];

    const elements = [
        ouverture(P),
        carteTrait({ debut: 6.0, fin: T0 + 0.2 }),
        titre(P, { debut: 6.4, fin: T0 - 0.3 }),
        sequence({ debut: T0 + 0.2, fin: T1 - 0.1, nom: "Températures", detail: "minimales du matin, puis maximales de l'après-midi" }),
        horloge(P, { debut: T0 + 0.2, fin: C1 - 0.2 }),
        echelle({ debut: T0 + 0.5, fin: T1 - 0.1, min: bas, max: haut, phase: phaseT }),
        villesTemperatures(P, { debut: T0 + 1.0, fin: T1 - 0.15, noms: villesT, phase: phaseT }),
        moments({ debut: T0 + 0.6, fin: T1 - 0.1, bascule: tBascule, hMatin: hMin, hApres: hMax, libelles: ["Minimales", "Maximales"] }),
        sequence({ debut: R0 + 0.2, fin: R1 - 0.1, nom: "Précipitations", detail: radar ? `radars européens OPERA, de ${HEURE(Math.round(hR0 * 4) / 4)} à ${HEURE(Math.round(hR1 * 4) / 4 % 24)}` : "radar" }),
        villesRadar(P, { debut: R0 + 0.3, fin: R1 - 0.1, noms: ["Lille", "Paris", "Strasbourg", "Brest", "Nantes", "Lyon", "Bordeaux", "Toulouse", "Marseille", "Nice", "Ajaccio"] }),
        sequence({ debut: C0 + 0.2, fin: C1 - 0.1, nom: "Conditions météo", detail: "dans les grandes villes" }),
        villesCiel(P, { debut: C0, fin: C1, bascule, hMatin, hApres, noms: villesC }),
        moments({ debut: C0 + 0.4, fin: C1 - 0.1, bascule, hMatin, hApres, libelles: ["Matin", "Après-midi"] }),
        fondIsobares({ debut: S0 + 1.3, fin: 40 }),
        synthese(P, { debut: S0 + 0.2, fin: S1 }),
        signature(P, { debut: S1, fin: 40 }),
        // (portrait : la place manque, la mention reste dans la page)
        ...(PORTRAIT ? [] : [mention({ debut: T0 + 0.5, fin: C1 - 0.2, texte: "Film généré automatiquement à partir des mesures du jour" })])
    ];

    // Minimale nationale pendant les minimales, maximale pendant les maximales
    const placer = e => ({ dx: e.lat < 44.5 ? 150 : (e.lon > 3 ? -330 : 330), dy: e.lat < 44.5 ? -120 : 150 });
    if (tn) elements.push(appel({ debut: T0 + 1.8, fin: tBascule - 0.8, lon: tn.lon, lat: tn.lat, heure: `${HEURE(tn.heure)} · minimale`,
        texte: `${fr(tn.valeur, 1)}${NBSP}°C à ${tn.lieu}`, couleur: COULEURS.froid, ...placer(tn) }));
    if (tx) elements.push(appel({ debut: tBascule + 1.1, fin: T1 - 0.2, lon: tx.lon, lat: tx.lat, heure: `${HEURE(tx.heure)} · maximale`,
        texte: `${fr(tx.valeur, 1)}${NBSP}°C à ${tx.lieu}`, couleur: COULEURS.chaud, ...placer(tx) }));

    // Radar : les événements de sa fenêtre, à leur heure, tenus 2,8 s
    (P.evenements_radar || []).forEach(ev => {
        const debut = clamp(tDeR(ev.heure) - 0.3, R0 + 0.4, R1 - 3.0);
        const texte = ev.type === "rafale" ? `Rafale à ${fr(ev.valeur)}${NBSP}km/h à ${ev.lieu}` : `${fr(ev.valeur, 1)}${NBSP}mm en 1${NBSP}h à ${ev.lieu}`;
        elements.push(appel({ debut, fin: Math.min(debut + 2.8, R1 - 0.05), lon: ev.lon, lat: ev.lat, grand: true,
            heure: `${HEURE(ev.heure)} · ${ev.type === "rafale" ? "vent le plus fort" : "pluie la plus forte"}`, texte,
            dx: ev.lon > 3 ? -170 : 170, dy: ev.lat < 44 ? -190 : (ev.lat > 49 ? 190 : -190) }));
    });

    // Conditions : une seule info clé (rafale, neige ou ensoleillement selon la journée)
    const ic = P.info_ciel;
    if (ic) {
        const libelle = { rafale: "vent le plus fort", neige: "neige", soleil: "le plus ensoleillé" }[ic.type] || "";
        elements.push(appel({ debut: C0 + 1.2, fin: C1 - 0.3, lon: ic.lon, lat: ic.lat,
            heure: ic.heure != null ? `${HEURE(ic.heure)} · ${libelle}` : `Sur la journée · ${libelle}`, texte: ic.texte,
            ancre: MISE.ancreCiel }));
    }

    return {
        format: { L, H, portrait: PORTRAIT },
        id: P.jour, titre: P.titre, date: P.date_longue, soleil: P.soleil, accent: COULEURS.ambre,
        temperature, etat, elements, actes: ACTES,
        radarCalque: radar ? (c, h) => radar.dessiner(c, h) : null
    };
}

window.HKOResume = { construireFilm, ACTES, DUREE: 40 };
})();
