
// script.js
// Au début de script.js ou dans la section i18n


// -----------------------------------
// SECTION 1 : SÉLECTEURS DOM PRINCIPAUX
// -----------------------------------
// Ces constantes récupèrent les éléments du DOM par leur ID pour interagir avec l’interface utilisateur.
// Gestion des traductions

// Sélecteurs pour le basculement des modes (aléatoire/créatif)
const modeSwitch = document.getElementById('modeSwitch');           // Toggle entre mode aléatoire et créatif
const randomOptions = document.getElementById('randomOptions');     // Conteneur des options du mode aléatoire
const creativeOptions = document.getElementById('creativeOptions'); // Conteneur des options du mode créatif
const modeLabelLeft = document.getElementById('modeLabelLeft');     // Étiquette à gauche du toggle (ex. "Aléatoire")
const modeLabelRight = document.getElementById('modeLabelRight');   // Étiquette à droite du toggle (ex. "Créatif")

// Sélecteurs spécifiques au générateur de mots (#generatorBox)
const previousWordButton = document.getElementById("previousWord");  // Bouton pour afficher le mot précédent généré
const langSelect = document.getElementById("lang-select");          // Sélecteur de langue pour le générateur
const prefixInput = document.getElementById("prefix-input");        // Champ pour entrer un préfixe dans le générateur
const selectedWordDisplay = document.getElementById("selectedWordDisplay"); // Affichage du mot sélectionné
const lengthInput = document.getElementById("length-input");        // Champ pour définir la longueur du mot généré

// Sélecteurs pour la fonctionnalité d’exportation
const exportButton = document.getElementById('exportButton');        // Bouton pour ouvrir la fenêtre d’exportation
const returnToGeneratorButton = document.getElementById('returnToGeneratorButton'); // Bouton de retour dans la fenêtre d’export

// Sélecteurs pour le conteneur principal et les modales
const generatorContainer = document.querySelector('.container');    // Conteneur principal de l’interface
const defineSpecialCharsButtonRandom = document.getElementById('defineSpecialCharsRandom'); // Bouton pour définir les caractères spéciaux (mode aléatoire)
const specialCharsWindowRandom = document.getElementById('specialCharsWindowRandom'); // Fenêtre modale pour caractères spéciaux (mode aléatoire)
const defineSpecialCharsButtonCreative = document.getElementById('defineSpecialChars'); // Bouton pour définir les caractères spéciaux (mode créatif)
const specialCharsWindowCreative = document.getElementById('specialCharsWindow'); // Fenêtre modale pour caractères spéciaux (mode créatif)

// Sélecteurs pour le générateur de mots (modale)
const wordList = document.getElementById('wordList');               // Liste des mots générés
const generateWordsButton = document.getElementById('generateWords'); // Bouton pour générer des mots
const openWordGeneratorButton = document.getElementById('openWordGenerator'); // Bouton pour ouvrir la modale du générateur
const closeWordGeneratorButton = document.getElementById('closeWordGenerator'); // Bouton pour fermer la modale
const wordGeneratorModal = document.getElementById('wordGeneratorModal'); // Modale du générateur de mots

// Sélecteurs pour les écrans d’affichage des deux modes
const randomScreen = document.getElementById('randomScreen');       // Écran d’affichage du mode aléatoire
const creativeScreen = document.getElementById('creativeScreen');   // Écran d’affichage du mode créatif
// Dans script.js, après const creativeScreen = document.getElementById('creativeScreen'); (vers la ligne ~50)
// Dans script.js, après const creativeScreen = document.getElementById('creativeScreen'); (vers la ligne ~50)
// Dans script.js, remplace l’écouteur existant après const creativeScreen = document.getElementById('creativeScreen'); (vers la ligne ~50)
// Dans script.js, remplace l’écouteur après const creativeScreen = document.getElementById('creativeScreen'); (vers la ligne ~50)

// Sélecteurs pour les options de filtrage (mode aléatoire)
const randomExclureDoublons = document.getElementById('random-exclure-doublons'); // Checkbox pour exclure les doublons (mode aléatoire)
const randomExclureSimilaires = document.getElementById('random-exclure-similaires'); // Checkbox pour exclure les caractères similaires (mode aléatoire)

// Sélecteurs pour les options de filtrage (mode créatif principal)
const creativeExclureDoublonsMain = document.getElementById('creative-exclure-doublons-main'); // Checkbox pour exclure les doublons (mode créatif)
const creativeExclureSimilairesMain = document.getElementById('creative-exclure-similaires-main'); // Checkbox pour exclure les caractères similaires (mode créatif)

// Sélecteur pour le slider de longueur
const rangeInput = document.getElementById('length-slider');        // Slider pour ajuster la longueur des mots générés

let wordHistory = [];
let wordHistoryIndex = 0;

let isInitialLoadComplete = false;
let userHasInteracted = false;

let baseGeneratedWord = '';

let currentGeneratedWord = {
    minuscules: '',
    majuscules: '',
    chiffres: '',
    speciaux: '',
    hasBeenAdjusted: false // Ajout ici
};

let isFirstManualAdjustment = true; // Nouvelle variable globale


let isFromImport = false;


// Sélecteurs pour le mode aléatoire
const lengthSlider = document.getElementById('length-slider');
const minusculesSlider = document.getElementById('minuscules-slider');
const majusculesSlider = document.getElementById('majuscules-slider');
const chiffresSlider = document.getElementById('chiffres-slider');
const speciauxSlider = document.getElementById('speciaux-slider');
const generateButton = document.getElementById('generateButton');


// Définition des jeux de caractères
const minuscules = 'abcdefghijklmnopqrstuvwxyz';
const majuscules = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const chiffres = '0123456789';
const speciaux = "!@#$%^&*()-_=+{}[]|\\:;\"'<>,.?/`~";


let isInitialLoad = true;
// -----------------------------------
// SECTION 3 : VÉRIFICATIONS INITIALES
// -----------------------------------
// Log pour confirmer le chargement des sélecteurs et du script
console.log('Vérification des sélecteurs terminée.');
console.log("✅ Le script du menu est bien chargé !");



function showCustomAlert(translationKey, type = 'alert') {
    const lang = window.currentLang || 'fr';
    const fallback = {
        max_length_alert: "Maximum 50 caractères atteint.",
        password_copied: "Mot de passe copié avec succès !"
    };

    const message = (window.translations?.[lang]?.[translationKey]) || fallback[translationKey] || translationKey;

    const alertWindow = document.createElement('div');
    alertWindow.className = `${type}-window`;
    alertWindow.textContent = message;
    document.body.appendChild(alertWindow);

    setTimeout(() => {
        alertWindow.classList.add('show');
    }, 10);

    setTimeout(() => {
        alertWindow.classList.remove('show');
        setTimeout(() => {
            alertWindow.remove();
        }, 300);
    }, 2500);
}




function isScreenEmpty(content) {
    const source = window.translations && window.translations[window.currentLang]
        ? window.translations[window.currentLang]
        : {
            no_phrase_generated: "Aucune phrase générée.",
            no_word_selected: "Aucun mot sélectionné pour l’instant.",
            creative_placeholder: "Entrer une base...",
            no_next_content: "Pas de contenu suivant",
            no_prev_content: "Pas de contenu précédent"
        };

    const result = !content ||
        content === source.no_phrase_generated ||
        content === "Votre phrase apparaîtra ici..." ||
        content === source.no_word_selected ||
        content === source.creative_placeholder ||
        content === source.no_next_content ||
        content === source.no_prev_content;

    console.log(`ℹ️ isScreenEmpty vérifié: content="${content}", result=${result}`);
    return result;
}


function updateRangeProgress(slider) {
    const value = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
    slider.style.setProperty('--range-progress', `${value}%`);
}

// 📌 Stockage des caractères générés et texte original
// Contient les catégories de caractères et le texte non filtré.



let prevRemoveDuplicates = false; // État précédent des filtres
let prevRemoveSimilar = false;



// -----------------------------------
// SECTION : GESTION DE LA MÉMORISATION DES MOTS DE PASSE
// -----------------------------------
// Ce bloc gère la mémorisation des mots de passe (jusqu’à 9), leur réinitialisation par double-clic,
// et la copie de tous les mots mémorisés dans le presse-papiers.

// Déclarations globales pour la mémorisation (placées au début du script, hors DOMContentLoaded)
const memorizedPasswords = [];          // Tableau stockant les mots de passe mémorisés
let memoryCounter = 0;                  // Compteur de mots mémorisés (de 0 à 9)
let clickTimeout = null;                // Temporisateur pour différencier clic simple et double-clic


// Sélecteurs DOM pour la mémorisation et l’exportation
const memoryButton = document.getElementById('memoryButton');      // Bouton pour mémoriser un mot (M1 à M9)
const copyButton = document.getElementById('copyButton');          // Bouton pour copier un mot individuel
const exportContent = document.getElementById('exportContent');    // Conteneur pour afficher les mots exportés
const saveToFileButton = document.getElementById('saveToFileButton'); // Bouton pour sauvegarder dans un fichier
const allCopyButton = document.getElementById('allCopyButton');     // Bouton pour copier tous les mots mémorisés

// Vérification des éléments essentiels
if (!memoryButton || !copyButton || !exportContent || !saveToFileButton || !allCopyButton) {
    console.warn("⚠️ Un ou plusieurs éléments de mémorisation/exportation sont manquants !");
}



let lastClickTime = 0; // Stocke le timestamp du dernier clic
let lastTouchTime = 0; // Stocke le timestamp du dernier tapotage
let clickCount = 0; // Compteur de clics
let touchCount = 0; // Compteur de tapotages
let isDoubleClicking = false;
let isDoubleTapping = false;
let isLocked = false; // Verrouillage temporaire après un clic ou tapotage

// Détecter si l’appareil est tactile
const isTouchDevice = () => 'ontouchstart' in window || navigator.maxTouchPoints > 0;

memoryButton.addEventListener('click', (event) => {
    // Ignorer les clics sur appareils tactiles
    if (isTouchDevice()) {
        console.log("ℹ️ Événement click ignoré : appareil tactile détecté");
        return;
    }

    if (isDoubleClicking || isLocked) {
        console.log("ℹ️ Clic ignoré : double-clic ou verrouillage en cours");
        return;
    }

    const currentTime = Date.now();
    clickCount++;

    console.log(`ℹ️ Clic détecté : clic ${clickCount}, temps: ${currentTime}`);

    if (clickCount === 1) {
        // Premier clic, démarrer la fenêtre temporelle
        lastClickTime = currentTime;
        setTimeout(() => {
            if (clickCount === 1 && !isDoubleClicking) {
                // Clic simple
                isLocked = true;
                console.log("ℹ️ Clic simple traité pour #memoryButton");

                const activeScreen = document.querySelector('.password-display[style*="display: block"]');
                const password = activeScreen.textContent.trim();

                if (isScreenEmpty(password)) {
                    const source = window.translations && window.translations[window.currentLang]
                        ? window.translations[window.currentLang]
                        : {
                            no_password_to_memorize_alert: "Aucun mot de passe à mémoriser."
                        };
                    const alertMessage = source.no_password_to_memorize_alert;
                    console.log(`ℹ️ Fenêtre d’alerte affichée pour mémorisation : ${alertMessage}`);

                    // Créer la fenêtre d’alerte
                    const notification = document.createElement('div');
                    notification.className = 'alert-window';
                    notification.textContent = alertMessage;
                    document.body.appendChild(notification);

                    // Afficher avec fondu
                    setTimeout(() => {
                        notification.classList.add('show');
                    }, 10);

                    // Supprimer après 2 secondes avec fondu
                    setTimeout(() => {
                        notification.classList.remove('show');
                        setTimeout(() => {
                            notification.remove();
                        }, 300);
                    }, 2000);

                    isLocked = false;
                    clickCount = 0;
                    return;
                }

                // Ajoute le mot à la mémoire si limite non atteinte
                if (memoryCounter < 9) {
                    memoryCounter++;
                    memorizedPasswords.push(password);
                    memoryButton.textContent = `M${memoryCounter}`;
                    console.log("Mot de passe mémorisé:", password, "Liste complète:", memorizedPasswords);
                    if (memoryCounter >= 2) {
                        allCopyButton.style.display = 'block';
                    }
                } else {
                    const source = window.translations && window.translations[window.currentLang]
                        ? window.translations[window.currentLang]
                        : {
                            memory_limit_alert: "Vous ne pouvez enregistrer que 9 mots de passe. Exportez pour réinitialiser."
                        };
                    const alertMessage = source.memory_limit_alert;
                    console.log(`ℹ️ Fenêtre d’alerte affichée pour limite de mémoire : ${alertMessage}`);

                    // Créer la fenêtre d’alerte
                    const notification = document.createElement('div');
                    notification.className = 'alert-window';
                    notification.textContent = alertMessage;
                    document.body.appendChild(notification);

                    // Afficher avec fondu
                    setTimeout(() => {
                        notification.classList.add('show');
                    }, 10);

                    // Supprimer après 2 secondes avec fondu
                    setTimeout(() => {
                        notification.classList.remove('show');
                        setTimeout(() => {
                            notification.remove();
                        }, 300);
                    }, 2000);
                }

                isLocked = false;
                clickCount = 0;
            } else {
                // Réinitialiser si pas de double-clic
                clickCount = 0;
            }
        }, 300); // Fenêtre temporelle pour détecter le double-clic
    }
});

memoryButton.addEventListener('dblclick', (event) => {
    isDoubleClicking = true;
    isLocked = true; // Verrouiller pour bloquer les clics simples
    clickCount = 0; // Réinitialiser le compteur de clics

    console.log("ℹ️ Double-clic détecté pour #memoryButton");

    // Réinitialise la mémoire
    memoryCounter = 0;
    memorizedPasswords.length = 0;
    memoryButton.textContent = 'M';
    allCopyButton.style.display = 'none';
    console.log("Mémoire réinitialisée, Liste:", memorizedPasswords);

    // Affiche une notification de réinitialisation
    const source = window.translations && window.translations[window.currentLang]
        ? window.translations[window.currentLang]
        : {
            memory_reset_success_alert: "Mémoire réinitialisée."
        };
    const alertMessage = source.memory_reset_success_alert;
    console.log(`ℹ️ Fenêtre de succès affichée pour réinitialisation : ${alertMessage}`);

    // Créer la fenêtre de succès
    const notification = document.createElement('div');
    notification.className = 'success-window';
    notification.textContent = alertMessage;
    document.body.appendChild(notification);

    // Afficher avec fondu
    setTimeout(() => {
        notification.classList.add('show');
    }, 10);

    // Supprimer après 2 secondes avec fondu
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 2000);

    // Déverrouiller après 500 ms pour bloquer les clics simples générés
    setTimeout(() => {
        isDoubleClicking = false;
        isLocked = false;
    }, 500);
});

// Détection du double tapotage sur mobile
memoryButton.addEventListener('touchstart', (event) => {
    // Empêche le clic généré automatiquement
    event.preventDefault();

    if (isDoubleTapping || isDoubleClicking || isLocked) {
        console.log("ℹ️ Événement touchstart ignoré : double tapotage, clic ou verrouillage en cours");
        return;
    }

    const currentTime = Date.now();
    touchCount++;

    console.log(`ℹ️ Touchstart détecté : tapotage ${touchCount}, temps: ${currentTime}`);

    if (touchCount === 1) {
        // Premier tapotage, démarrer la fenêtre temporelle
        lastTouchTime = currentTime;
        setTimeout(() => {
            if (touchCount === 1 && !isDoubleTapping) {
                // Tapotage simple
                isLocked = true;
                console.log("ℹ️ Tapotage simple traité pour #memoryButton");

                const activeScreen = document.querySelector('.password-display[style*="display: block"]');
                const password = activeScreen.textContent.trim();

                if (isScreenEmpty(password)) {
                    const source = window.translations && window.translations[window.currentLang]
                        ? window.translations[window.currentLang]
                        : {
                            no_password_to_memorize_alert: "Aucun mot de passe à mémoriser."
                        };
                    const alertMessage = source.no_password_to_memorize_alert;
                    console.log(`ℹ️ Fenêtre d’alerte affichée pour mémorisation (mobile) : ${alertMessage}`);

                    // Créer la fenêtre d’alerte
                    const notification = document.createElement('div');
                    notification.className = 'alert-window';
                    notification.textContent = alertMessage;
                    document.body.appendChild(notification);

                    // Afficher avec fondu
                    setTimeout(() => {
                        notification.classList.add('show');
                    }, 10);

                    // Supprimer après 2 secondes avec fondu
                    setTimeout(() => {
                        notification.classList.remove('show');
                        setTimeout(() => {
                            notification.remove();
                        }, 300);
                    }, 2000);

                    isLocked = false;
                    touchCount = 0;
                    return;
                }

                // Ajoute le mot à la mémoire si limite non atteinte
                if (memoryCounter < 9) {
                    memoryCounter++;
                    memorizedPasswords.push(password);
                    memoryButton.textContent = `M${memoryCounter}`;
                    console.log("Mot de passe mémorisé (mobile):", password, "Liste complète:", memorizedPasswords);
                    if (memoryCounter >= 2) {
                        allCopyButton.style.display = 'block';
                    }
                } else {
                    const source = window.translations && window.translations[window.currentLang]
                        ? window.translations[window.currentLang]
                        : {
                            memory_limit_alert: "Vous ne pouvez enregistrer que 9 mots de passe. Exportez pour réinitialiser."
                        };
                    const alertMessage = source.memory_limit_alert;
                    console.log(`ℹ️ Fenêtre d’alerte affichée pour limite de mémoire (mobile) : ${alertMessage}`);

                    // Créer la fenêtre d’alerte
                    const notification = document.createElement('div');
                    notification.className = 'alert-window';
                    notification.textContent = alertMessage;
                    document.body.appendChild(notification);

                    // Afficher avec fondu
                    setTimeout(() => {
                        notification.classList.add('show');
                    }, 10);

                    // Supprimer après 2 secondes avec fondu
                    setTimeout(() => {
                        notification.classList.remove('show');
                        setTimeout(() => {
                            notification.remove();
                        }, 300);
                    }, 2000);
                }

                isLocked = false;
                touchCount = 0;
            } else {
                // Réinitialiser si pas de double tapotage
                touchCount = 0;
            }
        }, 300); // Fenêtre temporelle pour détecter le double tapotage
    } else if (touchCount === 2 && currentTime - lastTouchTime < 300) {
        // Double tapotage détecté
        isDoubleTapping = true;
        console.log("ℹ️ Double tapotage détecté sur mobile pour #memoryButton");

        // Réinitialise la mémoire
        memoryCounter = 0;
        memorizedPasswords.length = 0;
        memoryButton.textContent = 'M';
        allCopyButton.style.display = 'none';
        console.log("Mémoire réinitialisée, Liste:", memorizedPasswords);

        // Affiche une notification de réinitialisation
        const source = window.translations && window.translations[window.currentLang]
            ? window.translations[window.currentLang]
            : {
                memory_reset_success_alert: "Mémoire réinitialisée."
            };
        const alertMessage = source.memory_reset_success_alert;
        console.log(`ℹ️ Fenêtre de succès affichée pour réinitialisation (mobile) : ${alertMessage}`);

        // Créer la fenêtre de succès
        const notification = document.createElement('div');
        notification.className = 'success-window';
        notification.textContent = alertMessage;
        document.body.appendChild(notification);

        // Afficher avec fondu
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);

        // Supprimer après 2 secondes avec fondu
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                notification.remove();
            }, 300);
        }, 2000);

        isDoubleTapping = false;
        touchCount = 0;
        isLocked = false;
    }
}, false);



allCopyButton.addEventListener('click', () => {
    if (memorizedPasswords.length === 0) {
        showNoPasswordNotification();
        return;
    }

    const allPasswords = memorizedPasswords.join('\n');
    navigator.clipboard.writeText(allPasswords).then(() => {
        const source = window.translations && window.translations[window.currentLang]
            ? window.translations[window.currentLang]
            : {
                all_copy_success_alert: "Tous les mots de passe copiés."
            };
        const alertMessage = source.all_copy_success_alert;
        console.log(`ℹ️ Fenêtre de succès affichée pour tout copier : ${alertMessage}`);

        // Créer la fenêtre de succès
        const notification = document.createElement('div');
        notification.className = 'success-window';
        notification.textContent = alertMessage;
        document.body.appendChild(notification);

        // Afficher avec fondu
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);

        // Supprimer après 2 secondes avec fondu
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                notification.remove();
            }, 300); // Correspond à la durée de la transition
        }, 2000);

        // Réinitialise la mémoire après copie
        memoryCounter = 0;
        memorizedPasswords.length = 0;
        memoryButton.textContent = 'M';
        allCopyButton.style.display = 'none';
    }).catch(err => {
        console.error("⚠️ Échec de la copie des mots de passe :", err);
    });
});





// -----------------------------------
// FONCTION : AFFICHAGE DES MOTS DE PASSE MÉMORISÉS
// -----------------------------------
// Affiche les mots de passe mémorisés ou le mot actuel dans #exportContent (fenêtre d’exportation).
// Si aucun mot n’est mémorisé, montre le mot affiché dans l’écran actif ou un message par défaut.

function showExportedPasswords() {
    exportContent.innerHTML = ''; // Réinitialise le conteneur d’affichage

    console.log("Affichage des mots mémorisés:", memorizedPasswords); // Log pour débogage

    // Récupérer la langue actuelle et les traductions
    const source = window.translations && window.translations[window.currentLang]
        ? window.translations[window.currentLang]
        : fallbackTranslations[window.currentLang];

    if (memorizedPasswords.length === 0) {
        // Cas où aucun mot n’est mémorisé
        const activeScreen = document.querySelector('.password-display[style*="display: block"]'); // Écran actif (randomScreen ou creativeScreen)
        const currentPassword = activeScreen?.textContent.trim() || ''; // Mot affiché actuellement

        if (!isScreenEmpty(currentPassword)) {
            // Si un mot valide est affiché, l’ajoute à #exportContent
            exportContent.innerHTML = `<p>${source.current_password} ${currentPassword}</p>`;
        } else {
            // Sinon, affiche un message par défaut
            exportContent.innerHTML = `<p>${source.no_password_memorized}</p>`;
        }
    } else {
        // Cas où des mots sont mémorisés : les affiche avec leur numéro (M1, M2...)
        memorizedPasswords.forEach((mp, index) => {
            const p = document.createElement('p');
            p.textContent = `M${index + 1}: ${mp}`; // Format : "M1: mot", "M2: mot", etc.
            exportContent.appendChild(p); // Ajoute chaque mot au conteneur
        });
    }
}



// -----------------------------------
// FONCTION : NOTIFICATION AUCUN MOT DE PASSE MÉMORISÉ
// -----------------------------------
// Affiche une notification temporaire centrée en bas de l’écran quand aucune donnée n’est disponible
// pour l’exportation ou la mémorisation (ex. si tous les écrans sont vides ou à l’état initial).

function showNoPasswordNotification() {
    const source = window.translations && window.translations[window.currentLang]
        ? window.translations[window.currentLang]
        : {
            no_password_alert: "Aucun mot de passe mémorisé."
        };
    const alertMessage = source.no_password_alert;
    console.log(`ℹ️ Fenêtre d’alerte affichée pour exportation : ${alertMessage}`);

    // Créer la fenêtre d’alerte
    const notification = document.createElement('div');
    notification.className = 'alert-window';
    notification.textContent = alertMessage;
    document.body.appendChild(notification);

    // Afficher avec fondu
    setTimeout(() => {
        notification.classList.add('show');
    }, 10);

    // Supprimer après 2 secondes avec fondu
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            notification.remove();
        }, 300); // Correspond à la durée de la transition
    }, 2000);
}

function showVisualInsertAlert(message) {
    const notification = document.createElement('div');
    notification.className = 'alert-window';
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.classList.add('show');
    }, 10);

    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 2000);
}


function showNavigationInsertBlockedNotification() {

    const translations = window.translations?.[window.currentLang] || {};
    const alertMessage = translations?.navigation_insert_block || "Impossible d'insérer ce message.";

    console.log(`🚫 Alerte d’insertion bloquée : ${alertMessage}`);

    const notification = document.createElement('div');
    notification.className = 'alert-window';
    notification.textContent = alertMessage;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.classList.add('show');
    }, 10);

    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 2000);
}






// -----------------------------------
// ÉVÉNEMENT : SAUVEGARDE DES MOTS DE PASSE DANS UN FICHIER
// -----------------------------------
// Gère le clic sur #saveToFileButton pour sauvegarder les mots de passe mémorisés ou le mot actuel
// dans un fichier texte (mots_de_passe.txt), réinitialiser la mémoire, et fermer la fenêtre d’exportation.

saveToFileButton.addEventListener('click', () => {
    const comments = document.getElementById('comments').value; // Récupère les commentaires saisis
    let content = ''; // Contenu final du fichier

    // Récupérer la langue actuelle et les traductions
    const source = window.translations && window.translations[window.currentLang]
        ? window.translations[window.currentLang]
        : fallbackTranslations[window.currentLang];

    // Détermine le contenu à sauvegarder
    if (memorizedPasswords.length === 0) {
        // Cas où aucun mot n’est mémorisé
        const activeScreen = document.querySelector('.password-display[style*="display: block"]'); // Écran actif (randomScreen ou creativeScreen)
        const currentPassword = activeScreen?.textContent.trim() || ''; // Mot affiché actuellement

        if (!isScreenEmpty(currentPassword)) {
            // Si un mot valide est affiché, le sauvegarde
            content = `${source.current_password} ${currentPassword}`;
        } else {
            // Sinon, message par défaut
            content = source.no_password_memorized;
        }
    } else {
        // Cas où des mots sont mémorisés : les concatène avec numéros (M1, M2...)
        content = memorizedPasswords.map((mp, index) => `M${index + 1}: ${mp}`).join('\n');
    }

    // Ajoute les commentaires au contenu
    content += `\n\n${source.comments_label}\n${comments}`;

    // Crée et télécharge le fichier texte
    const blob = new Blob([content], { type: 'text/plain' }); // Crée un fichier texte brut
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); // Génère un lien temporaire
    link.download = source.export_filename; // Nom du fichier traduit
    link.click(); // Déclenche le téléchargement

    // Réinitialise la mémoire et l’interface
    memoryCounter = 0; // Réinitialise le compteur
    memorizedPasswords.length = 0; // Vide la liste des mots mémorisés
    memoryButton.textContent = 'M'; // Réinitialise l’étiquette du bouton mémoire
    exportPage.style.display = 'none'; // Ferme la fenêtre d’exportation
    document.getElementById('comments').value = ''; // Vide le champ des commentaires
    copyButton.textContent = source.copy_button; // Utilise la traduction pour "Copier"
    copyButton.style.backgroundColor = "#007bff"; // Restaure la couleur par défaut

    console.log("Après sauvegarde, Liste réinitialisée:", memorizedPasswords); // Log pour débogage

    // Affiche une notification de réinitialisation
    showNotification(source.reset_button + " !", { bottom: '600px' }); // Utilise la traduction pour "Réinitialiser"
});

// -----------------------------------
// FONCTION : NOTIFICATION GÉNÉRIQUE
// -----------------------------------
// Affiche une notification temporaire personnalisable (message, position, style, durée).
function showNotification(message, options = {}) {
    const notification = document.createElement('div');
    notification.textContent = message;
    Object.assign(notification.style, {
        position: 'fixed',              // Position fixe dans l’écran
        bottom: options.bottom || '20px',  // Position par défaut en bas, personnalisable
        right: options.right || '20px',    // Aligné à droite par défaut
        backgroundColor: options.bgColor || 'orange',  // Fond orange par défaut
        color: options.textColor || 'white',           // Texte blanc par défaut
        padding: '10px 20px',           // Espacement interne
        borderRadius: '5px',            // Coins arrondis
        opacity: '1',                   // Visible au départ
        transition: 'opacity 2triangles ease-out',  // Animation de disparition
        ...options.style                // Permet des styles supplémentaires
    });
    document.body.appendChild(notification);
    setTimeout(() => {
        notification.style.opacity = '0';  // Début du fondu
        setTimeout(() => notification.remove(), 2000);  // Supprime après 2s (fin du fondu)
    }, options.duration || 2000);  // Durée par défaut de 2s avant disparition
}








// -----------------------------------
// SECTION : INFO-BULLE POUR LE BOUTON MÉMORISER
// -----------------------------------
// Crée et gère une info-bulle pour #memoryButton affichant des instructions.
// À revoir plus tard pour une version générique applicable à d’autres boutons.

const memoryTooltip = document.createElement('div');  // Info-bulle pour #memoryButton
memoryTooltip.id = 'memoryTooltip';                   // Identifiant unique
Object.assign(memoryTooltip.style, {
    position: 'absolute',            // Positionnement dynamique près du bouton
    backgroundColor: '#f0f0f0',      // Fond gris clair pour lisibilité
    border: '1px solid #ccc',        // Bordure légère pour délimitation
    padding: '5px',                  // Espacement interne
    borderRadius: '5px',             // Coins arrondis
    fontSize: '12px',                // Taille de police réduite
    display: 'none',                 // Masquée par défaut
    zIndex: '9999'                   // Au-dessus des autres éléments
});
document.body.appendChild(memoryTooltip);  // Ajoute l’info-bulle au DOM


function setTooltip(elementId, translationKey) {
    const el = document.getElementById(elementId);
    if (!el) {
        console.warn(`⚠️ Élément avec l’ID "${elementId}" introuvable pour le tooltip.`);
        return;
    }

    const lang = window.currentLang || 'fr';
    const translations = window.translations?.[lang];

    if (!translations || !translations.tooltips || !translations.tooltips[translationKey]) {
        console.warn(`⚠️ Traduction manquante pour "${translationKey}" dans la langue "${lang}"`);
        return;
    }

    el.innerHTML = translations.tooltips[translationKey];
}





// Temporisateur pour gérer l’affichage différé de l’info-bulle au survol
let hoverTimeout;



// -----------------------------------
// ÉVÉNEMENTS : AFFICHAGE DE L’INFO-BULLE POUR #memoryButton
// -----------------------------------
// Gère l’affichage différé et le masquage de l’info-bulle au survol de #memoryButton.
// À revoir plus tard pour une généralisation à d’autres boutons.

// Affiche l’info-bulle après un délai au survol de #memoryButton
memoryButton.addEventListener('mouseover', (event) => {
    hoverTimeout = setTimeout(() => {
        setTooltip('memoryTooltip', 'memory');  // Met à jour le contenu de l’info-bulle
        memoryTooltip.style.display = 'block';  // Rend l’info-bulle visible
        // Positionne l’info-bulle à 10px à droite et en bas du curseur
        memoryTooltip.style.left = `${event.pageX + 10}px`;
        memoryTooltip.style.top = `${event.pageY + 10}px`;
    }, 1500);  // Délai de 1,5s avant affichage pour éviter les flashs intempestifs
});

// Masque l’info-bulle quand le curseur quitte #memoryButton
memoryButton.addEventListener('mouseout', () => {
    clearTimeout(hoverTimeout);  // Annule le délai d’affichage si en cours
    memoryTooltip.style.display = 'none';  // Masque l’info-bulle immédiatement
});














// -----------------------------------
// SECTION : INITIALISATION PRINCIPALE ET GESTION DES INTERACTIONS
// -----------------------------------
// Initialise les éléments de l’interface, configure les curseurs pour le mode aléatoire,
// gère la fenêtre des caractères spéciaux pour le mode aléatoire, et met à jour les caractères sélectionnés.



// -----------------------------------
// SECTION : Récupération des caractères spéciaux sélectionnés (Générique)
// -----------------------------------
// Objectif : Récupère les caractères spéciaux cochés dans une modale spécifiée, avec options pour 
// gérer les logs et la mise à jour de variables globales.
// Paramètres : 
//   - modalId (String) : ID de la modale cible (ex. "specialCharsWindowRandom" ou "specialCharsWindow").
//   - options (Object, facultatif) : 
//       - log (Boolean) : Si true, affiche un message dans la console.
//       - updateGlobal (String) : Nom de la variable globale à mettre à jour (ex. "selectedSpecialChars").
// Retour : Une chaîne contenant les caractères sélectionnés (ex. "!@#"), ou "" si aucun.
// Dépendances : Éléments DOM avec la structure #<modalId> .char-options input[type='checkbox'].
function getSelectedSpecialChars(modalId, options = {}) {
    const { log = false, updateGlobal = null } = options;

    const modal = document.getElementById(modalId);
    if (!modal) {
        console.warn(`⚠️ getSelectedSpecialChars : Modale #${modalId} non trouvée.`);
        return "";
    }

    const selector = modalId === "specialCharsWindowRandom" ?
        ".random-char-options input[type='checkbox']:checked" :
        ".char-options input[type='checkbox']:checked";
    const selectedChars = [...modal.querySelectorAll(selector)]
        .map(checkbox => checkbox.value)
        .join("");

    if (log) {
        console.log(`Caractères spéciaux sélectionnés (${modalId}):`, selectedChars || "Aucun");
    }

    if (updateGlobal && typeof window[updateGlobal] !== 'undefined') {
        window[updateGlobal] = selectedChars;
    }

    return selectedChars || "";
}

// Alias pour les modes spécifiques, avec comportements originaux restaurés
const getSelectedSpecialCharsRandom = () => getSelectedSpecialChars("specialCharsWindowRandom", {
    log: true,
    updateGlobal: "selectedSpecialChars"
});
const getSelectedSpecialCharsCreative = () => getSelectedSpecialChars("specialCharsWindow", {
    log: true
});


// 📌 2️⃣ Fonction pour basculer entre le mode aléatoire et le mode créatif
// Affiche ou masque les écrans et boutons appropriés selon le mode choisi.
// Le bouton #menuToggle reste visible dans les deux modes pour accéder au menu latéral.




// 📌 Fonction pour afficher une notification temporaire centrée en bas de l’écran
// Crée un message (ex. "Texte copié !") qui apparaît pendant 2 secondes avec une transition de disparition.
function showCopyNotification(message) {
    const notification = document.createElement('div');
    notification.textContent = message;

    // Styles regroupés dans un objet pour plus de lisibilité
    Object.assign(notification.style, {
        position: 'fixed',
        bottom: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: '#28a745',
        color: '#fff',
        padding: '10px 20px',
        borderRadius: '5px',
        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
        zIndex: '10000',
        opacity: '1',
        transition: 'opacity 1s ease-out'
    });

    // Ajout au DOM avec vérification
    if (document.body) {
        document.body.appendChild(notification);
    } else {
        console.warn("⚠️ document.body n’est pas disponible pour afficher la notification !");
        return;
    }

    // Gestion de la disparition avec une seule temporisation
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.addEventListener('transitionend', () => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, { once: true }); // Événement déclenché une seule fois
    }, 2000);
}



// 📌 Fonction pour animer l’affichage d’un mot de passe dans #creativeScreen
// Efface le contenu actuel, ajoute le mot de passe dans un <span> avec une animation CSS,
// et retire la classe d’animation après 500 ms pour éviter les conflits futurs.
function animatePassword(password) {
    if (!creativeScreen || !password || typeof password !== 'string') {
        console.warn("⚠️ Paramètre invalide ou #creativeScreen manquant pour animatePassword !");
        return;
    }

    while (creativeScreen.firstChild) {
        creativeScreen.removeChild(creativeScreen.firstChild);
    }

    const span = document.createElement("span");
    span.textContent = password;
    span.classList.add("animated-password");

    creativeScreen.appendChild(span);

    // Retirer la classe après l’animation sans perturber le texte
    setTimeout(() => {
        span.classList.remove("animated-password");
    }, 500);
}


function updateResetButton() {
    const resetButton = document.getElementById('resetButton');
    const importerAlea = document.getElementById('importerAlea');
    const isCreative = creativeScreen.style.display !== 'none'; // Vérifie si mode créatif actif
    if (!resetButton) {
        console.warn("⚠️ #resetButton manquant !");
        return;
    }
    const hasContent = creativeScreen.textContent.trim().length > 0;
    resetButton.style.visibility = (isCreative && hasContent) ? 'visible' : 'hidden'; // Visible seulement en mode créatif avec contenu
    if (importerAlea) {
        importerAlea.style.display = hasContent ? 'none' : 'inline-block'; // inchangé
    }
    console.log(`ℹ️ Bouton Réinitialiser : ${(isCreative && hasContent) ? 'visible' : 'caché'}`);
}

// 🔹 Écouteur pour importer un mot de passe aléatoire dans le mode créatif avec animation
// Récupère le mot de passe de #randomScreen, l’anime dans #creativeScreen, masque #importerAlea,
// et affiche #resetButton si le mot de passe est valide.
let isImporting = false;

document.getElementById("importerAlea").addEventListener("click", function () {
    const importerAleaButton = document.getElementById("importerAlea");
    const resetBtn = document.getElementById("resetButton");

    if (!randomScreen || !creativeScreen || !importerAleaButton || !resetBtn) {
        console.warn("⚠️ Un ou plusieurs éléments nécessaires pour #importerAlea sont manquants !");
        return;
    }

    const firstLineEl = randomScreen.querySelector('.first-line');
    const secondLineEl = randomScreen.querySelector('.second-line');
    const screenContainer = creativeScreen.closest('.password-screen');

    let importedText = '';
    let originalOneLineText = '';

    if (firstLineEl && secondLineEl) {
        const line1 = firstLineEl.innerText.trim();
        const line2 = secondLineEl.innerText.trim();
        importedText = line1 + '\n' + line2;
        originalOneLineText = line1 + line2;

        isImporting = true;
        isFromImport = true;
        alreadyCleanedAfterImport = false;

        setTimeout(() => {
            // ✅ Forcer l’affichage sur 2 lignes en HTML
            creativeScreen.innerHTML = `
                <div class="line first-line" dir="ltr">${line1}</div>
                <div class="line second-line" dir="ltr">${line2}</div>
            `;
            creativeScreen.classList.add("import-view");

            // ✅ Hauteur personnalisée
            const lineHeight = parseFloat(getComputedStyle(creativeScreen).lineHeight) || 40;
            creativeScreen.style.height = `${lineHeight * 2}px`;

            // ✅ Réinitialiser les classes d’affichage
            if (screenContainer) {
                screenContainer.classList.remove('three-lines', 'font-22');
                screenContainer.classList.add('two-lines');
            }

            // ✅ Ne pas réécrire le texte, juste stocker l’original pour reset
            originalCreativePassword = originalOneLineText;
            originalContent = originalOneLineText;

            updateCreativeMetrics();
            updateResetButton();

            console.log("🔥 Import terminé, affichage forcé 2 lignes conservé.");
            isImporting = false;
        }, 250);
    } else {
        // Mode aléa en une seule ligne
        importedText = randomScreen.textContent.trim();
        originalOneLineText = importedText;

        isImporting = true;
        isFromImport = true;
        alreadyCleanedAfterImport = false;

        setTimeout(() => {
            creativeScreen.textContent = importedText;
            isFromImport = true;
            creativeScreen.style.height = ''; // auto
            if (screenContainer) {
                screenContainer.classList.remove('two-lines', 'three-lines', 'font-22');
            }

            originalCreativePassword = importedText;
            originalContent = importedText;

            updateCreativeMetrics();
            updateResetButton();

            console.log("📥 Import simple 1 ligne OK");
            isImporting = false;
        }, 250);
    }

    animatePassword(importedText);
});










// Variables globales pour le mode créatif
let creativeText = ''; // Base du texte en mode créatif (à confirmer si utilisée ailleurs)




















// Variable qui contiendra les caractères spéciaux sélectionnés
let selectedSpecialChars = "!@#$%^&*()-_=+{}[]|\\:;\"'<>,.?/`~";




















// 📌 Ajout des écouteurs pour régénérer le mot de passe au changement des curseurs
// Met à jour le mot de passe dans #randomScreen à chaque ajustement des curseurs de longueur et de catégories.
const sliders = {
    length: lengthSlider,
    minuscules: minusculesSlider,
    majuscules: majusculesSlider,
    chiffres: chiffresSlider,
    speciaux: speciauxSlider
};

// Vérifie et ajoute les écouteurs pour chaque curseur
Object.entries(sliders).forEach(([type, slider]) => {
    if (!slider) {
        console.warn(`⚠️ Curseur ${type} manquant dans le DOM !`);
        return;
    }

    slider.addEventListener('input', () => {
        generateRandomPassword();
        console.log(`✅ Mise à jour du mot de passe via curseur ${type} : ${slider.value}`);
    });
});



// Effet "machine à sous" au clic avec contrôle des lignes
function slotMachineEffectOnClick(displayElement, finalPasswordCallback, iterations = 8, initialSpeed = 4, delayIncrease = 9) {
    if (!displayElement) {
        console.warn("⚠️ Élément d’affichage manquant pour l’effet slotMachineEffectOnClick !");
        return;
    }

    const lengthSlider = document.getElementById('length-slider');
    const targetLength = parseInt(lengthSlider.value, 10) || 12;

    function generateTempPassword() {
        const tempPassword = generateRandomPassword();
        return tempPassword.slice(0, targetLength); // Toujours la bonne longueur
    }

    let count = iterations;
    function runEffect(delay) {
        if (count > 0) {
            displayElement.textContent = generateTempPassword();
            updateTextWrap();
            console.log(`ℹ️ Itération ${iterations - count + 1}/${iterations}, délai : ${delay}ms`);
            setTimeout(() => runEffect(delay + delayIncrease), delay);
            count--;
        } else {
            const finalPassword = finalPasswordCallback();
            displayElement.textContent = finalPassword; // Texte complet
            updateTextWrap();
            console.log("✅ Mot de passe final généré :", finalPassword);
            originalRandomPassword = finalPassword;
        }
    }

    runEffect(initialSpeed);
}

// Écouteur pour le bouton "Générer"
if (generateButton) {
    generateButton.addEventListener("click", () => {
        slotMachineEffectOnClick(randomScreen, () => {
            const password = generateRandomPassword();
            updateRandomPassword();
            return password;
        });
    });
} else {
    console.warn("⚠️ #generateButton manquant dans le DOM !");
}






// -----------------------------------
// SECTION : Évaluation de la force d’un mot de passe (Modes Créatif/Aléatoire)
// -----------------------------------
// Objectif : Calcule une note de force (0-5) pour un mot de passe en fonction de sa longueur et de sa diversité,
// avec une pondération stricte favorisant les mots longs.
// Paramètres : 
//   - password (String) : Le mot de passe à évaluer.
//   - type (String) : Le mode ("creative" ou "random") pour mise à jour UI.
// Retour : Aucun (met à jour l’interface via updateStrengthUI).
// Dépendances : 
//   - Fonction : updateStrengthUI(strength, type).
// Contexte : Appelée par updateCreativeMetrics et generateRandomPassword.
function evaluatePasswordStrength(password, type) {
    let strength = 0;

    const source = window.translations && window.translations[window.currentLang]
        ? window.translations[window.currentLang]
        : (typeof fallbackTranslations !== 'undefined' ? fallbackTranslations[window.currentLang] : {
            no_next_content: "Pas de contenu suivant",
            no_prev_content: "Pas de contenu précédent"
        });

    if (!password || typeof password !== 'string' || password.trim().length === 0 ||
        password.trim() === source.no_next_content ||
        password.trim() === source.no_prev_content) {
        updateStrengthUI(-1, type);
        console.log(`ℹ️ Mot vide ou placeholder dans ${type}, force non évaluée`);
        return;
    }

    const trimmedPassword = password.trim();
    const length = trimmedPassword.length;

    if (length >= 16) strength += 2;
    else if (length >= 12) strength += 1;

    const diversityFactor = length >= 8 ? 1 : 0.5;
    const diversityPoints = diversityFactor * (
        (/[A-Z]/.test(trimmedPassword) ? 1 : 0) +
        (/[a-z]/.test(trimmedPassword) ? 1 : 0) +
        (/[0-9]/.test(trimmedPassword) ? 1 : 0) +
        (/[^A-Za-z0-9]/.test(trimmedPassword) ? 1 : 0)
    );
    strength += Math.floor(diversityPoints);

    strength = Math.min(strength, 5);

    updateStrengthUI(strength, type);
    console.log(`ℹ️ Force calculée pour ${type} : ${strength}/5 (longueur=${length})`);
}

function updateStrengthUI(strength, type) {
    const strengthKeys = [
        'strength_empty',      // -1 : Vide
        'strength_very_weak',  // 0 : Insuffisant
        'strength_weak',       // 1 : Minimal
        'strength_medium',     // 2 : Acceptable
        'strength_good',       // 3 : Correct
        'strength_strong',     // 4 : Sécurisé
        'strength_very_strong' // 5 : Très sécurisé
    ];
    const colors = [
        "transparent", // -1 : Vide
        "#FF0000",     // 0 : Rouge
        "#FF6600",     // 1 : Orange foncé
        "#FFCC00",     // 2 : Jaune orangé
        "#99CC00",     // 3 : Vert clair
        "#66CC00",     // 4 : Vert moyen
        "#009900"      // 5 : Vert foncé
    ];

    const fallbackTranslations = {
        fr: {
            strength_empty: "***",
            strength_very_weak: "Très faible",
            strength_weak: "Faible",
            strength_medium: "Moyen",
            strength_good: "Bon",
            strength_strong: "Fort",
            strength_very_strong: "Très fort"
        },
        en: {
            strength_empty: "***",
            strength_very_weak: "Very weak",
            strength_weak: "Weak",
            strength_medium: "Medium",
            strength_good: "Good",
            strength_strong: "Strong",
            strength_very_strong: "Very strong"
        },
        es: {
            strength_empty: "***",
            strength_very_weak: "Muy débil",
            strength_weak: "Débil",
            strength_medium: "Medio",
            strength_good: "Bueno",
            strength_strong: "Fuerte",
            strength_very_strong: "Muy fuerte"
        },
        de: {
            strength_empty: "***",
            strength_very_weak: "Sehr schwach",
            strength_weak: "Schwach",
            strength_medium: "Mittel",
            strength_good: "Gut",
            strength_strong: "Stark",
            strength_very_strong: "Sehr stark"
        },
        it: {
            strength_empty: "***",
            strength_very_weak: "Molto debole",
            strength_weak: "Debole",
            strength_medium: "Medio",
            strength_good: "Buono",
            strength_strong: "Forte",
            strength_very_strong: "Molto forte"
        }
    };

    const barId = type === "random" ? "random-strength-bar" : "strength-bar";
    const textId = type === "random" ? "random-strength-text" : "strength-text";
    const strengthBar = document.getElementById(barId);
    const strengthText = document.getElementById(textId);

    if (!strengthBar || !strengthText) {
        console.warn(`⚠️ Éléments UI manquants pour ${type} : ${barId}, ${textId}`);
        return;
    }

    // Sélectionner la source des traductions
    const source = window.translations && window.translations[window.currentLang] ? window.translations[window.currentLang] : fallbackTranslations[window.currentLang];
    if (!window.translations || !window.translations[window.currentLang]) {
        console.log(`ℹ️ Utilisation des traductions de secours pour ${window.currentLang}`);
    }

    const strengthTextValue = source[strengthKeys[strength + 1]] || strengthKeys[strength + 1];
    strengthText.textContent = strengthTextValue;
    strengthBar.style.width = strength >= 0 ? `${strength * 20}%` : '0%';
    strengthBar.style.backgroundColor = colors[strength + 1];
}

// Lier la force du mot de passe au mode aléatoire
function updateRandomPasswordStrength() {
    evaluatePasswordStrength(randomScreen.textContent, "random");
}

// Ajout des écouteurs
[lengthSlider, minusculesSlider, majusculesSlider, chiffresSlider, speciauxSlider].forEach(slider => {
    slider.addEventListener('input', updateRandomPasswordStrength);
});

generateButton.addEventListener('click', updateRandomPasswordStrength);




// -----------------------------------
// SECTION : Mise à jour des métriques en mode Créatif
// -----------------------------------
// Objectif : Met à jour les métriques (longueur, visibilité du bouton réinitialiser, force) pour un écran donné.
// Paramètres : Aucun (utilise des éléments DOM et variables globales).
// Retour : Aucun (met à jour directement les éléments DOM).
// Dépendances : 
//   - Éléments DOM : #creativeScreen, #creative-length-value, #resetButton.
//   - Fonction : evaluatePasswordStrength().
//   - Variables globales : creativeScreen, creativeLengthValue, resetButton (définies ailleurs).
// Contexte : Appelée après modifications dans #creativeScreen ou #generatedWordDisplay.
function updateCreativeMetrics() {
    const creativeLengthValue = document.getElementById('creative-length-value');
    const resetButton = document.getElementById('resetButton');

    if (!creativeScreen || !creativeLengthValue || !resetButton) {
        console.warn("⚠️ Éléments manquants pour updateCreativeMetrics : creativeScreen, creative-length-value, ou resetButton !");
        return;
    }

    const source = window.translations && window.translations[window.currentLang]
        ? window.translations[window.currentLang]
        : (typeof fallbackTranslations !== 'undefined' ? fallbackTranslations[window.currentLang] : {
            no_next_content: "Pas de contenu suivant",
            no_prev_content: "Pas de contenu précédent"
        });

    const trimmedText = creativeScreen.textContent.replace(/\s+/g, '').replace(/\n/g, '');
    let textLength = Math.min(trimmedText.length, 50); // Limiter à 45 max

    // Forcer la longueur à 0 pour les placeholders
    if (trimmedText === source.no_next_content || trimmedText === source.no_prev_content) {
        textLength = 0;
        console.log(`ℹ️ Placeholder détecté ("${trimmedText}"), longueur forcée à 0`);
    }

    creativeLengthValue.textContent = textLength;
    resetButton.style.visibility = textLength > 0 ? 'visible' : 'hidden';

    if (typeof evaluatePasswordStrength === "function") {
        evaluatePasswordStrength(trimmedText.slice(0, 50), "creative");
        console.log(`ℹ️ Métriques mises à jour : longueur=${textLength}, force évaluée`);
    } else {
        console.warn("⚠️ evaluatePasswordStrength n’est pas défini !");
    }
}

// 📌 Écouteur modifié pour la saisie dans #creativeScreen
// Supprimé pour consolidation
/*
if (creativeScreen) {
    creativeScreen.addEventListener('input', function (e) {
        if (isImporting) return;
        updateCreativeMetrics();
    });
} else {
    console.warn("⚠️ #creativeScreen manquant pour l’écouteur input !");
}
*/

// 📌 Réinitialisation du mode créatif via #resetButton
// Vide #creativeScreen, rétablit le placeholder, et met à jour l’interface.
// 📌 Réinitialisation du mode créatif via #resetButton
// Vide #creativeScreen, rétablit le placeholder, et met à jour l’interface.
const resetButton = document.getElementById('resetButton');
if (resetButton) {
    resetButton.addEventListener('click', () => {
        if (!creativeScreen) {
            console.warn("⚠️ #creativeScreen manquant pour la réinitialisation !");
            return;
        }

        baseWord = "";
        creativeScreen.textContent = "";
        originalCreativePassword = "";
        originalContent = "";
        creativeScreen.setAttribute('data-i18n-placeholder', window.translations[window.currentLang].creative_placeholder);
        creativeScreen.focus();
        console.log(`ℹ️ Placeholder rétabli pour creativeScreen après réinitialisation : ${window.translations[window.currentLang].creative_placeholder}`);

        selectionOrder = [];
        selectedSeparators = [];
        updateSeparatorColors();
        buttonsInterface.separator.classList.remove("active-button");
        isSeparatorActive = false;

        updateResetButton();

        setTimeout(() => {
            if (typeof updateCreativeMetrics === "function") updateCreativeMetrics();
            document.addEventListener('DOMContentLoaded', () => {
                updateCreativeText(null);
            });
            console.log("✔️ Interface mise à jour après reset");
        }, 100);

        console.log("🔄 Réinitialisation complète : texte, compteur et boutons mis à jour !");
    });
} else {
    console.warn("⚠️ #resetButton manquant pour l’écouteur click !");
}














// 📌 Génération d’un anagramme à partir d’un texte
// Mélange aléatoirement les caractères du texte d’entrée.
function createAnagram(text) {
    if (!text || typeof text !== 'string') return "";
    const chars = text.split("");
    for (let i = chars.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [chars[i], chars[j]] = [chars[j], chars[i]]; // Échange aléatoire
    }
    return chars.join("");
}

// 📌 Gestion générique des anagrammes pour les modes aléatoire et créatif
// Crée un anagramme à partir du texte dans l’élément cible et met à jour selon le mode.
function handleAnagram(targetScreen, isCreativeMode = false) {
    if (!targetScreen) {
        console.warn(`⚠️ Élément cible manquant pour l’anagramme (${isCreativeMode ? "creativeScreen" : "randomScreen"})`);
        return;
    }

    const currentText = targetScreen.textContent.trim();

    if (isCreativeMode && (!currentText || isScreenEmpty(currentText))) {
        const source = window.translations && window.translations[window.currentLang]
            ? window.translations[window.currentLang]
            : {
                invalid_content_anagram_alert: "Veuillez entrer un texte dans la zone principale pour créer un anagramme."
            };
        const alertMessage = source.invalid_content_anagram_alert;
        console.log(`ℹ️ Fenêtre d’alerte affichée pour anagramme : ${currentText}`);

        showCustomAlert('invalid_content_anagram_alert');

        return;
    } else if (!isCreativeMode && (!currentText || currentText === 'Cliquez sur "Générer" pour créer un mot de passe')) {
        alert('Veuillez générer un mot de passe pour créer un anagramme.');
        return;
    }

    if (isCreativeMode && typeof window.insertCreativeContent === "function") {
        console.log("ℹ️ Ajout à l’historique avant anagramme :", currentText);
        window.insertCreativeContent(currentText);
    }

    const anagram = createAnagram(currentText);
    if (!anagram) {
        console.warn("⚠️ Échec de la génération de l’anagramme !");
        return;
    }
    console.log(`✅ Anagramme généré pour ${isCreativeMode ? "créatif" : "aléatoire"} :`, anagram);

    if (targetScreen === document.getElementById('generatedWordDisplay')) {
        baseGeneratedWord = anagram;
        console.log("ℹ️ Nouvelle baseGeneratedWord après anagramme :", baseGeneratedWord);
        updateFilteredText(); // Applique les filtres immédiatement
    } else {
        targetScreen.textContent = anagram;
    }

    if (isCreativeMode) {
        if (typeof updateCreativeMetrics === "function") {
            updateCreativeMetrics();
        }
        if (typeof window.insertCreativeContent === "function") {
            console.log("ℹ️ Ajout de l’anagramme à l’historique :", anagram);
            window.insertCreativeContent(anagram);
        }
    }
}

// 📌 Écouteur pour le bouton "Anagramme" (dual mode)
const anagramButton = document.getElementById('anagram-button'); // ID corrigé
if (anagramButton) {
    anagramButton.addEventListener('click', () => {
        const modeSwitch = document.getElementById('modeSwitch');
        if (!modeSwitch) {
            console.warn("⚠️ #modeSwitch manquant, utilisation du mode aléatoire par défaut");
            handleAnagram(randomScreen, false);
            return;
        }
        const isCreativeMode = modeSwitch.checked;
        handleAnagram(isCreativeMode ? creativeScreen : randomScreen, isCreativeMode);
    });
} else {
    console.warn("⚠️ #anagram-button manquant dans le DOM !");
}




// 📌 Inversion du texte dans #creativeScreen
// Retourne le texte avec ses caractères inversés.
function reverseText(text) {
    if (typeof text !== 'string' || !text.trim()) {
        console.warn("⚠️ Texte invalide pour inversion :", text);
        return "";
    }
    return text.split('').reverse().join('');
}

// 📌 Gestion du bouton "Inverser" en mode créatif
// Inverse le texte actuel dans #creativeScreen et met à jour l’historique et les métriques.
const reverseButton = document.getElementById('reverseButton');
if (reverseButton) {
    reverseButton.addEventListener('click', () => {
        if (!creativeScreen) {
            console.warn("⚠️ #creativeScreen manquant pour l’inversion !");
            return;
        }

        const currentText = creativeScreen.textContent.trim();

        // Vérification du contenu
        if (!currentText || isScreenEmpty(currentText)) {
            const source = window.translations && window.translations[window.currentLang]
                ? window.translations[window.currentLang]
                : {
                    invalid_content_reverse_alert: "Veuillez entrer un texte dans la zone principale pour inverser le texte."
                };
            const alertMessage = source.invalid_content_reverse_alert;
            console.log(`ℹ️ Fenêtre d’alerte affichée pour inversion : ${currentText}`);

            // Créer la fenêtre d’alerte
            showCustomAlert('invalid_content_reverse_alert');

            return;
        }

        // Ajout à l’historique avant inversion
        if (typeof window.insertCreativeContent === "function") {
            console.log("ℹ️ Ajout à l’historique avant inversion :", currentText);
            window.insertCreativeContent(currentText);
        }

        // Génération du texte inversé
        const reversedText = reverseText(currentText);
        creativeScreen.textContent = reversedText;
        console.log("✅ Texte inversé :", reversedText);

        // Ajout à l’historique après inversion et mise à jour des métriques
        if (typeof window.insertCreativeContent === "function") {
            console.log("ℹ️ Ajout du texte inversé à l’historique :", reversedText);
            window.insertCreativeContent(reversedText);
        } else {
            console.warn("⚠️ window.insertCreativeContent n’est pas défini ! Vérifie creativeScreenNav.js");
        }

        if (typeof updateCreativeMetrics === "function") {
            updateCreativeMetrics();
            console.log("ℹ️ Métriques mises à jour après inversion");
        } else {
            console.warn("⚠️ updateCreativeMetrics n’est pas défini !");
        }
    });
} else {
    console.warn("⚠️ #reverseButton manquant dans le DOM !");
}


// Fonction de debounce
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}




// 📌 Récupération du séparateur actif
// Retourne le premier séparateur sélectionné si le mode séparateur est activé, sinon une chaîne vide.
function getActiveSeparator() {
    if (typeof isSeparatorActive !== 'boolean' || !Array.isArray(selectedSeparators)) {
        console.warn("⚠️ isSeparatorActive ou selectedSeparators invalide :", { isSeparatorActive, selectedSeparators });
        return "";
    }

    const separator = isSeparatorActive && selectedSeparators.length > 0 ? selectedSeparators[0] : "";
    console.log("ℹ️ Séparateur actif récupéré :", separator || "aucun");
    return separator;
}





// 📌 Sélecteurs pour le mode créatif avec filtres et écran commun
// Récupère les éléments d’affichage et de contrôle des filtres.
const generatedWordDisplay = document.getElementById('generatedWordDisplay');

const creativeExclureDoublons = document.getElementById('creative-exclure-doublons');
const creativeExclureSimilaires = document.getElementById('creative-exclure-similaires');

// Vérification initiale des éléments
if (!generatedWordDisplay || !selectedWordDisplay || !creativeExclureDoublons || !creativeExclureSimilaires) {
    console.warn("⚠️ Éléments manquants pour les filtres ou l’écran commun :", {
        generatedWordDisplay: !!generatedWordDisplay,
        selectedWordDisplay: !!selectedWordDisplay,
        creativeExclureDoublons: !!creativeExclureDoublons,
        creativeExclureSimilaires: !!creativeExclureSimilaires
    });
}




// -----------------------------------
// SECTION : Application des filtres sur un mot (Mode Créatif/Aléatoire)
// -----------------------------------
// Objectif : Applique des filtres sur une chaîne pour supprimer les doublons et/ou les caractères similaires,
// selon les options spécifiées.
// Paramètres : 
//   - word (String) : La chaîne à filtrer.
//   - removeDuplicates (Boolean, facultatif) : Si true, supprime les caractères en double. Défaut : false.
//   - removeSimilar (Boolean, facultatif) : Si true, supprime les caractères visuellement similaires. Défaut : false.
// Retour : Une chaîne filtrée selon les options activées.
// Dépendances : Aucune (fonction autonome).
// Exemple : applyFilters('Hello1122', true, true) → 'Heo' (supprime 'l' similaire et doublons '1', '2').




function applyFilters(word, removeDuplicates = false, removeSimilar = false) {
    // Vérifie que l’entrée est une chaîne valide et non vide
    if (typeof word !== 'string' || !word.trim()) {
        console.warn("⚠️ Mot invalide pour applyFilters :", word);
        return "";
    }

    // Liste des caractères similaires (extensible si besoin)
    const similarChars = new Set(['0', 'O', '1', 'I', 'l', 'L', '5', 'S', '8', 'B']);
    const seen = new Set();

    // Filtre les caractères avec les options activées
    const filteredWord = [...word].filter(char => {
        if (removeSimilar && similarChars.has(char)) return false;
        if (removeDuplicates) {
            if (seen.has(char)) return false;
            seen.add(char);
        }
        return true;
    }).join('');

    // Log conditionnel pour débogage (désactivable en production)
    if (typeof console !== 'undefined' && console.log) {
        console.log("ℹ️ Filtres appliqués :", {
            word,
            removeDuplicates,
            removeSimilar,
            result: filteredWord
        });
    }

    return filteredWord;
}



// 📌 Variables globales pour stocker le texte non filtré et l’état des filtres
let currentUnfilteredText = "";


// 📌 Mise à jour des écrans avec les filtres
// Applique les filtres au texte non filtré actuel et synchronise les deux écrans.
function updateFilteredText() {
    if (!generatedWordDisplay || !selectedWordDisplay) {
        console.warn("⚠️ Écrans manquants pour mise à jour des filtres");
        return;
    }

    if (!baseGeneratedWord) {
        console.log("ℹ️ Aucune base générée, génération initiale en cours...");
        updateGeneratedWord(); // Génère la base si elle n’existe pas
        return;
    }

    const removeDuplicates = creativeExclureDoublons.checked || false;
    const removeSimilar = creativeExclureSimilaires.checked || false;
    const filteredText = applyFilters(baseGeneratedWord, removeDuplicates, removeSimilar);

    generatedWordDisplay.textContent = filteredText;
    selectedWordDisplay.textContent = filteredText;
    console.log("✅ Écrans mis à jour avec texte filtré :", filteredText);

    prevRemoveDuplicates = removeDuplicates;
    prevRemoveSimilar = removeSimilar;
}

// 📌 Écouteurs pour les filtres
if (creativeExclureDoublons && !creativeExclureDoublons.hasListener) {
    creativeExclureDoublons.addEventListener('change', updateFilteredText);
    creativeExclureDoublons.hasListener = true;
} else if (!creativeExclureDoublons) {
    console.warn("⚠️ #creative-exclure-doublons manquant pour l’écouteur de changement !");
}

if (creativeExclureSimilaires && !creativeExclureSimilaires.hasListener) {
    creativeExclureSimilaires.addEventListener('change', updateFilteredText);
    creativeExclureSimilaires.hasListener = true;
} else if (!creativeExclureSimilaires) {
    console.warn("⚠️ #creative-exclure-similaires manquant pour l’écouteur de changement !");
}










function applyFiltersToCurrentWord() {
    const filters = {
        doublons: document.getElementById('creative-exclure-doublons'),
        similaires: document.getElementById('creative-exclure-similaires')
    };
    const display = document.getElementById('generatedWordDisplay');
    const selectedDisplay = document.getElementById('selectedWordDisplay');

    if (!baseGeneratedWord) {
        console.log("ℹ️ Aucune base générée, génération initiale en cours...");
        updateGeneratedWord();
        return;
    }

    const filteredWord = applyFilters(baseGeneratedWord, filters.doublons.checked, filters.similaires.checked);
    display.textContent = filteredWord || 'Mot généré s\'affichera ici';
    selectedDisplay.textContent = filteredWord || 'Aucun mot généré.';
    console.log("ℹ️ Filtres appliqués sans régénération :", filteredWord);
}









// Définir les ensembles de caractères globalement (au début du script) pour éviter les doublons
const CHAR_SETS = {
    minuscules: 'abcdefghijklmnopqrstuvwxyz',
    majuscules: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    chiffres: '0123456789'
};



function generateCharacters(charSet, count) {
    let result = '';
    for (let i = 0; i < count; i++) {
        result += charSet[Math.floor(Math.random() * charSet.length)];
    }
    return result;
}

// -----------------------------------
// SECTION : Génération de mots pour la Boîte à mots aléatoire (Mode Créatif)
// -----------------------------------
// Objectif : Génère un mot personnalisé en combinant des caractères selon les curseurs et filtres.
// Paramètres : Aucun (utilise des éléments DOM et variables globales).
// Retour : Aucun (met à jour #generatedWordDisplay).
// Dépendances : CHAR_SETS, currentGeneratedWord, getSelectedSpecialCharsCreative(), adjustCharacters(), 
//   distributeCharacters(), applyFilters(), éléments DOM prédéfinis.
// Définir globalement au début du script




function updateGeneratedWord(forceRegenerate = false) {
    const sliders = {
        minuscules: document.getElementById('creative-minuscules'),
        majuscules: document.getElementById('creative-majuscules'),
        chiffres: document.getElementById('creative-chiffres'),
        speciaux: document.getElementById('creative-speciaux')
    };
    const filters = {
        doublons: document.getElementById('creative-exclure-doublons'),
        similaires: document.getElementById('creative-exclure-similaires')
    };
    const display = document.getElementById('generatedWordDisplay');
    const selectedWordDisplay = document.getElementById('selectedWordDisplay');

    const speciaux = getSelectedSpecialCharsCreative();
    const totals = {
        minuscules: parseInt(sliders.minuscules.value, 10) || 0,
        majuscules: parseInt(sliders.majuscules.value, 10) || 0,
        chiffres: parseInt(sliders.chiffres.value, 10) || 0,
        speciaux: parseInt(sliders.speciaux.value, 10) || 0
    };

    if (!currentGeneratedWord || forceRegenerate) {
        currentGeneratedWord = {
            minuscules: '',
            majuscules: '',
            chiffres: '',
            speciaux: ''
        };
    }

    const charSets = {
        minuscules: 'abcdefghijklmnopqrstuvwxyz',
        majuscules: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        chiffres: '0123456789',
        speciaux: speciaux || '!@#$%^&*()-_=+{}[]|\\:;"<>,.?/`~'
    };

    const isInitialLoad = baseGeneratedWord === '';
    console.log("ℹ️ isInitialLoad :", isInitialLoad, "forceRegenerate :", forceRegenerate, "userHasInteracted :", userHasInteracted);

    if (!isInitialLoad && !forceRegenerate) {
        // Ajuster à partir de l'ordre existant sans entrelacer
        let currentMinuscules = baseGeneratedWord.split('').filter(c => charSets.minuscules.includes(c)).join('');
        let currentMajuscules = baseGeneratedWord.split('').filter(c => charSets.majuscules.includes(c)).join('');
        let currentChiffres = baseGeneratedWord.split('').filter(c => charSets.chiffres.includes(c)).join('');
        let currentSpeciaux = baseGeneratedWord.split('').filter(c => charSets.speciaux.includes(c)).join('');

        console.log("ℹ️ Avant ajustement - minuscules :", currentMinuscules, "majuscules :", currentMajuscules, "chiffres :", currentChiffres, "speciaux :", currentSpeciaux);

        currentGeneratedWord.minuscules = currentMinuscules.slice(0, totals.minuscules);
        if (totals.minuscules > currentMinuscules.length) {
            currentGeneratedWord.minuscules += generateCharacters(charSets.minuscules, totals.minuscules - currentMinuscules.length);
        }

        currentGeneratedWord.majuscules = currentMajuscules.slice(0, totals.majuscules);
        if (totals.majuscules > currentMajuscules.length) {
            currentGeneratedWord.majuscules += generateCharacters(charSets.majuscules, totals.majuscules - currentMajuscules.length);
        }

        currentGeneratedWord.chiffres = currentChiffres.slice(0, totals.chiffres);
        if (totals.chiffres > currentChiffres.length) {
            currentGeneratedWord.chiffres += generateCharacters(charSets.chiffres, totals.chiffres - currentChiffres.length);
        }

        currentGeneratedWord.speciaux = currentSpeciaux.slice(0, totals.speciaux);
        if (totals.speciaux > currentSpeciaux.length) {
            currentGeneratedWord.speciaux += generateCharacters(charSets.speciaux, totals.speciaux - currentSpeciaux.length);
        }

        console.log("ℹ️ Après ajustement - minuscules :", currentGeneratedWord.minuscules, "majuscules :", currentGeneratedWord.majuscules, "chiffres :", currentGeneratedWord.chiffres, "speciaux :", currentGeneratedWord.speciaux);

        // Recomposer sans entrelacer
        baseGeneratedWord = currentGeneratedWord.minuscules + currentGeneratedWord.majuscules + currentGeneratedWord.chiffres + currentGeneratedWord.speciaux;
    } else {
        // Chargement initial ou régénération complète
        for (const category in totals) {
            const currentLength = currentGeneratedWord[category].length;
            const targetLength = totals[category];
            if (targetLength > currentLength) {
                const additionalChars = generateCharacters(charSets[category], targetLength - currentLength);
                currentGeneratedWord[category] += additionalChars;
            } else if (targetLength < currentLength) {
                currentGeneratedWord[category] = currentGeneratedWord[category].slice(0, targetLength);
            }
        }
        // Ordre fixe au chargement initial
        baseGeneratedWord = currentGeneratedWord.minuscules + currentGeneratedWord.majuscules + currentGeneratedWord.chiffres + currentGeneratedWord.speciaux;
    }

    if (!isInitialLoad && !forceRegenerate && !userHasInteracted) {
        console.log("ℹ️ Blocage d'un appel parasite avant interaction, préservation de :", baseGeneratedWord);
        display.textContent = baseGeneratedWord;
        selectedWordDisplay.textContent = baseGeneratedWord;
        return;
    }

    console.log("ℹ️ Base initiale générée :", baseGeneratedWord);

    const filteredWord = applyFilters(baseGeneratedWord, filters.doublons.checked, filters.similaires.checked);
    display.textContent = filteredWord || 'Mot généré s\'affichera ici';
    selectedWordDisplay.textContent = filteredWord || 'Aucun mot généré.';
    console.log("ℹ️ Mot filtré affiché :", filteredWord);

    if (typeof updateCreativeMetrics === 'function') {
        updateCreativeMetrics();
    }
}


function randomizeGeneratedWord() {
    console.log("randomizeGeneratedWord appelé (vérification contexte)");
    const sliders = {
        minuscules: document.getElementById('creative-minuscules'),
        majuscules: document.getElementById('creative-majuscules'),
        chiffres: document.getElementById('creative-chiffres'),
        speciaux: document.getElementById('creative-speciaux')
    };
    const totals = {
        minuscules: parseInt(sliders.minuscules.value, 10) || 0,
        majuscules: parseInt(sliders.majuscules.value, 10) || 0,
        chiffres: parseInt(sliders.chiffres.value, 10) || 0,
        speciaux: parseInt(sliders.speciaux.value, 10) || 0  // Plus de valeur par défaut à 5
    };
    const charSets = {
        minuscules: 'abcdefghijklmnopqrstuvwxyz',
        majuscules: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        chiffres: '0123456789',
        speciaux: getSelectedSpecialCharsCreative() || '!@#$%^&*()-_=+{}[]|\\:;"<>,.?/`~'
    };

    // Vérifier si au moins une catégorie est sélectionnée
    const totalWeight = totals.minuscules + totals.majuscules + totals.chiffres + totals.speciaux;
    if (totalWeight === 0) {
        document.getElementById('generatedWordDisplay').textContent = '';
        document.getElementById('selectedWordDisplay').textContent = 'Aucun mot généré.';
        console.log("ℹ️ Aucune catégorie sélectionnée, écran vidé");
        return;
    }

    // Générer les catégories uniquement si leur total est > 0
    currentGeneratedWord = {
        minuscules: totals.minuscules > 0 ? generateCharacters(charSets.minuscules, totals.minuscules) : '',
        majuscules: totals.majuscules > 0 ? generateCharacters(charSets.majuscules, totals.majuscules) : '',
        chiffres: totals.chiffres > 0 ? generateCharacters(charSets.chiffres, totals.chiffres) : '',
        speciaux: totals.speciaux > 0 ? generateCharacters(charSets.speciaux, totals.speciaux) : ''
    };

    // Concaténer et mélanger
    const combined = (currentGeneratedWord.minuscules || '') +
        (currentGeneratedWord.majuscules || '') +
        (currentGeneratedWord.chiffres || '') +
        (currentGeneratedWord.speciaux || '');
    baseGeneratedWord = shuffleString(combined);
    console.log("ℹ️ Nouvelle base générée après aléatoire :", baseGeneratedWord);

    const filters = {
        doublons: document.getElementById('creative-exclure-doublons'),
        similaires: document.getElementById('creative-exclure-similaires')
    };
    const filteredWord = applyFilters(baseGeneratedWord, filters.doublons.checked, filters.similaires.checked);
    document.getElementById('generatedWordDisplay').textContent = filteredWord || 'Mot généré s\'affichera ici';
    document.getElementById('selectedWordDisplay').textContent = filteredWord || 'Aucun mot généré.';
    console.log("ℹ️ Mot filtré affiché après aléatoire :", filteredWord);

    if (typeof updateCreativeMetrics === 'function') {
        updateCreativeMetrics();
    }
}





function distributeCharacters(minuscules, majuscules, chiffres, speciaux, isInitialLoad = false) {
    console.log("distributeCharacters appelé avec isInitialLoad :", isInitialLoad);
    if (isInitialLoad === true) { // Forcer la vérification explicite
        console.log("Ordre fixe appliqué");
        return (minuscules || '') + (majuscules || '') + (chiffres || '') + (speciaux || '');
    }
    console.log("Entrelacement appliqué");
    let charGroups = [
        (minuscules || '').split(''),
        (majuscules || '').split(''),
        (chiffres || '').split(''),
        (speciaux || '').split('')
    ];
    let finalArray = [];
    while (charGroups.some(group => group.length > 0)) {
        charGroups.forEach(group => {
            if (group.length > 0) {
                finalArray.push(group.shift());
            }
        });
    }
    return finalArray.join('');
}

function shuffleString(str) {
    console.log("shuffleString appelé avec :", str);
    let array = str.split('');
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array.join('');
}

// Modifier updateSliderValue pour ne pas forcer la réinitialisation
function updateSliderValue(sliderId, valueId, mode, isLength = false) {
    const slider = document.getElementById(sliderId);
    const valueDisplay = document.getElementById(valueId);
    if (!slider || !valueDisplay) {
        console.error(`❌ Erreur : Impossible de trouver ${sliderId} ou ${valueId}`);
        return;
    }
    console.log(`✅ Élément trouvé : ${sliderId}`);
    updateRangeProgress(slider);
    slider.addEventListener('input', () => {
        console.log(`Mise à jour : ${sliderId} -> ${slider.value}`);
        if (isLength) {
            valueDisplay.textContent = `${slider.value}`;
        } else if (mode === 'creatif') {
            valueDisplay.textContent = `${slider.value} caractères`;
        } else if (mode === 'aleatoire') {
            valueDisplay.textContent = `${slider.value}%`;
        }
        updateRangeProgress(slider);
        if (mode === 'creatif') {
            console.log("Mise à jour du mot généré en mode créatif");
            updateGeneratedWord(false); // Ne pas forcer la réinitialisation
        } else if (mode === 'aleatoire') {
            console.log("Mise à jour du mot de passe en mode aléatoire");
            generateRandomPassword();
        }
    });
    slider.addEventListener('change', () => {
        updateRangeProgress(slider);
    });
}

// Initialisation au démarrage
document.addEventListener('DOMContentLoaded', () => {
    updateGeneratedWord(true);
    ['minuscules', 'majuscules', 'chiffres', 'speciaux'].forEach(category => {
        const slider = document.getElementById(`creative-${category}`);
        const valueDisplay = document.getElementById(`creative-${category}-value`);
        if (slider && valueDisplay) {
            valueDisplay.textContent = `${slider.value} caractères`;
            updateRangeProgress(slider);
            slider.addEventListener('input', () => {
                valueDisplay.textContent = `${slider.value} caractères`;
                updateRangeProgress(slider);
                if (category === 'speciaux') {
                    adjustCreativeSpecialCharsSlider();
                }
                updateGeneratedWord(false);
            });
            slider.addEventListener('change', () => updateRangeProgress(slider));
        }
    });
    document.addEventListener('click', () => userHasInteracted = true, { once: true });
    document.addEventListener('input', () => userHasInteracted = true, { once: true });
});


document.getElementById('randomizeGeneratedWord').addEventListener('click', () => {
    console.log("ℹ️ Régénération aléatoire demandée");
    randomizeGeneratedWord();
});




// ✅ Ajouter un écouteur sur le slider pour cohérence
document.getElementById('creative-speciaux').addEventListener('input', () => {
    adjustCreativeSpecialCharsSlider();
});

// ... Reste du code avec positionSpecialCharsWindow, etc. ...

// ✅ Ajustement du curseur uniquement quand la fenêtre change
function adjustCreativeSpecialCharsSlider() {
    const checkedChars = [...document.querySelectorAll("#specialCharsWindow .char-options input[type='checkbox']:checked")]
        .map(checkbox => checkbox.value);
    const specialCharsSlider = document.getElementById("creative-speciaux");
    const currentSliderValue = parseInt(specialCharsSlider.value, 10) || 5; // Valeur actuelle ou 5

    let targetLength;
    if (checkedChars.length === 0) {
        targetLength = 0;
        specialCharsSlider.value = "0";
        document.getElementById("creative-speciaux-value").textContent = "0 caractère";
        currentGeneratedWord.speciaux = "";
    } else {
        targetLength = currentSliderValue; // Utiliser la valeur actuelle du curseur
        let newSpecials = '';
        for (let i = 0; i < targetLength; i++) {
            newSpecials += checkedChars[i % checkedChars.length];
        }
        currentGeneratedWord.speciaux = newSpecials;
        document.getElementById("creative-speciaux-value").textContent = `${targetLength} caractères`;
    }

    const nonSpecialPart = baseGeneratedWord.split('').filter(char => !"!@#$%^&*()-_=+{}[]|\\:;'\"<>,.?/`~".includes(char)).join('');
    baseGeneratedWord = nonSpecialPart + currentGeneratedWord.speciaux;
    const display = document.getElementById('generatedWordDisplay');
    const selectedDisplay = document.getElementById('selectedWordDisplay');
    display.textContent = baseGeneratedWord;
    selectedDisplay.textContent = baseGeneratedWord;
}



// Écouteurs pour la fenêtre des caractères
document.querySelectorAll("#specialCharsWindow .char-options input[type='checkbox']").forEach(checkbox => {
    checkbox.addEventListener("change", adjustCreativeSpecialCharsSlider);
});






// -----------------------------------
// SECTION : Ajustement des groupes de caractères (Mode Créatif)
// -----------------------------------
// Objectif : Ajuste une chaîne de caractères existante à une longueur cible en ajoutant des caractères 
// aléatoires depuis un ensemble donné, tout en conservant les caractères actuels.
// Paramètres : 
//   - existing (String) : Chaîne actuelle des caractères à ajuster.
//   - charSet (String) : Ensemble de caractères disponibles pour l’ajout.
//   - targetLength (Number) : Longueur cible du résultat.
// Retour : Une chaîne ajustée contenant exactement targetLength caractères.
// Dépendances : Aucune (fonction autonome).
// Exemple : adjustCharacters('ab', 'abcde', 4) → 'abcd'
function adjustCharacters(existing, charSet, targetLength) {
    if (typeof existing !== 'string') {
        console.warn('⚠️ adjustCharacters : existing doit être une chaîne.');
        existing = '';
    }
    if (typeof charSet !== 'string' || charSet.length === 0) {
        console.warn('⚠️ adjustCharacters : charSet doit être une chaîne non vide.');
        return existing.slice(0, targetLength);
    }
    if (!Number.isInteger(targetLength) || targetLength < 0) {
        console.warn('⚠️ adjustCharacters : targetLength doit être un entier positif.');
        return existing.slice(0, Math.max(0, targetLength));
    }
    let result = existing.split('');
    if (result.length < targetLength) {
        const charsToAdd = targetLength - result.length;
        const availableChars = charSet.split('');
        const newChars = Array.from({ length: charsToAdd }, () =>
            availableChars[Math.floor(Math.random() * availableChars.length)]
        );
        result = result.concat(newChars);
    }
    return result.slice(0, targetLength).join('');
}

const anagramButtonGenerated = document.getElementById('anagramButtonGenerated');

anagramButtonGenerated.addEventListener('click', () => {
    handleAnagram(document.getElementById('generatedWordDisplay'));
});





// Variable globale pour stocker le mot de passe aléatoire complet
let originalRandomPassword = "";

// -----------------------------------
// SECTION : Génération de mot de passe aléatoire (Mode Aléatoire)
// -----------------------------------
// Objectif : Génère un mot de passe aléatoire basé sur les curseurs du mode Aléatoire, avec une répartition 
// proportionnelle des caractères (minuscules, majuscules, chiffres, spéciaux) et des règles spécifiques 
// pour les caractères spéciaux (minimum de 3 ou 5 si 1 à 5 sont sélectionnés).
// Paramètres : Aucun (utilise des éléments DOM et variables globales).
// Retour : La chaîne du mot de passe généré (également mise à jour dans #randomScreen).
// Dépendances : 
//   - Éléments DOM : #length-slider, #minuscules-slider, #majuscules-slider, #chiffres-slider, 
//     #speciaux-slider, #randomScreen, #random-exclure-doublons, #random-exclure-similaires.
//   - Fonctions : getSelectedSpecialCharsRandom(), getRandomCharacters().
//   - Variables globales : minuscules, majuscules, chiffres (via CHAR_SETS), originalRandomPassword, currentBasePassword.



let isSliderMoving = false; // Variable pour suivre l'état du curseur

// ✅ Détecter le début du mouvement du curseur (l'utilisateur bouge le curseur)
lengthSlider.addEventListener('input', () => {
    isSliderMoving = true; // Mode "en mouvement"
    document.getElementById('length-value').textContent = lengthSlider.value; // Mise à jour de l'affichage

    // 🟢 Si les options ne sont pas activées, générer immédiatement le mot de passe
    if (!randomExclureDoublons.checked && !randomExclureSimilaires.checked) {
        generateRandomPassword();
    }
});

// ✅ Détecter la fin du mouvement du curseur (l'utilisateur a fini de bouger)
lengthSlider.addEventListener('change', () => {
    isSliderMoving = false; // Mode "stabilisé"

    // 🟢 Appliquer les filtres et mettre à jour le mot de passe uniquement si les options sont activées
    if (randomExclureDoublons.checked || randomExclureSimilaires.checked) {
        updateRandomPassword();
        updateLengthSlider();
    }
});

// ✅ Appliquer immédiatement les filtres lorsque les options sont cochées/décochées
[randomExclureDoublons, randomExclureSimilaires].forEach(checkbox => {
    checkbox.addEventListener('change', () => {
        if (!isSliderMoving) {
            updateRandomPassword(); // Appliquer les filtres seulement si le curseur est stabilisé
            updateLengthSlider(); // Ajuster la longueur affichée
        }
    });
});

// ✅ Fonction pour ajuster le curseur Nombre de caractères après application des filtres
function updateLengthSlider() {
    let displayedPassword = randomScreen.textContent.trim(); // Récupérer le mot de passe affiché

    if (displayedPassword.length > 0) {
        lengthSlider.value = displayedPassword.length; // Adapter le curseur à la nouvelle longueur
        document.getElementById('length-value').textContent = displayedPassword.length; // Mettre à jour l'affichage
    }
}

// ✅ Fonction pour appliquer les filtres sans générer un nouveau mot
function updateRandomPassword() {
    let filteredPassword = applyFilters(
        originalRandomPassword, // Toujours repartir du mot de passe original
        randomExclureDoublons.checked,
        randomExclureSimilaires.checked
    );

    randomScreen.textContent = filteredPassword; // Afficher la version filtrée
}




// Écouteurs d'événements pour mettre à jour le mot de passe en fonction des curseurs
[lengthSlider, minusculesSlider, majusculesSlider, chiffresSlider, speciauxSlider].forEach(slider => {
    slider.addEventListener('input', generateRandomPassword);
});

// Génération initiale au chargement de la page
window.addEventListener('DOMContentLoaded', generateRandomPassword);











// Sélection des éléments


// Variable pour stocker les séparateurs sélectionnés





















































let originalCreativePassword = ""; // Stocke toujours la version complète du mot

// Fonction pour mettre à jour le mot de passe en appliquant les filtres
function updateCreativePassword() {
    console.log("ℹ️ updateCreativePassword appelé, originalCreativePassword :", originalCreativePassword);

    const creativeScreen = document.getElementById('creativeScreen');
    if (!creativeScreen) {
        console.warn("⚠️ #creativeScreen manquant pour updateCreativePassword !");
        return;
    }

    const currentContent = creativeScreen.textContent.trim();
    console.log("ℹ️ Contenu actuel de creativeScreen :", currentContent);

    // Vérifier si le contenu est un placeholder
    if (!currentContent || (typeof isScreenEmpty === 'function' && isScreenEmpty(currentContent))) {
        console.log("ℹ️ Contenu non sauvegardé (vide, inchangé ou invalide) :", currentContent);
        return;
    }

    if (!originalCreativePassword) {
        console.warn("⚠️ originalCreativePassword non défini, utilisation du contenu actuel");
        originalCreativePassword = currentContent;
    }

    let creativePassword = originalCreativePassword;

    creativePassword = applyFilters(
        creativePassword,
        creativeExclureDoublonsMain.checked,
        creativeExclureSimilairesMain.checked
    );

    if (!creativePassword.trim()) {
        console.warn("⚠️ Mise à jour ignorée : Le mot après filtre est vide !");
        return;
    }

    creativeScreen.textContent = creativePassword;
    updateCreativeText(creativePassword);
    saveCreativeState(creativePassword);
    updateCreativeMetrics();
    evaluatePasswordStrength(creativePassword, "creative");
}


// ✅ Mise à jour immédiate si on coche/décoche les options


[creativeExclureDoublonsMain, creativeExclureSimilairesMain].forEach(checkbox => {
    checkbox.addEventListener('change', () => {
        const creativeScreen = document.getElementById('creativeScreen');
        if (!creativeScreen) {
            console.warn("⚠️ #creativeScreen manquant pour le filtre !");
            return;
        }
        const currentText = creativeScreen.textContent.trim();
        if (!currentText || (typeof isScreenEmpty === 'function' && isScreenEmpty(currentText))) {
            const source = window.translations && window.translations[window.currentLang]
                ? window.translations[window.currentLang]
                : {
                    invalid_content_filter_alert: "Veuillez entrer un texte valide dans la zone principale pour appliquer le filtre \"{filter}\".",
                    avoid_duplicates_creative: "Éviter les doublons",
                    exclude_similar_chars_creative: "Exclure les caractères similaires"
                };
            const filterKey = checkbox.id === 'creative-exclure-doublons-main' ? 'avoid_duplicates_creative' : 'exclude_similar_chars_creative';
            const filterName = source[filterKey] || (checkbox.id === 'creative-exclure-doublons-main' ? 'Éviter les doublons' : 'Exclure les caractères similaires');
            const alertMessage = source.invalid_content_filter_alert.replace('{filter}', filterName);
            console.log(`ℹ️ Fenêtre d’alerte affichée pour placeholder : ${currentText}`);

            // Créer la fenêtre d’alerte
            const alertWindow = document.createElement('div');
            alertWindow.className = 'alert-window';
            alertWindow.textContent = alertMessage;
            document.body.appendChild(alertWindow);

            // Afficher avec fondu
            setTimeout(() => {
                alertWindow.classList.add('show');
            }, 10);

            // Supprimer après 2,5 secondes avec fondu
            setTimeout(() => {
                alertWindow.classList.remove('show');
                setTimeout(() => {
                    alertWindow.remove();
                }, 300); // Correspond à la durée de la transition
            }, 2500);

            checkbox.checked = false; // Décoche la case
            return;
        }
        updateCreativePassword();
    });
});

// Supprimé pour consolidation
/*
creativeScreen.addEventListener('input', () => {
    if (isImporting) return;
    originalCreativePassword = creativeScreen.textContent.trim();
    updateCreativeMetrics();
});
*/


// ✅ Ajoutons un log pour voir ce qui est récupéré du générateur
console.log("Mot extrait du générateur de mots:", generatedWordDisplay.textContent.trim());


















// Écouteurs d'événements pour les curseurs (mise à jour du mot généré)
document.querySelectorAll('.creative-slider-group input[type="range"]').forEach(input => {
    input.addEventListener('input', () => {
        updateGeneratedWord();
        updateCreativeMetrics(); // Mise à jour du compteur et de la force
    });
});




























// Génération initiale au chargement de la page
//updateGeneratedWord();

if (userHasInteracted) {
    updateGeneratedWord(); // Ne s'exécute qu'après interaction
}





// Appels pour tous les sliders (remplace les deux blocs d’appels)
updateSliderValue('length-slider', 'length-value', 'aleatoire', true);
updateSliderValue('minuscules-slider', 'minuscules-value', 'aleatoire');
updateSliderValue('majuscules-slider', 'majuscules-value', 'aleatoire');
updateSliderValue('chiffres-slider', 'chiffres-value', 'aleatoire');
updateSliderValue('speciaux-slider', 'speciaux-value', 'aleatoire');


// Écouteurs pour les cases à cocher
document.getElementById('random-exclure-doublons').addEventListener('change', function () {
    const rangeInput = document.getElementById('length-slider');
    if (this.checked) {
        rangeInput.value = Math.max(rangeInput.min, rangeInput.value - 2);
    } else {
        rangeInput.value = Math.min(rangeInput.max, parseInt(rangeInput.value) + 2);
    }
    updateRangeProgress(rangeInput);
});

document.getElementById('random-exclure-similaires').addEventListener('change', function () {
    const rangeInput = document.getElementById('length-slider');
    if (this.checked) {
        rangeInput.value = Math.max(rangeInput.min, rangeInput.value - 1);
    } else {
        rangeInput.value = Math.min(rangeInput.max, parseInt(rangeInput.value) + 1);
    }
    updateRangeProgress(rangeInput);
});



document.addEventListener('DOMContentLoaded', () => {
    const defineButton = document.getElementById('defineSpecialChars');
    const specialCharsWindow = document.getElementById('specialCharsWindow');
    const specialCharsWindowRandom = document.getElementById('specialCharsWindowRandom');
    const closeButton = specialCharsWindow.querySelector('.close-window');

    const toggleAllCheckboxCreative = document.getElementById("toggleAllSpecialCharsCreative");
    const specialCharCheckboxesCreative = document.querySelectorAll("#specialCharsWindow .char-options input[type='checkbox']");
    const creativeSpecialCharsSlider = document.getElementById("creative-speciaux");
    const generatedWordDisplay = document.getElementById('generatedWordDisplay');
    const selectedWordDisplay = document.getElementById('selectedWordDisplay');

    let initialFullWord = "";
    let currentBaseWord = "";

    toggleAllCheckboxCreative.checked = true;

    defineButton.addEventListener('click', (e) => {
        e.stopPropagation();
        console.log('Bouton créatif cliqué');

        if (specialCharsWindow.classList.contains('hidden')) {
            specialCharsWindow.classList.remove('hidden');
            specialCharsWindowRandom.classList.add('hidden');
            console.log('Fenêtre ouverte');
        } else {
            specialCharsWindow.classList.add('hidden');
            console.log('Fenêtre fermée');
        }
    });

    closeButton.addEventListener('click', (e) => {
        e.stopPropagation();
        specialCharsWindow.classList.add('hidden');
        console.log('Fenêtre fermée par la croix');
    });

    document.addEventListener('click', (event) => {
        if (specialCharsWindow.classList.contains('hidden')) return;
        if (!specialCharsWindow.contains(event.target) && event.target !== defineButton) {
            specialCharsWindow.classList.add('hidden');
            console.log('Fermeture par clic extérieur');
        }
    });









    function generateInitialWord() {
        let minuscules = 'abcdefghijklmnopqrstuvwxyz';
        let majuscules = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        let chiffres = '0123456789';
        let speciaux = "!@#$%^&*()-_=+{}[]|\\:;'\"<>,.?/`~";

        let totalMinuscules = parseInt(document.getElementById('creative-minuscules').value, 10) || 0;
        let totalMajuscules = parseInt(document.getElementById('creative-majuscules').value, 10) || 0;
        let totalChiffres = parseInt(document.getElementById('creative-chiffres').value, 10) || 0;
        let totalSpeciaux = parseInt(document.getElementById('creative-speciaux').value, 10) || 0;

        currentBaseWord = generateCharacters(minuscules, totalMinuscules) +
            generateCharacters(majuscules, totalMajuscules) +
            generateCharacters(chiffres, totalChiffres);
        let specialChars = generateCharacters(speciaux, totalSpeciaux);
        initialFullWord = shuffleString(currentBaseWord + specialChars);

        console.log("Mot initial complet généré :", initialFullWord);
        console.log("Base du mot :", currentBaseWord);
    }

    function syncGeneratedWordWithSpecialChars() {
        console.log("Synchronisation du mot généré avec les caractères spéciaux");
        if (!userHasInteracted) {
            console.log("ℹ️ Synchronisation ignorée au démarrage");
            return;
        }
        if (!baseGeneratedWord) {
            updateGeneratedWord();
            return;
        }

        const selectedSpecialChars = getSelectedSpecialCharsCreative();
        const specialCharsSlider = document.getElementById("creative-speciaux");
        const currentSliderValue = parseInt(specialCharsSlider.value, 10) || 5;

        const nonSpecialPart = baseGeneratedWord.split('').filter(char => !"!@#$%^&*()-_=+{}[]|\\:;'\"<>,.?/`~".includes(char)).join('');
        if (!selectedSpecialChars) {
            baseGeneratedWord = nonSpecialPart;
            specialCharsSlider.value = 0;
        } else {
            let newSpecials = '';
            for (let i = 0; i < currentSliderValue; i++) {
                newSpecials += selectedSpecialChars[i % selectedSpecialChars.length];
            }
            baseGeneratedWord = nonSpecialPart + newSpecials;
            specialCharsSlider.value = currentSliderValue;
        }

        generatedWordDisplay.textContent = baseGeneratedWord;
        selectedWordDisplay.textContent = baseGeneratedWord; // Corrigé ici : selectedDisplay → selectedWordDisplay
        document.getElementById("creative-speciaux-value").textContent = `${currentSliderValue} caractères`;
        isFirstManualAdjustment = true; // Réinitialiser pour le prochain premier mouvement manuel
        console.log("✅ Mot synchronisé :", baseGeneratedWord);
    }

    toggleAllCheckboxCreative.addEventListener("change", () => {
        specialCharCheckboxesCreative.forEach(checkbox => checkbox.checked = toggleAllCheckboxCreative.checked);

        if (toggleAllCheckboxCreative.checked) {
            creativeSpecialCharsSlider.value = 5;
        } else {
            creativeSpecialCharsSlider.value = 0;
        }

        syncGeneratedWordWithSpecialChars(); // Nouveau nom
    });

    specialCharCheckboxesCreative.forEach(checkbox => {
        checkbox.addEventListener("change", () => {
            const allChecked = [...specialCharCheckboxesCreative].every(cb => cb.checked);
            toggleAllCheckboxCreative.checked = allChecked;

            syncGeneratedWordWithSpecialChars(); // Nouveau nom
        });
    });

    syncGeneratedWordWithSpecialChars();


});





function limitCreativeScreenLength(text, source = 'input') {
    const maxLength = 50;
    const creativeScreen = document.getElementById('creativeScreen');

    if (!creativeScreen) {
        console.warn("⚠️ #creativeScreen manquant pour limiter la longueur");
        return text;
    }

    if (isFromImport) {
        console.log(`⏸️ ${source} : pas de limite car texte importé`);
        return text;
    }

    const trimmedText = text.trim();
    if (trimmedText.length > maxLength) {
        const truncatedText = trimmedText.slice(0, maxLength);
        const sourceTranslations = window.translations && window.translations[window.currentLang]
            ? window.translations[window.currentLang]
            : {
                max_length_alert: "Maximum 50 caractères atteint."
            };
        console.log(`ℹ️ ${source} : Texte tronqué à ${maxLength} caractères : ${truncatedText}`);
        showCustomAlert('max_length_alert');

        creativeScreen.textContent = truncatedText; // Restaurer le texte tronqué
        updateCreativeMetrics();
        return truncatedText;
    }

    return trimmedText;
}








// 🎯 Détection de la saisie manuelle dans la fenêtre pour afficher "Réinitialiser"

creativeScreen.addEventListener("input", function () {
    if (isImporting) return;
    const textLength = creativeScreen.textContent.trim().length;
    if (textLength > 0) {
        if (reinitialiser) reinitialiser.style.display = "block";
    } else {
        if (reinitialiser) reinitialiser.style.display = "none";
    }
});







prefixInput.addEventListener("click", function () {
    this.focus();
    this.select();
    console.log("Clic dans #prefix-input : focus appliqué");
});








// Variables globales
// On ne déclare PAS creativeScreen ni selectedWordDisplay ici, car déjà définis lignes 42 et 19 avec const
// Variables globales
var secureWordButton, previousCreativeButton, nextCreativeButton,
    baseWord, creativeHistory, creativeHistoryIndex,
    boxTypeSelect, generatorBox, phraseBox, wordBox,
    phraseLangSelect, generatePhraseButton, insertPhraseButton, generatedPhrase,
    previousPhraseButton, nextPhraseButton, wordCountInput, useSpecialCharsCheckbox,
    toggleSpecialCharsButton, specialCharsContainer, closeSpecialChars;

// Initialisation des variables d’état globales
baseWord = "";
creativeHistory = [];
creativeHistoryIndex = -1;
phraseHistory = [];
phraseHistoryIndex = -1;
currentPhraseParts = [];
wordHistory = [];
wordHistoryIndex = -1;



// Génération de caractères aléatoires (version ligne 638, unique)
function getRandomCharacters(charSet, length) {
    if (typeof charSet !== 'string' || charSet.length === 0) {
        console.warn("⚠️ Ensemble de caractères invalide ou vide dans getRandomCharacters !");
        return [];
    }
    if (!Number.isInteger(length) || length < 0) {
        console.warn("⚠️ Longueur invalide dans getRandomCharacters :", length);
        return [];
    }

    const result = [];
    const charList = [...charSet];
    if (length === 0) return result;

    // Générer des caractères avec répétition possible
    for (let i = 0; i < length; i++) {
        const char = charList[Math.floor(Math.random() * charList.length)];
        result.push(char);
    }

    return result;
}






// Générer un mot de passe aléatoire (version réactive)
function generateRandomPassword() {
    console.log("generateRandomPassword appelé (vérification contexte)");

    const lengthSlider = document.getElementById('length-slider');
    const totalLength = parseInt(lengthSlider.value, 10) || 12;
    const numMinuscules = parseInt(document.getElementById('minuscules-slider').value, 10) || 0;
    const numMajuscules = parseInt(document.getElementById('majuscules-slider').value, 10) || 0;
    const numChiffres = parseInt(document.getElementById('chiffres-slider').value, 10) || 0;
    const numSpeciaux = parseInt(document.getElementById('speciaux-slider').value, 10) || 0;

    const totalWeight = numMinuscules + numMajuscules + numChiffres + numSpeciaux;
    if (totalWeight === 0) {
        randomScreen.textContent = '';
        document.getElementById('length-value').textContent = '0';
        lengthSlider.value = lengthSlider.min; // Remettre au minimum (4)
        lengthSlider.style.setProperty('--range-progress', '0%');
        if (typeof evaluatePasswordStrength === "function") {
            evaluatePasswordStrength('', 'random');
        }
        console.log("ℹ️ Aucune catégorie sélectionnée, écran vidé");
        return "";
    }

    let minMinuscules = numMinuscules > 0 ? Math.max(1, Math.floor(totalLength * numMinuscules / totalWeight)) : 0;
    let minMajuscules = numMajuscules > 0 ? Math.max(1, Math.floor(totalLength * numMajuscules / totalWeight)) : 0;
    let minChiffres = numChiffres > 0 ? Math.max(1, Math.floor(totalLength * numChiffres / totalWeight)) : 0;
    let minSpeciaux = numSpeciaux > 0 ? Math.max(0, Math.floor(totalLength * numSpeciaux / totalWeight)) : 0;

    const specialCharsToUse = getSelectedSpecialCharsRandom();
    if (specialCharsToUse.length > 0 && specialCharsToUse.length <= 5 && numSpeciaux > 0) {
        minSpeciaux = Math.max(minSpeciaux, specialCharsToUse.length === 1 ? 3 : 5);
    }

    let totalMin = minMinuscules + minMajuscules + minChiffres + minSpeciaux;
    if (totalMin > totalLength) {
        const ratio = totalLength / totalMin;
        minMinuscules = Math.floor(minMinuscules * ratio);
        minMajuscules = Math.floor(minMajuscules * ratio);
        minChiffres = Math.floor(minChiffres * ratio);
        minSpeciaux = numSpeciaux > 0 ? Math.floor(minSpeciaux * ratio) : 0;
        totalMin = minMinuscules + minMajuscules + minChiffres + minSpeciaux;
    }

    let remaining = totalLength - totalMin;
    if (remaining > 0) {
        const weights = [];
        if (numMinuscules > 0) weights.push({ type: 'minuscules', value: numMinuscules });
        if (numMajuscules > 0) weights.push({ type: 'majuscules', value: numMajuscules });
        if (numChiffres > 0) weights.push({ type: 'chiffres', value: numChiffres });
        if (numSpeciaux > 0) weights.push({ type: 'speciaux', value: numSpeciaux });

        for (let i = 0; i < remaining; i++) {
            const totalRemainingWeight = weights.reduce((sum, w) => sum + w.value, 0);
            const rand = Math.random() * totalRemainingWeight;
            let cumulative = 0;
            for (const w of weights) {
                cumulative += w.value;
                if (rand <= cumulative) {
                    if (w.type === 'minuscules') minMinuscules++;
                    else if (w.type === 'majuscules') minMajuscules++;
                    else if (w.type === 'chiffres') minChiffres++;
                    else if (w.type === 'speciaux' && numSpeciaux > 0) minSpeciaux++;
                    break;
                }
            }
        }
    }

    function generatePasswordString() {
        let passwordArray = [];
        passwordArray = passwordArray.concat(getRandomCharacters(CHAR_SETS.minuscules, minMinuscules));
        passwordArray = passwordArray.concat(getRandomCharacters(CHAR_SETS.majuscules, minMajuscules));
        passwordArray = passwordArray.concat(getRandomCharacters(CHAR_SETS.chiffres, minChiffres));
        if (numSpeciaux > 0 && specialCharsToUse.length > 0) {
            if (specialCharsToUse.length <= 5) {
                for (let i = 0; i < Math.min(minSpeciaux, specialCharsToUse.length); i++) {
                    passwordArray.push(specialCharsToUse[i]);
                }
                if (minSpeciaux > specialCharsToUse.length) {
                    passwordArray = passwordArray.concat(getRandomCharacters(specialCharsToUse, minSpeciaux - specialCharsToUse.length));
                }
            } else {
                passwordArray = passwordArray.concat(getRandomCharacters(specialCharsToUse, minSpeciaux));
            }
        }
        return passwordArray.join('');
    }

    let filteredPassword;
    let attempts = 0;
    const maxAttempts = 10;

    do {
        let passwordString = shuffleString(generatePasswordString().slice(0, totalLength));
        originalRandomPassword = passwordString;

        specialCharPositions = [];
        currentBasePassword = passwordString.split('').map((char, index) => {
            if ("!@#$%^&*()-_=+{}[]|\\:;'\"<>,.?/`~".includes(char)) {
                specialCharPositions.push(index);
                return '';
            }
            return char;
        }).join('');

        filteredPassword = applyFilters(passwordString, randomExclureDoublons.checked, randomExclureSimilaires.checked);

        if ((randomExclureDoublons.checked || randomExclureSimilaires.checked) && filteredPassword.length < totalLength) {
            const filteredArray = filteredPassword.split('');
            let currentMinuscules = filteredArray.filter(c => /[a-z]/.test(c)).length;
            let currentMajuscules = filteredArray.filter(c => /[A-Z]/.test(c)).length;
            let currentChiffres = filteredArray.filter(c => /[0-9]/.test(c)).length;
            let currentSpeciaux = filteredArray.filter(c => /[!@#$%^&*()\-_=+{}[\]|\\:;'",<>.?/`~]/.test(c)).length;

            const getUniqueChars = (charSet, count, existing) => {
                const available = charSet.split('').filter(c => !existing.includes(c));
                const result = [];
                for (let i = 0; i < count && available.length > 0; i++) {
                    const char = available.splice(Math.floor(Math.random() * available.length), 1)[0];
                    result.push(char);
                }
                return result;
            };

            if (currentMinuscules < minMinuscules) {
                filteredArray.push(...getUniqueChars(CHAR_SETS.minuscules, minMinuscules - currentMinuscules, filteredArray));
            }
            if (currentMajuscules < minMajuscules) {
                filteredArray.push(...getUniqueChars(CHAR_SETS.majuscules, minMajuscules - currentMajuscules, filteredArray));
            }
            if (currentChiffres < minChiffres) {
                filteredArray.push(...getUniqueChars(CHAR_SETS.chiffres, minChiffres - currentChiffres, filteredArray));
            }
            if (currentSpeciaux < minSpeciaux && numSpeciaux > 0) {
                filteredArray.push(...getUniqueChars(specialCharsToUse, minSpeciaux - currentSpeciaux, filteredArray));
            }

            let remainingLength = totalLength - filteredArray.length;
            if (remainingLength > 0) {
                const availableChars = (numMinuscules > 0 ? CHAR_SETS.minuscules : '') +
                    (numMajuscules > 0 ? CHAR_SETS.majuscules : '') +
                    (numChiffres > 0 ? CHAR_SETS.chiffres : '') +
                    (numSpeciaux > 0 ? specialCharsToUse : '');
                filteredArray.push(...getUniqueChars(availableChars, remainingLength, filteredArray));
            }

            filteredPassword = shuffleString(filteredArray.join('').slice(0, totalLength));
        }

        // Ajustement final pour garantir la longueur exacte
        if (filteredPassword.length !== totalLength) {
            console.warn(`⚠️ Longueur générée incorrecte : ${filteredPassword.length} au lieu de ${totalLength}. Ajustement...`);
            const allChars = CHAR_SETS.minuscules + CHAR_SETS.majuscules + CHAR_SETS.chiffres + specialCharsToUse;
            if (filteredPassword.length < totalLength) {
                filteredPassword = filteredPassword + getRandomCharacters(allChars, totalLength - filteredPassword.length).join('');
            }
            filteredPassword = filteredPassword.substring(0, totalLength); // Tronque si trop long
        }

        if (filteredPassword.length < totalLength && attempts < maxAttempts) {
            console.log("ℹ️ Longueur insuffisante après complément, nouvelle tentative :", filteredPassword.length);
            attempts++;
        } else {
            break;
        }
    } while (attempts < maxAttempts);

    if (attempts >= maxAttempts) {
        console.warn("⚠️ Impossible d’atteindre la longueur cible après plusieurs tentatives");
    }

    randomScreen.textContent = filteredPassword;
    updateTextWrap(filteredPassword);

    console.log("ℹ️ Distribution finale :", { minMinuscules, minMajuscules, minChiffres, minSpeciaux });
    console.log("Nouveau mot généré avant affichage:", filteredPassword);
    console.log("Mot de passe généré (mode aléatoire):", filteredPassword);
    console.log("✅ Mot de passe final généré :", filteredPassword);

    // Synchronisation du curseur uniquement avec la longueur demandée
    const actualLength = filteredPassword.length;
    if (actualLength !== totalLength) {
        console.error(`⚠️ Erreur critique : longueur finale ${actualLength} ne correspond pas à ${totalLength}`);
    }
    document.getElementById('length-value').textContent = totalLength;
    lengthSlider.value = totalLength;
    const min = parseInt(lengthSlider.min) || 4;
    const max = parseInt(lengthSlider.max) || 30;
    const percentage = ((totalLength - min) / (max - min)) * 100;
    lengthSlider.style.setProperty('--range-progress', `${percentage}%`);
    console.log("ℹ️ Curseur length-slider synchronisé à :", totalLength);

    if (typeof evaluatePasswordStrength === "function") {
        evaluatePasswordStrength(filteredPassword, 'random');
    }

    return filteredPassword;
}


function updateSpecialCharacters() {
    const specialCharsToUse = getSelectedSpecialCharsRandom();
    const lengthSlider = document.getElementById('length-slider');
    const lengthValue = document.getElementById('length-value');

    let newPassword;
    if (!specialCharsToUse || specialCharsToUse.length === 0) {
        newPassword = currentBasePassword;
        console.log("Mot de passe ajusté (sans caractères spéciaux) via toggle:", newPassword);
    } else {
        let newPasswordArray = originalRandomPassword.split('');
        let availableSpecials = specialCharsToUse.split('');

        // Mélanger les positions pour une répartition aléatoire
        let shuffledPositions = [...specialCharPositions].sort(() => Math.random() - 0.5);

        // Si moins ou autant de caractères que de positions, garantir chaque caractère au moins une fois
        if (availableSpecials.length <= specialCharPositions.length) {
            for (let i = 0; i < availableSpecials.length; i++) {
                newPasswordArray[shuffledPositions[i]] = availableSpecials[i];
            }
            // Remplir les positions restantes aléatoirement
            for (let i = availableSpecials.length; i < shuffledPositions.length; i++) {
                const specialChar = availableSpecials[Math.floor(Math.random() * availableSpecials.length)];
                newPasswordArray[shuffledPositions[i]] = specialChar;
            }
        } else {
            // Plus de caractères que de positions : garantir au moins 3 différents
            let usedSpecials = [];
            for (let i = 0; i < Math.min(3, shuffledPositions.length); i++) {
                let specialChar;
                do {
                    specialChar = availableSpecials[Math.floor(Math.random() * availableSpecials.length)];
                } while (usedSpecials.includes(specialChar) && usedSpecials.length < availableSpecials.length);
                usedSpecials.push(specialChar);
                newPasswordArray[shuffledPositions[i]] = specialChar;
            }
        }

        newPassword = newPasswordArray.join('');
        console.log("Mot mis à jour avec nouveaux caractères spéciaux :", newPassword);
    }

    const filteredPassword = applyFilters(
        newPassword,
        randomExclureDoublons.checked,
        randomExclureSimilaires.checked
    );

    randomScreen.textContent = filteredPassword;

    const actualLength = filteredPassword.length;
    lengthSlider.value = actualLength;
    lengthValue.textContent = actualLength;
    const min = parseInt(lengthSlider.min) || 4;
    const max = parseInt(lengthSlider.max) || 30;
    const percentage = ((actualLength - min) / (max - min)) * 100;
    lengthSlider.style.setProperty('--range-progress', `${percentage}%`);
    console.log("ℹ️ Curseur length-slider synchronisé à :", actualLength);

    evaluatePasswordStrength(filteredPassword, 'random');
}


// Déclarations globales (déjà dans ton script avant la ligne 2373)
const separatorModal = document.getElementById("separatorModal");
const addSeparatorButton = document.getElementById('addSeparatorButton');
const validateSeparatorButton = document.getElementById('validateSeparator');
const buttonsInterface = { separator: document.getElementById('addSeparatorButton') };
let selectionOrder = [];
let isSeparatorActive = false;
let selectedSeparators = [];
let removeDuplicatesEnabled = false;
let excludeSimilarEnabled = false;
let originalContent = "";


// Fonction pour mettre à jour l’affichage (doit être avant saveCreativeState)
function updateCreativeDisplay() {
    const source = window.translations && window.translations[window.currentLang]
        ? window.translations[window.currentLang]
        : (typeof fallbackTranslations !== 'undefined' ? fallbackTranslations[window.currentLang] : {
            no_next_content: "Pas de contenu suivant",
            no_prev_content: "Pas de contenu précédent"
        });

    if (creativeHistoryIndex >= 0 && creativeHistoryIndex < creativeHistory.length) {
        creativeScreen.textContent = creativeHistory[creativeHistoryIndex];
    } else if (creativeHistoryIndex < 0) {
        creativeScreen.textContent = source.no_prev_content;
    } else if (creativeHistoryIndex >= creativeHistory.length) {
        creativeScreen.textContent = source.no_next_content;
    } else if (creativeHistory.length === 0) {
        creativeScreen.textContent = "";
    }

    console.log(`ℹ️ updateCreativeDisplay: text="${creativeScreen.textContent}", index=${creativeHistoryIndex}`);

    updateCreativeText(creativeScreen.textContent);
    if (typeof updateCreativeMetrics === "function") {
        updateCreativeMetrics();
    }
    evaluatePasswordStrength(creativeScreen.textContent, "creative");

    // Forcer la barre à zéro pour les placeholders après évaluation
    if (creativeScreen.textContent === source.no_next_content || creativeScreen.textContent === source.no_prev_content) {
        updateStrengthUI(-1, "creative");
    }

    console.log("Écran créatif mis à jour:", creativeScreen.textContent, "Index:", creativeHistoryIndex);
}


// Fonction pour sauvegarder l’état dans l’historique
function saveCreativeState(content) {
    var trimmedContent = content.trim();
    if (trimmedContent && (creativeHistory.length === 0 || trimmedContent !== creativeHistory[creativeHistoryIndex]) && !isScreenEmpty(trimmedContent)) {
        creativeHistory.unshift(trimmedContent);
        if (creativeHistory.length > 10) creativeHistory.pop();
        creativeHistoryIndex = 0;
        console.log("Nouvel état sauvegardé:", trimmedContent, "Historique:", creativeHistory, "Index:", creativeHistoryIndex);
        updateCreativeDisplay();
    } else {
        console.log("ℹ️ Contenu non sauvegardé (vide, inchangé ou invalide) :", trimmedContent);
    }
}








const fontSizeSlider = document.getElementById('fontSizeSlider');


// Fonction pour gérer le wrap
// Initialiser la langue par défaut
window.currentLang = window.currentLang || 'fr';

// Charger les traductions avec un fallback robuste
function loadTranslations(lang = 'fr') {
    console.log('ℹ️ Tentative de chargement de translations.json avec langue :', lang);
    return fetch('/static/translations.json')
        .then(response => {
            if (!response.ok) {
                throw new Error('Erreur de chargement de translations.json');
            }
            return response.json();
        })
        .then(data => {
            window.translations = data;
            console.log('ℹ️ Translations chargées :', Object.keys(data));
            return data;
        })
        .catch(error => {
            console.warn('⚠️ Erreur lors du chargement des traductions, utilisation des traductions de secours :', error);
            const fallbackTranslations = {
                fr: {
                    strength_empty: 'Vide',
                    strength_very_strong: 'Très fort',
                    no_word_selected: 'Aucun mot sélectionné pour l’instant',
                    creative_placeholder: 'Entrez une base pour votre mot de passe sécurisé...',
                    copy_notification: 'Mot de passe copié !'
                }
            };
            window.translations = fallbackTranslations;
            return fallbackTranslations;
        });
}

// Modifier updateTextWrap (revenir à la version originale sans <div>)
function updateTextWrap(expectedText = null) {
    const fontSize = parseInt(fontSizeSlider.value) || 20;
    const activeScreen = randomScreen; // Mode aléatoire uniquement
    const screenContainer = activeScreen.closest('.password-screen');

    // Récupération du texte
    let text = expectedText ?? activeScreen.textContent;
    if (typeof text !== "string") text = "";

    // Nettoyage : on retire uniquement les retours à la ligne
    const visibleText = text.replace(/[\n\r]/g, '').trim();
    const charCount = visibleText.length;
    const isPhone = window.innerWidth <= 480;

    console.log(`ℹ️ Vérification wrap (aléatoire) : fontSize = ${fontSize}, charCount = ${charCount}, texte = "${visibleText}"`);

    // Conditions de wrap
    let shouldWrap = false;
    if (isPhone && charCount >= 15) {
        shouldWrap = true;
    } else if (fontSize >= 36 && charCount >= 22) {
        shouldWrap = true;
    } else if (fontSize === 22 && charCount >= 20) {
        shouldWrap = true;
    } else if (fontSize >= 27 && fontSize < 36 && charCount >= 28) {
        shouldWrap = true;
    }

    if (shouldWrap) {
        const mid = Math.ceil(charCount / 2);
        const line1 = visibleText.slice(0, mid);
        const line2 = visibleText.slice(mid);

        const wasEditable = activeScreen.contentEditable === "true";
        if (wasEditable) activeScreen.contentEditable = "false";

        activeScreen.innerHTML = `
            <div class="line first-line" dir="ltr">${line1}</div>
            <div class="line second-line" dir="ltr">${line2}</div>
        `;

        if (wasEditable) activeScreen.contentEditable = "true";

        setTimeout(() => {
            const sel = window.getSelection();
            const range = document.createRange();
            const lastLine = activeScreen.querySelector('.second-line');
            if (lastLine?.firstChild) {
                range.setStart(lastLine.firstChild, lastLine.firstChild.length);
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);
            }
        }, 0);

        screenContainer?.classList.add('two-lines');
        screenContainer?.classList.remove('three-lines');
        screenContainer?.classList.toggle('font-22', fontSize === 22);

        activeScreen.classList.add('two-lines');
        activeScreen.classList.remove('three-lines');

        console.log(`✅ Wrap appliqué (mode aléatoire)`);
    } else {
        activeScreen.textContent = visibleText;
        activeScreen.style.direction = 'ltr';
        activeScreen.style.textAlign = 'left';

        screenContainer?.classList.remove('two-lines', 'three-lines', 'font-22');
        activeScreen.classList.remove('two-lines', 'three-lines');

        console.log(`✅ Pas de wrap (mode aléatoire)`);
    }
}


let wasMultilineCreative = false;

function countLines(element) {
    const range = document.createRange();
    range.selectNodeContents(element);
    const rects = range.getClientRects();
    return rects.length;
}

function updateCreativeText(text = null) {
    const creativeScreen = document.getElementById('creativeScreen');
    const fontSize = parseInt(document.getElementById('fontSizeSlider').value) || 20;
    if (!creativeScreen) return;

    // Texte à afficher
    if (text === null) {
        text = creativeScreen.value || creativeScreen.textContent || "";
    }

    // 🔒 Ne nettoyer et tronquer le texte QUE si ce n’est pas un import
    if (!isImporting) {
        text = text.trim().replace(/\s+/g, " ").substring(0, 50);
    }

    creativeScreen.value = text;

    // 🔤 Forcer l'alignement et le sens
    creativeScreen.style.direction = 'ltr';
    creativeScreen.style.textAlign = 'left';
    creativeScreen.setAttribute('dir', 'ltr');
    creativeScreen.style.fontSize = `${fontSize}px`;

    // 📏 Détection réelle du nombre de lignes après le rendu
    setTimeout(() => {
        creativeScreen.classList.remove("import-view");
        const screenContainer = creativeScreen.closest('.password-screen');
        const lineCount = countLines(creativeScreen);

        // Réinitialiser les classes
        screenContainer?.classList.remove('two-lines', 'three-lines');
        creativeScreen.classList.remove('two-lines', 'three-lines', 'editable');

        // Appliquer la classe correcte selon le nombre de lignes
        if (lineCount === 2) {
            screenContainer?.classList.add('two-lines');
            creativeScreen.classList.add('two-lines');
            console.log("📏 Hauteur modifiée : 2 lignes");

            // ➕ Ajout de .editable si le champ est éditable
            if (creativeScreen.contentEditable === "true") {
                creativeScreen.classList.add('editable');
            }

        } else if (lineCount >= 3) {
            screenContainer?.classList.add('three-lines');
            creativeScreen.classList.add('three-lines');
            console.log("📏 Hauteur modifiée : 3 lignes");
        } else {
            console.log("📏 Hauteur modifiée : 1 ligne");
        }

        wasMultilineCreative = lineCount >= 2;
    }, 0);

    console.log(`🖊️ Mode créatif : texte = "${text}", longueur = ${text.length}`);
}



let alreadyCleanedAfterImport = false;

creativeScreen.addEventListener("input", function () {
    // 🛡️ Ne faire le nettoyage qu'une seule fois après un import
    if (isFromImport && !alreadyCleanedAfterImport) {
        // 🔍 Vérifie si le HTML contient encore des balises <div>
        if (creativeScreen.querySelector('.line')) {
            const text = creativeScreen.innerText.replace(/\s+/g, ' ').trim();

            // 🧼 Nettoyage : conversion en texte brut
            creativeScreen.textContent = text;

            // 🛠️ Réinitialise les styles et les lignes
            updateCreativeText(text);

            console.log("🧹 Texte nettoyé après import — mode classique restauré.");

            // ✅ On ne refait plus ce traitement après
            isFromImport = false;
            alreadyCleanedAfterImport = true;
        }
    }
});








function updateWrapDependingOnMode(expectedText = null) {
    if (creativeScreen.style.display !== 'none') {
        updateCreativeText(expectedText);
    } else {
        updateTextWrap(expectedText);
    }
}


// Forcer la direction du texte dans #creativeScreen
function initializeCreativeScreenDirection() {
    const creativeScreen = document.getElementById('creativeScreen');
    const errorMessage = document.getElementById('creativeScreenError');

    if (!creativeScreen) {
        console.warn('⚠️ #creativeScreen non trouvé');
        return;
    }
    if (!errorMessage) {
        console.warn('⚠️ #creativeScreenError non trouvé');
        return;
    }

    // Forcer direction: ltr et limiter à 50 caractères
    creativeScreen.addEventListener('input', () => {
        const text = creativeScreen.value;
        creativeScreen.style.direction = 'ltr';
        console.log(`ℹ️ Saisie dans #creativeScreen, textContent: ${text}, direction: ltr, length: ${text.length}`);

        if (text.length >= 50) {
            creativeScreen.value = text.slice(0, 50); // Tronquer à 50
            errorMessage.style.display = 'block';
            console.log('ℹ️ Limite de 50 caractères atteinte, message affiché');
        } else {
            errorMessage.style.display = 'none';
        }
    });

    // Gestion du collage
    creativeScreen.addEventListener('paste', (e) => {
        const pastedText = (e.clipboardData || window.clipboardData).getData('text');
        const currentText = creativeScreen.value;
        const newText = currentText + pastedText;

        if (newText.length > 50) {
            e.preventDefault();
            creativeScreen.value = newText.slice(0, 50);
            errorMessage.style.display = 'block';
            console.log('ℹ️ Collage bloqué, limite de 50 caractères atteinte');
        }
    });

    // Initialiser la direction
    creativeScreen.style.direction = 'ltr';
    console.log('ℹ️ Direction initialisée à ltr pour #creativeScreen');
}

// Appeler après initializeCreativeMode
document.addEventListener('DOMContentLoaded', () => {
    loadTranslations('fr').then(() => {
        initializeCreativeScreenDirection();
    });
});



// Écouteurs


document.getElementById('fontSelect').addEventListener('change', function () {
    const selectedFont = this.value;
    randomScreen.style.fontFamily = selectedFont;
    creativeScreen.style.fontFamily = selectedFont;
    updateWrapDependingOnMode(); // Vérifier après changement de police
});

document.getElementById('fontSizeSlider').addEventListener('input', function () {
    const size = this.value;
    randomScreen.style.fontSize = `${size}px`;
    creativeScreen.style.fontSize = `${size}px`;
    document.getElementById('fontSizeValue').textContent = size;
    updateWrapDependingOnMode(); // Vérifier après changement de taille
});

lengthSlider.addEventListener('input', function () {
    updateWrapDependingOnMode(); // Vérifier après changement de longueur
});

// Supprimé pour consolidation
/*
creativeScreen.addEventListener('input', function (e) {
    if (isImporting) return;
    updateTextWrap();
});
*/


// Vérifier au chargement
document.addEventListener('DOMContentLoaded', updateTextWrap);










document.addEventListener('DOMContentLoaded', () => {

    document.addEventListener('DOMContentLoaded', () => {
        const creativeScreen = document.getElementById('creativeScreen');


    });

    const checkboxes = document.querySelectorAll('.separator-options .separator-checkbox');
    console.log("ℹ️ Nombre de checkboxes trouvés au chargement :", checkboxes.length);
    if (checkboxes.length === 0) {
        console.warn("⚠️ Aucun checkbox trouvé dans .separator-options ! Vérifie le HTML ou le timing.");
    }
    checkboxes.forEach((checkbox, index) => {
        console.log("ℹ️ Checkbox détecté :", checkbox.value, "index :", index);
        checkbox.addEventListener('change', (event) => {
            console.log("ℹ️ Checkbox changé :", event.target.value, "coché :", event.target.checked, "index :", index);
            const value = event.target.value;
            if (event.target.checked) {
                if (!selectionOrder.includes(value)) {
                    selectionOrder.push(value);
                }
            } else {
                selectionOrder = selectionOrder.filter(item => item !== value);
            }
            updateSeparatorColors();
            console.log("ℹ️ SelectionOrder après changement :", selectionOrder);
            if (selectionOrder.length > 0) {
                buttonsInterface.separator.classList.add("active-button");
                isSeparatorActive = true;
            } else {
                buttonsInterface.separator.classList.remove("active-button");
                isSeparatorActive = false;
            }
            console.log("📌 Ordre de sélection :", selectionOrder);
        });
    });
});

addSeparatorButton.addEventListener('click', (event) => {
    event.stopPropagation();

    // Ferme #specialCharsWindow si elle est ouverte
    const specialCharsWindow = document.getElementById("specialCharsWindow");
    if (specialCharsWindow && !specialCharsWindow.classList.contains('hidden')) {
        specialCharsWindow.classList.add('hidden');
        console.log("ℹ️ #specialCharsWindow fermé avant d’ouvrir #separatorModal");
    }

    // Ferme #specialCharsContainer si elle est ouverte
    const specialCharsContainer = document.getElementById("specialCharsContainer");
    if (specialCharsContainer && !specialCharsContainer.classList.contains('hidden')) {
        specialCharsContainer.classList.add('hidden');
        console.log("ℹ️ #specialCharsContainer fermé - Classe ajoutée:", specialCharsContainer.classList.toString());
        // Forcer la fermeture si nécessaire
        specialCharsContainer.style.display = 'none';
    }

    // Réinitialiser les séparateurs avant ouverture
    selectedSeparators = [];
    selectionOrder = [];
    document.querySelectorAll(".separator-options input").forEach(checkbox => {
        checkbox.checked = false;
    });

    separatorModal.classList.remove('hidden');
    console.log("🔵 Fenêtre des séparateurs ouverte depuis interface, séparateurs réinitialisés");
    updateSeparatorColors();
    console.log("ℹ️ Couleurs initialisées à l’ouverture");
});

validateSeparatorButton.addEventListener("click", () => {
    // Réinitialiser avant de remplir avec les nouveaux choix
    selectedSeparators = [];
    selectionOrder = [];

    // Remplir avec les checkboxes actuellement cochées
    document.querySelectorAll('.separator-options input:checked').forEach(checkbox => {
        selectedSeparators.push(checkbox.value);
        selectionOrder.push(checkbox.value);
    });

    separatorModal.classList.add("hidden");
    if (selectedSeparators.length > 0) {
        buttonsInterface.separator.classList.add("active-button");
        isSeparatorActive = true;
        console.log("✅ Séparateurs validés et bouton maintenu actif !");
    } else {
        buttonsInterface.separator.classList.remove("active-button");
        isSeparatorActive = false;
        console.log("❌ Aucune sélection, bouton désactivé.");
    }
    console.log("✅ Séparateurs sélectionnés dans l’ordre :", selectedSeparators);
});

document.addEventListener('click', (event) => {
    if (!separatorModal.classList.contains('hidden')) {
        if (!separatorModal.contains(event.target)) {
            const checkedSeparators = separatorModal.querySelectorAll('.separator-checkbox:checked');
            if (checkedSeparators.length === 0) {
                separatorModal.classList.add('hidden');
                buttonsInterface.separator.classList.remove('active-button');
                isSeparatorActive = false;
                console.log("ℹ️ Fenêtre fermée par clic extérieur (aucun séparateur sélectionné).");
            } else {
                console.log("ℹ️ Clic extérieur ignoré : des séparateurs sont sélectionnés.");
            }
        }
    }
});

function updateSeparatorColors() {
    console.log("ℹ️ Mise à jour des couleurs appelée");
    document.querySelectorAll('.separator-options .separator-checkbox').forEach(checkbox => {
        const value = checkbox.value;
        const orderIndex = selectionOrder.indexOf(value);
        console.log("ℹ️ Checkbox analysée :", value, "checked :", checkbox.checked, "orderIndex :", orderIndex);
        if (orderIndex !== -1 && checkbox.checked) {
            checkbox.classList.remove('order-0', 'order-1', 'order-2', 'order-3', 'order-4', 'order-5', 'order-6', 'order-7', 'order-8', 'order-9', 'order-10', 'order-11', 'order-12', 'order-13', 'order-14', 'order-15', 'order-16', 'order-17', 'order-18', 'order-19', 'order-20', 'order-21', 'order-22', 'order-23', 'order-24', 'order-25', 'order-26', 'order-27', 'order-28', 'order-29');
            checkbox.classList.add(`order-${orderIndex}`);
            console.log(`🖌️ Couleur appliquée : order-${orderIndex} sur`, value);
        } else {
            checkbox.classList.remove('order-0', 'order-1', 'order-2', 'order-3', 'order-4', 'order-5', 'order-6', 'order-7', 'order-8', 'order-9', 'order-10', 'order-11', 'order-12', 'order-13', 'order-14', 'order-15', 'order-16', 'order-17', 'order-18', 'order-19', 'order-20', 'order-21', 'order-22', 'order-23', 'order-24', 'order-25', 'order-26', 'order-27', 'order-28', 'order-29');
        }
    });
}



function toggleMode(isCreative) {
    const copyButton = document.getElementById('copyButton');
    const memoryButton = document.getElementById('memoryButton');
    const allCopyButton = document.getElementById('allCopyButton');
    const exportButton = document.getElementById('exportButton');
    const anagramButton = document.getElementById('anagram-button');
    const reverseButton = document.getElementById('reverseButton');
    const previousCreativeButton = document.getElementById('previousCreative');
    const nextCreativeButton = document.getElementById('nextCreative');
    const secureWordButton = document.getElementById('secureWord');
    const resetButton = document.getElementById('resetButton'); // Ajouté pour accès direct
    const wrapper = document.querySelector('.below-screen-wrapper');

    console.log("Mode basculé vers :", isCreative ? "créatif" : "aléatoire");

    if (isCreative) {




        wrapper.classList.add('mode-creative');
        randomScreen.style.display = 'none';
        creativeScreen.style.display = 'block';
        creativeOptions.style.display = 'block';
        randomOptions.style.display = 'none';

        document.getElementById("modeLabelLeft").classList.remove("active");
        document.getElementById("modeLabelRight").classList.add("active");

        generateButton.style.visibility = 'hidden';
        copyButton.style.visibility = 'visible';
        memoryButton.style.visibility = 'visible';
        allCopyButton.style.display = memoryCounter >= 2 ? 'block' : 'none';
        exportButton.style.visibility = 'visible';
        anagramButton.style.visibility = 'visible';
        reverseButton.classList.remove('hidden');
        previousCreativeButton.style.opacity = '1';
        nextCreativeButton.style.opacity = '1';
        secureWordButton.style.display = 'block';
        resetButton.style.display = 'block';

        document.querySelector('.length-slider-container').style.display = 'none';
        document.querySelector('.creative-length-display').style.display = 'block';

        document.getElementById('creative-strength-meter').style.display = 'block';
        document.getElementById('random-strength-meter').style.display = 'none';

        document.querySelector(".random-options").classList.add("hidden");
        document.querySelector(".creative-options").classList.remove("hidden");

        document.getElementById("random-exclure-doublons").parentElement.style.display = "none";
        document.getElementById("random-exclure-similaires").parentElement.style.display = "none";

        document.getElementById("creative-exclure-doublons-main").parentElement.style.display = "block";
        document.getElementById("creative-exclure-similaires-main").parentElement.style.display = "block";

        document.getElementById("importerAlea").style.display = "inline-block";
        document.getElementById('menuToggle').style.display = 'block';

        document.querySelector('.anagram-button-container')?.classList.add('hidden');

        creativeScreen.focus();



        updateResetButton(); // Vérifie l'état de resetButton
    } else {
        wrapper.classList.remove('mode-creative');
        creativeScreen.style.display = 'none';
        randomScreen.style.display = 'block';
        creativeOptions.style.display = 'none';
        randomOptions.style.display = 'block';

        document.getElementById("modeLabelRight").classList.remove("active");
        document.getElementById("modeLabelLeft").classList.add("active");

        generateButton.style.visibility = 'visible';
        resetButton.style.visibility = 'hidden'; // Forcé caché en mode aléatoire
        copyButton.style.visibility = 'visible';
        memoryButton.style.visibility = 'visible';
        allCopyButton.style.display = memoryCounter >= 2 ? 'block' : 'none';
        exportButton.style.visibility = 'visible';
        anagramButton.style.visibility = 'visible';
        reverseButton.classList.add('hidden');
        previousCreativeButton.style.opacity = '0';
        nextCreativeButton.style.opacity = '0';
        secureWordButton.style.display = 'none';

        document.querySelector('.length-slider-container').style.display = 'block';
        document.querySelector('.creative-length-display').style.display = 'none';

        document.getElementById('creative-strength-meter').style.display = 'none';
        document.getElementById('random-strength-meter').style.display = 'block';

        document.querySelector(".random-options").classList.remove("hidden");
        document.querySelector(".creative-options").classList.add("hidden");

        document.getElementById("creative-exclure-doublons-main").parentElement.style.display = "none";
        document.getElementById("creative-exclure-similaires-main").parentElement.style.display = "none";

        document.getElementById("random-exclure-doublons").parentElement.style.display = "block";
        document.getElementById("random-exclure-similaires").parentElement.style.display = "block";

        document.getElementById("importerAlea").style.display = "none";
        document.getElementById('menuToggle').style.display = 'block';

        document.querySelector('.anagram-button-container')?.classList.remove('hidden');
    }
    updateTextWrap();
}

if (modeSwitch) {
    toggleMode(modeSwitch.checked); // Initialisation au chargement

    modeSwitch.addEventListener("change", function () {
        const isCreative = this.checked;
        toggleMode(isCreative);
        console.log(`✅ Mode basculé vers : ${isCreative ? "créatif" : "aléatoire"}`);

        if (isCreative) {
            const creativeScreen = document.getElementById('creativeScreen');
            const screenContainer = creativeScreen.closest('.password-screen');
            const content = creativeScreen.value?.trim() || creativeScreen.textContent?.trim() || '';

            if (!content) {
                screenContainer?.classList.remove('two-lines', 'three-lines', 'font-22');
                creativeScreen.classList.remove('two-lines', 'three-lines');
                creativeScreen.style.height = 'auto';

                const lineHeight = window.getComputedStyle(creativeScreen).lineHeight;
                if (lineHeight) {
                    creativeScreen.style.minHeight = lineHeight;
                }

                console.log("🧹 Reset affichage mode créatif (via switch) : 1 ligne car contenu vide");
            }
        }
    });
}



document.addEventListener("DOMContentLoaded", function () {



    console.log("✅ Initialisation des fonctionnalités...");

    isInitialLoad = false; // Désactiver après le chargement initial
    updateTextWrap();

    const creativeScreen = document.getElementById('creativeScreen');
    if (creativeScreen) {
        creativeScreen.addEventListener('input', function (e) {
            console.log('ℹ️ creativeScreen input déclenché, textContent=', creativeScreen.textContent, 'display=', creativeScreen.style.display, 'timestamp=', performance.now());
            if (isImporting) return;
            const currentText = e.target.textContent.trim();
            console.log('ℹ️ Texte saisi brut :', currentText);
            const limitedText = limitCreativeScreenLength(currentText, 'saisie manuelle');
            if (limitedText !== currentText) {
                e.target.textContent = limitedText; // Restaurer immédiatement le texte tronqué
                // Positionner le curseur à la fin
                const range = document.createRange();
                const sel = window.getSelection();
                range.selectNodeContents(creativeScreen);
                range.collapse(false);
                sel.removeAllRanges();
                sel.addRange(range);
            }
            updateCreativeMetrics();
            evaluatePasswordStrength(limitedText, 'creative');
            updateCreativeText(limitedText);
            if (limitedText && limitedText !== creativeHistory[creativeHistoryIndex]) {
                creativeHistory.unshift(limitedText);
                if (creativeHistory.length > 10) creativeHistory.pop();
                creativeHistoryIndex = 0;
                console.log('ℹ️ Nouvel état sauvegardé:', limitedText, 'Historique:', creativeHistory, 'Index:', creativeHistoryIndex);
            }
            const resetButton = document.getElementById('resetButton');
            if (resetButton) {
                resetButton.style.display = limitedText.length > 0 ? 'block' : 'none';
            }
        });

        // Gestion du collage
        creativeScreen.addEventListener('paste', (e) => {
            e.preventDefault();
            const pastedText = (e.clipboardData || window.clipboardData).getData('text');
            const currentText = creativeScreen.textContent.trim();
            const newText = currentText + pastedText;
            const limitedText = limitCreativeScreenLength(newText, 'collage');
            creativeScreen.textContent = limitedText;
            // Positionner le curseur à la fin
            const range = document.createRange();
            const sel = window.getSelection();
            range.selectNodeContents(creativeScreen);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
            updateCreativeMetrics();
            evaluatePasswordStrength(limitedText, 'creative');
            updateCreativeText(limitedText);
            if (limitedText && limitedText !== creativeHistory[creativeHistoryIndex]) {
                creativeHistory.unshift(limitedText);
                if (creativeHistory.length > 10) creativeHistory.pop();
                creativeHistoryIndex = 0;
                console.log('ℹ️ Nouvel état sauvegardé après collage:', limitedText, 'Historique:', creativeHistory, 'Index:', creativeHistoryIndex);
            }
        });
    } else {
        console.error('⚠️ Élément #creativeScreen non trouvé dans le DOM');
    }

    // --- SECTION 1 : INITIALISATION DES ÉLÉMENTS COMMUNS ---
    secureWordButton = document.getElementById("secureWord");
    previousCreativeButton = document.getElementById("previousCreative");
    nextCreativeButton = document.getElementById("nextCreative");
    boxTypeSelect = document.getElementById("boxType");
    generatorBox = document.getElementById("generatorBox");
    phraseBox = document.getElementById("phraseBox");
    wordBox = document.getElementById("wordBox");
    phraseLangSelect = document.getElementById("phrase-lang-select");
    generatePhraseButton = document.getElementById("generatePhrase");
    insertPhraseButton = document.getElementById("insertPhraseBox");
    generatedPhrase = document.getElementById("generatedPhrase");
    previousPhraseButton = document.getElementById("previousPhrase");
    nextPhraseButton = document.getElementById("nextPhrase");
    wordCountInput = document.getElementById("word-count-input");
    useSpecialCharsCheckbox = document.getElementById("use-special-chars");
    toggleSpecialCharsButton = document.getElementById("toggle-special-chars");
    specialCharsContainer = document.getElementById("specialCharsContainer");
    closeSpecialChars = document.getElementById("closeSpecialChars");

    // Éléments pour le générateur de mots
    let langSelect = document.getElementById("lang-select");
    let generateWordsButton = document.getElementById("generateWords");
    let previousWordButton = document.getElementById("previousWord");
    let nextWordButton = document.getElementById("nextWord");
    let wordList = document.getElementById("wordList");
    let prefixInput = document.getElementById("prefix-input");
    let lengthInput = document.getElementById("length-input");

    // Éléments pour l’interface d’insertion
    let insertButtonInterface = document.getElementById("insertButtonInterface");
    let insertButtonsGroup = document.getElementById("insertButtonsGroup");
    let separatorModal = document.getElementById("separatorModal");
    let validateSeparatorButton = document.getElementById("validateSeparator");

    // Éléments supplémentaires des blocs précédents
    let generatedWordDisplay = document.getElementById("generatedWordDisplay");
    let insertGeneratedWord = document.getElementById("insertGeneratedWord");
    const randomizeButton = document.getElementById("randomizeGeneratedWord");

    // Éléments pour la visibilité des boîtes
    const allBoxes = document.querySelectorAll(".box-container");

    // Éléments pour le menu et le mode aléatoire/créatif
    const modeSwitch = document.getElementById("modeSwitch");
    const menuButton = document.getElementById("menuToggle");
    const closeMenuButton = document.getElementById("closeMenu");
    const sideMenu = document.getElementById("sideMenu");
    const importerAleaCreative = document.getElementById("importerAlea");
    const reinitialiser = document.getElementById("reinitialiser");
    const resetButton = document.getElementById("resetButton");
    const resetAll = document.getElementById("resetAll");
    const exportButton = document.getElementById("exportButton");
    const saveFileButton = document.getElementById("saveFile");

    // Éléments pour le bouton capitalizeFirstButton
    const capitalizeFirstButton = document.getElementById("capitalizeFirstButton");

    // Éléments pour le bloc aléatoire/créatif
    const copyButton = document.getElementById('copyButton');
    const generateButton = document.getElementById('generateButton');
    const memoryButton = document.getElementById('memoryButton');
    const allCopyButton = document.getElementById('allCopyButton');
    const defineSpecialCharsButtonRandom = document.getElementById('defineSpecialCharsRandom');
    const specialCharsWindowRandom = document.getElementById('specialCharsWindowRandom');
    const toggleAllCheckbox = document.getElementById("toggleAllSpecialChars");
    const specialCharCheckboxes = document.querySelectorAll("#specialCharsWindowRandom .random-char-options input[type='checkbox']");
    const uppercaseButton = document.getElementById('uppercaseButton');
    const lowercaseButton = document.getElementById('lowercaseButton');

    // Éléments pour la fenêtre d’exportation
    const exportPage = document.getElementById("exportPage");
    const returnButton = document.getElementById("returnToGeneratorButton");







    // Vérification des éléments essentiels
    if (!creativeScreen || !secureWordButton || !previousCreativeButton || !nextCreativeButton ||
        !boxTypeSelect || !generatorBox || !phraseBox || !wordBox || !selectedWordDisplay ||
        !phraseLangSelect || !generatePhraseButton || !insertPhraseButton || !generatedPhrase ||
        !previousPhraseButton || !nextPhraseButton || !wordCountInput || !useSpecialCharsCheckbox ||
        !toggleSpecialCharsButton || !specialCharsContainer || !closeSpecialChars ||
        !langSelect || !generateWordsButton || !previousWordButton || !nextWordButton ||
        !wordList || !prefixInput || !lengthInput || !insertButtonInterface ||
        !insertButtonsGroup || !separatorModal || !validateSeparatorButton) {
        console.error("Erreur : Éléments de l’interface introuvables.");
        return;
    }

    // Initialisation
    generatedPhrase.textContent = "";
    wordList.textContent = "";
    selectedWordDisplay.textContent = boxTypeSelect.value === "phraseBox" ? "Aucune phrase générée" : "Aucun mot sélectionné pour l'instant.";
    creativeScreen.removeAttribute("autofocus");
    creativeScreen.blur();

    // Boutons d’insertion pour l’interface
    const buttonsInterface = {
        left: document.getElementById("insertLeftButton"),
        right: document.getElementById("insertRightButton"),
        middle: document.getElementById("insertMiddleButton"),
        both: document.getElementById("insertBothButton"),
        separator: document.getElementById("addSeparatorButton"),
    };




    // Variables d’état pour le bloc aléatoire/créatif
    let selectedSpecialChars = "!@#$%^&*()-_=+{}[]|\\:;\"'<>,.?/`~";
    let currentBasePassword = "";
    let currentCreativeWord = "";
    let isUppercaseActive = false;
    let isLowercaseActive = false;

    // --- SECTION 2 : GESTION DU BOUTON "SÉCURISER" ---
    var specialChars = ["!", "@", "#", "$", "%", "&", "*", "_", "+", "="];
    var numbers = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

    function secureWord(input) {
        if (!input || input === "Aucune phrase générée" || input === "Votre phrase apparaîtra ici..." || input === "Aucun mot sélectionné pour l'instant.") {
            return "Entrer une base...";
        }

        var chars = input.split("");
        var length = chars.length;
        var secured = [...chars];

        var replacements = Math.min(length, 3);
        var indices = [];
        while (indices.length < replacements) {
            var randomIndex = Math.floor(Math.random() * length);
            if (!indices.includes(randomIndex)) indices.push(randomIndex);
        }

        if (indices.length >= 1) {
            secured[indices[0]] = numbers[Math.floor(Math.random() * numbers.length)];
        }
        if (indices.length >= 2) {
            secured[indices[1]] = specialChars[Math.floor(Math.random() * specialChars.length)];
        }
        if (indices.length >= 3) {
            secured[indices[2]] = secured[indices[2]].toUpperCase();
        }

        secured = secured.map((char, index) => {
            if (/[a-zA-Z]/.test(char) && !indices.includes(index)) {
                return Math.random() > 0.5 ? char.toUpperCase() : char.toLowerCase();
            }
            return char;
        });

        return secured.join("");
    }

    secureWordButton.addEventListener("click", function () {
        var currentContent = creativeScreen.textContent.trim();
        if (isScreenEmpty(currentContent) && !baseWord) {
            console.warn("⚠️ Aucun contenu valide à sécuriser !");
            return;
        }

        if (!baseWord) {
            baseWord = currentContent;
            console.log("ℹ️ Mot de base défini au premier clic :", baseWord);
        }

        if (isScreenEmpty(baseWord)) {
            console.warn("⚠️ Aucun contenu valide à sécuriser !");
            return;
        }

        if (typeof window.insertCreativeContent === "function") {
            console.log("ℹ️ Ajout du contenu actuel à l’historique :", creativeScreen.textContent);
            window.insertCreativeContent(creativeScreen.textContent);
        }

        var securedWord = secureWord(baseWord);
        creativeScreen.textContent = securedWord;
        console.log("✅ Mot sécurisé à partir de la base :", securedWord);

        if (typeof window.insertCreativeContent === "function") {
            console.log("ℹ️ Ajout de la version sécurisée à l’historique :", securedWord);
            window.insertCreativeContent(securedWord);
        } else {
            console.warn("⚠️ window.insertCreativeContent n’est pas défini ! Vérifie creativeScreenNav.js.");
        }
    });

    resetButton?.addEventListener("click", function () {
        const creativeScreen = document.getElementById('creativeScreen');
        const screenContainer = creativeScreen.closest('.password-screen');
        const reinitialiser = document.getElementById("reinitialiser");
        const importerAleaCreative = document.getElementById("importerAlea");

        if (!creativeScreen) {
            console.warn("⚠️ #creativeScreen manquant pour la réinitialisation !");
            return;
        }

        // Réinitialiser le contenu et les variables
        baseWord = "";
        creativeScreen.value = ""; // Utiliser value pour <textarea>
        originalCreativePassword = "";
        originalContent = "";
        selectionOrder = [];
        selectedSeparators = [];
        updateSeparatorColors();
        buttonsInterface.separator.classList.remove("active-button");
        isSeparatorActive = false;

        // Supprimer la classe two-lines
        if (screenContainer) {
            screenContainer.classList.remove('two-lines', 'three-lines', 'font-22');
        }
        creativeScreen.classList.remove('two-lines', 'three-lines');

        // Forcer LTR
        creativeScreen.style.direction = 'ltr';
        creativeScreen.setAttribute('dir', 'ltr');
        creativeScreen.style.textAlign = 'center';

        // Mettre à jour l'interface
        creativeScreen.focus();
        if (reinitialiser) reinitialiser.style.display = "none";
        if (importerAleaCreative) importerAleaCreative.style.display = "block";

        // Appeler les mises à jour
        setTimeout(() => {
            if (typeof updateCreativeMetrics === "function") updateCreativeMetrics();
            if (typeof updateCreativeText === "function") updateCreativeText("");
            console.log("✔️ Interface mise à jour après reset, two-lines supprimé");
        }, 100);

        console.log("🔄 Mot de base réinitialisé, écran revenu à une ligne");
    });

    function isScreenEmpty(content) {
        const source = window.translations && window.translations[window.currentLang]
            ? window.translations[window.currentLang]
            : {
                no_phrase_generated: "Aucune phrase générée.",
                no_word_selected: "Aucun mot sélectionné pour l’instant.",
                creative_placeholder: "Entrer une base...",
                no_next_content: "Pas de contenu suivant",
                no_prev_content: "Pas de contenu précédent"
            };

        const result = !content ||
            content === source.no_phrase_generated ||
            content === "Votre phrase apparaîtra ici..." ||
            content === source.no_word_selected ||
            content === source.creative_placeholder ||
            content === source.no_next_content ||
            content === source.no_prev_content;

        console.log(`ℹ️ isScreenEmpty vérifié: content="${content}", result=${result}`);
        return result;
    }

    // --- SECTION 3 : HISTORIQUE DE L’ÉCRAN CRÉATIF ---



    /*
        creativeScreen.addEventListener("input", function () {
            saveCreativeState(creativeScreen.textContent);
        });*/

    window.insertCreativeContent = function (content) {
        console.log("ℹ️ Contenu reçu par insertCreativeContent :", content);
        creativeScreen.textContent = content;
        originalCreativePassword = content; // Synchronise avec le nouveau mot
        originalContent = content; // Pour cohérence
        saveCreativeState(content);
        updateCreativeMetrics();
        evaluatePasswordStrength(content, "creative");
        console.log("ℹ️ Contenu après insertion :", creativeScreen.textContent);
    };

    previousCreativeButton.addEventListener("click", function () {
        if (creativeHistory.length === 0) {
            creativeHistoryIndex = -1; // Indique hors limites
        } else if (creativeHistoryIndex < creativeHistory.length - 1) {
            creativeHistoryIndex++;
        } else {
            creativeHistoryIndex = creativeHistory.length; // Fin de l’historique
        }
        updateCreativeDisplay();
        console.log("Retour à:", creativeScreen.textContent, "Index:", creativeHistoryIndex);
    });

    nextCreativeButton.addEventListener("click", function () {
        if (creativeHistory.length === 0) {
            creativeHistoryIndex = -1; // Indique hors limites
        } else if (creativeHistoryIndex > 0) {
            creativeHistoryIndex--;
        } else {
            creativeHistoryIndex = -1; // Début de l’historique
        }
        updateCreativeDisplay();
        console.log("Avance à:", creativeScreen.textContent, "Index:", creativeHistoryIndex);
    });

    // --- SECTION 4 : GÉNÉRATEUR DE PHRASES ET MOTS, VISIBILITÉ DES BOÎTES ---
    function updateBoxVisibility() {
        const boxType = boxTypeSelect.value;
        generatorBox.classList.add("hidden");
        phraseBox.classList.add("hidden");
        wordBox.classList.add("hidden");

        allBoxes.forEach(box => {
            if (box.id === boxType) {
                box.classList.remove("hidden");
            } else {
                box.classList.add("hidden");
            }
        });

        if (boxType === "generatorBox") {
            generatorBox.classList.remove("hidden");
            selectedWordDisplay.textContent = wordList.textContent || "Aucun mot sélectionné pour l'instant.";
            prefixInput.focus();
            setTimeout(() => {
                prefixInput.focus();
                console.log("Focus forcé sur #prefix-input après délai");
            }, 1500);
        } else if (boxType === "phraseBox") {
            phraseBox.classList.remove("hidden");
            selectedWordDisplay.textContent = generatedPhrase.textContent.trim() || "Aucune phrase générée";
        } else if (boxType === "wordBox") {
            wordBox.classList.remove("hidden");
            selectedWordDisplay.textContent = generatedWordDisplay?.textContent.trim() || "Aucun mot sélectionné pour l'instant.";
        }
        console.log("Mode sélectionné:", boxType);
    }

    updateBoxVisibility();
    boxTypeSelect.addEventListener("change", function () {
        updateBoxVisibility();
        updateSelectedWordDisplays();
    });

    // Générateur de phrases
    function updatePhraseDisplay() {
        const useSpecialChars = useSpecialCharsCheckbox.checked;
        const selectedSpecialChars = Array.from(document.querySelectorAll('#specialCharsContainer input[name="special_chars"]:checked'))
            .map(input => input.value);

        let phrase;
        if (currentPhraseParts.length === 0) {
            phrase = "";
        } else if (useSpecialChars && selectedSpecialChars.length > 0) {
            phrase = currentPhraseParts[0];
            for (let i = 1; i < currentPhraseParts.length; i++) {
                const separator = selectedSpecialChars[(i - 1) % selectedSpecialChars.length];
                phrase += separator + currentPhraseParts[i];
            }
        } else {
            phrase = currentPhraseParts.join(" ");
        }
        generatedPhrase.textContent = phrase;
        if (boxTypeSelect.value === "phraseBox") {
            selectedWordDisplay.textContent = phrase || "Aucune phrase générée";
        }
        console.log("Affichage phrase mis à jour:", phrase);
    }

    function generatePhrase() {
        if (boxTypeSelect.value !== "phraseBox") {
            console.log("Génération annulée : #phraseBox n’est pas actif.");
            return;
        }

        console.log("Début de génération de phrase...");
        const lang = phraseLangSelect.value;
        const wordCount = wordCountInput.value.trim();
        const useSpecialChars = useSpecialCharsCheckbox.checked;
        const selectedSpecialChars = Array.from(document.querySelectorAll('#specialCharsContainer input[name="special_chars"]:checked'))
            .map(input => input.value);

        // Validation côté client
        if (wordCount && (isNaN(wordCount) || wordCount < 3 || wordCount > 10)) {
            generatedPhrase.textContent = "Le nombre de mots doit être entre 3 et 10.";
            return;
        }
        if (useSpecialChars && selectedSpecialChars.length === 0) {
            generatedPhrase.textContent = "Veuillez sélectionner au moins un caractère spécial.";
            return;
        }

        generatedPhrase.textContent = "Génération en cours...";

        const bodyData = {
            lang: lang || "fr",
            word_count: wordCount ? parseInt(wordCount, 10) : 5,
            use_special_chars: useSpecialChars,
            special_chars: selectedSpecialChars
        };
        console.log("Données envoyées au serveur:", bodyData); // Log ajouté

        //const langPrefix = window.location.pathname.includes('/fr/') ? '/fr' : '/en'; // Ajuste selon les langues
        fetch(`/generator/api/generate/phrase/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(bodyData)
        })
            .then(response => {
                if (!response.ok) throw new Error(`Erreur HTTP ${response.status}`);
                console.log("Réponse reçue de /generate_phrase");
                return response.json();
            })
            .then(data => {
                generatedPhrase.textContent = "";
                console.log("Données reçues:", data);
                if (data.error) {
                    generatedPhrase.textContent = data.error;
                    if (boxTypeSelect.value === "phraseBox") document.getElementById('selectedWordDisplayPhrase').textContent = data.error;
                } else {
                    if (!data || typeof data.phrase !== "string") {
                        console.error("Réponse invalide :", data);
                        throw new Error("Réponse invalide : 'phrase' est manquante ou incorrecte.");
                    }
                    const phrase = data.phrase;
                    currentPhraseParts = phrase.split(/[!@#$%^&*()_=\+{}\[\]|\\:;"'<>,.?\/`~ ]/).filter(part => part);
                    updatePhraseDisplay();
                    phraseHistory.unshift(phrase);
                    if (phraseHistory.length > 10) phraseHistory.pop();
                    phraseHistoryIndex = 0;
                    console.log("Phrase générée:", data.phrase, "Parts:", currentPhraseParts, "Historique:", phraseHistory, "Index:", phraseHistoryIndex);
                }
            })
            .catch(error => {
                console.error("Erreur lors de la requête:", error);
                generatedPhrase.textContent = "Erreur lors de la génération de la phrase.";
                if (boxTypeSelect.value === "phraseBox") selectedWordDisplay.textContent = "Erreur lors de la génération de la phrase.";
            });
    }

    function showPreviousPhrase() {
        if (boxTypeSelect.value !== "phraseBox") return;

        if (phraseHistoryIndex + 1 < phraseHistory.length) {
            phraseHistoryIndex++;
            const previousPhrase = phraseHistory[phraseHistoryIndex];
            currentPhraseParts = previousPhrase.split(/[!@#$%^&*()_=\+{}\[\]|\\:;"'<>,.?\/`~ ]/).filter(part => part);
            updatePhraseDisplay();
            console.log("Retour à:", previousPhrase, "Index:", phraseHistoryIndex);
        } else {
            generatedPhrase.textContent = "Pas de phrase précédente.";
            if (boxTypeSelect.value === "phraseBox") selectedWordDisplay.textContent = "Pas de phrase précédente.";
            console.log("Fin de l’historique des phrases");
        }
    }

    function showNextPhrase() {
        if (boxTypeSelect.value !== "phraseBox") return;

        if (phraseHistoryIndex - 1 >= 0) {
            phraseHistoryIndex--;
            const nextPhrase = phraseHistory[phraseHistoryIndex];
            currentPhraseParts = nextPhrase.split(/[!@#$%^&*()_=\+{}\[\]|\\:;"'<>,.?\/`~ ]/).filter(part => part);
            updatePhraseDisplay();
            console.log("Avance à:", nextPhrase, "Index:", phraseHistoryIndex);
        } else {
            generatedPhrase.textContent = "Pas de phrase suivante.";
            if (boxTypeSelect.value === "phraseBox") selectedWordDisplay.textContent = "Pas de phrase suivante.";
            console.log("Début de l’historique des phrases");
        }
    }

    toggleSpecialCharsButton.addEventListener("click", function (e) {
        e.preventDefault();
        specialCharsContainer.classList.toggle("hidden");
        specialCharsContainer.style.display = specialCharsContainer.classList.contains("hidden") ? "none" : "block";
        console.log("Fenêtre des caractères spéciaux toggled");
    });

    useSpecialCharsCheckbox.addEventListener("change", function (e) {
        e.preventDefault();
        updatePhraseDisplay();
    });

    document.querySelectorAll('#specialCharsContainer input[name="special_chars"]').forEach(checkbox => {
        checkbox.addEventListener("change", function (e) {
            e.stopPropagation();
            const selectedSpecialChars = document.querySelectorAll('#specialCharsContainer input[name="special_chars"]:checked').length;
            // Cocher la case si au moins un caractère est sélectionné
            useSpecialCharsCheckbox.checked = selectedSpecialChars > 0;
            if (currentPhraseParts.length > 0) updatePhraseDisplay();
        });
    });

    // Écouteur pour fermer la fenêtre via la croix

    closeSpecialChars.addEventListener("click", function (e) {
        e.stopPropagation();
        specialCharsContainer.classList.add("hidden");
        specialCharsContainer.style.display = "none";
        updatePhraseDisplay();
        console.log("Fenêtre fermée via croix");
    });

    // Écouteur pour fermer la fenêtre via clic extérieur

    document.addEventListener("click", function (event) {
        if (specialCharsContainer.classList.contains('hidden')) {
            return;
        }
        if (!specialCharsContainer.contains(event.target) &&
            event.target !== toggleSpecialCharsButton &&
            event.target !== useSpecialCharsCheckbox) {
            specialCharsContainer.classList.add("hidden");
            specialCharsContainer.style.display = "none";
            updatePhraseDisplay();
            console.log("Fenêtre fermée via clic extérieur");
        }
    });

    generatePhraseButton.addEventListener("click", function () {
        console.log("Clic sur #generatePhrase");
        generatePhrase();
        setTimeout(updateSelectedWordDisplays, 100);
    });

    previousPhraseButton.addEventListener("click", showPreviousPhrase);
    nextPhraseButton.addEventListener("click", showNextPhrase);

    insertPhraseButton.addEventListener("click", function () {
        if (boxTypeSelect.value !== "phraseBox") return;
        const phraseToInsert = generatedPhrase.textContent.trim();
        handleInsert(phraseToInsert, "boiteAPhrases");
        console.log("Phrase insérée dans #selectedWordDisplay:", phraseToInsert);
    });

    phraseLangSelect.addEventListener("change", generatePhrase);
    wordCountInput.addEventListener("change", generatePhrase);

    document.addEventListener("keypress", function (event) {
        if (event.key === "Enter" && boxTypeSelect.value === "phraseBox" && document.activeElement.tagName !== "INPUT") {
            generatePhrase();
        }
    });

    if (boxTypeSelect.value === "phraseBox") {
        generatePhrase();
    }

    // Générateur de mots
    function showLengthErrorAlert(message) {
        const alert = document.createElement("div");
        alert.textContent = message;
        alert.style.position = "absolute";
        alert.style.backgroundColor = "#ff4444";
        alert.style.color = "#fff";
        alert.style.padding = "5px 10px";
        alert.style.borderRadius = "5px";
        alert.style.boxShadow = "0 2px 4px rgba(0, 0, 0, 0.2)";
        alert.style.zIndex = "1000";
        alert.style.opacity = "1";
        alert.style.transition = "opacity 1s ease-out";

        const rect = lengthInput.getBoundingClientRect();
        alert.style.left = `${rect.right + 10}px`;
        alert.style.top = `${rect.top}px`;

        document.body.appendChild(alert);

        setTimeout(() => {
            alert.style.opacity = "0";
            setTimeout(() => document.body.removeChild(alert), 1000);
        }, 2000);
    }

    function generateWords() {
        console.log("🚀 Fonction generateWords appelée !");

        if (boxTypeSelect.value !== "generatorBox") return;

        const lang = langSelect.value;
        const prefix = prefixInput.value.trim();
        const length = lengthInput.value.trim();

        if (length) {
            const lengthInt = parseInt(length, 10);
            if (isNaN(lengthInt) || lengthInt < 3 || lengthInt > 20) {
                showLengthErrorAlert("La longueur doit être entre 3 et 20 caractères.");
                console.log("Entrée invalide dans #length-input :", length);
                return;
            }
        }

        //const langPrefix = window.location.pathname.includes('/fr/') ? '/fr' : '/en';

        fetch(`/generator/api/generate/words/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                lang: lang || "fr",
                prefix: prefix || "",
                length: length ? parseInt(length) : Math.floor(Math.random() * (12 - 5 + 1)) + 5
            })


        })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Erreur HTTP ${response.status}: ${response.statusText}`);
                }
                return response.json();
            })
            .then(data => {
                console.log("Réponse reçue pour /api/words/words/", data);
                const wordList = document.getElementById("wordList");
                const newWord = data.result[0];

                if (wordList) {
                    wordList.innerHTML = `<p>${newWord}</p>`;
                }
                // Étape 2 : on récupère le texte injecté et on le copie dans selectedWordDisplay
                const displayElement = document.getElementById('selectedWordDisplay');
                if (displayElement) {
                    displayElement.textContent = newWord;
                } else {
                    console.warn("⚠️ Élément #selectedWordDisplay introuvable dans le DOM.");
                }
                // 🔁 Gestion de l’historique
                wordHistory.unshift(newWord);
                if (wordHistory.length > 10) wordHistory.pop();
                wordHistoryIndex = 0;

                console.log("Mot généré:", newWord, "Historique:", wordHistory, "Index:", wordHistoryIndex);

            })

            .catch(error => {
                console.error("Erreur lors de la requête /api/words/words/", error);
            });
    }

    function showPreviousWord() {
        if (boxTypeSelect.value !== "generatorBox") return;

        if (wordHistoryIndex + 1 < wordHistory.length) {
            wordHistoryIndex++;
            const previousWord = wordHistory[wordHistoryIndex];
            wordList.textContent = previousWord;
            selectedWordDisplay.textContent = previousWord;
            console.log("Retour à:", previousWord, "Index:", wordHistoryIndex);
        } else {
            const lang = langSelect?.value || 'fr';
            const translations = window.translations?.[lang] || {};
            const message = translations.no_prev_content || "Pas de mot précédent.";
            wordList.textContent = message;
            selectedWordDisplay.textContent = message;
            console.log("Fin de l’historique des mots");
        }
    }

    function showNextWord() {
        if (boxTypeSelect.value !== "generatorBox") return;

        if (wordHistoryIndex - 1 >= 0) {
            wordHistoryIndex--;
            const nextWord = wordHistory[wordHistoryIndex];
            wordList.textContent = nextWord;
            selectedWordDisplay.textContent = nextWord;
            console.log("Avance à:", nextWord, "Index:", wordHistoryIndex);
        } else {
            const lang = langSelect?.value || 'fr';
            const translations = window.translations?.[lang] || {};
            const message = translations.no_next_content || "Pas de mot suivant.";
            wordList.textContent = message;
            selectedWordDisplay.textContent = message;
            console.log("Début de l’historique des mots");
        }
    }

    prefixInput.addEventListener("click", function () {
        if (boxTypeSelect.value === "generatorBox") {
            this.focus();
            this.select();
        }
    });

    lengthInput.addEventListener("click", function () {
        if (boxTypeSelect.value === "generatorBox") {
            this.focus();
            this.select();
        }
    });

    generateWordsButton.addEventListener("click", function () {
        generateWords();
        setTimeout(updateSelectedWordDisplays, 100);
    });

    previousWordButton.addEventListener("click", showPreviousWord);
    nextWordButton.addEventListener("click", showNextWord);

    prefixInput.addEventListener("input", generateWords);
    lengthInput.addEventListener("input", function () {
        if (boxTypeSelect.value !== "generatorBox") return;
        const length = this.value.trim();
        if (length && (parseInt(length, 10) === 1 || parseInt(length, 10) === 2)) return;
        generateWords();
    });

    prefixInput.addEventListener("keypress", function (event) {
        if (event.key === "Enter" && boxTypeSelect.value === "generatorBox") generateWords();
    });
    lengthInput.addEventListener("keypress", function (event) {
        if (event.key === "Enter" && boxTypeSelect.value === "generatorBox") generateWords();
    });

    if (boxTypeSelect.value === "generatorBox") {
        generateWords();
    }

    // --- SECTION 5 : INTERFACE D’INSERTION ---
    function activateInsertMode(selectedButton) {
        Object.values(buttonsInterface).forEach(btn => {
            if (btn && btn !== buttonsInterface.separator) btn.classList.remove("active-button");
        });
        selectedButton.classList.add("active-button");
        console.log(`✅ Mode d'insertion activé : ${selectedButton.id}`);
    }

    function toggleSeparatorWindow(source) {
        isSeparatorActive = !isSeparatorActive;
        if (isSeparatorActive) {
            buttonsInterface.separator.classList.add("active-button");
            separatorModal.classList.remove("hidden");
            console.log(`🔵 Fenêtre des séparateurs ouverte depuis ${source}`);
        } else {
            buttonsInterface.separator.classList.remove("active-button");
            separatorModal.classList.add("hidden");
            console.log(`🛑 Fenêtre des séparateurs fermée depuis ${source}`);
        }
    }

    Object.entries(buttonsInterface).forEach(([key, button]) => {
        if (key !== "separator") {
            button.addEventListener("click", () => activateInsertMode(button));
        } else {
            button.addEventListener("click", () => toggleSeparatorWindow("interface"));
        }
    });

    // Exemple d’intégration dans ton script.js

    // Exemple d’intégration dans ton script.js









    function deselectAllButtons() {
        Object.values(buttonsInterface).forEach(btn => {
            if (btn) btn.classList.remove("active-button");
        });
        selectedSeparators = [];
        isSeparatorActive = false;
        document.querySelectorAll(".separator-options input").forEach(checkbox => {
            checkbox.checked = false;
        });
        console.log("✅ Tous les boutons d'insertion désélectionnés et séparateurs réinitialisés");
    }

    insertButtonInterface.addEventListener("click", function () {
        const selectedBox = boxTypeSelect.value;
        let wordToInsert = selectedWordDisplay.textContent.trim();
        let source;

        console.log(`📌 Bouton Insérer cliqué. Source : ${selectedBox}, Mot : "${wordToInsert}"`);

        switch (selectedBox) {
            case "wordBox": source = "boiteAMots"; break;
            case "generatorBox": source = "generateurMots"; break;
            case "phraseBox": source = "boiteAPhrases"; break;
            default: console.warn("⚠️ Aucune boîte valide détectée."); return;
        }

        console.log(`📌 Insertion depuis la source : ${source}`);
        handleInsert(wordToInsert, source);
    });

    creativeScreen.addEventListener("click", function () {
        const source = window.translations && window.translations[window.currentLang]
            ? window.translations[window.currentLang]
            : (typeof fallbackTranslations !== 'undefined' ? fallbackTranslations[window.currentLang] : {
                no_next_content: "Pas de contenu suivant",
                no_prev_content: "Pas de contenu précédent"
            });

        const currentContent = creativeScreen.textContent.trim();
        if (currentContent === source.no_prev_content || currentContent === source.no_next_content) {
            resetButton?.click();
            console.log("Écran réinitialisé via resetButton suite à un clic");
        }
    });

    function updateInsertButtonsVisibility() {
        let currentContent = creativeScreen.textContent.trim();
        if (isScreenEmpty(currentContent)) {
            console.log("🔹 L'écran principal est vide → Masquage des boutons !");
            insertButtonsGroup.classList.add("hidden");
        } else {
            console.log("🔹 L'écran principal contient du texte → Affichage des boutons !");
            insertButtonsGroup.classList.remove("hidden");
        }
    }

    const observer = new MutationObserver(updateInsertButtonsVisibility);
    observer.observe(creativeScreen, { childList: true, subtree: true, characterData: true });
    updateInsertButtonsVisibility();

    function isNavigationMessage(text) {
        const lang = window.currentLang || 'fr';
        const translations = window.translations?.[lang];

        if (!translations) return false;
        const messagesToBlock = [
            translations.no_next_word,
            translations.no_previous_word,
            translations.no_word_yet,
            translations.word_placeholder,
            translations.phrase_placeholder,
            translations.no_word_generated,
            translations.no_previous_phrase,
            translations.no_phrase_generated
        ];

        return messagesToBlock.includes(text);
    }

    function handleInsert(wordToInsert, source) {

        if (isNavigationMessage(wordToInsert)) {
            console.log("🌐 Langue courante:", window.currentLang);
            console.log("🧾 Traduction utilisée:", translations.navigation_insert_block);
            showNavigationInsertBlockedNotification();
            return;
        }

        // Ensuite, vérifie si aucun mot n’a été généré
        if (!wordToInsert.trim() ||
            wordToInsert === "Mot généré s'affichera ici" ||
            wordToInsert === "Votre phrase apparaîtra ici..." ||
            wordToInsert === "Aucun mot généré pour l’instant." ||
            wordToInsert === "Pas de phrase précédente." ||
            wordToInsert === "Aucun mot généré." ||
            wordToInsert === "Aucune phrase générée.") {
            const sourceTranslations = window.translations?.[window.currentLang] || {
                generate_phrase_alert: "Veuillez générer une phrase avant de l'insérer.",
                generate_word_alert: "Veuillez générer un mot avant de l'insérer."
            };

            const alertMessage = source === "boiteAPhrases"
                ? sourceTranslations.generate_phrase_alert
                : sourceTranslations.generate_word_alert;

            showVisualInsertAlert(alertMessage);
            return;
        }

        let currentContent = creativeScreen.textContent.trim();
        let insertMode = getActiveInsertMode();
        let separators = selectedSeparators && selectedSeparators.length ? selectedSeparators.join('') : '';

        console.log(`📌 Contenu actuel : "${currentContent}"`);
        console.log(`📌 Mot à insérer : "${wordToInsert}"`);
        console.log(`📌 Mode d'insertion : "${insertMode || 'aucun mode sélectionné'}"`);
        console.log(`📌 Séparateurs : "${separators}"`);

        let newContent;
        if (isScreenEmpty(currentContent)) {
            console.log("🟢 Écran vide, insertion directe !");
            newContent = wordToInsert;
        } else {
            if (!insertMode) {
                // MODIFICATION : Au lieu d'une alerte, on default à l'insertion à droite
                console.log("⚠️ Aucun mode sélectionné → Insertion par défaut à droite !");
                newContent = currentContent + separators + wordToInsert;
            } else {
                // Le code existant pour les modes sélectionnés reste inchangé
                const positions = {
                    insertLeftButton: () => wordToInsert + separators + currentContent,
                    insertRightButton: () => currentContent + separators + wordToInsert,
                    insertMiddleButton: () => {
                        let mid = Math.floor(currentContent.length / 2);
                        return currentContent.slice(0, mid) + separators + wordToInsert + separators + currentContent.slice(mid);
                    },
                    insertBothButton: () => wordToInsert + separators + currentContent + separators + wordToInsert,
                    addSeparatorButton: () => currentContent + separators + wordToInsert
                };

                console.log("🔄 Insertion avec mode :", insertMode);
                newContent = positions[insertMode] ? positions[insertMode]() : currentContent;
            }
        }

        console.log("Nouveau contenu calculé:", newContent);
        originalContent = newContent;
        newContent = limitCreativeScreenLength(newContent, `insertion depuis ${source}`);

        const removeDuplicatesCheckbox = document.getElementById('creative-exclure-doublons-main');
        const excludeSimilarCheckbox = document.getElementById('creative-exclure-similaires-main');

        const removeDuplicates = removeDuplicatesCheckbox ? removeDuplicatesCheckbox.checked : removeDuplicatesEnabled;
        const removeSimilar = excludeSimilarCheckbox ? excludeSimilarCheckbox.checked : excludeSimilarEnabled;

        console.log("ℹ️ État des filtres avant application :", { removeDuplicates, removeSimilar });
        let filteredContent = applyFilters(newContent, removeDuplicates, removeSimilar);
        creativeScreen.textContent = filteredContent;
        console.log("Contenu filtré après insertion :", filteredContent);

        if (typeof updateCreativeMetrics === "function") updateCreativeMetrics();
        if (typeof updateCreativePassword === "function") updateCreativePassword();

        setTimeout(() => {
            if (typeof window.insertCreativeContent === "function") {
                console.log("Appel de window.insertCreativeContent avec:", filteredContent);
                window.insertCreativeContent(filteredContent);
            } else {
                console.warn("⚠️ window.insertCreativeContent n’est pas défini ! Vérifie creativeScreenNav.js.");
            }
        }, 50);

        deselectAllButtons();
    }

    function getActiveInsertMode() {
        for (const [key, button] of Object.entries(buttonsInterface)) {
            if (button.classList.contains("active-button") && key !== "separator") {
                console.log(`✅ Mode d'insertion détecté : ${button.id}`);
                return button.id;
            }
        }
        console.log("⚠️ Aucun mode d'insertion sélectionné !");
        return null;
    }

    // --- SECTION 6 : MISE À JOUR DE #SELECTEDWORDDISPLAY ---
    function getGeneratedWordFromCurrentBox() {
        const selectedBox = boxTypeSelect.value;
        const source = window.translations && window.translations[window.currentLang] ? window.translations[window.currentLang] : {
            no_word_generated: "Aucun mot généré.",
            no_phrase_generated: "Aucune phrase générée.",
            no_word_selected: "Aucun mot sélectionné pour l’instant"
        };

        if (selectedBox === "wordBox") {
            return generatedWordDisplay?.textContent.trim() || source.no_word_generated;
        } else if (selectedBox === "generatorBox") {
            return wordList?.textContent.trim() || source.no_word_generated;
        } else if (selectedBox === "phraseBox") {
            return generatedPhrase?.textContent.trim() || source.no_phrase_generated;
        }
        return source.no_word_selected;
    }

    function updateSelectedWordDisplays() {
        const word = getGeneratedWordFromCurrentBox();
        selectedWordDisplay.textContent = word;
    }

    const creativeSliders = document.querySelectorAll("#wordBox input[type='range'], .creative-slider-group input");
    creativeSliders.forEach(slider => {
        slider.addEventListener("input", function () {
            setTimeout(updateSelectedWordFromSliders, 50);
        });
    });

    function updateSelectedWordFromSliders() {
        const source = window.translations && window.translations[window.currentLang] ? window.translations[window.currentLang] : {
            no_word_generated: "Aucun mot généré."
        };
        if (boxTypeSelect.value === "wordBox") {
            selectedWordDisplay.textContent = generatedWordDisplay?.textContent.trim() || source.no_word_generated;
        }
    }

    if (insertGeneratedWord) {
        insertGeneratedWord.addEventListener("click", updateSelectedWordDisplays);
    }

    if (randomizeButton) {
        randomizeButton.addEventListener("click", () => {
            console.log("ℹ️ Régénération aléatoire demandée");
            randomizeGeneratedWord(); // Utiliser la fonction de mélange
        });
    }

    updateSelectedWordDisplays();





    // --- SECTION 7 : GESTION DU MENU LATÉRAL ET MODE ALÉATOIRE/CRÉATIF ---




    // Reste de la section (toggleMenu, etc.) inchangé...

    if (menuButton && closeMenuButton && sideMenu) {
        let hoverTimeout;

        function toggleMenu() {
            console.log("🎯 Clic détecté sur le menu !");
            if (sideMenu.classList.contains("open")) {
                console.log("🔴 Fermeture du menu");
                sideMenu.classList.remove("open");
                setTimeout(() => {
                    sideMenu.classList.add("hidden");
                    document.querySelectorAll(".submenu").forEach(submenu => {
                        submenu.classList.remove("open");
                        submenu.classList.add("hidden");
                        submenu.style.maxHeight = "0";
                    });
                }, 300);
            } else {
                console.log("🟢 Ouverture du menu");
                sideMenu.classList.remove("hidden");
                setTimeout(() => {
                    sideMenu.classList.add("open");
                    document.querySelectorAll(".menu-item.expandable").forEach(item => {
                        const submenu = item.querySelector(".submenu");
                        if (item.getAttribute("data-open") === "false") {
                            submenu.classList.remove("open");
                            submenu.classList.add("hidden");
                            submenu.style.maxHeight = "0";
                        } else {
                            submenu.classList.add("open");
                            submenu.classList.remove("hidden");
                            submenu.style.maxHeight = submenu.scrollHeight + "px";
                        }
                    });
                }, 10);
            }
        }

        menuButton.addEventListener("mouseenter", function () {
            if (sideMenu.classList.contains("open")) return;
            hoverTimeout = setTimeout(() => {
                if (!sideMenu.classList.contains("open")) {
                    toggleMenu();
                }
            }, 1000);
        });

        menuButton.addEventListener("mouseleave", function () {
            clearTimeout(hoverTimeout);
        });

        menuButton.addEventListener("click", toggleMenu);
        closeMenuButton.addEventListener("click", toggleMenu);

        document.querySelectorAll(".menu-item.expandable").forEach(item => {
            const arrow = item.querySelector(".arrow");
            const title = item.querySelector(".menu-title");
            const submenu = item.querySelector(".submenu");

            item.setAttribute("data-open", "true");
            arrow.style.transition = "transform 0.3s ease";

            function toggleSubMenu(event) {
                event.stopPropagation();
                const isOpen = submenu.classList.contains("open");

                submenu.classList.toggle("open");
                submenu.classList.toggle("hidden");

                if (isOpen) {
                    submenu.style.maxHeight = "0";
                    item.setAttribute("data-open", "false");
                    arrow.style.transform = "rotate(-90deg)";
                } else {
                    submenu.style.maxHeight = submenu.scrollHeight + "px";
                    item.setAttribute("data-open", "true");
                    arrow.style.transform = "rotate(0deg)";
                }
            }

            title.addEventListener("click", toggleSubMenu);
            arrow.addEventListener("click", toggleSubMenu);
        });
    }

    if (importerAleaCreative && reinitialiser && resetButton) {
        reinitialiser.style.display = "none";

        importerAleaCreative.addEventListener("click", function () {
            console.log("🎯 Clic sur Importer Aléa dans l'interface !");
            setTimeout(() => {
                if (typeof updateCreativeMetrics === "function") updateCreativeMetrics();
                creativeScreen.dispatchEvent(new Event("input"));
                console.log("🔥 Mise à jour de updateCreativeMetrics() après Importer Aléa");
            }, 200);
            if (reinitialiser) reinitialiser.style.display = "block";
        });

        reinitialiser.addEventListener('click', function () {
            creativeScreen.textContent = '';
            creativeScreen.focus();
            console.log('🔄 Réinitialisation demandée !');
            setTimeout(() => {
                if (typeof updateCreativeMetrics === 'function') updateCreativeMetrics();
                console.log('✔️ Interface mise à jour après reset');
            }, 100);
            if (importerAleaCreative) importerAleaCreative.style.display = 'block';
            reinitialiser.style.display = 'none';

            // Fermer le menu avec animation
            const sideMenu = document.getElementById('sideMenu');
            console.log('🔴 Fermeture du menu avec animation');
            sideMenu.classList.remove('open');
            setTimeout(() => {
                sideMenu.classList.add('hidden');
            }, 300);
        });
    }

    if (resetAll) {
        resetAll.addEventListener("click", function () {
            const languageSelect = document.getElementById('languageSelect');
            const selectedLang = languageSelect ? languageSelect.value : 'fr';
            console.log(`ℹ️ Rechargement avec langue : ${selectedLang}`);
            window.location.href = `${window.location.pathname}?lang=${selectedLang}`;
        });
    }

    console.log("✅ Synchronisation des boutons Exporter");
    if (exportButton && saveFileButton) {
        saveFileButton.addEventListener('click', () => {
            console.log("🟢 Clic sur Exporter dans la fenêtre => Exécution de Exporter dans l'interface");
            exportButton.click();
        });
    } else {
        console.warn("⚠️ Bouton Exporter non trouvé dans l'interface ou la fenêtre !");
    }

    // --- SECTION 8 : GESTION DU BOUTON CAPITALIZE FIRST ---
    if (capitalizeFirstButton) {
        const state = {
            currentCapitalIndex: 0,
            mode: 'capitalize',
            clickTimeout: null
        };

        const tooltip = document.createElement('div');
        Object.assign(tooltip.style, {
            position: 'absolute',
            backgroundColor: '#f0f0f0',
            border: '1px solid #ccc',
            padding: '5px',
            borderRadius: '5px',
            fontSize: '12px',
            display: 'none'
        });
        document.body.appendChild(tooltip);

        function updateTooltip() {
            const key = state.mode === 'capitalize' ? 'capitalize_mode' : 'lowercase_mode';
            const lang = window.currentLang || 'fr';
            const tooltipTranslations = window.translations?.[lang]?.tooltips;
            const fallback = {
                capitalize_mode: "Cliquer pour majusculer la lettre suivante<br>Double-cliquer pour passer en mode minuscule",
                lowercase_mode: "Cliquer pour minusculer la lettre suivante<br>Double-cliquer pour passer en mode majuscule"
            };

            console.log(`🧪 Tooltip update — Langue : ${lang}, Clé : ${key}`);
            tooltip.innerHTML = tooltipTranslations?.[key] ?? fallback[key];
        }



        function updateButtonStyle() {
            capitalizeFirstButton.classList.remove('uppercase-mode', 'lowercase-mode');
            capitalizeFirstButton.classList.add(state.mode === 'capitalize' ? 'uppercase-mode' : 'lowercase-mode');
            capitalizeFirstButton.textContent = state.mode === 'capitalize' ? 'Lettre majuscule' : 'Lettre minuscule';
        }

        function modifyLetterAt(text, index, mode) {
            if (typeof text !== 'string' || index < 0 || index >= text.length) {
                console.warn("⚠️ Texte ou index invalide pour modifyLetterAt :", { text, index });
                return text;
            }
            return text.split('').map((char, i) => {
                if (i === index && /[a-zA-Z]/.test(char)) {
                    return mode === 'capitalize' ? char.toUpperCase() : char.toLowerCase();
                }
                return char;
            }).join('');
        }

        function updateCreativeContent(text, action) {
            if (isScreenEmpty(text)) {
                showCustomAlert('empty_text_alert');  // ✅ Appelle la fonction d’alerte stylée avec traduction
                return false;
            }

            if (typeof window.insertCreativeContent === "function") {
                console.log(`ℹ️ Ajout à l’historique avant ${action} :`, text);
                window.insertCreativeContent(text);
            } else {
                console.warn("⚠️ window.insertCreativeContent n’est pas défini ! Vérifie creativeScreenNav.js");
            }

            return true;
        }


        updateTooltip();
        updateButtonStyle();

        capitalizeFirstButton.addEventListener('click', () => {
            if (state.clickTimeout) {
                clearTimeout(state.clickTimeout);
                state.clickTimeout = null;
                return;
            }

            state.clickTimeout = setTimeout(() => {
                const currentText = creativeScreen.textContent.trim();
                if (!updateCreativeContent(currentText, "modification")) return;

                if (state.currentCapitalIndex >= currentText.length) {
                    state.currentCapitalIndex = 0;
                }

                const updatedText = modifyLetterAt(currentText, state.currentCapitalIndex, state.mode);
                creativeScreen.textContent = updatedText;
                console.log(`✅ Lettre ${state.mode === 'capitalize' ? 'majusculée' : 'minusculée'} à l’index ${state.currentCapitalIndex} :`, updatedText);
                state.currentCapitalIndex++;

                if (typeof window.insertCreativeContent === "function") {
                    console.log("ℹ️ Ajout du texte modifié à l’historique :", updatedText);
                    window.insertCreativeContent(updatedText);
                }
                if (typeof updateCreativeMetrics === "function") {
                    updateCreativeMetrics();
                    console.log("ℹ️ Métriques mises à jour après modification");
                } else {
                    console.warn("⚠️ updateCreativeMetrics n’est pas défini !");
                }

                state.clickTimeout = null;
            }, 250);
        });

        const capitalizeButton = document.getElementById('capitalizeFirstButton');



        let lastTap = 0;
        const delay = 300; // Délai maximal entre deux taps (en ms)

        // Gestion du double tap pour mobile
        capitalizeButton.addEventListener('touchend', function (e) {
            e.preventDefault(); // Empêche zoom ou autres comportements par défaut
            const currentTime = new Date().getTime();
            const tapGap = currentTime - lastTap;

            if (tapGap < delay && tapGap > 0) {
                // Double tap détecté
                clearTimeout(state.clickTimeout);
                state.clickTimeout = null;

                const currentText = creativeScreen.textContent.trim();
                if (!updateCreativeContent(currentText, "changement de mode")) return;

                state.mode = state.mode === 'capitalize' ? 'lowercase' : 'capitalize';
                updateTooltip();
                updateButtonStyle();
                console.log(`ℹ️ Mode changé en : ${state.mode}`);

                if (state.currentCapitalIndex > 0) {
                    state.currentCapitalIndex--;
                    const updatedText = modifyLetterAt(currentText, state.currentCapitalIndex, state.mode);
                    creativeScreen.textContent = updatedText;
                    console.log(`✅ Lettre ajustée après changement de mode :`, updatedText);
                    state.currentCapitalIndex++;

                    if (typeof window.insertCreativeContent === "function") {
                        console.log("ℹ️ Ajout du texte modifié à l’historique après changement de mode :", updatedText);
                        window.insertCreativeContent(updatedText);
                    }
                    if (typeof updateCreativeMetrics === "function") {
                        updateCreativeMetrics();
                    }
                }
            }
            lastTap = currentTime;
        });

        // Gestion du double-clic pour desktop
        capitalizeButton.addEventListener('dblclick', () => {
            clearTimeout(state.clickTimeout);
            state.clickTimeout = null;

            const currentText = creativeScreen.textContent.trim();
            if (!updateCreativeContent(currentText, "changement de mode")) return;

            state.mode = state.mode === 'capitalize' ? 'lowercase' : 'capitalize';
            updateTooltip();
            updateButtonStyle();
            console.log(`ℹ️ Mode changé en : ${state.mode}`);

            if (state.currentCapitalIndex > 0) {
                state.currentCapitalIndex--;
                const updatedText = modifyLetterAt(currentText, state.currentCapitalIndex, state.mode);
                creativeScreen.textContent = updatedText;
                console.log(`✅ Lettre ajustée après changement de mode :`, updatedText);
                state.currentCapitalIndex++;

                if (typeof window.insertCreativeContent === "function") {
                    console.log("ℹ️ Ajout du texte modifié à l’historique après changement de mode :", updatedText);
                    window.insertCreativeContent(updatedText);
                }
                if (typeof updateCreativeMetrics === "function") {
                    updateCreativeMetrics();
                }
            }
        });

        let capitalizeTooltipTimeout;

        capitalizeFirstButton.addEventListener('mouseover', (event) => {
            capitalizeTooltipTimeout = setTimeout(() => {
                updateTooltip(); // Met à jour le contenu selon le mode et la langue
                tooltip.style.display = 'block';
                tooltip.style.left = `${event.pageX + 10}px`;
                tooltip.style.top = `${event.pageY + 10}px`;
            }, 2000); // ⏱️ Affiche après 2 secondes
        });

        capitalizeFirstButton.addEventListener('mouseout', () => {
            clearTimeout(capitalizeTooltipTimeout); // Annule si on sort avant 2s
            tooltip.style.display = 'none';         // Cache le tooltip
        });
    }

    // --- SECTION 9 : GESTION DES BOUTONS ALÉATOIRES ET CRÉATIFS ---
    if (copyButton && generateButton && resetButton && memoryButton && allCopyButton && exportButton &&
        defineSpecialCharsButtonRandom && specialCharsWindowRandom && toggleAllCheckbox &&
        uppercaseButton && lowercaseButton) {

        copyButton.addEventListener('click', () => {
            const isCreativeMode = modeSwitch.checked; // Vérifie si on est en mode créatif
            const activeScreen = isCreativeMode ? creativeScreen : randomScreen;
            const passwordToCopy = activeScreen.textContent.trim();

            // Vérifie si l’écran est vide ou contient un placeholder
            if (isCreativeMode && isScreenEmpty(passwordToCopy)) {
                alert(translations && translations[currentLang] && translations[currentLang].empty_screen_alert
                    ? translations[currentLang].empty_screen_alert
                    : fallbackTranslations[currentLang || 'fr'].empty_screen_alert || "L’écran est vide. Veuillez entrer ou générer un contenu à copier.");
                console.log("ℹ️ Tentative de copie annulée : écran créatif vide");
                return; // Arrête l’exécution si vide en mode créatif
            }

            // Si non vide, copie le contenu
            navigator.clipboard.writeText(passwordToCopy).then(() => {
                // Texte "Copié" dans la langue courante
                const copiedText = translations && translations[currentLang] && translations[currentLang].copied_button
                    ? translations[currentLang].copied_button
                    : fallbackTranslations[currentLang || 'fr'].copied_button || 'Copié';
                copyButton.textContent = copiedText;
                copyButton.classList.add('copied');
                console.log(`ℹ️ Copie réussie : ${passwordToCopy}`);

                // Revenir au texte initial après 2 secondes
                setTimeout(() => {
                    const originalText = translations && translations[currentLang] && translations[currentLang].copy_button
                        ? translations[currentLang].copy_button
                        : fallbackTranslations[currentLang || 'fr'].copy_button || 'Copier';
                    copyButton.textContent = originalText;
                    copyButton.classList.remove('copied');
                }, 2000);
            }).catch(err => {
                console.error("Erreur lors de la copie :", err);
            });
        });





        specialCharsWindowRandom.classList.add('hidden');
        specialCharsWindowRandom.style.display = 'none';
        console.log("État initial forcé - Classe actuelle:", specialCharsWindowRandom.classList);
        console.log("État initial forcé - Style display:", specialCharsWindowRandom.style.display);

        defineSpecialCharsButtonRandom.addEventListener('click', () => {
            console.log('Bouton aléatoire cliqué');
            console.log("Avant toggle - Classe actuelle:", specialCharsWindowRandom.classList);
            console.log("Avant toggle - Style display:", specialCharsWindowRandom.style.display);

            if (specialCharsWindowRandom.classList.contains('hidden')) {
                specialCharsWindowRandom.classList.remove('hidden');
                specialCharsWindowRandom.style.display = 'block';
                defineSpecialCharsButtonRandom.classList.add('active');
                currentBasePassword = randomScreen.textContent.trim();
                console.log("Mot de base stocké à l’ouverture:", currentBasePassword);
            } else {
                specialCharsWindowRandom.classList.add('hidden');
                specialCharsWindowRandom.style.display = 'none';
                defineSpecialCharsButtonRandom.classList.remove('active');
                currentBasePassword = "";
            }

            console.log("Après toggle - Classe actuelle:", specialCharsWindowRandom.classList);
            console.log("Style display après toggle:", specialCharsWindowRandom.style.display);
            console.log("Classe du bouton après toggle:", defineSpecialCharsButtonRandom.classList);
        });

        specialCharCheckboxes.forEach(checkbox => {
            checkbox.addEventListener("change", () => {
                console.log("Modification détectée dans les caractères spéciaux !");
                updateSpecialCharacters(); // Remplace generateRandomPassword
            });
        });

        toggleAllCheckbox.checked = true;

        toggleAllCheckbox.addEventListener('change', () => {
            specialCharCheckboxes.forEach(checkbox => checkbox.checked = toggleAllCheckbox.checked);
            console.log("Tout sélectionner / Désélectionner modifié !");

            const specialCharsToUse = getSelectedSpecialCharsRandom();
            const lengthSlider = document.getElementById('length-slider');
            const lengthValue = document.getElementById('length-value');

            if (!specialCharsToUse && originalRandomPassword && originalRandomPassword !== 'Cliquez sur "Générer" pour créer un mot de passe') {
                const allSpecialChars = "!@#$%^&*()-_=+{}[]|\\:;'\"<>,.?/`~";
                const basePassword = originalRandomPassword.split('').filter(char => !allSpecialChars.includes(char)).join('');
                randomScreen.textContent = basePassword;
                currentBasePassword = basePassword;
                console.log("Mot de passe ajusté (sans caractères spéciaux) via toggle:", basePassword);

                const actualLength = basePassword.length;
                lengthSlider.value = actualLength;
                lengthValue.textContent = actualLength;
                console.log("ℹ️ Curseur length-slider synchronisé à :", actualLength);

                // Mettre à jour le remplissage du curseur
                const min = parseInt(lengthSlider.min) || 4; // Min par défaut 4
                const max = parseInt(lengthSlider.max) || 30; // Max par défaut 30
                const percentage = ((actualLength - min) / (max - min)) * 100;
                lengthSlider.style.setProperty('--range-progress', `${percentage}%`);
            } else if (specialCharsToUse && originalRandomPassword && originalRandomPassword !== 'Cliquez sur "Générer" pour créer un mot de passe') {
                randomScreen.textContent = originalRandomPassword;
                console.log("Mot original restauré via toggle:", originalRandomPassword);

                const actualLength = originalRandomPassword.length;
                lengthSlider.value = actualLength;
                lengthValue.textContent = actualLength;
                console.log("ℹ️ Curseur length-slider synchronisé à :", actualLength);

                // Mettre à jour le remplissage du curseur
                const min = parseInt(lengthSlider.min) || 4;
                const max = parseInt(lengthSlider.max) || 30;
                const percentage = ((actualLength - min) / (max - min)) * 100;
                lengthSlider.style.setProperty('--range-progress', `${percentage}%`);
            }

            if (typeof evaluatePasswordStrength === "function") {
                evaluatePasswordStrength(randomScreen.textContent, 'random');
            }
        });

        specialCharCheckboxes.forEach(checkbox => {
            checkbox.addEventListener("change", () => {
                const allChecked = [...specialCharCheckboxes].every(cb => cb.checked);
                toggleAllCheckbox.checked = allChecked;
            });
        });



        uppercaseButton.addEventListener('click', () => {
            const currentText = creativeScreen.textContent.trim();

            if (isScreenEmpty(currentText)) {
                showCustomAlert('empty_text_alert');
                return;
            }

            if (typeof window.insertCreativeContent === "function") {
                console.log("Ajout de l’état actuel à l’historique avant bascule:", currentText);
                window.insertCreativeContent(currentText);
            } else {
                console.warn("⚠️ window.insertCreativeContent n’est pas défini !");
            }

            if (!isUppercaseActive) {
                currentCreativeWord = currentText.toUpperCase();
                creativeScreen.textContent = currentCreativeWord;
                uppercaseButton.style.backgroundColor = '#004080';
                isUppercaseActive = true;
                console.log("Tout en majuscules activé:", currentCreativeWord);
            } else {
                currentCreativeWord = currentText.toLowerCase();
                creativeScreen.textContent = currentCreativeWord;
                uppercaseButton.style.backgroundColor = '';
                isUppercaseActive = false;
                console.log("Tout en majuscules désactivé:", currentCreativeWord);
            }

            if (typeof window.insertCreativeContent === "function") {
                console.log("Ajout de l’état modifié à l’historique:", currentCreativeWord);
                window.insertCreativeContent(currentCreativeWord);
            }

            if (typeof updateCreativeMetrics === "function") {
                updateCreativeMetrics();
            }
        });

        lowercaseButton.addEventListener('click', () => {
            const currentText = creativeScreen.textContent.trim();

            if (isScreenEmpty(currentText)) {
                showCustomAlert('empty_text_alert');
                return;
            }

            if (typeof window.insertCreativeContent === "function") {
                console.log("Ajout de l’état actuel à l’historique avant bascule:", currentText);
                window.insertCreativeContent(currentText);
            } else {
                console.warn("⚠️ window.insertCreativeContent n’est pas défini !");
            }

            if (!isLowercaseActive) {
                currentCreativeWord = currentText.toLowerCase();
                creativeScreen.textContent = currentCreativeWord;
                lowercaseButton.classList.add('active-button');
                isLowercaseActive = true;
                console.log("Tout en minuscules activé:", currentCreativeWord);
            } else {
                currentCreativeWord = currentText.toUpperCase();
                creativeScreen.textContent = currentCreativeWord;
                lowercaseButton.classList.remove('active-button');
                isLowercaseActive = false;
                console.log("Tout en minuscules désactivé:", currentCreativeWord);
            }

            if (typeof window.insertCreativeContent === "function") {
                console.log("Ajout de l’état modifié à l’historique:", currentCreativeWord);
                window.insertCreativeContent(currentCreativeWord);
            }

            if (typeof updateCreativeMetrics === "function") {
                updateCreativeMetrics();
            }
        });

        document.addEventListener('click', (event) => {
            if (specialCharsWindowRandom.classList.contains('hidden')) {
                return;
            }
            if (!specialCharsWindowRandom.contains(event.target) &&
                !defineSpecialCharsButtonRandom.contains(event.target)) {
                specialCharsWindowRandom.classList.add('hidden');
                specialCharsWindowRandom.style.display = 'none';
                defineSpecialCharsButtonRandom.classList.remove('active');
                console.log('Fenêtre fermée par clic extérieur');
            }
        });

        copyButton.style.visibility = 'visible';
        memoryButton.style.visibility = 'visible';
        exportButton.style.visibility = 'visible';

        // Effet "machine à sous" au chargement avec ralentissement
        function slotMachineEffectOnLoad() {
            const duration = 600;
            let startTime = Date.now();
            let elapsedTime = 0;
            let currentInterval = 30;

            const lengthSlider = document.getElementById('length-slider');
            const targetLength = parseInt(lengthSlider.value, 10) || 12;

            function runEffect() {
                if (elapsedTime > duration) {
                    randomScreen.textContent = generateRandomPassword().slice(0, targetLength);
                    updateTextWrap();
                    return;
                }

                randomScreen.textContent = generateRandomPassword().slice(0, targetLength);
                updateTextWrap(); // Stabilise le wrap
                elapsedTime = Date.now() - startTime;
                currentInterval = 30 + Math.pow(elapsedTime / duration, 2) * 100;
                console.log(`ℹ️ Chargement, délai : ${currentInterval}ms`);
                setTimeout(runEffect, currentInterval);
            }

            runEffect();
        }

        // Appel au chargement
        slotMachineEffectOnLoad();
    }

    // --- Vérification initiale des éléments DOM ---

    const exportContentInitial = document.getElementById('exportContent');
    const commentsInitial = document.getElementById('comments');
    console.log("ℹ️ Initial DOM check - exportPage:", exportPage);
    console.log("ℹ️ Initial DOM check - exportButton:", exportButton);
    console.log("ℹ️ Initial DOM check - saveFileButton:", saveFileButton);
    console.log("ℹ️ Initial DOM check - returnButton:", returnButton);
    console.log("ℹ️ Initial DOM check - exportContent:", exportContentInitial);
    console.log("ℹ️ Initial DOM check - comments:", commentsInitial);

    // --- SECTION 10 : GESTION DE LA FENÊTRE D’EXPORTATION ---
    if (exportPage && exportButton && saveFileButton && returnButton) {
        function showExportPage() {
            exportPage.style.display = "flex";
            console.log("Fenêtre d’exportation ouverte");
        }

        function hideExportPage() {
            exportPage.style.display = "none";
            console.log("Fenêtre d’exportation fermée");
        }

        exportButton.addEventListener("click", (event) => {
            event.stopPropagation();
            const activeScreen = document.querySelector('.password-display[style*="display: block"]');
            const password = activeScreen ? activeScreen.textContent.trim() : creativeScreen.textContent.trim();

            if (memorizedPasswords.length === 0 && isScreenEmpty(password)) {
                showNoPasswordNotification();
                return;
            }

            console.log("Avant affichage, Liste actuelle:", memorizedPasswords);
            showExportedPasswords();
            console.log("ℹ️ Contenu de #exportContent après showExportedPasswords:", exportContentInitial?.innerHTML || 'null');
            showExportPage();

            // Vérifier la hauteur de #exportContent après rendu
            setTimeout(() => {
                const exportContent = exportPage.querySelector('#exportContent');
                const comments = exportPage.querySelector('#comments');
                console.log("ℹ️ Post-render DOM check - exportContent:", exportContent);
                console.log("ℹ️ Post-render DOM check - comments:", comments);

                if (exportContent && comments) {
                    // Loguer la hauteur réelle pour débogage
                    const contentHeight = exportContent.offsetHeight;
                    console.log(`ℹ️ Hauteur réelle de #exportContent: ${contentHeight}px`);
                    console.log(`ℹ️ Fenêtre d’exportation ouverte, éléments affichés: ${memorizedPasswords.length === 0 ? 1 : memorizedPasswords.length}`);
                    // Pas de margin-top dynamique, le CSS gère le flux
                } else {
                    console.error("⚠️ Éléments manquants - exportContent:", exportContent, "comments:", comments);
                }
            }, 100); // Délai pour attendre le rendu
        });

        returnButton.addEventListener("click", () => {
            hideExportPage();
        });

        document.addEventListener("click", (event) => {
            const isClickInside = exportPage.contains(event.target);
            const isClickOnExportButton = exportButton.contains(event.target);
            const isClickOnSaveFileButton = saveFileButton.contains(event.target);
            const isExportPageVisible = exportPage.style.display === "flex";

            if (isExportPageVisible && !isClickInside && !isClickOnExportButton && !isClickOnSaveFileButton) {
                hideExportPage();
            }
        });
    }
    // --- SECTION 11 : ÉVALUATION INITIALE DE LA FORCE DES MOTS DE PASSE ---
    console.log("🔍 Évaluation initiale de la force des mots de passe...");
    let initialRandomPassword = document.getElementById("randomScreen").textContent.trim();
    if (initialRandomPassword === 'Cliquez sur "Générer" pour créer un mot de passe') {
        initialRandomPassword = "";
    }
    evaluatePasswordStrength(initialRandomPassword, "random");
    let initialCreativePassword = creativeScreen.textContent.trim();
    if (!initialCreativePassword || initialCreativePassword === creativeScreen.getAttribute("data-placeholder")) {
        initialCreativePassword = "";
    }
    evaluatePasswordStrength(initialCreativePassword, "creative");




    console.log("✅ Tout est prêt !");
});



const fontSettingsWindow = document.getElementById('fontSettingsWindow');
const fontSettingsHeader = fontSettingsWindow.querySelector('h3');
const closeFontSettingsButton = document.getElementById('closeFontSettings');

let isDragging = false;
let currentX;
let currentY;
let initialX;
let initialY;

function setInitialPosition() {
    const windowWidth = fontSettingsWindow.offsetWidth;
    const windowHeight = fontSettingsWindow.offsetHeight;
    const viewportHeight = window.innerHeight;
    const bottomMargin = 20; // Ajuste ici : 5, 30, 50, etc.

    fontSettingsWindow.style.left = `calc(50% - ${windowWidth / 2}px)`; // Centre horizontal
    fontSettingsWindow.style.top = `${viewportHeight - windowHeight - bottomMargin}px`; // Position verticale
    fontSettingsWindow.style.bottom = '';
    fontSettingsWindow.style.transform = 'none';

    console.log('Initial Position - Viewport Height:', viewportHeight, 'Window Height:', windowHeight, 'Bottom Margin:', bottomMargin, 'Top:', fontSettingsWindow.style.top);
}

// Ouverture via toggleFontSettings
document.getElementById('toggleFontSettings').addEventListener('click', function () {
    const sideMenu = document.getElementById('sideMenu');
    console.log('Opening font settings window');
    fontSettingsWindow.classList.remove('hidden');
    setInitialPosition(); // Ajoute ici pour positionner
    sideMenu.classList.remove('open');
    setTimeout(() => sideMenu.classList.add('hidden'), 300);
    updateWrapDependingOnMode();
});

// Fermeture
if (closeFontSettingsButton) {
    closeFontSettingsButton.addEventListener('click', function () {
        console.log('Closing font settings window');
        fontSettingsWindow.classList.add('hidden');
    });
}

// Déplacement
fontSettingsHeader.addEventListener('mousedown', (e) => {
    e.preventDefault();
    isDragging = true;
    const rect = fontSettingsWindow.getBoundingClientRect();
    currentX = rect.left;
    currentY = rect.top;
    initialX = e.clientX - currentX;
    initialY = e.clientY - currentY;
    fontSettingsWindow.style.cursor = 'grabbing';
});

document.addEventListener('mousemove', (e) => {
    if (isDragging) {
        e.preventDefault();
        currentX = e.clientX - initialX;
        currentY = e.clientY - initialY;

        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        const rect = fontSettingsWindow.getBoundingClientRect();

        currentX = Math.max(0, Math.min(currentX, windowWidth - rect.width));
        currentY = Math.max(0, Math.min(currentY, windowHeight - rect.height));

        fontSettingsWindow.style.left = `${currentX}px`;
        fontSettingsWindow.style.top = `${currentY}px`;
    }
});

document.addEventListener('mouseup', () => {
    if (isDragging) {
        isDragging = false;
        fontSettingsWindow.style.cursor = 'default';
    }
});

// Autres écouteurs existants
document.getElementById('fontSelect').addEventListener('change', function () {
    const selectedFont = this.value;
    randomScreen.style.fontFamily = selectedFont;
    creativeScreen.style.fontFamily = selectedFont;
    updateWrapDependingOnMode();
});

document.getElementById('fontSizeSlider').addEventListener('input', function () {
    const size = this.value;
    randomScreen.style.fontSize = `${size}px`;
    creativeScreen.style.fontSize = `${size}px`;
    document.getElementById('fontSizeValue').textContent = size;
    updateWrapDependingOnMode();
});

lengthSlider.addEventListener('input', function () {
    updateWrapDependingOnMode();
});

/*
creativeScreen.addEventListener('input', function(e) {
    if (isImporting) return;
    updateTextWrap();
});
*/














(function () {
    window.translations = null;
    window.currentLang = 'fr';
    let currentPhrase = ''; // Stocker la phrase actuelle pour phraseBox
    let currentGeneratorText = ''; // Stocker le texte actuel pour generatorBox
    let currentWord = ''; // Stocker le mot actuel pour wordBox
    let hasGeneratedWord = false; // Suivre si un mot a été généré
    let hasGeneratedPhrase = false; // Suivre si une phrase a été générée

    // Traductions globales
    const fallbackTranslations = {
        fr: {
            mode_random: 'Aléatoire',
            mode_creative: 'Créatif',
            title: 'Générateur de mots de passe',
            new: 'Nouveau',
            reset: 'Réinitialiser',
            export: 'Exporter',
            display_theme: 'Affichage & Thème',
            change_theme: 'Changer de thème',
            adjust_text: 'Ajuster le texte',
            dark_theme: 'Thème sombre',
            light_theme: 'Thème clair',
            creative_placeholder: 'Entrer une base...',
            anagram_button: 'Anagramme',
            reverse_button: 'Inverser',
            copy_button: 'Copier',
            copied_button: 'Copié',
            copy_notification: 'Mot de passe copié !',
            empty_screen_alert: "L’écran est vide. Veuillez entrer ou générer un contenu à copier.",
            no_next_content: "Pas de contenu suivant",
            no_prev_content: "Pas de contenu précédent",
            strength_empty: "***",
            strength_very_weak: "Très faible",
            strength_weak: "Faible",
            strength_medium: "Moyen",
            strength_good: "Bon",
            strength_strong: "Fort",
            strength_very_strong: "Très fort",
            reset_button: "Réinitialiser",
            importer_alea: "Importer Aléa",
            secure_word: "Sécuriser",
            all_copy_button: "Tous Copier",
            export_button: "Exporter",
            character_count: "Nombre de caractères",
            font_label: "Police",
            size_label: "Taille",
            avoid_duplicates: "Éviter les doublons",
            exclude_similar_chars: "Exclure caractères similaires",
            lowercase: "Minuscules",
            uppercase: "Majuscules",
            digits: "Chiffres",
            special_chars: "Caractères",
            define_special_chars: "Définir les caractères spéciaux",
            toggle_all_chars: "Tout sélectionner / Désélectionner",
            capitalize_first: "Lettre majuscule",
            all_uppercase: "Tout en majuscules",
            all_lowercase: "Tout en minuscules",
            no_word_selected: "Aucun mot sélectionné pour l’instant",
            no_word_generated: "Aucun mot généré.",
            no_phrase_generated: "Aucune phrase générée.",
            word_box: "Boîte à Mots Aléatoire",
            generator_box: "Générateur de Mots",
            phrase_box: "Générateur de Phrases",
            insert: "Insérer",
            insert_left: "Gauche",
            insert_right: "Droite",
            insert_middle: "Milieu",
            insert_both: "Deux bouts",
            separator: "Séparateur",
            choose_separator: "Choisissez un séparateur",
            validate: "Valider",
            avoid_duplicates_creative: "Éviter les doublons",
            exclude_similar_chars_creative: "Exclure caractères similaires",
            anagram_button_generated: "Anagramme",
            randomize_word: "Aléatoire",
            define_special_chars_creative: "Définir les caractères spéciaux",
            lowercase_creative: "Minuscules",
            uppercase_creative: "Majuscules",
            digits_creative: "Chiffres",
            special_chars_creative: "Caractères",
            characters_count: "{count} caractères",
            toggle_all_chars_creative: "Tout sélectionner / Désélectionner",
            language_label: "Langue :",
            prefix_label: "Préfixe (optionnel) :",
            length_label: "Longueur (3-20) :",
            prefix_placeholder: "ex. ab",
            length_placeholder: "Long. ?",
            previous_word: "Précédent",
            generate_words: "Générer",
            next_word: "Suivant",
            lang_fr: "Français",
            lang_en: "Anglais",
            lang_es: "Espagnol",
            lang_de: "Allemand",
            lang_it: "Italien",
            word_count_label: "Nombre de mots (3-10) :",
            word_count_placeholder: "Facultatif",
            use_special_chars: "Avec caractères spéciaux",
            previous_phrase: "Précédent",
            generate_phrase: "Générer une phrase",
            next_phrase: "Suivant",
            lang_mix: "Mélanger",
            select_special_chars: "Choisir les caractères :",
            return_to_generator: "Retour",
            export_passwords: "Exporter vos mots de passe",
            save_to_file: "Enregistrer",
            export_comments_placeholder: "Ajoutez vos commentaires ici...",
            no_password_memorized: "Aucun mot de passe mémorisé.",
            current_password: "Mot de passe actuel :",
            comments_label: "Commentaires:",
            export_filename: "mots_de_passe.txt"
        },
        en: {
            mode_random: 'Random',
            mode_creative: 'Creative',
            title: 'Password Generator',
            new: 'New',
            reset: 'Reset',
            export: 'Export',
            display_theme: 'Display & Theme',
            change_theme: 'Change Theme',
            adjust_text: 'Adjust Text',
            dark_theme: 'Dark Theme',
            light_theme: 'Light Theme',
            creative_placeholder: 'Enter a base...',
            anagram_button: 'Anagram',
            reverse_button: 'Reverse',
            copy_button: 'Copy',
            copied_button: 'Copied',
            copy_notification: 'Password copied!',
            empty_screen_alert: "The screen is empty. Please enter or generate content to copy.",
            no_next_content: "No next content",
            no_prev_content: "No previous content",
            strength_empty: "***",
            strength_very_weak: "Very weak",
            strength_weak: "Weak",
            strength_medium: "Medium",
            strength_good: "Good",
            strength_strong: "Strong",
            strength_very_strong: "Very strong",
            reset_button: "Reset",
            importer_alea: "Import Random",
            secure_word: "Secure",
            all_copy_button: "Copy All",
            export_button: "Export",
            character_count: "Number of characters",
            font_label: "Font",
            size_label: "Size",
            avoid_duplicates: "Avoid duplicates",
            exclude_similar_chars: "Exclude similar characters",
            lowercase: "Lowercase",
            uppercase: "Uppercase",
            digits: "Digits",
            special_chars: "Special characters",
            define_special_chars: "Define special characters",
            toggle_all_chars: "Select all / Deselect",
            capitalize_first: "Capitalize first letter",
            all_uppercase: "All uppercase",
            all_lowercase: "All lowercase",
            no_word_selected: "No word selected yet",
            no_word_generated: "No word generated.",
            no_phrase_generated: "No phrase generated.",
            word_box: "Random Word Box",
            generator_box: "Word Generator",
            phrase_box: "Phrase Generator",
            insert: "Insert",
            insert_left: "Left",
            insert_right: "Right",
            insert_middle: "Middle",
            insert_both: "Both ends",
            separator: "Separator",
            choose_separator: "Choose a separator",
            validate: "Validate",
            avoid_duplicates_creative: "Avoid duplicates",
            exclude_similar_chars_creative: "Exclude similar characters",
            anagram_button_generated: "Anagram",
            randomize_word: "Random",
            define_special_chars_creative: "Define special characters",
            lowercase_creative: "Lowercase",
            uppercase_creative: "Uppercase",
            digits_creative: "Digits",
            special_chars_creative: "Special characters",
            characters_count: "{count} characters",
            toggle_all_chars_creative: "Select All / Deselect All",
            language_label: "Language:",
            prefix_label: "Prefix (optional):",
            length_label: "Length (3-20):",
            prefix_placeholder: "e.g., ab",
            length_placeholder: "Len. ?",
            previous_word: "Previous",
            generate_words: "Generate",
            next_word: "Next",
            lang_fr: "French",
            lang_en: "English",
            lang_es: "Spanish",
            lang_de: "German",
            lang_it: "Italian",
            word_count_label: "Number of words (3-10):",
            word_count_placeholder: "Optional",
            use_special_chars: "With special characters",
            previous_phrase: "Previous",
            generate_phrase: "Generate a phrase",
            next_phrase: "Next",
            lang_mix: "Mix",
            select_special_chars: "Choose characters:",
            return_to_generator: "Back",
            export_passwords: "Export your passwords",
            save_to_file: "Save",
            export_comments_placeholder: "Add your comments here...",
            no_password_memorized: "No password memorized.",
            current_password: "Current password:",
            comments_label: "Comments:",
            export_filename: "passwords.txt"
        },
        es: {
            mode_random: 'Aleatorio',
            mode_creative: 'Creativo',
            title: 'Generador de contraseñas',
            new: 'Nuevo',
            reset: 'Restablecer',
            export: 'Exportar',
            display_theme: 'Visualización y Tema',
            change_theme: 'Cambiar tema',
            adjust_text: 'Ajustar texto',
            dark_theme: 'Tema oscuro',
            light_theme: 'Tema claro',
            creative_placeholder: 'Introduce una base...',
            anagram_button: 'Anagrama',
            reverse_button: 'Invertir',
            copy_button: 'Copiar',
            copied_button: 'Copiado',
            copy_notification: '¡Contraseña copiada!',
            empty_screen_alert: "La pantalla está vacía. Por favor, introduce o genera contenido para copiar.",
            no_next_content: "No hay contenido siguiente",
            no_prev_content: "No hay contenido anterior",
            strength_empty: "***",
            strength_very_weak: "Muy débil",
            strength_weak: "Débil",
            strength_medium: "Medio",
            strength_good: "Bueno",
            strength_strong: "Fuerte",
            strength_very_strong: "Muy fuerte",
            reset_button: "Restablecer",
            importer_alea: "Importar Aleatorio",
            secure_word: "Asegurar",
            all_copy_button: "Copiar Todo",
            export_button: "Exportar",
            character_count: "Número de caracteres",
            font_label: "Fuente",
            size_label: "Tamaño",
            avoid_duplicates: "Evitar duplicados",
            exclude_similar_chars: "Excluir caracteres similares",
            lowercase: "Minúsculas",
            uppercase: "Mayúsculas",
            digits: "Dígitos",
            special_chars: "Caracteres especiales",
            define_special_chars: "Definir caracteres especiales",
            toggle_all_chars: "Seleccionar todo / Deseleccionar",
            capitalize_first: "Primera letra en mayúscula",
            all_uppercase: "Todo en mayúsculas",
            all_lowercase: "Todo en minúsculas",
            no_word_selected: "Ninguna palabra seleccionada por ahora",
            no_word_generated: "Ninguna palabra generada.",
            no_phrase_generated: "Ninguna frase generada.",
            word_box: "Caja de Palabras Aleatorias",
            generator_box: "Generador de Palabras",
            phrase_box: "Generador de Frases",
            insert: "Insertar",
            insert_left: "Izquierda",
            insert_right: "Derecha",
            insert_middle: "Medio",
            insert_both: "Ambos extremos",
            separator: "Separador",
            choose_separator: "Choisissez un séparateur",
            validate: "Validar",
            avoid_duplicates_creative: "Evitar duplicados",
            exclude_similar_chars_creative: "Excluir caracteres similares",
            anagram_button_generated: "Anagrama",
            randomize_word: "Aleatorio",
            define_special_chars_creative: "Definir caracteres especiales",
            lowercase_creative: "Minúsculas",
            uppercase_creative: "Mayúsculas",
            digits_creative: "Dígitos",
            special_chars_creative: "Caracteres especiales",
            characters_count: "{count} caracteres",
            toggle_all_chars_creative: "Seleccionar Todo / Deseleccionar Todo",
            language_label: "Idioma:",
            prefix_label: "Prefijo (opcional):",
            length_label: "Longitud (3-20):",
            prefix_placeholder: "ej., ab",
            length_placeholder: "¿Long. ?",
            previous_word: "Anterior",
            generate_words: "Generar",
            next_word: "Siguiente",
            lang_fr: "Francés",
            lang_en: "Inglés",
            lang_es: "Español",
            lang_de: "Alemán",
            lang_it: "Italiano",
            word_count_label: "Número de palabras (3-10):",
            word_count_placeholder: "Opcional",
            use_special_chars: "Con caracteres especiales",
            previous_phrase: "Anterior",
            generate_phrase: "Generar una frase",
            next_phrase: "Siguiente",
            lang_mix: "Mezclar",
            select_special_chars: "Elegir caracteres:",
            return_to_generator: "Volver",
            export_passwords: "Exportar tus contraseñas",
            save_to_file: "Guardar",
            export_comments_placeholder: "Añade tus comentarios aquí...",
            no_password_memorized: "Ninguna contraseña memorizada.",
            current_password: "Contraseña actual:",
            comments_label: "Comentarios:",
            export_filename: "contraseñas.txt"
        },
        de: {
            mode_random: 'Zufällig',
            mode_creative: 'Kreativ',
            title: 'Passwort-Generator',
            new: 'Neu',
            reset: 'Zurücksetzen',
            export: 'Exportieren',
            display_theme: 'Anzeige & Thema',
            change_theme: 'Thema ändern',
            adjust_text: 'Text anpassen',
            dark_theme: 'Dunkles Thema',
            light_theme: 'Helles Thema',
            creative_placeholder: 'Eine Basis eingeben...',
            anagram_button: 'Anagramm',
            reverse_button: 'Umkehren',
            copy_button: 'Kopieren',
            copied_button: 'Kopiert',
            copy_notification: 'Passwort kopiert!',
            empty_screen_alert: "Der Bildschirm ist leer. Bitte geben Sie Inhalte ein oder generieren Sie Inhalte zum Kopieren.",
            no_next_content: "Kein nächster Inhalt",
            no_prev_content: "Kein vorheriger Inhalt",
            strength_empty: "***",
            strength_very_weak: "Sehr schwach",
            strength_weak: "Schwach",
            strength_medium: "Mittel",
            strength_good: "Gut",
            strength_strong: "Stark",
            strength_very_strong: "Sehr stark",
            reset_button: "Zurücksetzen",
            importer_alea: "Zufällig Importieren",
            secure_word: "Sichern",
            all_copy_button: "Alles Kopieren",
            export_button: "Exportieren",
            character_count: "Anzahl der Zeichen",
            font_label: "Schriftart",
            size_label: "Größe",
            avoid_duplicates: "Duplikate vermeiden",
            exclude_similar_chars: "Ähnliche Zeichen ausschließen",
            lowercase: "Kleinbuchstaben",
            uppercase: "Großbuchstaben",
            digits: "Ziffern",
            special_chars: "Sonderzeichen",
            define_special_chars: "Sonderzeichen definieren",
            toggle_all_chars: "Alle auswählen / Abwählen",
            capitalize_first: "Erster Buchstabe groß",
            all_uppercase: "Alles groß",
            all_lowercase: "Alles klein",
            no_word_selected: "Noch kein Wort ausgewählt",
            no_word_generated: "Kein Wort generiert.",
            no_phrase_generated: "Keine Phrase generiert.",
            word_box: "Zufallswortbox",
            generator_box: "Wortgenerator",
            phrase_box: "Phrasengenerator",
            insert: "Einfügen",
            insert_left: "Links",
            insert_right: "Rechts",
            insert_middle: "Mitte",
            insert_both: "Beide Enden",
            separator: "Trennzeichen",
            choose_separator: "Wähle ein Trennzeichen",
            validate: "Bestätigen",
            avoid_duplicates_creative: "Duplikate vermeiden",
            exclude_similar_chars_creative: "Ähnliche Zeichen ausschließen",
            anagram_button_generated: "Anagramm",
            randomize_word: "Zufällig",
            define_special_chars_creative: "Sonderzeichen definieren",
            lowercase_creative: "Kleinbuchstaben",
            uppercase_creative: "Großbuchstaben",
            digits_creative: "Ziffern",
            special_chars_creative: "Sonderzeichen",
            characters_count: "{count} Zeichen",
            toggle_all_chars_creative: "Alle auswählen / Abwählen",
            language_label: "Sprache:",
            prefix_label: "Präfix (optional):",
            length_label: "Länge (3-20):",
            prefix_placeholder: "z.B., ab",
            length_placeholder: "Länge ?",
            previous_word: "Vorheriger",
            generate_words: "Generieren",
            next_word: "Nächster",
            lang_fr: "Französisch",
            lang_en: "Englisch",
            lang_de: "Deutsch",
            lang_es: "Spanisch",
            lang_it: "Italienisch",
            word_count_label: "Anzahl der Wörter (3-10):",
            word_count_placeholder: "Optional",
            use_special_chars: "Mit Sonderzeichen",
            previous_phrase: "Vorheriger",
            generate_phrase: "Eine Phrase generieren",
            next_phrase: "Nächster",
            lang_mix: "Mischen",
            select_special_chars: "Zeichen auswählen:",
            return_to_generator: "Zurück",
            export_passwords: "Ihre Passwörter exportieren",
            save_to_file: "Speichern",
            export_comments_placeholder: "Fügen Sie Ihre Kommentare hier hinzu...",
            no_password_memorized: "Kein Passwort gespeichert.",
            current_password: "Aktuelles Passwort:",
            comments_label: "Kommentare:",
            export_filename: "passwoerter.txt"
        },
        it: {
            mode_random: 'Casuale',
            mode_creative: 'Creativo',
            title: 'Generatore di password',
            new: 'Nuovo',
            reset: 'Ripristina',
            export: 'Esporta',
            display_theme: 'Visualizzazione e Tema',
            change_theme: 'Cambia tema',
            adjust_text: 'Regola testo',
            dark_theme: 'Tema scuro',
            light_theme: 'Tema chiaro',
            creative_placeholder: 'Inserisci una base...',
            anagram_button: 'Anagramma',
            reverse_button: 'Inverti',
            copy_button: 'Copia',
            copied_button: 'Copiato',
            copy_notification: 'Password copiata!',
            empty_screen_alert: "Lo schermo è vuoto. Inserisci o genera un contenuto da copiare.",
            no_next_content: "Nessun contenuto successivo",
            no_prev_content: "Nessun contenuto precedente",
            strength_empty: "***",
            strength_very_weak: "Molto debole",
            strength_weak: "Debole",
            strength_medium: "Medio",
            strength_good: "Buono",
            strength_strong: "Forte",
            strength_very_strong: "Molto forte",
            reset_button: "Ripristina",
            importer_alea: "Importa Casuale",
            secure_word: "Sicuro",
            all_copy_button: "Copia Tutto",
            export_button: "Esporta",
            character_count: "Numero di caratteri",
            font_label: "Carattere",
            size_label: "Dimensione",
            avoid_duplicates: "Evitare duplicati",
            exclude_similar_chars: "Escludere caratteri simili",
            lowercase: "Minuscolo",
            uppercase: "Maiuscolo",
            digits: "Cifre",
            special_chars: "Caratteri speciali",
            define_special_chars: "Definire caratteri speciali",
            toggle_all_chars: "Seleziona tutto / Deseleziona",
            capitalize_first: "Prima lettera maiuscola",
            all_uppercase: "Tutto maiuscolo",
            all_lowercase: "Tutto minuscolo",
            no_word_selected: "Nessuna parola selezionata per ora",
            no_word_generated: "Nessuna parola generata.",
            no_phrase_generated: "Nessuna frase generata.",
            word_box: "Scatola di Parole Casuali",
            generator_box: "Generatore di Parole",
            phrase_box: "Generatore di Frasi",
            insert: "Inserisci",
            insert_left: "Sinistra",
            insert_right: "Destra",
            insert_middle: "Centro",
            insert_both: "Entrambi i lati",
            separator: "Separatore",
            choose_separator: "Scegli un separatore",
            validate: "Convalida",
            avoid_duplicates_creative: "Evitare duplicati",
            exclude_similar_chars_creative: "Escludere caratteri simili",
            anagram_button_generated: "Anagramma",
            randomize_word: "Casuale",
            define_special_chars_creative: "Definire caratteri speciali",
            lowercase_creative: "Minuscolo",
            uppercase_creative: "Maiuscolo",
            digits_creative: "Cifre",
            special_chars_creative: "Caratteri speciali",
            characters_count: "{count} caratteri",
            toggle_all_chars_creative: "Seleziona Tutto / Deseleziona Tutto",
            language_label: "Lingua:",
            prefix_label: "Prefisso (opzionale):",
            length_label: "Lunghezza (3-20):",
            prefix_placeholder: "es., ab",
            length_placeholder: "Lung. ?",
            previous_word: "Precedente",
            generate_words: "Genera",
            next_word: "Successivo",
            lang_fr: "Francese",
            lang_en: "Inglese",
            lang_es: "Spagnolo",
            lang_de: "Tedesco",
            lang_it: "Italiano",
            word_count_label: "Numero di parole (3-10):",
            word_count_placeholder: "Opzionale",
            use_special_chars: "Con caratteri speciali",
            previous_phrase: "Precedente",
            generate_phrase: "Genera una frase",
            next_phrase: "Successivo",
            lang_mix: "Mescolare",
            select_special_chars: "Scegli i caratteri:",
            return_to_generator: "Indietro",
            export_passwords: "Esporta le tue password",
            save_to_file: "Salva",
            export_comments_placeholder: "Aggiungi i tuoi commenti qui...",
            no_password_memorized: "Nessuna password memorizzata.",
            current_password: "Password attuale:",
            comments_label: "Commenti:",
            export_filename: "password.txt"
        },
        pt: {
            mode_random: "Aleatório",
            mode_creative: "Criativo",
            title: "Gerador de palavras-passe",
            new: "Novo",
            reset: "Reiniciar",
            export: "Exportar",
            display_theme: "Exibição e Tema",
            change_theme: "Mudar tema",
            adjust_text: "Ajustar texto",
            dark_theme: "Tema escuro",
            light_theme: "Tema claro",
            creative_placeholder: "Insira uma base...",
            anagram_button: "Anagrama",
            reverse_button: "Inverter",
            copy_button: "Copiar",
            copied_button: "Copiado",
            copy_notification: "Palavra-passe copiada!",
            empty_screen_alert: "O ecrã está vazio. Por favor, insira ou gere conteúdo para copiar.",
            no_next_content: "Nenhum conteúdo seguinte",
            no_prev_content: "Nenhum conteúdo anterior",
            strength_empty: "***",
            strength_very_weak: "Muito fraco",
            strength_weak: "Fraco",
            strength_medium: "Médio",
            strength_good: "Bom",
            strength_strong: "Forte",
            strength_very_strong: "Muito forte",
            reset_button: "Reiniciar",
            importer_alea: "Importar Aleatório",
            secure_word: "Proteger",
            all_copy_button: "Copiar Tudo",
            export_button: "Exportar",
            character_count: "Número de caracteres",
            font_label: "Fonte",
            size_label: "Tamanho",
            avoid_duplicates: "Evitar duplicados",
            exclude_similar_chars: "Excluir caracteres semelhantes",
            lowercase: "Minúsculas",
            uppercase: "Maiúsculas",
            digits: "Dígitos",
            special_chars: "Caracteres",
            define_special_chars: "Definir caracteres especiais",
            toggle_all_chars: "Selecionar / Desselecionar tudo",
            capitalize_first: "Letra maiúscula",
            all_uppercase: "Tudo em maiúsculas",
            all_lowercase: "Tudo em minúsculas",
            no_word_selected: "Nenhuma palavra selecionada por enquanto",
            no_word_generated: "Nenhuma palavra gerada.",
            no_phrase_generated: "Nenhuma frase gerada.",
            word_box: "Caixa de Palavras Aleatórias",
            generator_box: "Gerador de Palavras",
            phrase_box: "Gerador de Frases",
            insert: "Inserir",
            insert_left: "Esquerda",
            insert_right: "Direita",
            insert_middle: "Meio",
            insert_both: "Ambos os lados",
            separator: "Separador",
            choose_separator: "Escolha um separador",
            validate: "Validar",
            avoid_duplicates_creative: "Evitar duplicados",
            exclude_similar_chars_creative: "Excluir caracteres semelhantes",
            anagram_button_generated: "Anagrama",
            randomize_word: "Aleatório",
            define_special_chars_creative: "Definir caracteres especiais",
            lowercase_creative: "Minúsculas",
            uppercase_creative: "Maiúsculas",
            digits_creative: "Dígitos",
            special_chars_creative: "Caracteres",
            characters_count: "{count} caracteres",
            toggle_all_chars_creative: "Selecionar / Desselecionar tudo",
            language_label: "Idioma:",
            prefix_label: "Prefixo (opcional):",
            length_label: "Comprimento (3-20):",
            prefix_placeholder: "ex. ab",
            length_placeholder: "Comp. ?",
            previous_word: "Anterior",
            generate_words: "Gerar",
            next_word: "Seguinte",
            lang_fr: "Francês",
            lang_en: "Inglês",
            lang_es: "Espanhol",
            lang_de: "Alemão",
            lang_it: "Italiano",
            word_count_label: "Número de palavras (3-10):",
            word_count_placeholder: "Opcional",
            use_special_chars: "Com caracteres especiais",
            previous_phrase: "Anterior",
            generate_phrase: "Gerar uma frase",
            next_phrase: "Seguinte",
            lang_mix: "Misturar",
            select_special_chars: "Escolher caracteres:",
            return_to_generator: "Voltar",
            export_passwords: "Exportar as suas palavras-passe",
            save_to_file: "Guardar",
            export_comments_placeholder: "Adicione os seus comentários aqui...",
            no_password_memorized: "Nenhuma palavra-passe memorizada.",
            current_password: "Palavra-passe atual:",
            comments_label: "Comentários:",
            export_filename: "palavras_passe.txt"
        }
    };


    // Gestion du thème
    const toggleTheme = document.getElementById('toggleTheme');

    function updateThemeButton() {
        if (!toggleTheme) return;
        const isDarkTheme = document.body.classList.contains('dark-theme');
        const key = isDarkTheme ? 'light_theme' : 'dark_theme';
        const source = window.translations && window.translations[window.currentLang] ? window.translations[window.currentLang] : fallbackTranslations[window.currentLang];
        const translation = source[key] || (isDarkTheme ? 'Thème clair' : 'Thème sombre');
        toggleTheme.textContent = translation;
        console.log(`ℹ️ Bouton thème mis à jour : ${translation}`);
    }

    function toggleThemeMode() {
        if (!toggleTheme) return;
        document.body.classList.toggle('dark-theme');
        updateThemeButton();
    }

    if (toggleTheme) {
        toggleTheme.textContent = 'Thème sombre';
        toggleTheme.addEventListener('click', toggleThemeMode);
    } else {
        console.error('Erreur : #toggleTheme non trouvé');
    }



    // Traduire une phrase (uniquement pour phrases dynamiques non générées)
    function translatePhrase(phrase, targetLang) {
        console.log(`ℹ️ Traduction de "${phrase}" vers ${targetLang}`);
        // Vérifier si la phrase est une phrase par défaut dans n'importe quelle langue
        const source = window.translations && window.translations[targetLang] ? window.translations[targetLang] : fallbackTranslations[targetLang];
        const langs = Object.keys(fallbackTranslations);
        for (const lang of langs) {
            if (phrase === fallbackTranslations[lang].no_word_generated && source.no_word_generated) {
                console.log(`ℹ️ Traduction locale utilisée : ${source.no_word_generated}`);
                return Promise.resolve(source.no_word_generated);
            }
            if (phrase === fallbackTranslations[lang].no_phrase_generated && source.no_phrase_generated) {
                console.log(`ℹ️ Traduction locale utilisée : ${source.no_phrase_generated}`);
                return Promise.resolve(source.no_phrase_generated);
            }
        }
        // Pour les phrases dynamiques non générées
        return fetch('/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: phrase, targetLang: targetLang })
        })
            .then(response => {
                if (!response.ok) {
                    throw new Error('Erreur de traduction');
                }
                return response.json();
            })
            .then(data => {
                console.log(`ℹ️ Phrase traduite : ${data.translatedText}`);
                return data.translatedText;
            })
            .catch(error => {
                console.error('Erreur lors de la traduction :', error);
                return phrase; // Retourner la phrase originale en cas d'erreur
            });
    }

    function updateLanguage(lang, useFallback = false) {
        console.log('ℹ️ Mise à jour langue :', lang, 'Fallback :', useFallback);
        const prevLang = window.currentLang;
        window.currentLang = lang;
        const source = useFallback || !window.translations || !window.translations[lang] ? fallbackTranslations : window.translations;

        document.querySelectorAll('[data-i18n]').forEach(element => {
            const key = element.getAttribute('data-i18n');
            if (source[lang][key]) {
                const args = element.getAttribute('data-i18n-args');
                let translation = source[lang][key];
                if (args) {
                    try {
                        const parsedArgs = JSON.parse(args);
                        translation = translation.replace(/\{(\w+)\}/g, (match, argName) => parsedArgs[argName] || match);
                    } catch (e) {
                        console.warn(`⚠️ Erreur lors du parsing de data-i18n-args pour ${key}:`, e);
                    }
                }
                const hasInput = element.querySelector('input');
                const hasSpan = element.querySelector('span');
                if (hasInput) {
                    const childNodes = Array.from(element.childNodes);
                    const textNodes = childNodes.filter(node => node.nodeType === Node.TEXT_NODE);
                    textNodes.forEach(node => node.textContent = '');
                    const inputNode = element.querySelector('input');
                    if (inputNode && inputNode.nextSibling) {
                        inputNode.nextSibling.textContent = translation;
                    } else {
                        element.appendChild(document.createTextNode(translation));
                    }
                    console.log(`ℹ️ Traduction appliquée : ${key} → ${translation}`);
                } else if (hasSpan) {
                    const childNodes = Array.from(element.childNodes);
                    const firstTextNode = childNodes.find(node => node.nodeType === Node.TEXT_NODE);
                    if (firstTextNode) {
                        firstTextNode.textContent = translation + (key === 'size_label' || key === 'font_label' || key === 'character_count' ? ' : ' : '');
                        console.log(`ℹ️ Traduction appliquée : ${key} → ${translation}`);
                    }
                } else {
                    element.textContent = translation;
                    console.log(`ℹ️ Traduction appliquée : ${key} → ${translation}`);
                }
            } else {
                console.warn(`⚠️ Clé de traduction manquante : ${key} pour langue ${lang}`);
            }
        });

        document.querySelectorAll('option[data-i18n]').forEach(option => {
            const key = option.getAttribute('data-i18n');
            if (source[lang][key]) {
                option.textContent = source[lang][key];
                console.log(`ℹ️ Traduction appliquée à option : ${key} → ${source[lang][key]}`);
            } else {
                console.warn(`⚠️ Clé de traduction manquante pour option : ${key} pour langue ${lang}`);
            }
        });

        document.querySelectorAll('[data-i18n-title]').forEach(element => {
            const key = element.getAttribute('data-i18n-title');
            if (source[lang][key]) {
                element.setAttribute('title', source[lang][key]);
                console.log(`ℹ️ Tooltip traduit : ${key} → ${source[lang][key]}`);
            }
        });

        document.querySelectorAll('input[data-i18n-placeholder], textarea[data-i18n-placeholder]').forEach(element => {
            const key = element.getAttribute('data-i18n-placeholder');
            const validKeys = Object.keys(source[lang]);
            if (validKeys.includes(key)) {
                element.placeholder = source[lang][key];
                console.log(`ℹ️ Placeholder traduit pour ${element.id || element.tagName}: ${key} → ${source[lang][key]}`);
            } else {
                console.warn(`⚠️ Clé de traduction invalide pour placeholder : ${key} pour langue ${lang}. Ignoré.`);
            }
        });



        // Forcer la mise à jour du placeholder pour creativeScreen si vide
        const creativeScreen = document.getElementById('creativeScreen');
        if (creativeScreen && !creativeScreen.textContent.trim()) {
            creativeScreen.setAttribute('data-i18n-placeholder', source[lang].creative_placeholder);
            creativeScreen.focus();
            console.log(`ℹ️ Placeholder forcé pour creativeScreen après changement de langue : ${source[lang].creative_placeholder}`);
        }

        if (creativeScreen && creativeScreen.style.display === 'block' && !creativeScreen.textContent.trim()) {
            creativeScreen.focus();
            console.log('ℹ️ Focus restauré sur #creativeScreen');
        }

        const randomScreen = document.getElementById('randomScreen');
        if (randomScreen) {
            const randomPassword = randomScreen.textContent.trim();
            evaluatePasswordStrength(randomPassword, 'random');
            console.log('ℹ️ Force du mot de passe aléatoire mise à jour après changement de langue');
        }
        if (creativeScreen) {
            const creativePassword = creativeScreen.textContent.trim();
            evaluatePasswordStrength(creativePassword, 'creative');
            console.log('ℹ️ Force du mot de passe créatif mise à jour après changement de langue');
        }

        // Vérifier si creativeScreen affiche un placeholder et rafraîchir
        if (creativeScreen && typeof updateCreativeDisplay === 'function') {
            const currentText = creativeScreen.textContent.trim();
            const prevSource = prevLang && (useFallback || !window.translations || !window.translations[prevLang]) ? fallbackTranslations[prevLang] : window.translations[prevLang];
            console.log(`ℹ️ Vérification placeholder: currentText="${currentText}", prevLang=${prevLang}, prevSource.no_prev_content="${prevSource?.no_prev_content}", prevSource.no_next_content="${prevSource?.no_next_content}"`);
            if (prevSource && (currentText === prevSource.no_next_content || currentText === prevSource.no_prev_content)) {
                updateCreativeDisplay();
                console.log(`ℹ️ Placeholder détecté dans creativeScreen ("${currentText}"), rafraîchissement avec updateCreativeDisplay`);
            }
        }

        // Synchroniser #lang-select avec #languageSelect
        const langSelect = document.getElementById('lang-select');
        if (langSelect) {
            langSelect.value = lang;
            console.log(`ℹ️ #lang-select synchronisé à : ${lang}`);
        } else {
            console.error('Erreur : #lang-select non trouvé');
        }

        // Synchroniser #phrase-lang-select avec #languageSelect
        const phraseLangSelect = document.getElementById('phrase-lang-select');
        if (phraseLangSelect) {
            phraseLangSelect.value = lang;
            console.log(`ℹ️ #phrase-lang-select synchronisé à : ${lang}`);
        } else {
            console.error('Erreur : #phrase-lang-select non trouvé');
        }

        // Gérer la traduction/régénération pour #phraseBox et #generatorBox
        const boxTypeSelect = document.getElementById('boxType');
        const selectedWordDisplay = document.getElementById('selectedWordDisplay');
        console.log('ℹ️ Vérification régénération : boxTypeSelect=', !!boxTypeSelect, 'value=', boxTypeSelect?.value);
        if (boxTypeSelect && selectedWordDisplay) {
            const selectedBox = boxTypeSelect.value;
            console.log('ℹ️ Mode actif :', selectedBox);
            if (selectedBox === 'phraseBox') {
                if (hasGeneratedPhrase) {
                    console.log('ℹ️ Régénération de phrase pour phraseBox dans langue :', lang);
                    phraseLangSelect.value = lang; // Synchroniser avant génération
                    const generatePhraseButton = document.getElementById('generatePhrase');
                    if (generatePhraseButton) {
                        generatePhraseButton.click();
                        console.log('ℹ️ Clic simulé sur #generatePhrase');
                    } else {
                        console.error('Erreur : #generatePhrase non trouvé');
                    }
                } else if (currentPhrase) {
                    console.log('ℹ️ Traduction de la phrase actuelle pour phraseBox dans langue :', lang);
                    translatePhrase(currentPhrase, lang).then(translatedPhrase => {
                        selectedWordDisplay.textContent = translatedPhrase;
                        currentPhrase = translatedPhrase;
                        console.log(`ℹ️ Phrase mise à jour dans #selectedWordDisplay : ${translatedPhrase}`);
                    });
                } else {
                    console.log('ℹ️ Pas de phrase générée, traduction par défaut pour phraseBox');
                    selectedWordDisplay.textContent = source[lang].no_phrase_generated;
                    currentPhrase = source[lang].no_phrase_generated;
                    console.log(`ℹ️ Phrase par défaut affichée : ${currentPhrase}`);
                }
            } else if (selectedBox === 'generatorBox') {
                if (hasGeneratedWord) {
                    console.log('ℹ️ Régénération de mot pour generatorBox dans langue :', lang);
                    langSelect.value = lang; // Synchroniser avant génération
                    const generateWordsButton = document.getElementById('generateWords');
                    if (generateWordsButton) {
                        generateWordsButton.click();
                        console.log('ℹ️ Clic simulé sur #generateWords');
                    } else {
                        console.error('Erreur : #generateWords non trouvé');
                    }
                } else if (currentGeneratorText) {
                    console.log('ℹ️ Traduction du texte actuel pour generatorBox dans langue :', lang);
                    translatePhrase(currentGeneratorText, lang).then(translatedText => {
                        selectedWordDisplay.textContent = translatedText;
                        currentGeneratorText = translatedText;
                        console.log(`ℹ️ Texte mis à jour dans #selectedWordDisplay pour generatorBox : ${translatedText}`);
                    });
                } else {
                    console.log('ℹ️ Pas de mot généré, traduction par défaut pour generatorBox');
                    selectedWordDisplay.textContent = source[lang].no_word_generated;
                    currentGeneratorText = source[lang].no_word_generated;
                    console.log(`ℹ️ Mot par défaut affiché : ${currentGeneratorText}`);
                }
            } else if (selectedBox === 'wordBox' && currentWord) {
                console.log('ℹ️ Restauration mot pour wordBox dans langue :', lang);
                selectedWordDisplay.textContent = currentWord;
                console.log(`ℹ️ Mot affiché dans #selectedWordDisplay pour wordBox : ${currentWord}`);
            } else {
                console.log('ℹ️ Pas de régénération : mode non défini ou aucun contenu à traduire');
            }
        } else {
            console.error('Erreur : boxTypeSelect ou selectedWordDisplay non trouvé');
        }

        updateThemeButton();

    }

    window.updateLanguage = updateLanguage;

    console.log('ℹ️ Initialisation i18n');
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            console.log('ℹ️ DOMContentLoaded déclenché');
            const urlParams = new URLSearchParams(window.location.search);
            let lang = urlParams.get('lang');
            if (!lang) {
                // Détecter la langue du navigateur
                const browserLang = navigator.language.split('-')[0]; // Ex. : 'de' pour 'de-DE'
                lang = ['fr', 'en', 'es', 'de', 'it', 'pt'].includes(browserLang) ? browserLang : 'fr';
            }
            window.initialLang = lang; // Stocker la langue initiale
            console.log(`ℹ️ Langue initiale définie : ${lang}`);

            const languageSelect = document.getElementById('languageSelect');
            if (languageSelect) {
                languageSelect.value = lang;
                updateLanguage(lang);
            } else {
                console.error('Erreur : #languageSelect non trouvé');
            }

            initializeCreativeMode();
            loadTranslations(window.initialLang); // Passer la langue initiale

            if (languageSelect) {
                languageSelect.addEventListener('change', (e) => {
                    const selectedLanguage = e.target.value;
                    console.log(`ℹ️ Langue sélectionnée : ${selectedLanguage}`);
                    updateLanguage(selectedLanguage);
                });
            }

            // Écouter les clics sur #generatePhrase pour mettre à jour currentPhrase
            const generatePhraseButton = document.getElementById('generatePhrase');
            if (generatePhraseButton) {
                generatePhraseButton.addEventListener('click', () => {
                    setTimeout(() => {
                        const selectedWordDisplay = document.getElementById('selectedWordDisplay');
                        if (selectedWordDisplay) {
                            currentPhrase = selectedWordDisplay.textContent;
                            hasGeneratedPhrase = true;
                            console.log(`ℹ️ currentPhrase mise à jour : ${currentPhrase}`);
                            console.log(`ℹ️ hasGeneratedPhrase défini à : ${hasGeneratedPhrase}`);
                        }
                    }, 100);
                });
            }
            // Écouter les clics sur #generateWords pour mettre à jour currentGeneratorText
            const generateWordsButton = document.getElementById('generateWords');
            if (generateWordsButton) {
                generateWordsButton.addEventListener('click', () => {
                    setTimeout(() => {
                        const selectedWordDisplay = document.getElementById('selectedWordDisplay');
                        if (selectedWordDisplay) {
                            currentGeneratorText = selectedWordDisplay.textContent;
                            hasGeneratedWord = true;
                            console.log(`ℹ️ currentGeneratorText mise à jour : ${currentGeneratorText}`);
                            console.log(`ℹ️ hasGeneratedWord défini à : ${hasGeneratedWord}`);
                        }
                    }, 100);
                });
            }
            // Écouter les changements de #boxType pour mettre à jour currentWord
            const boxTypeSelect = document.getElementById('boxType');
            if (boxTypeSelect) {
                boxTypeSelect.addEventListener('change', () => {
                    if (boxTypeSelect.value === 'wordBox') {
                        setTimeout(() => {
                            const selectedWordDisplay = document.getElementById('selectedWordDisplay');
                            if (selectedWordDisplay && selectedWordDisplay.textContent !== fallbackTranslations[window.currentLang].no_word_selected) {
                                currentWord = selectedWordDisplay.textContent;
                                console.log(`ℹ️ currentWord mise à jour : ${currentWord}`);
                            }
                        }, 100);
                    }
                });
            }
        });
    } else {
        console.log('ℹ️ DOM déjà chargé');
        initializeCreativeMode();
        loadTranslations();
        const languageSelect = document.getElementById('languageSelect');
        if (languageSelect) {
            languageSelect.addEventListener('change', (e) => {
                const selectedLanguage = e.target.value;
                console.log(`ℹ️ Langue sélectionnée : ${selectedLanguage}`);
                updateLanguage(selectedLanguage);
            });
            languageSelect.value = 'fr';
        } else {
            console.error('Erreur : #languageSelect non trouvé');
        }
        // Écouter les clics sur #generatePhrase pour mettre à jour currentPhrase
        const generatePhraseButton = document.getElementById('generatePhrase');
        if (generatePhraseButton) {
            generatePhraseButton.addEventListener('click', () => {
                setTimeout(() => {
                    const selectedWordDisplay = document.getElementById('selectedWordDisplay');
                    if (selectedWordDisplay) {
                        currentPhrase = selectedWordDisplay.textContent;
                        hasGeneratedPhrase = true;
                        console.log(`ℹ️ currentPhrase mise à jour : ${currentPhrase}`);
                        console.log(`ℹ️ hasGeneratedPhrase défini à : ${hasGeneratedPhrase}`);
                    }
                }, 100);
            });
        }
        // Écouter les clics sur #generateWords pour mettre à jour currentGeneratorText
        const generateWordsButton = document.getElementById('generateWords');
        if (generateWordsButton) {
            generateWordsButton.addEventListener('click', () => {
                setTimeout(() => {
                    const selectedWordDisplay = document.getElementById('selectedWordDisplay');
                    if (selectedWordDisplay) {
                        currentGeneratorText = selectedWordDisplay.textContent;
                        hasGeneratedWord = true;
                        console.log(`ℹ️ currentGeneratorText mise à jour : ${currentGeneratorText}`);
                        console.log(`ℹ️ hasGeneratedWord défini à : ${hasGeneratedWord}`);
                    }
                }, 100);
            });
        }
        // Écouter les changements de #boxType pour mettre à jour currentWord
        const boxTypeSelect = document.getElementById('boxType');
        if (boxTypeSelect) {
            boxTypeSelect.addEventListener('change', () => {
                if (boxTypeSelect.value === 'wordBox') {
                    setTimeout(() => {
                        const selectedWordDisplay = document.getElementById('selectedWordDisplay');
                        if (selectedWordDisplay && selectedWordDisplay.textContent !== fallbackTranslations[window.currentLang].no_word_selected) {
                            currentWord = selectedWordDisplay.textContent;
                            console.log(`ℹ️ currentWord mise à jour : ${currentWord}`);
                        }
                    }, 100);
                }
            });
        }
    }

    function waitForBoxType(attempts = 10, delay = 100) {
        function tryInitialize() {
            const boxType = document.getElementById('boxType');
            if (boxType) {
                console.log('ℹ️ #boxType trouvé, initialisation du mode créatif');
                initializeCreativeMode();
            } else if (attempts > 0) {
                console.log(`ℹ️ #boxType non trouvé, nouvelle tentative (${attempts} restantes)`);
                setTimeout(tryInitialize, delay);
            } else {
                console.error('Erreur : #boxType non trouvé après plusieurs tentatives');
            }
        }
        tryInitialize();
    }

    // Variable globale pour empêcher les appels multiples
    window.isCreativeModeInitialized = false;

    // Promesse pour attendre le DOM
    function waitForDOM() {
        return new Promise(resolve => {
            if (document.readyState === 'complete' || document.readyState === 'interactive') {
                console.log('ℹ️ DOM déjà chargé pour waitForDOM');
                resolve();
            } else {
                document.addEventListener('DOMContentLoaded', () => {
                    console.log('ℹ️ DOMContentLoaded déclenché pour waitForDOM');
                    resolve();
                }, { once: true });
            }
        });
    }

    // Promesse pour updateGeneratedWord
    function updateGeneratedWordAsync(firstLoad = false) {
        return new Promise(resolve => {
            console.log('ℹ️ updateGeneratedWordAsync appelé, firstLoad:', firstLoad, 'boxType.value:', document.getElementById('boxType')?.value);
            updateGeneratedWord(firstLoad);
            setTimeout(() => {
                const word = document.getElementById('generatedWordDisplay')?.textContent || '';
                console.log('ℹ️ updateGeneratedWordAsync, generatedWordDisplay.textContent:', word);
                resolve(word);
            }, 100); // Délai pour permettre la mise à jour du DOM
        });
    }

    // Fonction pour initialiser les écouteurs des checkboxes
    function initializeCheckboxListeners() {
        const avoidDuplicatesCheckbox = document.getElementById('creative-exclure-doublons');
        const excludeSimilarCheckbox = document.getElementById('creative-exclure-similaires');

        if (avoidDuplicatesCheckbox) {
            avoidDuplicatesCheckbox.addEventListener('change', () => {
                console.log(`ℹ️ Checkbox #creative-exclure-doublons changé, état: ${avoidDuplicatesCheckbox.checked}`);
                updateGeneratedWord(false); // Régénérer le mot si nécessaire
            });
        } else {
            console.warn('⚠️ Checkbox #creative-exclure-doublons non trouvé');
        }

        if (excludeSimilarCheckbox) {
            excludeSimilarCheckbox.addEventListener('change', () => {
                console.log(`ℹ️ Checkbox #creative-exclure-similaires changé, état: ${excludeSimilarCheckbox.checked}`);
                updateGeneratedWord(false); // Régénérer le mot si nécessaire
            });
        } else {
            console.warn('⚠️ Checkbox #creative-exclure-similaires non trouvé');
        }
    }

    // Fonction d'initialisation optimisée
    function initializeCreativeMode() {
        if (window.isCreativeModeInitialized) {
            console.log('ℹ️ initializeCreativeMode déjà exécuté, ignoré');
            return;
        }

        console.log('ℹ️ Début de initializeCreativeMode, stack:', new Error().stack);
        window.isCreativeModeInitialized = true;

        const boxType = document.getElementById('boxType');
        const generatedWordDisplay = document.getElementById('generatedWordDisplay');
        const selectedWordDisplay = document.getElementById('selectedWordDisplay');
        const creativeScreen = document.getElementById('creativeScreen');
        console.log('ℹ️ Initialisation de initializeCreativeMode : boxType=', !!boxType, 'generatedWordDisplay=', !!generatedWordDisplay, 'selectedWordDisplay=', !!selectedWordDisplay, 'creativeScreen=', !!creativeScreen);

        if (!boxType || !generatedWordDisplay || !selectedWordDisplay || !creativeScreen) {
            console.warn('⚠️ Éléments DOM manquants pour initializeCreativeMode');
            return;
        }

        Promise.all([waitForDOM(), loadTranslations('fr')]).then(([_, translations]) => {
            console.log('ℹ️ Translations chargées :', Object.keys(translations));
            if (Object.keys(translations).length === 0) {
                console.warn('⚠️ Aucune traduction chargée, utilisant des valeurs par défaut');
            }

            boxType.value = 'wordBox';
            console.log('ℹ️ Mode forcé à : wordBox, valeur actuelle :', boxType.value);
            const changeEvent = new Event('change');
            boxType.dispatchEvent(changeEvent);
            console.log('ℹ️ Événement change déclenché sur #boxType vers wordBox');

            try {
                updateGeneratedWordAsync(true).then(generatedWord => {
                    if (generatedWord && generatedWord !== translations[window.currentLang]?.no_word_selected) {
                        currentWord = generatedWord;
                        generatedWordDisplay.textContent = currentWord;
                        selectedWordDisplay.textContent = currentWord;
                        console.log(`ℹ️ Mot affiché dans #generatedWordDisplay au chargement : ${currentWord}`);
                        console.log(`ℹ️ Mot affiché dans #selectedWordDisplay au chargement : ${currentWord}`);
                        console.log(`ℹ️ currentWord initialisé : ${currentWord}`);
                    } else {
                        currentWord = translations[window.currentLang]?.no_word_selected || 'Aucun mot sélectionné pour l’instant';
                        generatedWordDisplay.textContent = currentWord;
                        selectedWordDisplay.textContent = currentWord;
                        console.log(`ℹ️ Aucun mot généré, #generatedWordDisplay défini à : ${currentWord}`);
                        console.log(`ℹ️ Aucun mot généré, #selectedWordDisplay défini à : ${currentWord}`);
                        console.log(`ℹ️ currentWord initialisé à la valeur par défaut : ${currentWord}`);
                    }

                    currentGeneratorText = translations[window.currentLang]?.no_word_generated || 'Aucun mot généré';
                    console.log(`ℹ️ currentGeneratorText initialisé : ${currentGeneratorText}`);
                    creativeScreen.textContent = '';
                    creativeScreen.setAttribute('data-i18n-placeholder', translations[window.currentLang]?.creative_placeholder || 'Entrer une base...');
                    creativeScreen.focus();
                    console.log(`ℹ️ Placeholder initial défini pour creativeScreen : ${translations[window.currentLang]?.creative_placeholder || 'Entrer une base...'}`);

                    initializeCheckboxListeners();
                    console.log('ℹ️ Écouteurs des checkboxes initialisés');

                    console.log('✅ initializeCreativeMode terminé avec succès');
                }).catch(e => {
                    console.error('Erreur lors de l’appel à updateGeneratedWordAsync :', e);
                    currentWord = translations[window.currentLang]?.no_word_selected || 'Aucun mot sélectionné pour l’instant';
                    generatedWordDisplay.textContent = currentWord;
                    selectedWordDisplay.textContent = currentWord;
                    console.log(`ℹ️ currentWord initialisé après erreur : ${currentWord}`);
                    console.log('✅ initializeCreativeMode terminé avec erreur');
                });
            } catch (e) {
                console.error('Erreur lors de l’initialisation de initializeCreativeMode :', e);
                currentWord = translations[window.currentLang]?.no_word_selected || 'Aucun mot sélectionné pour l’instant';
                generatedWordDisplay.textContent = currentWord;
                selectedWordDisplay.textContent = currentWord;
                console.log(`ℹ️ currentWord initialisé après erreur : ${currentWord}`);
                console.log('✅ initializeCreativeMode terminé avec erreur');
            }
        }).catch(error => {
            console.error('Erreur lors de l’initialisation de initializeCreativeMode :', error);
            console.log('✅ initializeCreativeMode terminé avec erreur');
        });
    }

    // Mettre à jour la logique i18n sans appels redondants
    console.log('ℹ️ Initialisation i18n');
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            console.log('ℹ️ DOMContentLoaded déclenché');

            const urlParams = new URLSearchParams(window.location.search);
            let lang = urlParams.get('lang');
            if (!lang) {
                const browserLang = navigator.language.split('-')[0];
                lang = ['fr', 'en', 'es', 'de', 'it', 'pt'].includes(browserLang) ? browserLang : 'fr';
            }
            window.initialLang = lang;
            console.log(`ℹ️ Langue initiale définie : ${lang}`);

            const languageSelect = document.getElementById('languageSelect');
            if (languageSelect) {
                languageSelect.value = lang;
                updateLanguage(lang);
            } else {
                console.error('Erreur : #languageSelect non trouvé');
            }

            loadTranslations(window.initialLang);

            if (languageSelect) {
                languageSelect.addEventListener('change', (e) => {
                    const selectedLanguage = e.target.value;
                    console.log(`ℹ️ Langue sélectionnée : ${selectedLanguage}`);
                    updateLanguage(selectedLanguage);
                });
            }

            const generatePhraseButton = document.getElementById('generatePhrase');
            if (generatePhraseButton) {
                generatePhraseButton.addEventListener('click', () => {
                    setTimeout(() => {
                        const selectedWordDisplay = document.getElementById('selectedWordDisplay');
                        if (selectedWordDisplay) {
                            currentPhrase = selectedWordDisplay.textContent;
                            hasGeneratedPhrase = true;
                            console.log(`ℹ️ currentPhrase mise à jour : ${currentPhrase}`);
                            console.log(`ℹ️ hasGeneratedPhrase défini à : ${hasGeneratedPhrase}`);
                        }
                    }, 100);
                });
            }



            const boxTypeSelect = document.getElementById('boxType');
            if (boxTypeSelect) {
                boxTypeSelect.addEventListener('change', () => {
                    if (boxTypeSelect.value === 'wordBox') {
                        setTimeout(() => {
                            const selectedWordDisplay = document.getElementById('selectedWordDisplay');
                            if (selectedWordDisplay && selectedWordDisplay.textContent !== fallbackTranslations[window.currentLang].no_word_selected) {
                                currentWord = selectedWordDisplay.textContent;
                                console.log(`ℹ️ currentWord mise à jour : ${currentWord}`);
                            }
                        }, 100);
                    }
                });
            }
        });
    } else {
        console.log('ℹ️ DOM déjà chargé');
        loadTranslations();
        const languageSelect = document.getElementById('languageSelect');
        if (languageSelect) {
            languageSelect.addEventListener('change', (e) => {
                const selectedLanguage = e.target.value;
                console.log(`ℹ️ Langue sélectionnée : ${selectedLanguage}`);
                updateLanguage(selectedLanguage);
            });
            languageSelect.value = 'fr';
        } else {
            console.error('Erreur : #languageSelect non trouvé');
        }

        const generatePhraseButton = document.getElementById('generatePhrase');
        if (generatePhraseButton) {
            generatePhraseButton.addEventListener('click', () => {
                setTimeout(() => {
                    const selectedWordDisplay = document.getElementById('selectedWordDisplay');
                    if (selectedWordDisplay) {
                        currentPhrase = selectedWordDisplay.textContent;
                        hasGeneratedPhrase = true;
                        console.log(`ℹ️ currentPhrase mise à jour : ${currentPhrase}`);
                        console.log(`ℹ️ hasGeneratedPhrase défini à : ${hasGeneratedPhrase}`);
                    }
                }, 100);
            });
        }

        const generateWordsButton = document.getElementById('generateWords');
        if (generateWordsButton) {
            generateWordsButton.addEventListener('click', () => {
                setTimeout(() => {
                    const selectedWordDisplay = document.getElementById('selectedWordDisplay');
                    if (selectedWordDisplay) {
                        currentGeneratorText = selectedWordDisplay.textContent;
                        hasGeneratedWord = true;
                        console.log(`ℹ️ currentGeneratorText mise à jour : ${currentGeneratorText}`);
                        console.log(`ℹ️ hasGeneratedWord défini à : ${hasGeneratedWord}`);
                    }
                }, 100);
            });
        }

        const boxTypeSelect = document.getElementById('boxType');
        if (boxTypeSelect) {
            boxTypeSelect.addEventListener('change', () => {
                if (boxTypeSelect.value === 'wordBox') {
                    setTimeout(() => {
                        const selectedWordDisplay = document.getElementById('selectedWordDisplay');
                        if (selectedWordDisplay && selectedWordDisplay.textContent !== fallbackTranslations[window.currentLang].no_word_selected) {
                            currentWord = selectedWordDisplay.textContent;
                            console.log(`ℹ️ currentWord mise à jour : ${currentWord}`);
                        }
                    }, 100);
                }
            });
        }
    }

    // Appeler initializeCreativeMode une seule fois
    waitForDOM().then(() => {
        console.log('ℹ️ DOM chargé, lancement de initializeCreativeMode');
        initializeCreativeMode();
    });
})();


document.addEventListener('DOMContentLoaded', () => {
    const readmeButton = document.getElementById('readmeButton');
    const readmeModal = document.getElementById('readmeModal');
    const closeReadme = readmeModal?.querySelector('.close');
    const modalContent = readmeModal?.querySelector('.modal-content');
    const languageSelect = document.getElementById('languageSelect');
    let isReadmeModalOpen = false;

    if (!readmeButton || !readmeModal || !closeReadme || !modalContent || !languageSelect) {
        console.warn("❗ Certains éléments README ou langue sont introuvables :", {
            readmeButton: !!readmeButton,
            readmeModal: !!readmeModal,
            closeReadme: !!closeReadme,
            modalContent: !!modalContent,
            languageSelect: !!languageSelect
        });
        return;
    }

    // Toggle modal via bouton README et appliquer les traductions
    readmeButton.addEventListener('click', (e) => {
        e.stopPropagation();
        if (readmeModal.classList.contains('hidden')) {
            readmeModal.classList.remove('hidden');
            isReadmeModalOpen = true;
            if (window.updateLanguage) {
                window.updateLanguage(window.currentLang); // Appliquer les traductions
                console.log('ℹ️ Readme modal ouvert, traductions appliquées pour langue :', window.currentLang);
            } else {
                console.error('⚠️ window.updateLanguage non défini !');
            }
        } else {
            readmeModal.classList.add('hidden');
            isReadmeModalOpen = false;
            console.log('ℹ️ Readme modal fermé via bouton');
        }
    });

    // Fermer via la croix
    closeReadme.addEventListener('click', (e) => {
        e.stopPropagation();
        readmeModal.classList.add('hidden');
        isReadmeModalOpen = false;
        console.log('ℹ️ Readme modal fermé via croix');
    });

    // Réappliquer les traductions lors du changement de langue
    languageSelect.addEventListener('change', (e) => {
        const selectedLanguage = e.target.value;
        console.log(`ℹ️ Langue sélectionnée : ${selectedLanguage}`);
        if (window.updateLanguage) {
            window.updateLanguage(selectedLanguage);
            if (isReadmeModalOpen) {
                window.updateLanguage(selectedLanguage); // Forcer un second appel pour #readmeModal
                console.log('ℹ️ Traductions réappliquées pour #readmeModal dans langue :', selectedLanguage);
            }
        } else {
            console.error('⚠️ window.updateLanguage non défini lors du changement de langue !');
        }
    });
});


const modalText = document.querySelector('.modal-text');
let isManualScrolling = false;
let startScrollY = 0;
let startY = 0;

modalText.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return; // clic gauche seulement
    isManualScrolling = true;
    startY = e.clientY;
    startScrollY = modalText.scrollTop;
    modalText.style.cursor = 'grabbing';
    modalText.style.userSelect = 'none';
    e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
    if (!isManualScrolling) return;
    const deltaY = e.clientY - startY;
    modalText.scrollTop = startScrollY - deltaY;
});

document.addEventListener('mouseup', () => {
    if (isManualScrolling) {
        isManualScrolling = false;
        modalText.style.cursor = 'default';
        modalText.style.userSelect = 'auto';
    }
});









// --- DRAG & MOVE POUR README ---




let offsetX = 0, offsetY = 0;

const readmeHeader = document.getElementById('readmeHeader');
const readmeContent = document.getElementById('readmeContent');

readmeHeader.addEventListener('mousedown', (e) => {
    isDragging = true;
    const rect = readmeContent.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    document.body.classList.add('dragging');
    e.preventDefault(); // ✅ Empêche les sélections / comportements par défaut
});

document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const x = e.clientX - offsetX;
    const y = e.clientY - offsetY;
    readmeContent.style.left = `${x}px`;
    readmeContent.style.top = `${y}px`;
    readmeContent.style.transform = 'none'; // ✅ Supprime recentrage une fois déplacée
});

document.addEventListener('mouseup', () => {
    if (isDragging) {
        isDragging = false;
        document.body.classList.remove('dragging');
        readmeContent.style.cursor = 'default';  // ✅ ici
    }
});


let wasJustResized = false;


let isResizing = false; // Ajoute cette ligne UNE FOIS, comme isDragging

const resizeHandle = document.querySelector('.resize-handle');

// 🔧 Démarre le redimensionnement
let startWidth, startHeight;

resizeHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();

    isResizing = true;
    document.body.classList.add('dragging');

    const rect = readmeContent.getBoundingClientRect();
    startWidth = rect.width;
    startHeight = rect.height;

    offsetX = e.clientX;
    offsetY = e.clientY;
});

// 🔧 Resize actif
document.addEventListener('mousemove', (e) => {
    if (isResizing) {
        const deltaX = e.clientX - offsetX;
        const deltaY = e.clientY - offsetY;

        const newWidth = Math.max(300, startWidth + deltaX);
        const newHeight = Math.max(200, startHeight + deltaY);

        readmeContent.style.width = `${newWidth}px`;
        const modalText = readmeContent.querySelector('.modal-text');
        if (modalText) {
            modalText.style.maxHeight = `${newHeight - 100}px`;
        }
    }
});


// 🔧 Fin du redimensionnement
document.addEventListener('mouseup', () => {
    if (isResizing) {
        isResizing = false;
        document.body.classList.remove('dragging');
        readmeContent.style.cursor = 'default';  // ✅ ici aussi
    }
});


document.addEventListener('mousemove', (e) => {
    if (isDragging || isResizing) return;

    const rect = readmeContent.getBoundingClientRect();
    const buffer = 12; // tolérance dans l’angle

    const inResizeCorner =
        e.clientX >= rect.right - buffer &&
        e.clientY >= rect.bottom - buffer;

    const inHeaderZone =
        e.clientY >= rect.top &&
        e.clientY <= rect.top + 40 &&
        e.clientX >= rect.left &&
        e.clientX <= rect.right;

    if (inResizeCorner) {
        readmeContent.style.cursor = 'nwse-resize';
    } else if (inHeaderZone) {
        readmeContent.style.cursor = 'move';
    } else {
        readmeContent.style.cursor = 'default';
    }
});


document.addEventListener("DOMContentLoaded", function () {
    // 1. Récupérer la langue dans l’URL (ex: "en" depuis /en/generator/)
    const langFromUrl = window.location.pathname.split("/")[1] || "fr";

    // 2. Sélecteur de langue
    const languageSelect = document.getElementById("languageSelect");
    if (languageSelect) {
        languageSelect.value = langFromUrl;
    }

    // 3. Appelle ton système de traduction
    if (typeof updateLanguage === "function") {
        updateLanguage(langFromUrl);
    }
});






















