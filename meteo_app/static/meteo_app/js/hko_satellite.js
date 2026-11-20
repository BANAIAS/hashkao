/* ==========================================================================
   HKO Météo — lecteur satellite (images GeoColour et vidéo H.264)

   Deux façons de montrer la journée, avec le même rendu :

   - vidéo : la journée encodée par le serveur (hko_derives), une image
     toutes les 2 min 30 de temps réel, chaque image montrant la dernière
     observation disponible. La vidéo est linéaire dans le temps, comme la
     frise : l'heure affichée se déduit exactement de l'image présentée
     (requestVideoFrameCallback), sans dérive possible.
   - images : les observations une à une (décodées hors du fil principal,
     recadrées à la zone visible), comme l'ancien lecteur.

   À l'arrêt (pause, curseur de la frise, journée en cours), c'est toujours
   l'image exacte de l'observation qui est affichée, nette.

   Les images reçues portent déjà la correction de couleur et de netteté
   qui était appliquée par un filtre CSS/SVG : le navigateur n'a plus ce
   calcul à refaire à chaque image. Le léger assombrissement des bords est
   posé par-dessus (calque « voile »), avec une teinte et une opacité
   équivalentes à l'ancien rendu filtré.

   API (window.HKOSatellite) :
     creer(options) -> lecteur
       .charger(sequence)       séquence de /api/satellite/ (préparée par hko.js)
       .situation(instant)      { avant, observee, lacune }
       .dessiner({ instant, lecture })
       .instantVideo()          instant (ms) de l'image vidéo affichée, ou null
       .cadrer()                après un changement de taille
       .suspendre() / .liberer()
   ========================================================================== */

(() => {
"use strict";

const LACUNE = 30 * 60000;
const FOND = "rgb(0, 0, 20)";              // #02091a après l'ancienne correction
const VOILE = [0, 0, 14];                    // teinte du bord, équivalente après correction
const VOILE_OPACITE = 0.45 * 1.05;

const rvfc = "requestVideoFrameCallback" in HTMLVideoElement.prototype;

function yMercator(lat) {
    return Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
}

function creer(options) {
    const { toile, voile, conteneur, projection, echelle, journal } = options;
    let mode = options.mode || "video";

    const ctx = toile.getContext("2d");
    let sequence = null;
    let affichee = null;          // url de l'image posée sur la toile
    let demandee = null;
    let jeton = 0;

    // --- Images (décodage hors fil principal, anneau borné) ----------------
    const MAX_IMAGES = options.maxImages || 3;
    const cache = new Map();      // url -> Promise<{ bitmap, sx, sy, sw, sh }>

    function oublier(url) {
        const p = cache.get(url);
        cache.delete(url);
        if (p) p.then(r => r && r.bitmap.close && r.bitmap.close()).catch(() => {});
    }

    // Rectangle (pixels de toile) où poser l'image entière de l'emprise
    function cadreImage() {
        const k = echelle(), p = projection();
        const [o, s, e, n] = sequence.emprise;
        const [x0, y0] = p([o, n]);
        const [x1, y1] = p([e, s]);
        return [x0 * k, y0 * k, (x1 - x0) * k, (y1 - y0) * k];
    }

    function zoneVisible(largeur, hauteur) {
        const [dx, dy, dw, dh] = cadreImage();
        const fx = largeur / dw, fy = hauteur / dh;
        const sx = Math.max(0, Math.floor((0 - dx) * fx) - 2);
        const sy = Math.max(0, Math.floor((0 - dy) * fy) - 2);
        const ex = Math.min(largeur, Math.ceil((toile.width - dx) * fx) + 2);
        const ey = Math.min(hauteur, Math.ceil((toile.height - dy) * fy) + 2);
        return { sx, sy, sw: Math.max(1, ex - sx), sh: Math.max(1, ey - sy) };
    }

    function imageEnCache(url) {
        if (cache.has(url)) {
            const p = cache.get(url);
            cache.delete(url);
            cache.set(url, p);            // la plus récemment utilisée en dernier
            return p;
        }
        const seq = sequence;
        const promesse = fetch(url)
            .then(r => {
                if (!r.ok) throw new Error(`${url} : ${r.status}`);
                return r.blob();
            })
            .then(async blob => {
                const { sx, sy, sw, sh } = zoneVisible(seq.largeur, seq.hauteur);
                // Taille utile à l'écran : inutile de garder plus de pixels
                const [, , dw] = cadreImage();
                const facteur = Math.min(1, dw / seq.largeur * 1.05);
                const choix = { resizeWidth: Math.max(1, Math.round(sw * facteur)),
                                resizeHeight: Math.max(1, Math.round(sh * facteur)),
                                resizeQuality: "high" };
                let bitmap;
                try {
                    bitmap = await createImageBitmap(blob, sx, sy, sw, sh, facteur < 0.98 ? choix : undefined);
                } catch (e) {
                    bitmap = await createImageBitmap(blob);
                    return { bitmap, sx: 0, sy: 0, sw: seq.largeur, sh: seq.hauteur };
                }
                return { bitmap, sx, sy, sw, sh };
            })
            .catch(erreur => {
                if (cache.get(url) === promesse) cache.delete(url);
                throw erreur;
            });
        cache.set(url, promesse);
        while (cache.size > MAX_IMAGES) oublier(cache.keys().next().value);
        return promesse;
    }

    function poser(r) {
        const W = toile.width, H = toile.height;
        const [dx, dy, dw, dh] = cadreImage();
        const fx = dw / sequence.largeur, fy = dh / sequence.hauteur;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = FOND;
        ctx.fillRect(0, 0, W, H);
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(r.bitmap, dx + r.sx * fx, dy + r.sy * fy, r.sw * fx, r.sh * fy);
    }

    function dessinerVoile() {
        const c = voile.getContext("2d");
        const W = voile.width, H = voile.height;
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.clearRect(0, 0, W, H);
        const v = c.createRadialGradient(W * 0.52, H * 0.45, Math.min(W, H) * 0.25,
                                         W * 0.52, H * 0.45, Math.hypot(W, H) * 0.62);
        v.addColorStop(0, `rgba(${VOILE.join(",")}, 0)`);
        v.addColorStop(1, `rgba(${VOILE.join(",")}, ${VOILE_OPACITE})`);
        c.fillStyle = v;
        c.fillRect(0, 0, W, H);
    }

    function trameA(instant) {
        const t = sequence.trames;
        let i = 0;
        while (i + 1 < t.length && t[i + 1].ms <= instant) i++;
        return i;
    }

    // Pose l'image exacte de l'observation (asynchrone ; la précédente reste
    // affichée tant que la nouvelle n'est pas prête)
    function afficherImage(index, prechargement) {
        const trame = sequence.trames[index];
        if (!trame) return Promise.resolve(false);
        if (affichee === trame.image) return Promise.resolve(true);
        if (demandee === trame.image) return demandee.promesse;
        const seq = sequence, j = jeton;
        const promesse = imageEnCache(trame.image).then(r => {
            if (seq !== sequence || j !== jeton) return false;
            poser(r);
            affichee = trame.image;
            if (options.surImage) options.surImage(trame);
            if (prechargement) {
                for (let k = 1; k < MAX_IMAGES; k++) {
                    const suivante = sequence.trames[index + k];
                    if (suivante) imageEnCache(suivante.image).catch(() => {});
                }
            }
            return true;
        }).catch(erreur => {
            console.warn("HKO satellite :", erreur.message);
            return false;
        }).finally(() => {
            if (demandee && demandee.url === trame.image) demandee = null;
        });
        demandee = { url: trame.image, promesse };
        return promesse;
    }

    // --- Vidéo ----------------------------------------------------------------
    const videos = [0, 1].map(() => {
        const v = document.createElement("video");
        v.muted = true;
        v.playsInline = true;
        v.preload = "metadata";        // la vidéo ne se charge qu'à la lecture
        v.disablePictureInPicture = true;
        v.setAttribute("aria-hidden", "true");
        v.className = "video-satellite";
        conteneur.appendChild(v);
        return v;
    });
    let active = 0;                // indice de la vidéo en cours
    let videoInfo = null;          // { url, debut, spi, fps, fin }
    let presente = null;           // instant (ms) de l'image vidéo présentée
    let videoVisible = false;
    let enAttente = null;          // bascule vers une nouvelle version de la vidéo
    let lectureVoulue = false;
    let lancement = false;         // play() demandé, première image pas encore présentée
    let blocage = null;

    const video = () => videos[active];

    function instantDeTemps(info, t) {
        const image = Math.floor(t * info.fps + 1e-3);
        return info.debut + image * info.spi;
    }

    function tempsDInstant(info, instant) {
        const image = Math.max(0, Math.floor((instant - info.debut) / info.spi + 1e-6));
        return (image + 0.5) / info.fps;
    }

    function suivreImages(v, info) {
        if (!rvfc) return;
        const surImage = (_, meta) => {
            if (v !== video() || videoInfo !== info) return;
            presente = instantDeTemps(info, meta.mediaTime);
            lancement = false;
            if (!videoVisible && lectureVoulue) montrerVideo(true);
            v.requestVideoFrameCallback(surImage);
        };
        v.requestVideoFrameCallback(surImage);
    }

    function montrerVideo(oui) {
        videoVisible = oui;
        for (const [i, v] of videos.entries()) v.classList.toggle("visible", oui && i === active);
    }

    function infoVideo(seq) {
        const v = seq && seq.video;
        if (!v) return null;
        return {
            url: v.url, fps: v.fps,
            debut: Date.parse(v.debut),
            spi: v.secondes_par_image * 1000,
            fin: Date.parse(v.fin),
            observations: v.observations
        };
    }

    function chargerVideo(info) {
        if (!info) {
            for (const v of videos) { v.pause(); v.removeAttribute("src"); v.load(); }
            videoInfo = null;
            montrerVideo(false);
            return;
        }
        if (videoInfo && videoInfo.url === info.url) return;

        const enCours = videoInfo && !video().paused && videoVisible;
        if (!enCours) {
            // Rien à préserver : on remplace directement
            const v = video();
            v.src = info.url;
            videoInfo = info;
            presente = null;
            suivreImages(v, info);
            return;
        }
        // Lecture en cours : la nouvelle version se prépare à côté, puis
        // prend le relais exactement à la même heure (pas de saut visible).
        const autre = 1 - active;
        const v = videos[autre];
        enAttente = info;
        v.src = info.url;
        v.addEventListener("loadeddata", function basculer() {
            v.removeEventListener("loadeddata", basculer);
            if (enAttente !== info) return;
            const instant = presente ?? info.debut;
            v.currentTime = tempsDInstant(info, instant);
            v.playbackRate = video().playbackRate;
            v.play().then(() => {
                if (enAttente !== info) return;
                const ancienne = video();
                active = autre;
                videoInfo = info;
                enAttente = null;
                suivreImages(v, info);
                montrerVideo(true);
                ancienne.pause();
                ancienne.removeAttribute("src");
                ancienne.load();
            }).catch(() => { enAttente = null; });
        });
    }

    function abandonnerVideo(motif) {
        if (mode !== "video") return;
        mode = "images";
        console.info("HKO satellite : lecture vidéo abandonnée —", motif);
        if (journal) journal({ type: "satellite_video", motif });
        chargerVideo(null);
    }

    for (const v of videos) {
        v.addEventListener("error", () => {
            if (v === video() && videoInfo) abandonnerVideo(`erreur ${v.error && v.error.code}`);
        });
        v.addEventListener("waiting", () => {
            if (v !== video()) return;
            clearTimeout(blocage);
            blocage = setTimeout(() => {
                if (v === video() && lectureVoulue && v.readyState < 3) abandonnerVideo("chargement trop lent");
            }, 8000);
        });
        v.addEventListener("playing", () => {
            clearTimeout(blocage);
            if (!rvfc && v === video()) {
                lancement = false;
                if (lectureVoulue) montrerVideo(true);
            }
        });
    }

    function placerVideos() {
        if (!sequence) return;
        const k = echelle();
        const [dx, dy, dw, dh] = cadreImage();
        for (const v of videos) {
            v.style.left = `${dx / k}px`;
            v.style.top = `${dy / k}px`;
            v.style.width = `${dw / k}px`;
            v.style.height = `${dh / k}px`;
        }
    }

    function vitesse(info) {
        // Une boucle complète dure DUREE_BOUCLE (comme le lecteur d'images)
        const t = sequence.trames;
        const duree = (Math.min(info.fin, t.at(-1).ms) - t[0].ms) / info.spi / info.fps;
        return Math.max(0.0625, Math.min(16, duree / (options.dureeBoucle / 1000)));
    }

    // --- Interface ------------------------------------------------------------
    return {
        get sequence() { return sequence; },
        get mode() { return mode; },
        // Quelque chose est à l'écran : image posée ou vidéo en lecture
        get pret() { return affichee !== null || (videoVisible && presente !== null); },

        charger(nouvelle) {
            const memeJour = sequence && sequence.jour === nouvelle.jour && sequence.profil === nouvelle.profil;
            sequence = nouvelle;
            jeton++;
            if (!memeJour) {
                for (const url of [...cache.keys()]) oublier(url);
                affichee = null;
                demandee = null;
                chargerVideo(null);
            }
            placerVideos();
            if (mode === "video") chargerVideo(infoVideo(nouvelle));
        },

        situation(instant) {
            if (!sequence || !sequence.trames.length) return null;
            const i = trameA(instant);
            const t = sequence.trames;
            const suivante = t[i + 1];
            return {
                avant: i,
                observee: true,
                lacune: Boolean(suivante && suivante.ms - t[i].ms > LACUNE && instant - t[i].ms > LACUNE)
            };
        },

        // Pilotage : vrai quand la vidéo donne l'heure (lecture en cours)
        pilote() {
            return Boolean(mode === "video" && lectureVoulue && videoInfo && !video().paused &&
                           presente !== null && !lancement);
        },

        // Vrai si cet instant sera montré par la vidéo (lecture) : tant
        // qu'elle démarre, l'heure de la frise attend au lieu d'avancer seule.
        utiliseVideo(instant) {
            return Boolean(mode === "video" && videoInfo && instant < videoInfo.fin && !document.hidden);
        },

        instantVideo() {
            if (!this.pilote()) return null;
            if (!rvfc) presente = instantDeTemps(videoInfo, video().currentTime);
            return presente;
        },

        dessiner({ instant, lecture }) {
            if (!sequence || !sequence.trames.length) return;
            const t = sequence.trames;
            const index = trameA(instant);
            const info = videoInfo;
            const fin = t.at(-1).ms;
            const videoPossible = mode === "video" && info && instant < info.fin && !document.hidden;

            if (lecture && videoPossible) {
                lectureVoulue = true;
                // Rien encore à l'écran : l'image (légère) en attendant la vidéo
                if (!videoVisible && affichee === null && !demandee) afficherImage(index, false);
                const v = video();
                const cible = tempsDInstant(info, instant);
                const ecart = presente === null ? Infinity : Math.abs(presente - instant);
                if (v.paused) {
                    if (!lancement && instant < Math.min(fin, info.fin)) {
                        if (Math.abs(v.currentTime - cible) > 0.5 / info.fps) v.currentTime = cible;
                        v.playbackRate = vitesse(info);
                        lancement = true;
                        presente = null;
                        v.play().catch(erreur => {
                            lancement = false;
                            if (erreur.name !== "AbortError") abandonnerVideo(erreur.name);
                        });
                    }
                } else if (!lancement && ecart > 2 * info.spi) {
                    v.currentTime = cible;        // saut demandé (retour au début de la boucle)
                }
                // Fin de la partie encodée : on s'arrête sur l'image exacte
                if (presente !== null && presente >= Math.min(fin, info.fin)) v.pause();
                return;
            }

            // Arrêt, ou au-delà de la vidéo : l'image exacte de l'observation
            lectureVoulue = false;
            lancement = false;
            const v = video();
            if (!v.paused) v.pause();
            afficherImage(index, lecture).then(ok => {
                if (ok && !lectureVoulue && videoVisible) montrerVideo(false);
            });
        },

        cadrer() {
            jeton++;
            for (const url of [...cache.keys()]) oublier(url);   // recadrage : nouvelles découpes
            affichee = null;
            demandee = null;
            dessinerVoile();
            placerVideos();
        },

        // Le tableau satellite n'est plus affiché : plus aucun décodage
        suspendre() {
            lectureVoulue = false;
            lancement = false;
            for (const v of videos) v.pause();
        },

        liberer() {
            this.suspendre();
            chargerVideo(null);
            for (const url of [...cache.keys()]) oublier(url);
            affichee = null;
        },

        dessinerVoile
    };
}

window.HKOSatellite = { creer };

})();
