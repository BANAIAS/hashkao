/* ==========================================================================
   HKO Météo — rubrique « Est-ce normal ? »

   Replace la température d'un jour à Paris-Montsouris dans la série
   historique de la station. Toutes les valeurs viennent de l'API
   /meteo/api/normal/ : rien n'est calculé ni supposé côté navigateur,
   hormis la mise en forme.
   ========================================================================== */

(() => {
"use strict";

const racine = document.getElementById("normal");
const URL_API = racine.dataset.api;
const $ = id => document.getElementById(id);

const FROID = "#4a98da", CHAUD = "#e8603f", AMBRE = "#ffb81c";

const etat = { jour: null, mode: "chaud", donnees: null, cache: new Map() };

// --- Mise en forme ---------------------------------------------------------

const degres = (v, decimales = 1) => `${Number(v).toLocaleString("fr-FR", {
    minimumFractionDigits: decimales, maximumFractionDigits: decimales
})} °C`;

const ecartSigne = v => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("fr-FR", {
    minimumFractionDigits: 1, maximumFractionDigits: 1
})} °C`;

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

// --- Verdict ---------------------------------------------------------------

function qualifier(bloc, nomJour) {
    // Part des années plus froides que la mesure, à la même date
    const part = bloc.position.part_plus_froides;
    const normale = bloc.normale ?? bloc.mediane;

    const doux = normale >= 20 ? "chaud" : "doux";
    const frais = normale <= 8 ? "froid" : "frais";

    if (part >= 95) return `Exceptionnellement ${doux} pour un ${nomJour}.`;
    if (part >= 80) return `Nettement plus ${doux} que d'habitude.`;
    if (part >= 60) return `Un peu plus ${doux} que d'habitude.`;
    if (part > 40) return "Oui, c'est normal.";
    if (part > 20) return `Un peu plus ${frais} que d'habitude.`;
    if (part > 5) return `Nettement plus ${frais} que d'habitude.`;
    return `Exceptionnellement ${frais} pour un ${nomJour}.`;
}

function ecrireVerdict(bloc) {
    const d = etat.donnees;
    const nomJour = jourMois(etat.jour);
    const quoi = etat.mode === "chaud" ? "maximale" : "minimale";
    const notes = [];

    if (bloc.mesure !== null && bloc.mesure !== undefined && bloc.position) {
        $("n-mesure").innerHTML =
            `${echapper(degres(bloc.mesure))} <small>${quoi} à ${echapper(d.station)}</small>`;
        $("n-phrase").textContent = qualifier(bloc, nomJour);

        if (bloc.ecart_normale !== null) {
            notes.push(`${ecartSigne(bloc.ecart_normale)} par rapport à la normale ` +
                `${bloc.normale_periode.replace("-", "–")} (${degres(bloc.normale)}).`);
        }

        const p = bloc.position;
        notes.push(`Sur ${p.total} années mesurées à cette date, ${p.plus_froides} ont été plus ` +
            `froides et ${p.plus_chaudes} plus chaudes.`);

        if (bloc.mesure > bloc.record_haut.temperature) {
            notes.push(`C'est au-dessus de toutes les valeurs de la série pour cette date ` +
                `(jusqu'ici ${degres(bloc.record_haut.temperature)} en ${bloc.record_haut.annee}).`);
        } else if (bloc.mesure < bloc.record_bas.temperature) {
            notes.push(`C'est en dessous de toutes les valeurs de la série pour cette date ` +
                `(jusqu'ici ${degres(bloc.record_bas.temperature)} en ${bloc.record_bas.annee}).`);
        }

        if (d.mesure.en_cours) {
            notes.push("Valeur provisoire : la journée n'est pas terminée.");
        } else if (d.mesure.couverture < 0.8) {
            notes.push(`Journée incomplète dans nos relevés (${Math.round(d.mesure.couverture * 100)} % des mesures).`);
        }
    } else {
        const reference = bloc.normale ?? bloc.mediane;

        $("n-mesure").innerHTML =
            `${echapper(degres(reference))} <small>${quoi} habituelle un ${echapper(nomJour)}</small>`;

        $("n-phrase").textContent = etat.jour > d.aujourdhui
            ? "Ce jour n'est pas encore arrivé. Voici ce que disent les archives."
            : "Pas de mesure de la station pour ce jour. Voici ce que disent les archives.";
    }

    $("n-note").textContent = notes.join(" ");

    const reperes = [
        [`Normale ${bloc.normale_periode.replace("-", "–")}`, bloc.normale === null ? "—" : degres(bloc.normale), ""],
        [`Médiane depuis ${bloc.premiere_annee}`, degres(bloc.mediane), ""],
        ["Valeur la plus haute", degres(bloc.record_haut.temperature), `en ${bloc.record_haut.annee}`],
        ["Valeur la plus basse", degres(bloc.record_bas.temperature), `en ${bloc.record_bas.annee}`]
    ];

    $("n-reperes").innerHTML = reperes.map(([nom, valeur, precision]) =>
        `<div><dt>${echapper(nom)}</dt><dd>${echapper(valeur)} <small>${echapper(precision)}</small></dd></div>`
    ).join("");
}

// --- Graphiques ------------------------------------------------------------

function toile(id, hauteur) {
    const conteneur = $(id);
    const largeur = Math.max(300, conteneur.clientWidth);

    conteneur.innerHTML = "";

    const svg = d3.select(conteneur).append("svg")
        .attr("viewBox", `0 0 ${largeur} ${hauteur}`)
        .attr("role", "img");

    return { svg, largeur, hauteur };
}

function axeTemperatures(svg, y, marge, largeur) {
    svg.append("g").attr("class", "grille")
        .selectAll("line").data(y.ticks(6)).join("line")
        .attr("x1", marge.gauche).attr("x2", largeur - marge.droite)
        .attr("y1", d => y(d)).attr("y2", d => y(d));

    svg.append("g").attr("class", "axe")
        .attr("transform", `translate(${marge.gauche},0)`)
        .call(d3.axisLeft(y).ticks(6).tickSize(0).tickPadding(8).tickFormat(d => `${d}°`))
        .call(g => g.select(".domain").remove());
}

// Chaque année : un trait qui part de la normale. Bleu en dessous, rouge au-dessus.
function dessinerAnnees(bloc) {
    const etroit = racine.clientWidth < 560;
    const { svg, largeur, hauteur } = toile("g-annees", etroit ? 300 : 380);
    const marge = { haut: 26, droite: etroit ? 12 : 96, bas: 30, gauche: 38 };

    const annees = bloc.annees;
    const reference = bloc.normale ?? bloc.mediane;
    const valeurs = annees.map(a => a.temperature);
    if (bloc.mesure !== null && bloc.mesure !== undefined) valeurs.push(bloc.mesure);

    const x = d3.scaleBand()
        .domain(d3.range(bloc.premiere_annee, bloc.derniere_annee + 1))
        .range([marge.gauche, largeur - marge.droite])
        .paddingInner(0.3);

    const y = d3.scaleLinear()
        .domain([Math.min(d3.min(valeurs), reference) - 1, Math.max(d3.max(valeurs), reference) + 1])
        .nice()
        .range([hauteur - marge.bas, marge.haut]);

    svg.attr("aria-label",
        `Température ${etat.mode === "chaud" ? "maximale" : "minimale"} de chaque ${jourMois(etat.jour)} depuis ${bloc.premiere_annee}`);

    axeTemperatures(svg, y, marge, largeur);

    svg.append("g").attr("class", "axe")
        .attr("transform", `translate(0,${hauteur - marge.bas})`)
        .call(d3.axisBottom(x)
            .tickValues(x.domain().filter(a => a % (etroit ? 40 : 20) === 0))
            .tickSize(0).tickPadding(10))
        .call(g => g.select(".domain").remove());

    svg.append("g").selectAll("rect").data(annees).join("rect")
        .attr("x", d => x(d.annee))
        .attr("width", Math.max(1.5, x.bandwidth()))
        .attr("y", d => Math.min(y(d.temperature), y(reference)))
        .attr("height", d => Math.max(1, Math.abs(y(d.temperature) - y(reference))))
        .attr("rx", Math.min(2, x.bandwidth() / 2))
        .attr("fill", d => d.temperature >= reference ? CHAUD : FROID);

    // Normale : filet et étiquette
    svg.append("line").attr("class", "repere")
        .attr("x1", marge.gauche).attr("x2", largeur - marge.droite)
        .attr("y1", y(reference)).attr("y2", y(reference));

    if (!etroit) {
        svg.append("text").attr("class", "etiquette")
            .attr("x", largeur - marge.droite + 8).attr("y", y(reference)).attr("dy", "0.35em")
            .text(`Normale ${degres(reference)}`);
    }

    // Mesure du jour
    if (bloc.mesure !== null && bloc.mesure !== undefined) {
        svg.append("line").attr("class", "jour-j")
            .attr("x1", marge.gauche).attr("x2", largeur - marge.droite)
            .attr("y1", y(bloc.mesure)).attr("y2", y(bloc.mesure));

        const proche = Math.abs(y(bloc.mesure) - y(reference)) < 16;

        svg.append("text").attr("class", "etiquette forte")
            .attr("x", etroit ? largeur - marge.droite : largeur - marge.droite + 8)
            .attr("y", y(bloc.mesure))
            .attr("dy", etroit ? "-0.5em" : (proche ? (bloc.mesure >= reference ? "-0.6em" : "1.3em") : "0.35em"))
            .attr("text-anchor", etroit ? "end" : "start")
            .text(`${dateUtc(etat.jour).getUTCFullYear()} : ${degres(bloc.mesure)}`);
    }

    // Survol : une bande par année, plus large que le trait
    svg.append("g").selectAll("rect").data(annees).join("rect")
        .attr("class", "survol")
        .attr("x", d => x(d.annee) - x.step() * 0.15)
        .attr("width", x.step())
        .attr("y", marge.haut).attr("height", hauteur - marge.haut - marge.bas)
        .attr("fill", "transparent")
        .on("pointermove", (e, d) => montrerBulle(e,
            `<span>${jourMois(etat.jour)} ${d.annee}</span><b>${degres(d.temperature)}</b>` +
            `<span>${ecartSigne(d.temperature - reference)} par rapport à la normale</span>`))
        .on("pointerleave", cacherBulle);
}

// Répartition : chaque année est un point, empilé par degré.
function dessinerRepartition(bloc) {
    const etroit = racine.clientWidth < 560;
    const annees = bloc.annees;
    const reference = bloc.normale ?? bloc.mediane;

    const valeurs = annees.map(a => a.temperature);
    if (bloc.mesure !== null && bloc.mesure !== undefined) valeurs.push(bloc.mesure);

    const mini = Math.floor(d3.min(valeurs)) - 1, maxi = Math.ceil(d3.max(valeurs)) + 1;

    const piles = d3.rollup(annees, v => v.sort((a, b) => a.annee - b.annee), a => Math.floor(a.temperature));
    const plusHaute = d3.max(piles.values(), v => v.length);

    const largeurDispo = Math.max(300, $("g-repartition").clientWidth);
    const marge = { haut: 44, droite: 16, bas: 34, gauche: 16 };
    const pasX = (largeurDispo - marge.gauche - marge.droite) / (maxi - mini);
    const rayon = Math.max(2.5, Math.min(7, pasX * 0.42, (etroit ? 190 : 250) / plusHaute / 2));
    const hauteur = marge.haut + marge.bas + plusHaute * rayon * 2.25 + 8;

    const { svg, largeur } = toile("g-repartition", hauteur);

    const x = d3.scaleLinear().domain([mini, maxi]).range([marge.gauche, largeur - marge.droite]);
    const base = hauteur - marge.bas;

    svg.attr("aria-label", `Répartition des températures de tous les ${jourMois(etat.jour)}`);

    svg.append("g").attr("class", "axe")
        .attr("transform", `translate(0,${base})`)
        .call(d3.axisBottom(x)
            .tickValues(d3.range(mini, maxi + 1).filter(v => v % (pasX < 26 ? 5 : 2) === 0))
            .tickSize(4).tickPadding(8).tickFormat(d => `${d}°`));

    const points = [];
    for (const [degre, liste] of piles) {
        liste.forEach((a, i) => points.push({ ...a, cx: x(degre + 0.5), cy: base - rayon - 3 - i * rayon * 2.25 }));
    }

    svg.append("g").selectAll("circle").data(points).join("circle")
        .attr("class", "survol")
        .attr("cx", d => d.cx).attr("cy", d => d.cy).attr("r", rayon)
        .attr("fill", d => d.temperature >= reference ? CHAUD : FROID)
        .on("pointermove", (e, d) => montrerBulle(e,
            `<span>${jourMois(etat.jour)} ${d.annee}</span><b>${degres(d.temperature)}</b>`))
        .on("pointerleave", cacherBulle);

    // Normale
    svg.append("line").attr("class", "repere")
        .attr("x1", x(reference)).attr("x2", x(reference))
        .attr("y1", marge.haut - 6).attr("y2", base);

    const mesure = bloc.mesure;
    const aMesure = mesure !== null && mesure !== undefined;
    const normaleAGauche = aMesure ? reference <= mesure : x(reference) > largeur / 2;

    svg.append("text").attr("class", "etiquette")
        .attr("x", x(reference) + (normaleAGauche ? -7 : 7))
        .attr("y", marge.haut - 26)
        .attr("text-anchor", normaleAGauche ? "end" : "start")
        .text(`Normale ${degres(reference)}`);

    // Mesure du jour
    if (aMesure) {
        svg.append("line").attr("class", "jour-j")
            .attr("x1", x(mesure)).attr("x2", x(mesure))
            .attr("y1", marge.haut - 6).attr("y2", base);

        svg.append("circle").attr("class", "jour-j-point")
            .attr("cx", x(mesure)).attr("cy", base).attr("r", 6);

        svg.append("text").attr("class", "etiquette forte")
            .attr("x", x(mesure) + (normaleAGauche ? 7 : -7))
            .attr("y", marge.haut - 26)
            .attr("text-anchor", normaleAGauche ? "start" : "end")
            .text(`${dateUtc(etat.jour).getUTCFullYear()} : ${degres(mesure)}`);
    }
}

// Moyenne par décennie : la tendance de fond.
function dessinerDecennies(bloc) {
    const etroit = racine.clientWidth < 560;
    const decennies = bloc.decennies;
    const quoi = etat.mode === "chaud" ? "maximales" : "minimales";
    const debutFenetre = jourMois(decaler(etat.jour, -7)), finFenetre = jourMois(decaler(etat.jour, 7));

    let tendance = "";
    const completes = decennies.filter(d => d.nombre >= 140);

    if (completes.length >= 2) {
        const premiere = completes[0], derniere = completes.at(-1);
        tendance = ` Entre les années ${premiere.decennie} et les années ${derniere.decennie} : ` +
            `${ecartSigne(derniere.moyenne - premiere.moyenne)}.`;
    }

    $("n-legende-climat").textContent =
        `Qu'un ${jourMois(etat.jour)} soit doux ou frais, c'est la météo. Le climat se lit autrement : ` +
        `voici la moyenne des ${quoi} du ${debutFenetre} au ${finFenetre}, décennie par décennie.${tendance}`;

    if (decennies.length < 2) {
        $("g-decennies").innerHTML = "";
        return;
    }

    const { svg, largeur, hauteur } = toile("g-decennies", etroit ? 250 : 300);
    const marge = { haut: 26, droite: etroit ? 22 : 96, bas: 32, gauche: 38 };

    const x = d3.scalePoint()
        .domain(decennies.map(d => d.decennie))
        .range([marge.gauche + 14, largeur - marge.droite - 8]);

    const moyennes = decennies.map(d => d.moyenne);
    if (bloc.normale !== null) moyennes.push(bloc.normale);

    const y = d3.scaleLinear()
        .domain([d3.min(moyennes) - 0.6, d3.max(moyennes) + 0.6]).nice()
        .range([hauteur - marge.bas, marge.haut]);

    svg.attr("aria-label", `Moyenne des ${quoi} par décennie autour du ${jourMois(etat.jour)}`);

    axeTemperatures(svg, y, marge, largeur);

    svg.append("g").attr("class", "axe")
        .attr("transform", `translate(0,${hauteur - marge.bas})`)
        .call(d3.axisBottom(x)
            .tickValues(x.domain().filter((d, i) => !etroit || i % 2 === 0))
            .tickSize(0).tickPadding(10))
        .call(g => g.select(".domain").remove());

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

    svg.append("path")
        .attr("fill", "none").attr("stroke", "#f3f7fb").attr("stroke-width", 2)
        .attr("stroke-linejoin", "round")
        .attr("d", d3.line().x(d => x(d.decennie)).y(d => y(d.moyenne))(decennies));

    // Décennie incomplète : point évidé
    svg.append("g").selectAll("circle").data(decennies).join("circle")
        .attr("cx", d => x(d.decennie)).attr("cy", d => y(d.moyenne)).attr("r", 5)
        .attr("fill", d => d.nombre >= 140 ? "#f3f7fb" : "#06203f")
        .attr("stroke", d => d.nombre >= 140 ? "#06203f" : "#f3f7fb")
        .attr("stroke-width", 2);

    const derniere = decennies.at(-1);
    svg.append("text").attr("class", "etiquette forte")
        .attr("x", x(derniere.decennie)).attr("y", y(derniere.moyenne) - 13)
        .attr("text-anchor", "end")
        .text(degres(derniere.moyenne));

    svg.append("g").selectAll("rect").data(decennies).join("rect")
        .attr("class", "survol")
        .attr("x", d => x(d.decennie) - x.step() / 2).attr("width", x.step())
        .attr("y", marge.haut).attr("height", hauteur - marge.haut - marge.bas)
        .attr("fill", "transparent")
        .on("pointermove", (e, d) => montrerBulle(e,
            `<span>Années ${d.decennie}${d.nombre < 140 ? " (décennie incomplète)" : ""}</span>` +
            `<b>${degres(d.moyenne, 2)}</b>`))
        .on("pointerleave", cacherBulle);
}

function ecrireTableau(bloc) {
    const reference = bloc.normale ?? bloc.mediane;

    $("n-tableau").innerHTML = `<table>
        <thead><tr><th>Année</th><th>Température</th><th>Écart à la normale</th></tr></thead>
        <tbody>${bloc.annees.slice().reverse().map(a =>
            `<tr><td>${a.annee}</td><td>${degres(a.temperature)}</td><td>${ecartSigne(a.temperature - reference)}</td></tr>`
        ).join("")}</tbody></table>`;
}

// --- Affichage -------------------------------------------------------------

function afficher() {
    const d = etat.donnees;
    const bloc = d && d[etat.mode];
    const nomJour = jourMois(etat.jour);

    $("n-jour").textContent = jourComplet(etat.jour);

    if (!bloc) {
        $("n-contenu").hidden = true;
        $("n-etat").hidden = false;
        $("n-etat").textContent = "Les archives ne contiennent pas de valeur validée pour cette date.";
        return;
    }

    $("n-etat").hidden = true;
    $("n-contenu").hidden = false;

    const quoi = etat.mode === "chaud" ? "maximales" : "minimales";
    const aMesure = bloc.mesure !== null && bloc.mesure !== undefined;

    $("n-titre-annees").textContent = `Tous les ${nomJour} depuis ${bloc.premiere_annee}`;
    $("n-legende-annees").innerHTML =
        `Températures ${quoi} de chaque année, comparées à la normale. ` +
        `<span class="cle" style="background:${CHAUD}"></span>au-dessus ` +
        `<span class="cle" style="background:${FROID}"></span>en dessous` +
        (aMesure ? ` <span class="cle" style="background:${AMBRE}"></span>mesure de ${dateUtc(etat.jour).getUTCFullYear()}` : "");

    $("n-titre-repartition").textContent = aMesure
        ? `Où se situe ce ${nomJour} ?`
        : `Les ${nomJour}, du plus froid au plus chaud`;

    $("n-periode").textContent = `de ${bloc.premiere_annee} à ${bloc.derniere_annee} (${bloc.nombre_annees} années pour cette date)`;

    ecrireVerdict(bloc);
    dessinerAnnees(bloc);
    dessinerRepartition(bloc);
    dessinerDecennies(bloc);
    ecrireTableau(bloc);
}

let demande = 0;

async function charger(jour) {
    const numero = ++demande;

    if (jour) {
        etat.jour = jour;
        $("n-jour").textContent = jourComplet(jour);
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
}

$("n-precedent").addEventListener("click", () => charger(decaler(etat.jour, -1)));
$("n-suivant").addEventListener("click", () => charger(decaler(etat.jour, 1)));

for (const bouton of document.querySelectorAll(".bascule button")) {
    bouton.addEventListener("click", () => {
        etat.mode = bouton.dataset.mode;
        for (const b of document.querySelectorAll(".bascule button")) {
            b.setAttribute("aria-pressed", String(b === bouton));
        }
        if (etat.donnees) afficher();
    });
}

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
