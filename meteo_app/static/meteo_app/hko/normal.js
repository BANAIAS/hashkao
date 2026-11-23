/* ==========================================================================
   HKO Météo — rubrique « Est-ce normal ? »

   Replace la température d'un jour à Paris-Montsouris dans la série
   historique de la station. Les données viennent de /meteo/api/normal/ ;
   le navigateur ne fait que trier, compter et mettre en forme.

   Verdict : on compte la part des années (même date, depuis 1900) plus
   froides que la mesure.
     - « normal »                      : entre 20 % et 80 %
     - « plus froid / plus doux »      : entre 5 % et 20 %, ou 80 % et 95 %
     - « exceptionnellement »          : au-delà
     - « record »                      : hors de toutes les valeurs connues
   Une ligne s'ajoute quand les 30 années précédentes disent autre chose.
   ========================================================================== */

(() => {
"use strict";

const racine = document.getElementById("normal");
const URL_API = racine.dataset.api;
const $ = id => document.getElementById(id);

const COULEURS = { xf: "#3d8ee0", f: "#8cc1f0", n: "#6f86a3", c: "#f2a07e", xc: "#ec6640" };
const AMBRE = "#ffb81c", NUIT = "#06203f", ECUME = "#f3f7fb";

const etat = { jour: null, mode: "chaud", donnees: null, cache: new Map() };

// --- Mise en forme ---------------------------------------------------------

const nombre = (v, decimales = 1) => Number(v).toLocaleString("fr-FR", {
    minimumFractionDigits: decimales, maximumFractionDigits: decimales
}).replace("-", "−");

const degres = (v, decimales = 1) => `${nombre(v, decimales)} °C`;

const ecartSigne = v => `${v > 0 ? "+" : v < 0 ? "−" : ""}${nombre(Math.abs(v))} °C`;

const ordinal = n => n === 1 ? "1er" : `${n}e`;

function dateUtc(jour) {
    const [a, m, j] = jour.split("-").map(Number);
    return new Date(Date.UTC(a, m - 1, j));
}

function jourMois(jour) {
    const d = dateUtc(jour);
    const mois = new Intl.DateTimeFormat("fr-FR", { month: "long", timeZone: "UTC" }).format(d);
    const j = d.getUTCDate();
    return `${j === 1 ? "1er" : j} ${mois}`;
}

function jourComplet(jour) {
    const d = dateUtc(jour);
    const semaine = new Intl.DateTimeFormat("fr-FR", { weekday: "long", timeZone: "UTC" }).format(d);
    return `${semaine.charAt(0).toUpperCase()}${semaine.slice(1)} ${jourMois(jour)} ${d.getUTCFullYear()}`;
}

function jourCourt(jour) {
    const d = dateUtc(jour);
    const mois = new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" }).format(d);
    const j = d.getUTCDate();
    return `${j === 1 ? "1er" : j} ${mois}`;
}

function decaler(jour, pas) {
    const d = dateUtc(jour);
    d.setUTCDate(d.getUTCDate() + pas);
    return d.toISOString().slice(0, 10);
}

function echapper(texte) {
    return String(texte ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

// --- Bulle -----------------------------------------------------------------

function montrerBulle(evenement, html) {
    const bulle = $("n-bulle");
    bulle.innerHTML = html;
    bulle.hidden = false;

    const largeur = bulle.offsetWidth;
    let x = evenement.clientX + 14, y = evenement.clientY - bulle.offsetHeight - 12;
    if (x + largeur > window.innerWidth - 8) x = evenement.clientX - largeur - 14;
    if (y < 8) y = evenement.clientY + 18;

    bulle.style.left = `${Math.max(8, x)}px`;
    bulle.style.top = `${y}px`;
}

const cacherBulle = () => { $("n-bulle").hidden = true; };

// --- Analyse ---------------------------------------------------------------

/*
 Prépare la série du mode affiché. L'année du jour étudié est retirée des
 archives quand on a la mesure, pour ne pas compter deux fois la journée.
*/
function analyser(d, bloc) {
    const anneeJour = dateUtc(etat.jour).getUTCFullYear();
    const mesure = bloc.mesure ?? null;
    const aMesure = mesure !== null;

    const autres = bloc.annees.filter(a => !(aMesure && a.annee === anneeJour));
    const valeurs = autres.map(a => a.temperature).sort((a, b) => a - b);

    const quantiles = {
        p5: d3.quantileSorted(valeurs, 0.05),
        p20: d3.quantileSorted(valeurs, 0.2),
        p80: d3.quantileSorted(valeurs, 0.8),
        p95: d3.quantileSorted(valeurs, 0.95)
    };

    const plusHaut = autres.reduce((m, a) => (a.temperature > m.temperature ? a : m), autres[0]);
    const plusBas = autres.reduce((m, a) => (a.temperature < m.temperature ? a : m), autres[0]);

    const resultat = {
        anneeJour, mesure, aMesure, autres, valeurs, quantiles,
        plusHaut, plusBas,
        normale: bloc.normale ?? bloc.mediane,
        premiere: autres.length ? autres[0].annee : bloc.premiere_annee,
        derniere: autres.length ? autres.at(-1).annee : bloc.derniere_annee
    };

    if (aMesure) {
        resultat.position = situer(mesure, autres);
        resultat.classe = classer(resultat.position.part, mesure, plusHaut, plusBas);

        // Les 30 années qui précèdent le jour étudié
        const recentes = autres.filter(a => a.annee < anneeJour && a.annee >= anneeJour - 30);
        if (recentes.length >= 20) {
            resultat.recentes = situer(mesure, recentes);
            resultat.classeRecente = classer(resultat.recentes.part);
        }
    }

    return resultat;
}

function situer(valeur, annees) {
    let plusFroides = 0, plusChaudes = 0;
    for (const a of annees) {
        if (a.temperature < valeur) plusFroides++;
        else if (a.temperature > valeur) plusChaudes++;
    }
    const total = annees.length;
    const egales = total - plusFroides - plusChaudes;

    return {
        plusFroides, plusChaudes, total,
        // Les ex æquo comptent pour moitié
        part: total ? 100 * (plusFroides + egales / 2) / total : 50
    };
}

function classer(part, valeur = null, plusHaut = null, plusBas = null) {
    if (valeur !== null && plusHaut && valeur > plusHaut.temperature) return "record-haut";
    if (valeur !== null && plusBas && valeur < plusBas.temperature) return "record-bas";
    if (part >= 95) return "xc";
    if (part >= 80) return "c";
    if (part > 20) return "n";
    if (part > 5) return "f";
    return "xf";
}

// Zone d'une valeur dans la répartition (couleur des points)
function zone(t, q) {
    if (t < q.p5) return "xf";
    if (t < q.p20) return "f";
    if (t <= q.p80) return "n";
    if (t <= q.p95) return "c";
    return "xc";
}

function mots(normale) {
    return {
        doux: normale >= 20 ? "chaud" : "doux",
        frais: normale <= 8 ? "froid" : "frais"
    };
}

function verdict(classe, normale) {
    const { doux, frais } = mots(normale);
    return {
        "record-haut": `Record : jamais aussi ${doux === "doux" ? "doux" : "chaud"} à cette date.`,
        "record-bas": "Record : jamais aussi froid à cette date.",
        xc: `Exceptionnellement ${doux}.`,
        c: `Plus ${doux} que d'habitude.`,
        n: "Oui, c'est normal.",
        f: `Plus ${frais} que d'habitude.`,
        xf: `Exceptionnellement ${frais}.`
    }[classe];
}

function adjectif(classe, normale) {
    const { doux, frais } = mots(normale);
    const fem = { doux: "douce", chaud: "chaude", frais: "fraîche", froid: "froide" };
    return {
        xc: `exceptionnellement ${fem[doux]}`,
        c: `plutôt ${fem[doux]}`,
        n: "dans la normale",
        f: `plutôt ${fem[frais]}`,
        xf: `exceptionnellement ${fem[frais]}`
    }[classe];
}

const versCote = c => (c === "record-haut" ? "xc" : c === "record-bas" ? "xf" : c);

// --- Bandeau ---------------------------------------------------------------

function ecrireBandeau(d, bloc, a) {
    $("n-quoi").textContent = etat.mode === "chaud" ? "Au plus chaud de la journée" : "Au plus froid de la journée";

    const statut = $("n-statut");
    statut.hidden = true;
    statut.removeAttribute("title");

    if (!a.aMesure) {
        $("n-valeur").textContent = "—";
        $("n-quoi").textContent = etat.jour > d.aujourdhui ? "Jour à venir" : "Pas de mesure ce jour";
        return;
    }

    $("n-valeur").textContent = degres(a.mesure);

    if (d.mesure.en_cours) {
        statut.textContent = "Provisoire";
        statut.hidden = false;
    } else if (d.mesure.couverture < 0.8) {
        statut.textContent = "Incomplète";
        statut.title = `${Math.round(d.mesure.couverture * 100)} % des mesures de la journée`;
        statut.hidden = false;
    }
}

// --- Rubrique 1 : la réponse -----------------------------------------------

function ecrireReponse(d, bloc, a) {
    const nomJour = jourMois(etat.jour);
    const note = $("n-note");
    note.hidden = true;

    if (!a.aMesure) {
        $("n-verdict").textContent = etat.jour > d.aujourdhui
            ? "Ce jour n'est pas encore arrivé."
            : "Pas de mesure ce jour-là.";

        $("n-explication").textContent =
            `Voici ce que disent les archives : depuis ${a.premiere}, les ${nomJour} ont varié de ` +
            `${degres(a.plusBas.temperature)} (${a.plusBas.annee}) à ${degres(a.plusHaut.temperature)} ` +
            `(${a.plusHaut.annee})` +
            (bloc.normale !== null ? `, pour une normale de ${degres(bloc.normale)}.` : ".");
        return;
    }

    const p = a.position;
    $("n-verdict").textContent = verdict(a.classe, a.normale);

    let suite = "";
    if (a.classe === "n") {
        suite = p.part >= 40 && p.part <= 60 ? " : la journée se place au milieu" : " : la journée reste dans la moyenne";
    }

    const phrases = [
        `Depuis ${a.premiere}, la station a connu ${p.total} journées du ${nomJour}.`,
        p.plusFroides === 0
            ? `Aucune n'a été plus froide.`
            : p.plusChaudes === 0
                ? `Aucune n'a été plus chaude.`
                : `${p.plusFroides} ${p.plusFroides > 1 ? "ont été plus froides" : "a été plus froide"}, ` +
                  `${p.plusChaudes} plus ${p.plusChaudes > 1 ? "chaudes" : "chaude"}${suite}.`
    ];

    if (a.classe === "record-haut") {
        phrases.push(`Le précédent record était de ${degres(a.plusHaut.temperature)}, en ${a.plusHaut.annee}.`);
    } else if (a.classe === "record-bas") {
        phrases.push(`Le précédent record était de ${degres(a.plusBas.temperature)}, en ${a.plusBas.annee}.`);
    }

    if (bloc.ecart_normale !== null && bloc.normale !== null) {
        const ecart = a.mesure - bloc.normale;
        const periode = bloc.normale_periode.replace("-", "–");

        if (Math.abs(ecart) < 0.05) {
            phrases.push(`C'est exactement la normale ${periode}.`);
        } else {
            phrases.push(`C'est ${nombre(Math.abs(ecart))} °C de ${ecart > 0 ? "plus" : "moins"} que la ` +
                `normale ${periode} (${degres(bloc.normale)})` +
                (a.classe === "n" ? ", un écart courant à cette saison." : "."));
        }
    }

    $("n-explication").textContent = phrases.join(" ");

    // Les 30 dernières années disent-elles autre chose ?
    if (a.classeRecente && a.classeRecente !== versCote(a.classe)) {
        const r = a.recentes;
        const cote = a.classeRecente;
        let detail;

        if (cote === "xf" || cote === "f") {
            detail = `${r.plusChaudes} de ces ${r.total} années ont été plus chaudes`;
        } else if (cote === "xc" || cote === "c") {
            detail = `${r.plusFroides} de ces ${r.total} années ont été plus froides`;
        } else {
            detail = `${r.plusFroides} de ces ${r.total} années ont été plus froides, ${r.plusChaudes} plus chaudes`;
        }

        note.textContent = `Par rapport aux 30 dernières années seulement, la journée est ` +
            `${adjectif(cote, a.normale)} : ${detail}.`;
        note.hidden = false;
    }
}

// Bande des années : chaque point est une année, rangée par température.
function dessinerRepartition(bloc, a) {
    const conteneur = $("g-repartition");
    const largeur = Math.max(300, conteneur.clientWidth);
    const etroit = largeur < 560;

    const toutes = a.aMesure ? [...a.valeurs, a.mesure] : a.valeurs;
    const mini = Math.floor(d3.min(toutes)) - 1, maxi = Math.ceil(d3.max(toutes)) + 1;
    const pasBac = etroit ? 1 : 0.5;

    const marge = { haut: 34, droite: 6, gauche: 6 };
    const x = d3.scaleLinear().domain([mini, maxi]).range([marge.gauche, largeur - marge.droite]);

    // Empilement
    const piles = new Map();
    const points = [...a.autres].sort((p, q) => p.temperature - q.temperature || p.annee - q.annee).map(an => {
        const bac = Math.floor(an.temperature / pasBac) * pasBac + pasBac / 2;
        const rang = piles.get(bac) || 0;
        piles.set(bac, rang + 1);
        return { ...an, bac, rang };
    });

    const plusHaute = d3.max(piles.values()) || 1;
    const largeurBac = x(mini + pasBac) - x(mini);
    let rayon = Math.min(etroit ? 4 : 6, largeurBac * 0.42);
    let pas = rayon * 2.2;
    const hauteurMax = etroit ? 170 : 230;
    if (plusHaute * pas > hauteurMax) {
        pas = hauteurMax / plusHaute;
        rayon = Math.max(2, pas / 2.2);
    }

    const base = marge.haut + plusHaute * pas + 12;
    const hauteur = base + (etroit ? 110 : 78);

    conteneur.innerHTML = "";
    const svg = d3.select(conteneur).append("svg")
        .attr("viewBox", `0 0 ${largeur} ${hauteur}`)
        .attr("role", "img")
        .attr("aria-label", a.aMesure
            ? `Les ${a.autres.length} ${jourMois(etat.jour)} depuis ${a.premiere}, du plus froid au plus chaud. ` +
              `La mesure du jour, ${degres(a.mesure)}, est plus chaude que ${a.position.plusFroides} d'entre eux.`
            : `Les ${a.autres.length} ${jourMois(etat.jour)} depuis ${a.premiere}, du plus froid au plus chaud.`);

    // Zones
    const q = a.quantiles;
    const zones = [
        ["xf", mini, q.p5, "Exceptionnel", "Exc."],
        ["f", q.p5, q.p20, "Plus froid que d'habitude", "Plus froid"],
        ["n", q.p20, q.p80, "Normal", "Normal"],
        ["c", q.p80, q.p95, "Plus doux que d'habitude", "Plus doux"],
        ["xc", q.p95, maxi, "Exceptionnel", "Exc."]
    ];

    for (const [cle, de, a2, long, court] of zones) {
        const x0 = x(Math.max(mini, de)), x1 = x(Math.min(maxi, a2));
        if (x1 <= x0) continue;

        svg.append("rect")
            .attr("x", x0).attr("y", marge.haut).attr("width", x1 - x0).attr("height", base - marge.haut)
            .attr("fill", COULEURS[cle]).attr("fill-opacity", cle === "n" ? 0.12 : 0.06);

        const place = x1 - x0;
        const texte = place >= long.length * 6.6 + 8 ? long : place >= court.length * 6.6 + 6 ? court : null;
        if (texte) {
            svg.append("text").attr("class", `zone-nom${cle === "n" ? " normal" : ""}`)
                .attr("x", (x0 + x1) / 2).attr("y", marge.haut - 12)
                .attr("text-anchor", "middle").text(texte);
        }
    }

    // Points
    svg.append("g").selectAll("circle").data(points).join("circle")
        .attr("class", "survol")
        .attr("cx", p => x(p.bac))
        .attr("cy", p => base - rayon - 2 - p.rang * pas)
        .attr("r", rayon)
        .attr("fill", p => COULEURS[zone(p.temperature, q)])
        .attr("stroke", NUIT).attr("stroke-width", 1)
        .on("pointermove", (e, p) => montrerBulle(e,
            `<span>${jourMois(etat.jour)} ${p.annee}</span><b>${degres(p.temperature)}</b>`))
        .on("pointerleave", cacherBulle);

    // Axe
    svg.append("line").attr("x1", marge.gauche).attr("x2", largeur - marge.droite)
        .attr("y1", base).attr("y2", base).attr("stroke", "rgba(255,255,255,0.14)");

    const pasGraduation = etroit ? 4 : 2;
    svg.append("g").attr("class", "axe").selectAll("text")
        .data(d3.range(Math.ceil(mini / pasGraduation) * pasGraduation, maxi + 0.01, pasGraduation))
        .join("text")
        .attr("x", t => x(t)).attr("y", base + 18).attr("text-anchor", "middle")
        .text(t => `${nombre(t, 0)} °`);

    // Normale
    const xn = x(a.normale);
    svg.append("line").attr("class", "repere")
        .attr("x1", xn).attr("x2", xn).attr("y1", marge.haut).attr("y2", base);

    // Mesure du jour
    let occupe = [];
    const largeurEtiquette = 130;
    const y1 = base + 46, y2 = base + 66;

    function etiquette(xa, ancre, ligne1, ligne2, classe = "forte") {
        svg.append("text").attr("class", `etiquette ${classe}`)
            .attr("x", xa).attr("y", y1).attr("text-anchor", ancre).text(ligne1);
        svg.append("text").attr("class", "etiquette")
            .attr("x", xa).attr("y", y2).attr("text-anchor", ancre).text(ligne2);
    }

    const etendue = (xa, ancre) => ancre === "end" ? [xa - largeurEtiquette, xa] : [xa, xa + largeurEtiquette];
    const chevauche = ([g, d]) => occupe.some(([g2, d2]) => g < d2 + 10 && d > g2 - 10);

    const nomNormale = bloc.normale !== null ? `Normale ${degres(a.normale)}` : `Médiane ${degres(a.normale)}`;
    const detailNormale = bloc.normale !== null ? `moyenne ${bloc.normale_periode.replace("-", "–")}` : `depuis ${a.premiere}`;

    if (a.aMesure) {
        const xm = x(a.mesure);
        svg.append("line").attr("class", "jour-j")
            .attr("x1", xm).attr("x2", xm).attr("y1", marge.haut - 4).attr("y2", base + 26);
        svg.append("circle").attr("class", "jour-j-point").attr("cx", xm).attr("cy", base).attr("r", rayon + 3);

        // L'étiquette du jour se place du côté opposé à la normale, sans sortir du cadre
        let mesureAGauche = a.mesure <= a.normale;
        if (!mesureAGauche && xm + 8 + largeurEtiquette > largeur) mesureAGauche = true;
        if (mesureAGauche && xm - 8 - largeurEtiquette < 0) mesureAGauche = false;
        const ancreJour = mesureAGauche ? "end" : "start";
        const xj = xm + (mesureAGauche ? -8 : 8);
        const nomJour = etat.jour === etat.donnees.aujourdhui ? "Aujourd'hui" : String(a.anneeJour);

        etiquette(xj, ancreJour, `${nomJour} ${degres(a.mesure)}`,
            etat.donnees.mesure.en_cours ? "provisoire" : (etat.mode === "chaud" ? "au plus chaud" : "au plus froid"), "jour");
        occupe.push(etendue(xj, ancreJour));

        if (!etroit) {
            for (const ancreN of [mesureAGauche ? "start" : "end", mesureAGauche ? "end" : "start"]) {
                const xnn = xn + (ancreN === "start" ? 8 : -8);
                const place = etendue(xnn, ancreN);
                if (place[0] < 0 || place[1] > largeur || chevauche(place)) continue;
                etiquette(xnn, ancreN, nomNormale, detailNormale);
                occupe.push(place);
                break;
            }
        }
    } else if (!etroit) {
        etiquette(xn + 8, "start", nomNormale, detailNormale);
        occupe.push(etendue(xn + 8, "start"));
    }

    // Valeurs extrêmes, si la place le permet
    const motHaut = etat.mode === "chaud" ? "le plus chaud" : "le plus doux";
    const xb = x(a.plusBas.temperature), xh = x(a.plusHaut.temperature);

    if (!etroit) {
        const eb = [Math.max(marge.gauche, xb - 4), Math.max(marge.gauche, xb - 4) + largeurEtiquette];
        if (!chevauche(eb)) etiquette(eb[0], "start", degres(a.plusBas.temperature), `en ${a.plusBas.annee}, le plus froid`);

        const eh = [Math.min(largeur - marge.droite, xh + 4) - largeurEtiquette, Math.min(largeur - marge.droite, xh + 4)];
        if (!chevauche(eh)) etiquette(eh[1], "end", degres(a.plusHaut.temperature), `en ${a.plusHaut.annee}, ${motHaut}`);
    } else {
        // Sur téléphone, les repères passent en lignes de texte sous le graphique
        const lignes = [
            bloc.normale !== null ? `${nomNormale}, ${detailNormale}` : nomNormale,
            `Le plus froid : ${degres(a.plusBas.temperature)} en ${a.plusBas.annee}`,
            `${motHaut.charAt(0).toUpperCase()}${motHaut.slice(1)} : ${degres(a.plusHaut.temperature)} en ${a.plusHaut.annee}`
        ];
        lignes.forEach((l, i) => svg.append("text").attr("class", "etiquette")
            .attr("x", marge.gauche).attr("y", base + (a.aMesure ? 92 : 40) + i * 17).text(l));

        if (!a.aMesure) svg.attr("viewBox", `0 0 ${largeur} ${base + 96}`);
    }
}

// --- Rubrique 2 : le classement --------------------------------------------

function ecrireClassement(d, bloc, a) {
    const nomJour = jourMois(etat.jour);
    const chaud = etat.mode === "chaud";

    // Liste complète : archives + mesure du jour
    const liste = a.autres.map(an => ({ ...an }));
    if (a.aMesure) liste.push({ annee: a.anneeJour, temperature: a.mesure, jour: true });

    const decroissant = [...liste].sort((p, q) => q.temperature - p.temperature || p.annee - q.annee);
    const croissant = [...liste].sort((p, q) => p.temperature - q.temperature || p.annee - q.annee);

    const listes = chaud
        ? [[`Les trois ${nomJour} les plus chauds`, decroissant.slice(0, 3), COULEURS.xc],
           [`Les trois ${nomJour} les plus froids`, croissant.slice(0, 3), COULEURS.xf]]
        : [[`Les trois ${nomJour} les plus froids`, croissant.slice(0, 3), COULEURS.xf],
           [`Les trois ${nomJour} les plus doux`, decroissant.slice(0, 3), COULEURS.xc]];

    const mediane = d3.median(liste, l => l.temperature);
    const ecartMax = d3.max(listes.flatMap(l => l[1]), l => Math.abs(l.temperature - mediane)) || 1;

    listes.forEach(([titre, elements, couleur], i) => {
        $(`n-titre-liste-${i + 1}`).textContent = titre;
        $(`n-liste-${i + 1}`).innerHTML = elements.map((l, rang) => {
            const largeur = Math.max(6, Math.round(100 * Math.abs(l.temperature - mediane) / ecartMax));
            const marque = l.jour ? `<small>${etat.jour === d.aujourdhui ? "aujourd'hui" : "jour étudié"}</small>` : "";
            return `<li class="${l.jour ? "n-aujourdhui" : ""}">` +
                `<span class="n-place">${rang + 1}</span>` +
                `<span class="n-an">${l.annee}${marque}</span>` +
                `<span class="n-barre" aria-hidden="true" style="width:${largeur}%;background:${l.jour ? AMBRE : couleur}"></span>` +
                `<span class="n-t">${echapper(degres(l.temperature))}</span></li>`;
        }).join("");
    });

    // Rang du jour
    const bloc_rang = $("n-rang-bloc");
    if (!a.aMesure) {
        bloc_rang.hidden = true;
        $("g-classement").innerHTML = "";
        return;
    }
    bloc_rang.hidden = false;

    const p = a.position;
    const total = p.total + 1;
    const rang = (chaud ? p.plusChaudes : p.plusFroides) + 1;
    const compris = etat.jour === d.aujourdhui ? "aujourd'hui compris" : `${a.anneeJour} compris`;

    const part = rang / total;
    let situation;
    if (rang === 1) situation = "En tête du classement.";
    else if (rang === total) situation = "Tout en bas du classement.";
    else if (part <= 0.05) situation = "Parmi les tout premiers du classement.";
    else if (part <= 0.2) situation = "Dans le haut du classement.";
    else if (part >= 0.95) situation = "Parmi les derniers du classement.";
    else if (part >= 0.8) situation = "Dans le bas du classement.";
    else if (part >= 0.4 && part <= 0.6) situation = "Pile au milieu du classement.";
    else situation = "Dans la moyenne du classement.";

    $("n-rang").textContent = ordinal(rang);
    $("n-rang-texte").innerHTML =
        `${echapper(nomJour)} le plus ${chaud ? "chaud" : "froid"} sur ${total}, ${compris}.<br>` +
        `<span>${situation}</span>`;

    dessinerClassement(rang, total, chaud);
}

function dessinerClassement(rang, total, chaud) {
    const conteneur = $("g-classement");
    const largeur = Math.max(300, conteneur.clientWidth);
    const hauteur = 84;
    const x0 = 8, x1 = largeur - 8;
    const x = r => x0 + (r - 1) / Math.max(1, total - 1) * (x1 - x0);

    conteneur.innerHTML = "";
    const svg = d3.select(conteneur).append("svg")
        .attr("viewBox", `0 0 ${largeur} ${hauteur}`)
        .attr("role", "img")
        .attr("aria-label", `Classement : ${ordinal(rang)} sur ${total}.`);

    const debutNormal = Math.round(total * 0.2) + 1, finNormal = Math.round(total * 0.8);
    const bout = Math.max(1, Math.round(total * 0.05));

    svg.append("rect").attr("x", x0).attr("y", 30).attr("width", x1 - x0).attr("height", 10)
        .attr("rx", 5).attr("fill", "rgba(255,255,255,0.10)");
    svg.append("rect").attr("x", x(debutNormal)).attr("y", 30)
        .attr("width", Math.max(0, x(finNormal) - x(debutNormal))).attr("height", 10)
        .attr("fill", COULEURS.n).attr("fill-opacity", 0.55);
    svg.append("rect").attr("x", x0).attr("y", 30).attr("width", Math.max(10, x(bout) - x0)).attr("height", 10)
        .attr("rx", 5).attr("fill", chaud ? COULEURS.xc : COULEURS.xf);
    svg.append("rect").attr("x", Math.min(x1 - 10, x(total - bout + 1))).attr("y", 30)
        .attr("width", Math.max(10, x1 - x(total - bout + 1))).attr("height", 10)
        .attr("rx", 5).attr("fill", chaud ? COULEURS.xf : COULEURS.xc);

    svg.append("text").attr("class", "zone-nom normal")
        .attr("x", (x(debutNormal) + x(finNormal)) / 2).attr("y", 20).attr("text-anchor", "middle").text("Normal");

    const xr = x(rang);
    svg.append("circle").attr("cx", xr).attr("cy", 35).attr("r", 8)
        .attr("fill", AMBRE);

    const premier = chaud ? "le plus chaud" : "le plus froid";
    const dernier = chaud ? "le plus froid" : "le plus doux";

    svg.append("text").attr("class", "etiquette forte").attr("x", x0).attr("y", 64).text("1er");
    svg.append("text").attr("class", "etiquette").attr("x", x0).attr("y", 80).text(premier);
    svg.append("text").attr("class", "etiquette forte").attr("x", x1).attr("y", 64)
        .attr("text-anchor", "end").text(ordinal(total));
    svg.append("text").attr("class", "etiquette").attr("x", x1).attr("y", 80)
        .attr("text-anchor", "end").text(dernier);

    if (xr - x0 > 40 && x1 - xr > 40) {
        svg.append("text").attr("class", "etiquette jour").attr("x", xr).attr("y", 64)
            .attr("text-anchor", "middle").text(ordinal(rang));
    }
}

// --- Rubrique 4 : explorer -------------------------------------------------

function dessinerAnnees(bloc, a) {
    const conteneur = $("g-annees");
    const largeur = Math.max(300, conteneur.clientWidth);
    const etroit = largeur < 560;
    const hauteur = etroit ? 250 : 320;
    const marge = { haut: 20, droite: etroit ? 10 : 20, bas: 30, gauche: 36 };

    const points = a.autres.map(an => ({ ...an }));
    const toutes = points.map(p => p.temperature);
    if (a.aMesure) toutes.push(a.mesure);

    const x = d3.scaleLinear()
        .domain([a.premiere, Math.max(a.derniere, a.anneeJour)])
        .range([marge.gauche + 6, largeur - marge.droite - 6]);

    const y = d3.scaleLinear()
        .domain([Math.min(d3.min(toutes), a.normale) - 1, Math.max(d3.max(toutes), a.normale) + 1]).nice()
        .range([hauteur - marge.bas, marge.haut]);

    conteneur.innerHTML = "";
    const svg = d3.select(conteneur).append("svg")
        .attr("viewBox", `0 0 ${largeur} ${hauteur}`)
        .attr("role", "img")
        .attr("aria-label", `Température ${etat.mode === "chaud" ? "maximale" : "minimale"} de chaque ` +
            `${jourMois(etat.jour)} depuis ${a.premiere}`);

    svg.append("g").attr("class", "grille").selectAll("line").data(y.ticks(5)).join("line")
        .attr("x1", marge.gauche).attr("x2", largeur - marge.droite)
        .attr("y1", t => y(t)).attr("y2", t => y(t));

    svg.append("g").attr("class", "axe").selectAll("text").data(y.ticks(5)).join("text")
        .attr("x", marge.gauche - 8).attr("y", t => y(t)).attr("dy", "0.35em").attr("text-anchor", "end")
        .text(t => `${nombre(t, 0)} °`);

    const pasAnnees = etroit ? 25 : 10;
    const debut = Math.ceil(a.premiere / pasAnnees) * pasAnnees;
    svg.append("g").attr("class", "axe").selectAll("text")
        .data(d3.range(debut, Math.max(a.derniere, a.anneeJour) + 1, pasAnnees)).join("text")
        .attr("x", an => x(an)).attr("y", hauteur - marge.bas + 20).attr("text-anchor", "middle")
        .text(an => an);

    // Normale
    svg.append("line").attr("class", "repere")
        .attr("x1", marge.gauche).attr("x2", largeur - marge.droite)
        .attr("y1", y(a.normale)).attr("y2", y(a.normale));
    svg.append("text").attr("class", "etiquette forte")
        .attr("x", largeur - marge.droite).attr("y", y(a.normale) - 8).attr("text-anchor", "end")
        .text(`${bloc.normale !== null ? "normale" : "médiane"} ${nombre(a.normale)} °`);

    svg.append("g").selectAll("circle").data(points).join("circle")
        .attr("class", "survol")
        .attr("cx", p => x(p.annee)).attr("cy", p => y(p.temperature))
        .attr("r", etroit ? 3 : 3.6)
        .attr("fill", p => COULEURS[zone(p.temperature, a.quantiles)])
        .on("pointermove", (e, p) => montrerBulle(e,
            `<span>${jourMois(etat.jour)} ${p.annee}</span><b>${degres(p.temperature)}</b>` +
            (bloc.normale !== null ? `<span>${ecartSigne(p.temperature - bloc.normale)} par rapport à la normale</span>` : "")))
        .on("pointerleave", cacherBulle);

    if (a.aMesure) {
        const xm = x(a.anneeJour), ym = y(a.mesure);
        svg.append("circle").attr("class", "jour-j-point").attr("cx", xm).attr("cy", ym).attr("r", 7);
        svg.append("text").attr("class", "etiquette jour")
            .attr("x", xm - 12).attr("y", ym + (ym > hauteur - 60 ? -14 : 24)).attr("text-anchor", "end")
            .text(`${a.anneeJour} : ${degres(a.mesure)}`);
    }
}

function ecrireTableau(bloc, a) {
    const reference = bloc.normale;
    const lignes = [...a.autres].reverse();

    $("n-tableau").innerHTML = `<table>
        <thead><tr><th>Année</th><th>Température</th>${reference !== null ? "<th>Écart à la normale</th>" : ""}</tr></thead>
        <tbody>${lignes.map(l =>
            `<tr><td>${l.annee}</td><td>${degres(l.temperature)}</td>` +
            (reference !== null ? `<td>${ecartSigne(l.temperature - reference)}</td>` : "") + "</tr>"
        ).join("")}</tbody></table>`;
}

// --- Rubrique 5 : comprendre -----------------------------------------------

function ecrireComprendre(bloc, a) {
    const nomJour = jourMois(etat.jour);
    const periode = bloc.normale_periode.replace("-", " à ");

    $("n-q-normale").textContent =
        `C'est la température moyenne d'une date sur trente ans, ici de ${periode}. Pour ne pas dépendre ` +
        `du hasard d'une seule journée, on la calcule sur les quinze jours qui entourent la date.`;

    $("n-q-jour").textContent =
        `Une même température n'a pas le même sens en juillet et en janvier. On compare donc les ` +
        `${nomJour} entre eux : c'est comparer ce qui est comparable.`;

    const completes = bloc.decennies.filter(dd => dd.nombre >= 140);
    let climat = "Une journée relève de la météo ; le climat se lit sur des décennies.";

    if (completes.length >= 2) {
        const premiere = completes[0], derniere = completes.at(-1);
        climat += ` Autour du ${nomJour}, les années ${derniere.decennie} sont en moyenne ` +
            `${ecartSigne(derniere.moyenne - premiere.moyenne)} par rapport aux années ${premiere.decennie}.`;
    }

    if (bloc.normale !== null && bloc.normale - bloc.mediane >= 0.2) {
        climat += ` C'est pourquoi la normale récente (${degres(bloc.normale)}) dépasse la valeur du milieu ` +
            `de toutes les années depuis ${a.premiere} (${degres(bloc.mediane)}).`;
    }

    $("n-q-climat").textContent = climat;

    $("n-periode").textContent = `de ${a.premiere} à ${a.derniere}`;
}

function dessinerDecennies(bloc) {
    const conteneur = $("g-decennies");
    const decennies = bloc.decennies;
    const quoi = etat.mode === "chaud" ? "maximales" : "minimales";
    const debutFenetre = jourMois(decaler(etat.jour, -7)), finFenetre = jourMois(decaler(etat.jour, 7));

    $("n-legende-decennies").textContent = `Moyenne des ${quoi} du ${debutFenetre} au ${finFenetre}.`;

    if (decennies.length < 2) {
        conteneur.innerHTML = "";
        return;
    }

    const largeur = Math.max(300, conteneur.clientWidth);
    const etroit = largeur < 560;
    const hauteur = etroit ? 210 : 220;
    const marge = { haut: 18, droite: etroit ? 8 : 96, bas: 28, gauche: 36 };

    const moyennes = decennies.map(dd => dd.moyenne);
    if (bloc.normale !== null) moyennes.push(bloc.normale);

    const y = d3.scaleLinear()
        .domain([Math.floor(d3.min(moyennes) - 1), Math.ceil(d3.max(moyennes) + 0.5)])
        .range([hauteur - marge.bas, marge.haut]);

    const x = d3.scaleBand().domain(decennies.map(dd => dd.decennie))
        .range([marge.gauche, largeur - marge.droite]).padding(0.28);

    conteneur.innerHTML = "";
    const svg = d3.select(conteneur).append("svg")
        .attr("viewBox", `0 0 ${largeur} ${hauteur}`)
        .attr("role", "img")
        .attr("aria-label", `Moyenne des ${quoi} par décennie autour du ${jourMois(etat.jour)}`);

    svg.append("g").attr("class", "grille").selectAll("line").data(y.ticks(4)).join("line")
        .attr("x1", marge.gauche).attr("x2", largeur - marge.droite)
        .attr("y1", t => y(t)).attr("y2", t => y(t));

    svg.append("g").attr("class", "axe").selectAll("text").data(y.ticks(4)).join("text")
        .attr("x", marge.gauche - 8).attr("y", t => y(t)).attr("dy", "0.35em").attr("text-anchor", "end")
        .text(t => `${nombre(t, 0)} °`);

    const derniere = decennies.at(-1).decennie;
    const bas = y.range()[0];
    const r = Math.min(4, x.bandwidth() / 2);

    svg.append("g").selectAll("path").data(decennies).join("path")
        .attr("class", "survol")
        .attr("d", dd => {
            const x0 = x(dd.decennie), w = x.bandwidth(), yy = y(dd.moyenne);
            return `M${x0},${bas} V${yy + r} Q${x0},${yy} ${x0 + r},${yy} H${x0 + w - r} ` +
                `Q${x0 + w},${yy} ${x0 + w},${yy + r} V${bas} Z`;
        })
        .attr("fill", dd => dd.decennie === derniere ? AMBRE : "#4a98da")
        .attr("fill-opacity", dd => dd.decennie === derniere ? 1 : dd.nombre >= 140 ? 0.85 : 0.5)
        .on("pointermove", (e, dd) => montrerBulle(e,
            `<span>Années ${dd.decennie}${dd.nombre < 140 ? " (décennie incomplète)" : ""}</span>` +
            `<b>${degres(dd.moyenne, 2)}</b>`))
        .on("pointerleave", cacherBulle);

    svg.append("g").attr("class", "axe").selectAll("text.annee")
        .data(decennies.filter((dd, i) => !etroit || i % 2 === 0)).join("text")
        .attr("x", dd => x(dd.decennie) + x.bandwidth() / 2).attr("y", hauteur - 8)
        .attr("text-anchor", "middle").text(dd => dd.decennie);

    if (bloc.normale !== null) {
        svg.append("line").attr("class", "repere")
            .attr("x1", marge.gauche).attr("x2", largeur - marge.droite)
            .attr("y1", y(bloc.normale)).attr("y2", y(bloc.normale));

        if (!etroit) {
            svg.append("text").attr("class", "etiquette")
                .attr("x", largeur - marge.droite + 8).attr("y", y(bloc.normale)).attr("dy", "0.35em")
                .text(`Normale ${degres(bloc.normale)}`);
        }
    }
}

// --- Affichage -------------------------------------------------------------

function ecrireDate() {
    $("n-jour-long").textContent = jourComplet(etat.jour);
    $("n-jour-court").textContent = jourCourt(etat.jour);
    $("n-choisir").setAttribute("aria-label", `${jourComplet(etat.jour)}, choisir une autre date`);

    const aujourdhui = etat.donnees ? etat.donnees.aujourdhui : null;
    $("n-suivant").disabled = Boolean(aujourdhui && etat.jour >= aujourdhui);
}

function afficher() {
    const d = etat.donnees;
    const bloc = d && d[etat.mode];

    ecrireDate();

    if (!bloc || !bloc.annees || !bloc.annees.length) {
        $("n-contenu").hidden = true;
        $("n-etat").hidden = false;
        $("n-etat").textContent = "Les archives ne contiennent pas de valeur validée pour cette date.";
        $("n-valeur").textContent = "—";
        $("n-statut").hidden = true;
        return;
    }

    $("n-etat").hidden = true;
    $("n-contenu").hidden = false;

    const a = analyser(d, bloc);
    const nomJour = jourMois(etat.jour);

    $("n-titre-bande").textContent = `Les ${a.autres.length} ${nomJour} depuis ${a.premiere}.`;
    $("n-legende-bande").textContent = "Chaque point est une année ; plus il est à droite, plus il a fait chaud.";

    $("n-legende-annees").textContent =
        `Chaque point est un ${nomJour}, ${etat.mode === "chaud" ? "au plus chaud" : "au plus froid"} de la journée. ` +
        `Changez de date en haut de page, ou passez ${etat.mode === "chaud" ? "au plus froid" : "au plus chaud"} : ` +
        `tout l'article se met à jour.`;

    ecrireBandeau(d, bloc, a);
    ecrireReponse(d, bloc, a);
    dessinerRepartition(bloc, a);
    ecrireClassement(d, bloc, a);
    dessinerAnnees(bloc, a);
    ecrireTableau(bloc, a);
    ecrireComprendre(bloc, a);
    dessinerDecennies(bloc);
}

function noterAdresse() {
    if (!etat.donnees) return;
    const adresse = new URL(location.href);
    if (etat.jour === etat.donnees.aujourdhui) adresse.searchParams.delete("jour");
    else adresse.searchParams.set("jour", etat.jour);
    history.replaceState(null, "", adresse);
}

let demande = 0;

async function charger(jour) {
    const numero = ++demande;

    if (jour) {
        etat.jour = jour;
        ecrireDate();
    }

    let donnees = jour && etat.cache.get(jour);

    if (!donnees) {
        try {
            const reponse = await fetch(jour ? `${URL_API}?jour=${jour}` : URL_API);
            const corps = await reponse.json().catch(() => ({}));

            if (!reponse.ok) throw new Error(corps.erreur || `Erreur ${reponse.status}`);

            donnees = corps;
            etat.cache.set(donnees.jour, donnees);
        } catch (erreur) {
            if (numero !== demande) return;
            $("n-contenu").hidden = true;
            $("n-etat").hidden = false;
            $("n-etat").classList.add("erreur");
            $("n-etat").textContent = erreur instanceof TypeError
                ? "Le serveur n'a pas répondu. Vérifiez la connexion, puis rechargez la page."
                : erreur.message;
            return;
        }
    }

    if (numero !== demande) return;

    $("n-etat").classList.remove("erreur");
    etat.donnees = donnees;
    etat.jour = donnees.jour;
    afficher();
    noterAdresse();
}

// --- Commandes -------------------------------------------------------------

$("n-precedent").addEventListener("click", () => charger(decaler(etat.jour, -1)));
$("n-suivant").addEventListener("click", () => charger(decaler(etat.jour, 1)));

const calendrier = $("n-calendrier");

$("n-choisir").addEventListener("click", () => {
    if (!etat.jour) return;
    calendrier.value = etat.jour;
    if (etat.donnees) calendrier.max = etat.donnees.aujourdhui;

    try {
        if (typeof calendrier.showPicker === "function") {
            calendrier.showPicker();
            return;
        }
    } catch (e) { /* navigateur sans showPicker utilisable : on retombe sur le clic */ }

    calendrier.click();
});

calendrier.addEventListener("change", () => {
    const valeur = calendrier.value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(valeur) && valeur !== etat.jour) charger(valeur);
});

for (const bouton of document.querySelectorAll(".bascule button")) {
    bouton.addEventListener("click", () => {
        etat.mode = bouton.dataset.mode;
        for (const b of document.querySelectorAll(".bascule button")) {
            b.setAttribute("aria-pressed", String(b === bouton));
        }
        if (etat.donnees) afficher();
    });
}

// Hauteur du bandeau collant : sert à aligner le défilement sous lui
const bande = $("n-bande");
new ResizeObserver(() => {
    document.documentElement.style.setProperty("--bande", `${Math.ceil(bande.offsetHeight)}px`);
}).observe(bande);

let minuterie = null, largeurPrecedente = racine.clientWidth;

new ResizeObserver(() => {
    clearTimeout(minuterie);
    minuterie = setTimeout(() => {
        if (racine.clientWidth === largeurPrecedente || !etat.donnees) return;
        largeurPrecedente = racine.clientWidth;
        afficher();
    }, 200);
}).observe(racine);

if (typeof d3 === "undefined") {
    $("n-etat").classList.add("erreur");
    $("n-etat").textContent = "La bibliothèque de graphiques n'a pas pu être chargée. Vérifiez la connexion.";
} else {
    // ?jour=AAAA-MM-JJ dans l'adresse ouvre directement ce jour
    const demandee = new URLSearchParams(location.search).get("jour");
    charger(/^\d{4}-\d{2}-\d{2}$/.test(demandee || "") ? demandee : null);
}

})();
