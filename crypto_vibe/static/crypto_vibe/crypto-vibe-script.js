// Données globales
let btcData = [];
let ethData = [];
let solData = [];
let currentChart = null;
let initialScrollPosition = 0;
let labels = {};

const timestamps = {}; // timestamps[crypto] = [ISO strings]
let selectedCrypto = 'bitcoin';

window.CV = window.CV || {};

const LIVE_CHART_UPDATES = false;

const SOURCE_WEIGHT = { reddit: 0.7, news: 0.3 }; // à ajuster par crypto si besoin

const cryptoAliasMap = {
    ripple: "xrp",
    // Tu peux en ajouter d'autres si besoin : exemple
    // bitcoin-cash: "bch"
};

// Placeholder à 24 points (utilisé uniquement en cas d'erreur)
const placeholderData = {
    bitcoin: {
        data: [
            99753, 99630, 99270, 98666, 97846, 98072, 98333, 97487,
            97705, 98139, 97966, 98027, 98204, 98333, 98311, 98063,
            98329, 98095, 98021, 97986, 98141, 97821, 97706, 97272
        ],
        labels: [
            '22h', '23h', '00h', '01h', '02h', '03h', '04h', '05h',
            '06h', '07h', '08h', '09h', '10h', '11h', '12h', '13h',
            '14h', '15h', '16h', '17h', '18h', '19h', '20h', '21h'
        ]
    },
    ethereum: {
        data: [
            3125.8, 3111.1, 3097, 3084, 3038, 3047, 3057, 2987,
            3008, 3025, 3029, 3037, 3039, 3045, 3035, 3001,
            3034, 3012, 3010, 3011, 3025, 3026, 2944.85, 2944.85
        ],
        labels: [
            '22h', '23h', '00h', '01h', '02h', '03h', '04h', '05h',
            '06h', '07h', '08h', '09h', '10h', '11h', '12h', '13h',
            '14h', '15h', '16h', '17h', '18h', '19h', '20h', '21h'
        ]
    },
    solana: {
        data: [
            145.79, 145.16, 144.35, 143.98, 143.74, 141.16, 141.67, 138.86,
            142.29, 142.29, 141.62, 141.62, 140.96, 140.96, 140.31, 140.31,
            139.67, 139.67, 139.04, 139.04, 136.49, 136.49, 136.49, 136.49
        ],
        labels: [
            '22h', '23h', '00h', '01h', '02h', '03h', '04h', '05h',
            '06h', '07h', '08h', '09h', '10h', '11h', '12h', '13h',
            '14h', '15h', '16h', '17h', '18h', '19h', '20h', '21h'
        ]
    }
};

// ====== FETCH CACHE (coalescing + TTL) ======
const __fetchCache = new Map();   // key -> { data, expiry }
const __inflight = new Map();     // key -> Promise



function fetchJSONCached(url, { ttl = 60_000, init = {} } = {}) {
    const now = Date.now();
    const key = url + '|' + (init.method || 'GET');

    // mémoire
    const cached = __fetchCache.get(key);
    if (cached && cached.expiry > now) return Promise.resolve(cached.data);

    // coalesce
    if (__inflight.has(key)) return __inflight.get(key);

    const p = fetch(url, { cache: 'no-store', credentials: 'same-origin', ...init })
        .then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status} on ${url}`);
            const ct = r.headers.get('content-type') || '';
            return ct.includes('application/json') ? r.json() : r.text();
        })
        .then(json => {
            __fetchCache.set(key, { data: json, expiry: now + ttl });
            __inflight.delete(key);
            return json;
        })
        .catch(e => { __inflight.delete(key); throw e; });

    __inflight.set(key, p);
    return p;
}

// ====== THROTTLE / DEBOUNCE ======
function throttle(fn, interval) {
    let last = 0, timer = null, lastArgs = null;
    return function (...args) {
        const now = Date.now();
        if (now - last >= interval) {
            last = now;
            fn.apply(this, args);
        } else {
            lastArgs = args;
            clearTimeout(timer);
            timer = setTimeout(() => {
                last = Date.now();
                fn.apply(this, lastArgs);
                lastArgs = null;
            }, interval - (now - last));
        }
    };
}
function debounce(fn, wait) {
    let t = null;
    return function (...args) {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), wait);
    };
}

// Rotation des vibes (simplifiée : pas de rotation, affiche Reddit)
function rotateVibes(card) {
    if (card.dataset.vibeInit === '1') return;
    card.dataset.vibeInit = '1';
    const rotator = card.querySelector('.vibe-rotator');
    if (!rotator) return;

    const vibeItems = rotator.querySelectorAll('.vibe-item');
    if (vibeItems.length === 0) return;

    let currentIndex = 0;
    vibeItems.forEach(item => item.style.display = 'none');
    vibeItems[currentIndex].style.display = '';

    const nextBtn = rotator.querySelector('.vibe-next-btn');
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            vibeItems[currentIndex].style.display = 'none';
            currentIndex = (currentIndex + 1) % vibeItems.length;
            vibeItems[currentIndex].style.display = '';
        });
    }
}

// Définir les datasets, labels et prix dynamiquement
const datasets = {};

const cachedPrices = {};
let lastPriceFetch = 0;
const PRICE_CACHE_DURATION = 60 * 1000; // 1 minute

// mémos globaux (si pas déjà déclarés)
window.timestamps = window.timestamps || {};
window.selectedCrypto = window.selectedCrypto || 'bitcoin';

async function preloadHistory() {
    const cryptos = ['bitcoin', 'ethereum', 'xrp', 'tether', 'bnb', 'solana', 'usdc', 'dogecoin', 'tron', 'cardano'];
    const fetchPromises = cryptos.map(async (crypto) => {
        try {
            // 👉 Sans include_current=1 pour avoir seulement les données horaires
            const response = await fetch(`/history/${crypto}/?hours=24&include_current=0`, { cache: 'no-store', credentials: 'same-origin' });
            const data = await response.json();
            datasets[crypto] = data.map(e => e.price_eur).filter(p => p != null && !isNaN(p));
            labels[crypto] = data.map(e => new Date(e.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit' }));
            cachedPrices[crypto] = datasets[crypto].length ? datasets[crypto][datasets[crypto].length - 1] : null;
            console.log(`Données chargées (horaire) pour ${crypto}:`, datasets[crypto].length, "points");
        } catch (err) {
            console.error(`Erreur pour ${crypto}:`, err);
            datasets[crypto] = placeholderData[crypto]?.data || [];
            labels[crypto] = placeholderData[crypto]?.labels || [];
            cachedPrices[crypto] = null;
        }
    });
    await Promise.all(fetchPromises);
    updateChart('bitcoin');
}

// Helper de validation souple (anti-valeurs absurdes d’API)
function isPriceValid(crypto, value) {
    const p = Number(value);
    if (!Number.isFinite(p) || p <= 0) return false;
    const MAX = { bitcoin: 2_000_000 };      // Plafond large pour BTC
    const max = MAX[crypto] || 1_000_000;     // Défaut large pour les autres
    return p < max;
}

async function updatePriceDisplay() {
    const CRYPTOS = ['bitcoin', 'ethereum', 'xrp', 'tether', 'bnb', 'solana', 'usdc', 'dogecoin', 'tron', 'cardano'];
    const now = Date.now();

    // 1) Utilisation du cache en mémoire si encore frais
    if (now - lastPriceFetch < PRICE_CACHE_DURATION && Object.keys(cachedPrices).length > 0) {
        console.log('Utilisation des prix en cache');
        for (const crypto of CRYPTOS) {
            const priceElement = document.getElementById(`price-${crypto}`);
            if (!priceElement) {
                console.error(`Élément prix non trouvé pour ${crypto}`);
                continue;
            }
            const p = cachedPrices[crypto];
            priceElement.textContent = (p != null && isPriceValid(crypto, p)) ? `${Number(p).toFixed(2)} €` : 'Indisponible';
        }
        return;
    }

    // 2) Fetch des derniers prix sauvegardés en DB
    try {
        const data = await fetchJSONCached('/api/prices/latest/', { ttl: 55_000 });

        for (const crypto of CRYPTOS) {
            const priceElement = document.getElementById(`price-${crypto}`);
            if (!priceElement) {
                console.error(`Élément prix non trouvé pour ${crypto}`);
                continue;
            }

            const info = data[crypto];                // attendu: { price, timestamp }
            const dbPrice = info?.price != null ? Number(info.price) : null;
            const cachePrice = cachedPrices[crypto] != null ? Number(cachedPrices[crypto]) : null;

            let chosen = null;
            let source = 'AUCUNE';

            // On privilégie la DB si valide
            if (isPriceValid(crypto, dbPrice)) {
                chosen = dbPrice;
                source = 'DB (sauvegardée)';
            } else if (isPriceValid(crypto, cachePrice)) {
                // Sinon on tombe sur le cache valide
                chosen = cachePrice;
                source = 'CACHE';
                console.warn(`Prix indisponible/aberrant pour ${crypto} (DB=${dbPrice}), utilisé cache: ${cachePrice}`);
            } else {
                // Rien de valide
                console.warn(`Prix indisponible pour ${crypto} (DB=${dbPrice}, CACHE=${cachePrice})`);
            }

            // MAJ cache mémoire avec le choix (même null pour signaler indispo)
            cachedPrices[crypto] = chosen;

            // Affichage
            priceElement.textContent = (chosen != null) ? `${chosen.toFixed(2)} €` : 'Indisponible';
            if (chosen != null) {
                console.log(`🔢 Prix affiché pour ${crypto}: ${chosen.toFixed(2)} €`);
                console.log(`${source === 'CACHE' ? '📦' : '🛰️'} Source utilisée pour ${crypto}: ${source}`);
            }
        }

        lastPriceFetch = now;

    } catch (error) {
        console.error('Erreur récupération des prix:', error);
        // Fallback total: afficher le cache s’il existe
        for (const crypto of CRYPTOS) {
            const priceElement = document.getElementById(`price-${crypto}`);
            if (!priceElement) continue;
            const p = cachedPrices[crypto];
            priceElement.textContent = (p != null && isPriceValid(crypto, p)) ? `${Number(p).toFixed(2)} €` : 'Indisponible';
        }
    }
}

async function updateVibeDisplay() {
    const cryptos = ['bitcoin', 'ethereum', 'xrp', 'tether', 'bnb', 'solana', 'usdc', 'dogecoin', 'tron', 'cardano'];
    const sources = ['reddit'];
    const tasks = [];

    for (const crypto of cryptos) {
        const displayName = cryptoAliasMap[crypto] || crypto;
        for (const source of sources) {
            const task = fetch(`/api/vibe/${crypto}/${source}/`, { cache: 'no-store', credentials: 'same-origin' })
                .then(response => response.json())
                .then(data => {
                    const vibeElement = document.getElementById(`vibe-${displayName}-${source}`);
                    const scoreElement = document.getElementById(`score-${displayName}-${source}`);
                    const predElement = document.getElementById(`pred-${displayName}-${source}`);
                    const confidenceElement = document.getElementById(`pred-confidence-${displayName}-${source}`);

                    if (vibeElement) vibeElement.textContent = data.vibe || 'Inconnu';
                    if (scoreElement) scoreElement.textContent = data.score ? `(${data.score.toFixed(4)})` : '';

                    if (predElement) {
                        const predWrapper = predElement.parentElement;
                        predWrapper.innerHTML = '';
                        const now = new Date();
                        now.setHours(now.getHours() + 1);
                        const predTime = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

                        const label = document.createElement('span');
                        label.className = 'prediction-label';
                        label.textContent = `Prédiction à ${predTime}: `;

                        predWrapper.appendChild(label);
                        predWrapper.appendChild(predElement);

                        predElement.textContent = data.predicted_price
                            ? `${parseFloat(data.predicted_price).toFixed(2)} €`
                            : 'N/A';
                    }

                    if (confidenceElement) {
                        const confWrapper = confidenceElement.parentElement;
                        confWrapper.innerHTML = '';

                        const label = document.createElement('span');
                        label.className = 'confidence-label';
                        label.textContent = 'Confiance: ';

                        confWrapper.appendChild(label);
                        confWrapper.appendChild(confidenceElement);

                        confidenceElement.textContent = data.confidence
                            ? `${data.confidence}%`
                            : 'N/A';
                    }
                })
                .catch(error => {
                    console.error(`Erreur mise à jour vibe pour ${crypto}/${source}:`, error);
                });

            tasks.push(task);
        }
    }

    await Promise.all(tasks);
}

function niceStep(step) {
    const s = Math.max(step || 1, 1e-12);
    const exp = Math.floor(Math.log10(s));
    const f = s / Math.pow(10, exp);
    const nice = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
    return nice * Math.pow(10, exp);
}
function quantile(sortedArr, q) {
    if (!sortedArr.length) return null;
    const pos = (sortedArr.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    return sortedArr[base + 1] !== undefined
        ? sortedArr[base] + rest * (sortedArr[base + 1] - sortedArr[base])
        : sortedArr[base];
}

function updateChart(crypto) {
    const rawValues = datasets[crypto] || [];
    const rawLabels = labels[crypto] || [];
    const label = crypto.charAt(0).toUpperCase() + crypto.slice(1);
    const chartLoading = document.getElementById('chart-loading');
    const canvas = document.querySelector('#price-chart');

    if (!canvas) {
        console.error('Canvas #price-chart non trouvé');
        return;
    }

    // Nettoyage valeurs/labels en conservant l’alignement
    const values = [];
    const labelsClean = [];
    for (let i = 0; i < rawValues.length; i++) {
        const v = Number(rawValues[i]);
        if (isPriceValid(crypto, v)) {
            values.push(v);
            labelsClean.push(rawLabels[i]);
        }
    }

    if (values.length < 2) {
        if (chartLoading) chartLoading.classList.remove('hidden');
        canvas.classList.remove('visible');
        console.warn(`Données insuffisantes pour ${crypto}`);
        return;
    }

    if (chartLoading) chartLoading.classList.add('hidden');
    canvas.classList.add('visible');

    if (window.currentChart) {
        window.currentChart.destroy();
    }

    const smallWindowAssets = new Set(['usdc', 'tether', 'dogecoin', 'tron', 'cardano']);
    const lowPriceAssets = new Set(['usdc', 'tether', 'dogecoin', 'tron', 'cardano', 'xrp']);

    const WINDOW_POINTS = smallWindowAssets.has(crypto) ? 24 : 48; // usdc/tether => 24 pts
    const dataValues = smallWindowAssets.has(crypto) ? values.slice(-WINDOW_POINTS) : values;
    const dataLabels = smallWindowAssets.has(crypto) ? labelsClean.slice(-WINDOW_POINTS) : labelsClean;

    const sorted = [...dataValues].sort((a, b) => a - b);
    const minVal = sorted[0];
    const maxVal = sorted[sorted.length - 1];
    const span = Math.max(maxVal - minVal, 0);

    const baseFrac =
        (crypto === 'usdc' || crypto === 'tether') ? 0.02 :
            smallWindowAssets.has(crypto) ? 0.10 :
                0.12;

    const median = sorted[Math.floor(sorted.length / 2)];
    let minPadAbs;
    if (crypto === 'usdc' || crypto === 'tether') {
        minPadAbs = Math.max(median * 0.0002, 0.00005);
    } else if (lowPriceAssets.has(crypto)) {
        minPadAbs = Math.max(median * 0.0025, 0.0008);
    } else {
        minPadAbs = Math.max(median * 0.003, 1);
    }

    const pad = Math.max(span * baseFrac, minPadAbs);
    let yMin = minVal - pad;
    let yMax = maxVal + pad;

    const desiredTicks =
        (crypto === 'usdc' || crypto === 'tether' || lowPriceAssets.has(crypto)) ? 12 : 10;
    const stepSize = niceStep((yMax - yMin) / desiredTicks);
    const yMinNice = Math.floor(yMin / stepSize) * stepSize;
    const yMaxNice = Math.ceil(yMax / stepSize) * stepSize;

    const yEqual = (yMaxNice - yMinNice) === 0;
    const yMinFinal = yEqual ? yMinNice - stepSize : yMinNice;
    const yMaxFinal = yEqual ? yMaxNice + stepSize : yMaxNice;

    const finalStep =
        (crypto === 'usdc' || crypto === 'tether' || lowPriceAssets.has(crypto)) ? stepSize / 2 : stepSize;

    window.currentChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels: dataLabels,
            datasets: [{
                label: `${label} Prix (€)`,
                data: dataValues,
                borderColor: crypto === 'bitcoin' ? '#f7931a' :
                    crypto === 'ethereum' ? '#627eea' :
                        crypto === 'xrp' ? '#222f3e' :
                            crypto === 'tether' ? '#26a17b' :
                                crypto === 'bnb' ? '#f3ba2f' :
                                    crypto === 'solana' ? '#00a68c' :
                                        crypto === 'usdc' ? '#2775ca' :
                                            crypto === 'dogecoin' ? '#c2a633' :
                                                crypto === 'tron' ? '#ff0000' :
                                                    crypto === 'cardano' ? '#0033ad' : '#ff1654',
                fill: false,
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { title: { display: true, text: 'Heure' } },
                y: {
                    title: { display: true, text: 'Prix (€)' },
                    beginAtZero: false,
                    min: yMinFinal,
                    max: yMaxFinal,
                    ticks: {
                        stepSize: finalStep,
                        callback: (v) => (crypto === 'usdc' || crypto === 'tether')
                            ? Number(v).toFixed(4)
                            : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 2 })
                    }
                }
            },
            animation: {
                duration: 500,
                easing: 'easeInOutQuad'
            }
        }
    });

    console.log(`Chart ${crypto} — window=${dataValues.length} pts, y:[${yMinNice}..${yMaxNice}], step=${finalStep}`);
}

function selectCard(card) {
    document.querySelectorAll('.crypto-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    const crypto = card.dataset.crypto;
    window.activeChartCrypto = crypto;   // ← garde la sélection courante
    updateChart(crypto);
}

function zoomToDetails(crypto) { updateChart(crypto); }


function updateScrollBtns() {
    const shell = document.querySelector('.scroll-shell');
    const container = shell?.querySelector('.horizontal-scroll-container');
    const leftBtn = shell?.querySelector('.scroll-btn.left');
    const rightBtn = shell?.querySelector('.scroll-btn.right');
    if (!container || !leftBtn || !rightBtn) return;

    const max = container.scrollWidth - container.clientWidth;
    const x = container.scrollLeft;

    leftBtn.toggleAttribute('disabled', x <= 1);
    rightBtn.toggleAttribute('disabled', x >= max - 1);
}

function scrollCards(direction) {
    const container = document.querySelector('.horizontal-scroll-container');
    if (!container) return;
    const CARD_W = 300 + 12; // largeur carte + gap (mets tes valeurs)
    container.scrollBy({ left: direction * CARD_W, behavior: 'smooth' });
    // petit délai pour laisser le scroll se produire puis MAJ des boutons
    setTimeout(updateScrollBtns, 180);
}

// MAJ auto des boutons quand on scrolle
document.addEventListener('DOMContentLoaded', () => {
    const container = document.querySelector('.horizontal-scroll-container');
    if (!container) return;
    container.addEventListener('scroll', () => {
        // throttle léger
        if (window.__sb_t) cancelAnimationFrame(window.__sb_t);
        window.__sb_t = requestAnimationFrame(updateScrollBtns);
    });
    updateScrollBtns();
});


// Applique les classes CSS dynamiques
function applySentimentClasses(span, sentiment) {
    if (!span) return;
    span.classList.remove('positif', 'neutre', 'negatif');
    const classe = sentiment.toLowerCase();
    span.classList.add(classe);
}

// Affiche les flèches montantes/descendantes
function updateArrowIcon(crypto, source, currentPrice, predictedPrice) {
    const arrowSpan = document.getElementById(`arrow-${crypto}-${source}`);
    if (!arrowSpan || !currentPrice || !predictedPrice) return;

    arrowSpan.className = 'arrow-icon';
    if (predictedPrice > currentPrice) {
        arrowSpan.classList.add('up');
    } else if (predictedPrice < currentPrice) {
        arrowSpan.classList.add('down');
    }
}

// Affiche les données de vibe (par ligne Reddit/News)
function displayVibeData(data, crypto, source) {
    const card = document.querySelector(`.crypto-card[data-crypto="${crypto}"]`);
    if (!card) return;

    const row = card.querySelector(`.vibe-item[data-vibe="${source}"]`);
    const vibeSpan = card.querySelector(`#vibe-${crypto}-${source}`) || row?.querySelector('.sentiment-value');
    const scoreSpan = card.querySelector(`#score-${crypto}-${source}`) || row?.querySelector('.sentiment-score');
    if (!row || !vibeSpan || !scoreSpan) return;

    // Texte + classes
    vibeSpan.textContent = data?.vibe ?? '—';
    scoreSpan.textContent = (typeof data?.score === 'number') ? `(${data.score.toFixed(2)})` : '';
    applySentimentClasses(vibeSpan, data?.vibe || 'Neutre');

    // Prix courant pour la flèche
    if (typeof data?.price_eur === 'number') {
        row.dataset.priceEur = String(data.price_eur);
    }

    // Remplir la puce tout de suite si l’API vibe donne déjà une prédiction
    const priceEl = row.querySelector('.source-chip .src-price');
    const confEl = row.querySelector('.source-chip .src-conf');
    if (priceEl && confEl && typeof data?.predicted_price === 'number') {
        priceEl.textContent = Number(data.predicted_price).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        confEl.textContent = (typeof data.confidence === 'number') ? `${Number(data.confidence).toFixed(1)}%` : '—';
        row.dataset.predPrice = String(data.predicted_price);
    }

    // Flèche (avec ce qu’on a sous la main)
    const predicted = (typeof data?.predicted_price === 'number')
        ? data.predicted_price
        : (row.dataset.predPrice ? Number(row.dataset.predPrice) : null);

    if (data?.price_eur && predicted) {
        updateArrowIcon(crypto, source, data.price_eur, predicted);
    }
}

// Récupère les données de vibe
function fetchVibe(crypto, source) {
    if (source !== 'reddit') return Promise.resolve();
    const url = `/api/vibe/${crypto}/${source}/`;
    return fetchJSONCached(url, { ttl: 60_000 })
        .then(data => displayVibeData(data, crypto, source))
        .catch(error => {
            console.error(`Erreur fetch vibe ${crypto}/${source}:`, error);
            displayVibeData({
                vibe: 'Erreur',
                score: 0,
                price_eur: 0,
                predicted_price: 0,
                prediction_time: new Date(Date.now() + 3600000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h'),
                source
            }, crypto, source);
        });
}

// Charge les news (robuste aux champs différents) puis lance la rotation
function loadNews() {
    const mainTicker = document.querySelector('.ticker-content-fixed');
    if (!mainTicker) {
        console.warn('[loadNews] bloc ticker-content-fixed absent, skip');
        return;
    }

    fetch('/api/news/?source=reddit', { cache: 'no-store', credentials: 'same-origin' })
        .then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
        })
        .then(payload => {
            mainTicker.innerHTML = '';
            const rows = Array.isArray(payload) ? payload : [];
            const getText = (it) => it?.text ?? it?.title ?? it?.headline ?? it?.content ?? '';
            const getLink = (it) => it?.link ?? it?.url ?? '#';

            rows.forEach((item) => {
                const txt = String(getText(item)).trim();
                if (!txt) return;

                // Toute la ligne devient un anchor cliquable
                const a = document.createElement('a');
                a.className = 'ticker-item ticker-item--incoming';
                a.href = getLink(item) || '#';
                a.target = '_blank';
                a.rel = 'noopener';

                // Logo Reddit
                const logo = document.createElement('img');
                logo.src = '/static/crypto_vibe/img/reddit-logo.png';
                logo.className = 'ticker-logo';
                logo.alt = 'Reddit';
                a.appendChild(logo);

                // Texte
                const textSpan = document.createElement('span');
                textSpan.className = 'ticker-text';
                textSpan.textContent = txt;
                a.appendChild(textSpan);

                mainTicker.appendChild(a);
            });

            if (!mainTicker.children.length) {
                console.warn('[loadNews] aucun item valide, affichage fallback');
                mainTicker.innerHTML = '<span class="ticker-item ticker-item--incoming">Aucune info</span>';
            }

            // Activer le premier
            const m0 = mainTicker.firstElementChild;
            if (m0) {
                m0.classList.remove('ticker-item--incoming');
                m0.classList.add('ticker-item--active');
            }

            // (ré)initialiser le contrôleur de rotation
            const controller = (window.CV && window.CV.white && window.CV.white.init)
                ? window.CV.white.init(mainTicker)
                : null;
            if (controller && controller.reset) controller.reset();
        })
        .catch(err => {
            console.error('[loadNews] erreur:', err);
            mainTicker.innerHTML = '<span class="ticker-item ticker-item--incoming">Erreur chargement news</span>';
            setTimeout(() => {
                const controller = window.CV?.white?.init?.(mainTicker);
                controller?.reset?.();
            }, 100);
        });
}

// Formate l'étiquette "HH:MM" comme dans preloadHistory()
function formatTimeLabel(isoTs) {
    try {
        return new Date(isoTs).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } catch { return isoTs; }
}

// Récupère le dernier point pour une crypto (1 seul)
async function fetchLastPoint(crypto) {
    const res = await fetch(`/history/${crypto}/?limit=1`, { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const arr = await res.json();
    return Array.isArray(arr) && arr.length ? arr[arr.length - 1] : null;
}

// --- helpers ---
const getSelectedCrypto = () => {
    const el = document.querySelector('.crypto-card.selected');
    return el ? el.dataset.crypto : 'bitcoin';
};
const getActiveCrypto = () => {
    if (typeof activeChartCrypto !== 'undefined' && activeChartCrypto) return activeChartCrypto;
    return getSelectedCrypto();
};

function lockSeries(crypto) {
    datasets[crypto] = Object.freeze([...datasets[crypto]]);
    labels[crypto] = Object.freeze([...labels[crypto]]);
}

// Fonction principale de mise à jour des prix via l'API (sans toucher aux séries du graphe)
async function updateLivePrices() {
    try {
        const data = await fetchJSONCached("/api/prices/latest/", { ttl: 55_000 });

        const extractPrice = (info) => {
            if (info == null) return null;
            if (typeof info === "number") return info;
            if (typeof info === "object") {
                if (typeof info.price === "number") return info.price;
                if ("price_eur" in info && info.price_eur != null) {
                    const v = info.price_eur;
                    return (typeof v === "number") ? v : Number(v);
                }
            }
            return null;
        };
        const extractTs = (info) => (info && typeof info === "object" && info.timestamp) ? info.timestamp : null;

        if (!window.cachedPrices) window.cachedPrices = {};

        document.querySelectorAll(".crypto-card").forEach(card => {
            const crypto = card.dataset.crypto;
            const alias = (window.cryptoAliasMap && window.cryptoAliasMap[crypto]) || crypto;
            const priceDiv = card.querySelector(".crypto-price");
            const info = data[alias];
            const rawPrice = extractPrice(info);
            const ts = extractTs(info);

            if (rawPrice != null && !Number.isNaN(rawPrice) && rawPrice > 0) {
                const newPrice = Number(rawPrice).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
                if (priceDiv.textContent !== newPrice) priceDiv.textContent = newPrice;
                priceDiv.classList.remove("price-missing");
                window.cachedPrices[crypto] = Number(rawPrice);

                for (const src of ["reddit"]) {
                    const row = card.querySelector(`.vibe-item[data-vibe="${src}"]`);
                    if (row) row.dataset.priceEur = String(rawPrice);
                }
                if (ts) priceDiv.setAttribute("title", `Dernier enregistrement: ${ts}`);
            } else {
                priceDiv.textContent = "–";
                priceDiv.classList.add("price-missing");
            }
        });
        window.lastPriceFetch = Date.now();
    } catch (error) {
        console.error("🛑 Erreur lors du chargement des prix :", error);
        if (!window.cachedPrices) window.cachedPrices = {};
        document.querySelectorAll(".crypto-card").forEach(card => {
            const crypto = card.dataset.crypto;
            const priceDiv = card.querySelector(".crypto-price");
            const p = window.cachedPrices[crypto];
            if (p != null && isPriceValid(crypto, p)) {
                priceDiv.textContent = Number(p).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
                priceDiv.classList.remove("price-missing");
            } else {
                priceDiv.textContent = "–";
                priceDiv.classList.add("price-missing");
            }
        });
    }
}

// --- Singleton: ticker de prix aligné sur le bucket 5 min ---
function startPriceTicker() {
    window.CV = window.CV || {};
    if (window.CV.priceTickerStarted) return;
    window.CV.priceTickerStarted = true;

    updateLivePrices(); // 1er run immédiat

    const now = new Date();
    const msToNextBucket =
        ((5 - (now.getMinutes() % 5)) % 5) * 60000 +
        (60000 - now.getSeconds() * 1000 - now.getMilliseconds());

    setTimeout(() => {
        updateLivePrices();               // pile à la tranche
        window.CV.priceTickerId = setInterval(updateLivePrices, 300000); // 5 min
    }, msToNextBucket);
}

// --- CoinCap ticker (idempotent + cache + pause hors focus) ---
(function startCoincapTicker() {
    window.CV = window.CV || {};
    if (window.CV.tickerStarted) return;
    window.CV.tickerStarted = true;

    const API_URL = "/api/coincap/ticker/?basis=1h&sort=alpha&dir=asc&limit=40";
    const inner = document.getElementById("ticker-inner");
    const track = document.getElementById("ticker-track");
    const track2 = document.getElementById("ticker-track-clone");
    if (!inner || !track || !track2) {
        console.warn('[ticker] DOM not found');
        return;
    }

    const SPEED_PX_S = 60;

    let lastHash = "";
    let intervalId = null;

    function euro(n) { try { return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 8 }).format(n) } catch { return (n || 0).toFixed(6) + ' €' } }
    function pct(n) { return (n >= 0 ? '+' : '') + Number(n || 0).toFixed(2) + '%' }
    function arrow(d) { return d === 'up' ? '▲' : d === 'down' ? '▼' : '•' }
    function cls(d) { return d === 'up' ? 'ticker-up' : d === 'down' ? 'ticker-down' : 'ticker-flat' }

    const SYMBOL_ALIAS = { 'matic-network': 'MATIC', 'near-protocol': 'NEAR', 'internet-computer': 'ICP', 'lido-dao': 'LDO', 'rocket-pool-eth': 'rETH', 'elrond-egld': 'EGLD', 'the-graph': 'GRT', 'immutable-x': 'IMX', 'first-digital-usd': 'FDUSD' };
    const nice = id => (SYMBOL_ALIAS[id] || id).toUpperCase().replace(/[-_]/g, ' ');
    const hash = rows => rows.map(r => `${r.id}:${Number(r.price_eur || 0).toFixed(8)}:${Number(r.change_1h || 0).toFixed(4)}:${r.direction || ''}`).join('|');

    function makeItem(r) {
        const d = document.createElement('div');
        const dir = (r.direction === 'up' || r.direction === 'down' || r.direction === 'flat')
            ? r.direction
            : (Number(r.change_1h || 0) > 0 ? 'up' : Number(r.change_1h || 0) < 0 ? 'down' : 'flat');
        const c = cls(dir);
        d.className = 'ticker-item';
        d.innerHTML = `
      <span class="ticker-symbol">${nice(r.id)}</span>
      <span class="ticker-price ${c}">${euro(r.price_eur)}</span>
      <span class="ticker-arrow ${c}">${arrow(dir)}</span>
      <span class="${c}">${pct(r.change_1h)}</span>
    `;
        return d;
    }

    function setAnimationByWidth() {
        const w = track.scrollWidth;
        const duration = Math.max(10, w / SPEED_PX_S);
        inner.style.setProperty('--scroll-distance', w + 'px');
        inner.style.setProperty('--ticker-duration', duration.toFixed(2) + 's');
    }

    function render(rows) {
        inner.style.animation = 'none';
        track.innerHTML = "";
        rows.forEach(r => track.appendChild(makeItem(r)));
        track2.innerHTML = track.innerHTML;
        setAnimationByWidth();
        requestAnimationFrame(() => { inner.style.animation = ''; });
    }

    async function refresh() {
        try {
            const payload = await fetchJSONCached(API_URL, { ttl: 30_000 });
            const rows = Array.isArray(payload?.data) ? payload.data : [];
            if (!rows.length) return;

            const h = hash(rows);
            if (h !== lastHash) {
                render(rows);
                lastHash = h;
            } else {
                setAnimationByWidth();
            }
        } catch (e) {
            console.error('[ticker] refresh error', e);
        }
    }

    function startLoop() {
        if (intervalId) return;
        refresh();
        intervalId = setInterval(refresh, 60_000);
    }
    function stopLoop() {
        if (intervalId) clearInterval(intervalId);
        intervalId = null;
    }

    window.addEventListener('resize', () => setAnimationByWidth());
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') stopLoop(); else startLoop();
    });

    startLoop();
})();

async function fetchHkoPrediction(crypto) {
    return fetchJSONCached(`/api/prediction/hko/${crypto}/?hours=6`, { ttl: 120_000 })
        .catch(() => null);
}

function renderPrediction(pred) {
    if (!pred || !pred.crypto) return;

    window.hkoPred = window.hkoPred || {};
    window.hkoPred[pred.crypto] = pred;

    const card = document.querySelector(`.crypto-card[data-crypto="${pred.crypto}"]`);
    if (!card) return;

    const box = card.querySelector('.prediction-hko');
    const chip = card.querySelector('.prediction-hko .prediction-chip');
    const timeEl = card.querySelector('.prediction-time');
    const priceEl = card.querySelector('.prediction-price');
    const confEl = card.querySelector('.prediction-confidence');
    if (!box || !timeEl || !priceEl || !confEl) return;

    const rowReddit = card.querySelector('.vibe-item[data-vibe="reddit"]');
    const pr = rowReddit?.dataset?.predPrice ? Number(rowReddit.dataset.predPrice) : NaN;
    const cr = rowReddit?.dataset?.predConf ? Number(rowReddit.dataset.predConf) : NaN;

    let priceToShow = Number(pred.predicted_price ?? NaN);
    let confToShow = Number(pred.confidence ?? NaN);

    if (!isNaN(pr)) {
        priceToShow = pr;
        if (!isNaN(cr)) confToShow = cr;
        if (chip) chip.classList.remove('warn');
    }

    const dt = new Date(pred.predict_at);
    const hhmm = dt.toLocaleTimeString('fr-FR', {
        hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris'
    });

    const priceStr = Number(priceToShow || 0).toLocaleString('fr-FR', {
        minimumFractionDigits: 2, maximumFractionDigits: 2
    });
    const confStr = Number(isNaN(confToShow) ? 0 : confToShow).toLocaleString('fr-FR', {
        maximumFractionDigits: 1
    });

    timeEl.textContent = hhmm;
    priceEl.textContent = priceStr;
    confEl.textContent = `${confStr}%`;

    box.style.display = '';
}

function startPredictionTicker() {
    if (window.CV?.predTicker) return;
    const tick = async () => {
        const cards = document.querySelectorAll('.crypto-card[data-crypto]');
        for (const card of cards) {
            const crypto = card.getAttribute('data-crypto');
            try {
                const pred = await fetchHkoPrediction(crypto);
                if (pred) renderPrediction(pred);
            } catch (e) { /* noop */ }
        }
    };
    tick();
    window.CV = window.CV || {};
    window.CV.predTicker = setInterval(tick, 180_000); // 3 min
}

// --- Reddit predictions (toutes 8–10 min) ---
async function fetchSourcePrediction(crypto, source) {
    if (source !== 'reddit') return null;
    return fetchJSONCached(`/api/prediction/source/${crypto}/reddit/`, { ttl: 480_000 })
        .catch(() => null);
}

function renderSourcePrediction(crypto, source, data) {
    const card = document.querySelector(`.crypto-card[data-crypto="${crypto}"]`);
    if (!card) return;
    const row = card.querySelector(`.vibe-item[data-vibe="${source}"]`);
    if (!row) return;

    const priceEl = row.querySelector('.source-chip .src-price');
    const confEl = row.querySelector('.source-chip .src-conf');

    const hasPrice = typeof data?.predicted_price === 'number' && isFinite(data.predicted_price);
    const hasConf = typeof data?.confidence === 'number' && isFinite(data.confidence);

    if (priceEl) {
        priceEl.textContent = hasPrice
            ? Number(data.predicted_price).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : '—';
    }
    if (confEl) {
        confEl.textContent = hasConf
            ? `${Number(data.confidence).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}%`
            : '—';
    }

    if (hasPrice) row.dataset.predPrice = String(data.predicted_price); else delete row.dataset.predPrice;
    if (hasConf) row.dataset.predConf = String(data.confidence); else delete row.dataset.predConf;

    if (typeof data?.price_eur === 'number' && isFinite(data.price_eur)) {
        row.dataset.priceEur = String(data.price_eur);
    } else if (!row.dataset.priceEur) {
        const txt = card.querySelector(`#price-${crypto}`)?.textContent || '';
        const parsed = parseFloat(txt.replace(/[^\d,.-]/g, '').replace(',', '.'));
        if (!isNaN(parsed) && isFinite(parsed)) row.dataset.priceEur = String(parsed);
    }

    const cp = Number(row.dataset.priceEur);
    if (cp && hasPrice) {
        updateArrowIcon(crypto, source, cp, Number(data.predicted_price));
    }

    const hko = window.hkoPred && window.hkoPred[crypto];
    if (hko) renderPrediction(hko);
}

function startSourcePredTicker() {
    if (window.CV?.srcTicker) return;

    const tick = async () => {
        for (const card of document.querySelectorAll('.crypto-card[data-crypto]')) {
            const crypto = card.getAttribute('data-crypto');
            try {
                const d = await fetchSourcePrediction(crypto, 'reddit');
                if (d?.ok) renderSourcePrediction(crypto, 'reddit', d);
            } catch (e) { /* silence radio */ }
        }
    };

    tick();
    window.CV = window.CV || {};
    window.CV.srcTicker = setInterval(tick, 10 * 60 * 1000);
}

// === Carousel: molette + drag + sélection au clic ===
function initScrollInteractions() {
    const container = document.querySelector('.horizontal-scroll-container');
    if (!container) return;

    // --- Molette => scroll horizontal
    const WHEEL_SPEED = 1.8;
    container.addEventListener('wheel', (e) => {
        const canScroll = container.scrollWidth > container.clientWidth;
        if (!canScroll) return;
        const delta = (Math.abs(e.deltaX) > Math.abs(e.deltaY)) ? e.deltaX : e.deltaY;
        if (!delta) return;
        e.preventDefault();
        container.scrollLeft += delta * WHEEL_SPEED;
    }, { passive: false });

    // --- Drag + clic fiable
    const DRAG_CLICK_SLOP = 6;
    let dragging = false;
    let moved = false;
    let startX = 0, startY = 0;
    let lastX = 0;

    container.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0) return; // bouton gauche
        dragging = true;
        moved = false;
        startX = lastX = e.clientX;
        startY = e.clientY;
        container.classList.add('dragging');
        try { container.setPointerCapture?.(e.pointerId); } catch { }
    });

    container.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - lastX;
        lastX = e.clientX;
        if (dx !== 0) container.scrollLeft -= dx;
        const totalDx = e.clientX - startX;
        const totalDy = e.clientY - startY;
        if (!moved && Math.hypot(totalDx, totalDy) > DRAG_CLICK_SLOP) moved = true;
    });

    function endDrag() {
        dragging = false;
        container.classList.remove('dragging');
    }

    container.addEventListener('pointerup', (e) => {
        const wasMoved = moved;
        endDrag();

        // ⬇️ pas de scroll ici : on sélectionne seulement
        if (!wasMoved) {
            let card = e.target.closest('.crypto-card');
            if (!card) {
                const el = document.elementFromPoint(e.clientX, e.clientY);
                card = el?.closest?.('.crypto-card') || null;
            }
            if (card) selectCard(card);
        }
    });

    container.addEventListener('pointercancel', endDrag);
    container.addEventListener('pointerleave', () => { if (dragging) endDrag(); });

    // Délégation de clic (au cas où)
    container.addEventListener('click', (e) => {
        if (dragging || moved) return; // ignore un clic juste après un drag
        const card = e.target.closest('.crypto-card');
        if (!card) return;
        // ⬇️ pas de scroll ici non plus
        selectCard(card);
    });
}









document.addEventListener('DOMContentLoaded', () => {
    const ensureInitialSelection = () => {
        let sel = document.querySelector('.crypto-card.selected');
        if (!sel) {
            sel = document.querySelector('.crypto-card');
            if (sel) selectCard(sel);
        }
    };

    ensureInitialSelection();

    const init = debounce(async () => {
        try {
            await preloadHistory();
            ensureInitialSelection(); // ← ne re-sélectionne que s’il n’y a RIEN

            document.querySelectorAll('.crypto-card').forEach(card => {
                rotateVibes(card);
                const crypto = card.dataset.crypto;
                fetchVibe(crypto, 'reddit');
            });

            ['bitcoin', 'ethereum', 'xrp', 'tether', 'bnb', 'solana', 'usdc', 'dogecoin', 'tron', 'cardano']
                .forEach(lockSeries);

            if (typeof window.loadNewsWhite === 'function') window.loadNewsWhite();
            else if (typeof window.loadNews === 'function') window.loadNews();

            (typeof startPriceTicker === 'function' ? startPriceTicker : updateLivePrices)();
            startPredictionTicker();
            startSourcePredTicker();
        } catch (e) { console.error('Erreur initialisation:', e); }
    }, 50);

    init();
    initScrollInteractions(); // ← voir juste en dessous
});


// === FOOTER: Wire (barre noire) — contrôleur autonome en fondu (fix pause/resume) ===
(function wireTickerV2() {
    const root = document.querySelector(".ticker-row--black .ticker-content");
    if (!root) return;

    const API = "/api/news/wire/";
    const IN_MS = 520;
    const OUT_MS = 420;
    const HOLD_MS = 4200;
    const REFRESH_MS = 60_000;

    let feed = [];
    let idx = 0;
    let running = false;
    let holdTimer = null;

    const chipClass = c => (c === "crypto" ? "news-crypto" : c === "finance" ? "news-finance" : "news-ai");
    const chipLabel = c => (c || "AI").toUpperCase();

    function makeNode(it) {
        const wrap = document.createElement("div");
        wrap.className = "wire-now wire-in";
        wrap.style.setProperty("--in-ms", IN_MS + "ms");
        wrap.style.setProperty("--out-ms", OUT_MS + "ms");
        wrap.style.cssText += "display:inline-flex;align-items:center;gap:10px;white-space:nowrap;height:36px;";
        wrap.innerHTML = `
      <span class="news-chip ${chipClass(it.cat)}">${chipLabel(it.cat)}</span>
      <span class="news-src">[${it.source || ""}]</span>
      <a class="news-title" href="${it.link || "#"}" target="_blank" rel="noopener">${it.title || ""}</a>
    `;
        return wrap;
    }

    function exitNode(node) {
        if (!node) return;
        node.classList.remove("wire-in");
        node.classList.add("wire-out");

        let done = false;
        const goNext = () => {
            if (done) return; done = true;
            node.remove();
            if (running) showNext();
        };

        node.addEventListener("animationend", goNext, { once: true });
        setTimeout(goNext, OUT_MS + 80);
    }

    function showNext() {
        if (!feed.length) return;
        running = true;

        const it = feed[idx++ % feed.length];
        const node = makeNode(it);
        root.appendChild(node);

        clearTimeout(holdTimer);
        holdTimer = setTimeout(() => exitNode(node), HOLD_MS + IN_MS);
    }

    async function refreshFeed() {
        try {
            const data = await fetchJSONCached(API, { ttl: REFRESH_MS });
            const arr = Array.isArray(data) ? data : [];
            if (arr.length) {
                feed = arr;
                if (idx >= feed.length) idx = idx % feed.length;
            }
        } catch (e) {
            console.error("[wire] refresh error", e);
        }
    }

    const api = {
        advance() {
            clearTimeout(holdTimer);
            const cur = root.querySelector(".wire-now");
            if (cur) exitNode(cur);
            else showNext();
        },
        pause() {
            running = false;
            clearTimeout(holdTimer);
        },
        resume() {
            if (running) return;
            running = true;
            const cur = root.querySelector(".wire-now");
            if (cur) {
                clearTimeout(holdTimer);
                holdTimer = setTimeout(() => exitNode(cur), HOLD_MS);
            } else {
                showNext();
            }
        }
    };

    window.CV = window.CV || {};
    window.CV.wire = api;

    root.addEventListener("click", (e) => {
        if (e.target.closest("a")) {
            api.advance();
            setTimeout(() => api.resume(), 0);
        }
    });

    (async () => {
        await refreshFeed();
        showNext();
        setInterval(refreshFeed, REFRESH_MS);
    })();
})();

// === FOOTER: Ticker Reddit (barre blanche) — contrôleur autonome ===
(function whiteTickerController() {
    const HOLD_MS = 4200;
    const IN_MS = 600;
    const OUT_MS = 600;

    function items(root) { return Array.from(root.querySelectorAll('.ticker-item')); }
    function setAll(root, klass) {
        items(root).forEach(el => {
            el.classList.remove('ticker-item--incoming', 'ticker-item--active', 'ticker-item--exiting');
            el.classList.add(klass);
        });
    }

    function init(root) {
        if (root._wt) return root._wt;

        const st = { idx: 0, timer: null, running: false };

        function activate(i) {
            const els = items(root);
            if (!els.length) { st.running = false; return; }
            st.idx = (i % els.length + els.length) % els.length;

            const cur = els[st.idx];
            cur.classList.remove('ticker-item--incoming', 'ticker-item--exiting');
            cur.classList.add('ticker-item--active');

            st.timer = setTimeout(advance, HOLD_MS);
            st.running = true;
        }

        function advance() {
            clearTimeout(st.timer);
            const els = items(root);
            if (!els.length) { st.running = false; return; }
            const cur = els[st.idx];
            if (!cur) { activate(0); return; }

            cur.classList.remove('ticker-item--active');
            cur.classList.add('ticker-item--exiting');

            cur.addEventListener('transitionend', () => {
                cur.classList.remove('ticker-item--exiting');
                setAll(root, 'ticker-item--incoming');
                activate((st.idx + 1) % items(root).length);
            }, { once: true });
        }

        function reset() {
            clearTimeout(st.timer);
            setAll(root, 'ticker-item--incoming');
            st.idx = 0;
            activate(0);
        }
        function pause() { st.running = false; clearTimeout(st.timer); }
        function resume() {
            if (st.running) return;
            st.running = true;
            if (!root.querySelector('.ticker-item--active')) {
                if (items(root).length) activate(st.idx % items(root).length);
            } else {
                st.timer = setTimeout(advance, HOLD_MS);
            }
        }

        root.addEventListener('click', (e) => { if (e.target.closest('a.ticker-item')) advance(); });
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') pause(); else resume(); });
        window.addEventListener('pageshow', () => resume());

        root._wt = { reset, advance, pause, resume };
        return root._wt;
    }

    window.CV = window.CV || {};
    window.CV.white = { init };
})();

// Reprise/pause globale pour les deux tickers (noir & blanc)
window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        window.CV?.wire?.pause?.();
        window.CV?.white?.pause?.();
    } else {
        window.CV?.wire?.resume?.();
        window.CV?.white?.resume?.();
    }
});
window.addEventListener('pageshow', () => {
    window.CV?.wire?.resume?.();
    window.CV?.white?.resume?.();
});
window.addEventListener('focus', () => {
    window.CV?.wire?.resume?.();
    window.CV?.white?.resume?.();
});

// --- Abonnement MVP (liste d'attente) ---
(function subscribeMVP() {
    const openers = document.querySelectorAll('.sub-btn, [data-open-sub]');
    const modal = document.getElementById('subscribe-modal');
    if (!modal) {
        console.warn('[subscribe] Modal introuvable (#subscribe-modal)');
        return;
    }
    const form = document.getElementById('subscribe-form');
    const msg = document.getElementById('sub-msg');

    function open() { modal.classList.add('is-open'); if (msg) msg.textContent = ''; }
    function close() { modal.classList.remove('is-open'); }

    openers.forEach(btn => btn.addEventListener('click', (e) => { e.preventDefault(); open(); }));
    modal.addEventListener('click', (e) => { if (e.target.matches('[data-close], .sub-modal__backdrop')) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    function getCookie(name) {
        const m = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
        return m ? m.pop() : '';
    }

    form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (msg) msg.textContent = 'Envoi…';
        const fd = new FormData(form);
        const endpoint = form.dataset.endpoint || '/subscribe/';

        let csrf = getCookie('csrftoken');
        if (!csrf) {
            const hidden = form.querySelector('input[name=csrfmiddlewaretoken]');
            if (hidden) csrf = hidden.value;
        }

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'X-CSRFToken': csrf },
                body: fd,
            });
            const data = await res.json();
            if (data.ok) {
                if (msg) msg.textContent = data.duplicate ? 'Vous êtes déjà inscrit·e ✅' : 'Inscription confirmée ✅';
                form.reset();
                setTimeout(close, 900);
            } else {
                if (msg) msg.textContent = data.error || 'Erreur. Merci de réessayer.';
            }
        } catch (err) {
            console.error('[subscribe] fetch error', err);
            if (msg) msg.textContent = 'Erreur réseau. Réessayez plus tard.';
        }
    });
})();



(() => {
    const rail = document.querySelector('.horizontal-scroll-container');
    if (!rail) return;

    const mq = window.matchMedia('(max-width: 640px)');
    const getCards = () => Array.from(rail.querySelectorAll('.crypto-card'));
    const originalScrollCards = window.scrollCards;

    let mobileEnabled = false;
    let debounce;
    let lastChartSymbol = null; // évite de recharger la même courbe en boucle

    function readCenterBias() {
        const v = getComputedStyle(document.documentElement)
            .getPropertyValue('--center-bias')
            .trim();
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : 0;
    }

    const railMidX = () => rail.getBoundingClientRect().left + rail.clientWidth / 2;
    const cardMidX = (c) => {
        const r = c.getBoundingClientRect();
        return r.left + r.width / 2;
    };

    function getSymbolFromCard(card) {
        return (card?.dataset?.crypto || card?.getAttribute?.('data-crypto') || '').trim();
    }

    // 🔗 Synchronise la courbe avec la carte centrée (mobile only)
    function ensureChartFor(card) {
        if (!mobileEnabled || !card) return;
        const symbol = getSymbolFromCard(card);
        if (!symbol) return;
        if (lastChartSymbol === symbol) return; // rien à faire, déjà affichée

        lastChartSymbol = symbol;

        // 1) Si ta logique existante est dans selectCard(el), on la réutilise
        if (typeof window.selectCard === 'function') {
            try { window.selectCard(card); return; } catch { }
        }
        // 2) Sinon, on déclenche le click programmatique (déclenche l’onclick inline)
        if (typeof card.click === 'function') {
            card.click(); return;
        }
        // 3) Fallback : un event custom auquel tu peux t’abonner si besoin
        document.dispatchEvent(new CustomEvent('crypto:centered', {
            detail: { symbol, card }
        }));
    }

    function nearestIndexToCenter() {
        const mid = railMidX();
        let best = 0, bestDist = Infinity;
        getCards().forEach((c, i) => {
            const d = Math.abs(cardMidX(c) - mid);
            if (d < bestDist) { best = i; bestDist = d; }
        });
        return best;
    }

    function markCurrent(i) {
        const cards = getCards();
        cards.forEach(c => c.classList.remove('is-current', 'selected'));
        const card = cards[i];
        if (card) {
            card.classList.add('is-current', 'selected');
            ensureChartFor(card); // ⬅️ charge la courbe correspondante (mobile)
        }
    }

    function centerCardAtIndex(idx, behavior = 'smooth') {
        const cards = getCards();
        if (!cards.length) return;
        const i = Math.max(0, Math.min(idx, cards.length - 1));
        const bias = readCenterBias();
        const delta = (cardMidX(cards[i]) - railMidX()) + bias;
        rail.scrollTo({ left: rail.scrollLeft + delta, behavior });
        markCurrent(i);
    }

    function onScroll() {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
            centerCardAtIndex(nearestIndexToCenter());
        }, 120);
    }

    function onResize() {
        centerCardAtIndex(nearestIndexToCenter(), 'auto');
    }

    function enableMobileMode() {
        if (mobileEnabled) return;
        mobileEnabled = true;
        lastChartSymbol = null;

        rail.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onResize, { passive: true });

        // Flèches : navigation carte par carte (mobile)
        window.scrollCards = function (dir) {
            const i = nearestIndexToCenter();
            centerCardAtIndex(i + (dir > 0 ? 1 : -1));
        };

        // Init : centre sur la plus proche + synchronise la courbe
        centerCardAtIndex(nearestIndexToCenter(), 'auto');
    }

    function disableMobileMode() {
        if (!mobileEnabled) return;
        mobileEnabled = false;
        clearTimeout(debounce);
        rail.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onResize);
        lastChartSymbol = null;

        if (originalScrollCards) {
            window.scrollCards = originalScrollCards;
        } else {
            try { delete window.scrollCards; } catch { }
        }
    }

    function syncMode(e) {
        if (e.matches) enableMobileMode();
        else disableMobileMode();
    }

    // Premier passage + écoute des changements
    syncMode(mq);
    if (mq.addEventListener) mq.addEventListener('change', syncMode);
    else if (mq.addListener) /* compat Safari ancien */ mq.addListener(syncMode);
})();














