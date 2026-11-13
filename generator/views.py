# generator/views.py

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.shortcuts import render
from django.core.cache import cache
from .utils import PHRASE_DICT, WORDS_BY_ROLE
import json
import random
import traceback
from html import escape
import uuid
import time

from .utils import (
    WORDS_BY_ROLE,
    SPECIAL_CHARS,
    NUMBERS,
    SYMBOLS,
    PHRASE_DICT,
    load_word_dictionary,
)


# Vue principale qui sert la page HTML
def generator_view(request):
    return render(request, "generator/index.html")


@csrf_exempt
def generate_phrase_view(request):
    try:
        if request.method != "POST":
            return JsonResponse({"error": "Méthode non autorisée"}, status=405)

        if request.content_type == "application/json":
            data = json.loads(request.body)
            lang = data.get("lang", "fr")
            word_count = data.get("word_count", "")
            use_special_chars = data.get("use_special_chars", False)
            special_chars = data.get("special_chars", [])
            add_security = data.get("add_security", False)
        else:
            lang = request.POST.get("lang", "fr")
            word_count = request.POST.get("word_count", "")
            use_special_chars = request.POST.get("use_special_chars", "false") == "true"
            special_chars = request.POST.getlist("special_chars")
            add_security = request.POST.get("add_security", "false") == "true"

        if lang not in WORDS_BY_ROLE and lang != "mix":
            return JsonResponse(
                {
                    "error": f"Langue non supportée: {lang}. Langues disponibles: {list(WORDS_BY_ROLE.keys())}"
                },
                status=400,
            )

        try:
            word_count = int(word_count)
            if word_count < 3 or word_count > 10:
                return JsonResponse(
                    {"error": "Le nombre de mots doit être entre 3 et 10."}, status=400
                )
        except ValueError:
            word_count = random.randint(3, 7)

        # Graine aléatoire unique pour chaque requête
        random.seed(time.time())

        print(
            f"Requête reçue: lang={lang}, word_count={word_count}, use_special_chars={use_special_chars}"
        )

        def get_article(lang, nom, gender):
            if lang == "fr":
                return "un" if gender == "m" else "une"
            elif lang == "es":
                return "el" if gender == "m" else "la"
            elif lang == "de":
                return "der" if gender == "m" else "die" if gender == "f" else "das"
            elif lang == "it":
                return "il" if gender == "m" else "la"
            elif lang == "en":
                return "a" if nom[0].lower() not in "aeiou" else "an"
            return ""

        def build_phrase(word_pool, lang, target_words):
            max_attempts = 50
            for attempt in range(max_attempts):
                parts = []
                tense = random.choice(list(word_pool["verbe"].keys()))
                pronoun = random.choice(list(word_pool["verbe"][tense].keys()))
                if lang == "en" and pronoun == "you_pl":
                    pronoun = "you"
                verbe = random.choice(word_pool["verbe"][tense][pronoun])
                nom, gender = random.choice(word_pool["nom"])
                adj_masc, adj_fem = random.choice(word_pool["adjectif"])
                adj = adj_masc if gender == "m" else adj_fem
                simple_complements = [
                    c.split()[-1] for c in word_pool["complement"]
                ]  # Dernier mot
                complement = random.choice(simple_complements)
                article = get_article(lang, nom, gender)

                parts = [pronoun]
                verbe_parts = verbe.split()
                parts.extend(verbe_parts)
                initial_word_count = 1 + len(verbe_parts)  # Pronom + verbe
                remaining_words = target_words - initial_word_count

                if initial_word_count > target_words:
                    continue  # Verbe trop long

                if remaining_words >= 2:
                    parts.append(f"{article} {nom}")
                    remaining_words -= 2
                elif remaining_words == 1:
                    parts.append(nom)
                    remaining_words -= 1

                if remaining_words >= 1:
                    parts.append(complement)
                    remaining_words -= 1
                if remaining_words >= 1:
                    parts.append(adj)
                    remaining_words -= 1

                # Construire la phrase pour compter les mots après contractions
                phrase = " ".join(parts).strip().rstrip("…")
                if lang == "fr" and "je ai" in phrase:
                    phrase = phrase.replace("je ai", "j’ai")
                final_word_count = len(phrase.split())

                # Valider la phrase
                if final_word_count == target_words:
                    print(
                        f"Phrase générée: {parts}, Phrase finale: {phrase}, Nombre de mots: {final_word_count}, Tentative: {attempt + 1}, Langue: {lang}, Dict: {word_pool['nom'][:3]}, Verbes: {word_pool['verbe'][tense][pronoun][:3]}, Compléments: {simple_complements[:3]}"
                    )
                    return parts
                print(
                    f"Tentative {attempt + 1} échouée: {parts}, Phrase: {phrase}, Nombre de mots: {final_word_count}, Attendu: {target_words}, Langue: {lang}, Dict: {word_pool['nom'][:3]}, Verbes: {word_pool['verbe'][tense][pronoun][:3]}, Compléments: {simple_complements[:3]}"
                )

            # Phrase de secours
            parts = [pronoun]
            parts.extend(verbe_parts)
            if target_words > initial_word_count:
                parts.append(nom)
            if target_words > initial_word_count + 1:
                parts[-1] = f"{article} {nom}"
            if target_words > initial_word_count + 2:
                parts.append(complement)
            if target_words > initial_word_count + 3:
                parts.append(adj)
            phrase = " ".join(parts).strip().rstrip("…")
            if lang == "fr" and "je ai" in phrase:
                phrase = phrase.replace("je ai", "j’ai")
            final_word_count = len(phrase.split())
            print(
                f"Phrase de secours générée: {parts}, Phrase finale: {phrase}, Nombre de mots: {final_word_count}, Langue: {lang}, Dict: {word_pool['nom'][:3]}, Verbes: {word_pool['verbe'][tense][pronoun][:3]}, Compléments: {simple_complements[:3]}"
            )
            return parts

        word_dict = load_word_dictionary()

        if lang == "mix":
            max_attempts = 50
            for attempt in range(max_attempts):
                parts = []
                langs = list(WORDS_BY_ROLE.keys())
                base_lang = random.choice(langs)
                complement_lang = random.choice([l for l in langs if l != base_lang])
                base_pool = WORDS_BY_ROLE[base_lang]
                complement_pool = WORDS_BY_ROLE[complement_lang]

                tense = random.choice(list(base_pool["verbe"].keys()))
                pronoun = random.choice(list(base_pool["verbe"][tense].keys()))
                if base_lang == "en" and pronoun == "you_pl":
                    pronoun = "you"
                verbe = random.choice(base_pool["verbe"][tense][pronoun])
                nom, gender = random.choice(complement_pool["nom"])
                adj_masc, adj_fem = random.choice(complement_pool["adjectif"])
                adj = adj_masc if gender == "m" else adj_fem
                simple_complements = [
                    c.split()[-1] for c in complement_pool["complement"]
                ]
                complement = random.choice(simple_complements)
                article = get_article(complement_lang, nom, gender)

                parts = [pronoun]
                verbe_parts = verbe.split()
                parts.extend(verbe_parts)
                initial_word_count = 1 + len(verbe_parts)
                remaining_words = word_count - initial_word_count

                if initial_word_count > word_count:
                    continue

                if remaining_words >= 2:
                    parts.append(f"{article} {nom}")
                    remaining_words -= 2
                elif remaining_words == 1:
                    parts.append(nom)
                    remaining_words -= 1

                if remaining_words >= 1:
                    parts.append(complement)
                    remaining_words -= 1
                if remaining_words >= 1:
                    parts.append(adj)
                    remaining_words -= 1

                phrase = " ".join(parts).strip().rstrip("…")
                if complement_lang == "fr" and "je ai" in phrase:
                    phrase = phrase.replace("je ai", "j’ai")
                final_word_count = len(phrase.split())

                if final_word_count == word_count:
                    print(
                        f"Phrase mix générée: {parts}, Phrase finale: {phrase}, Nombre de mots: {final_word_count}, Tentative: {attempt + 1}, Base: {base_lang}, Complément: {complement_lang}, Dict: {complement_pool['nom'][:3]}, Verbes: {base_pool['verbe'][tense][pronoun][:3]}, Compléments: {simple_complements[:3]}"
                    )
                    return JsonResponse({"phrase": " ".join(parts)})
                print(
                    f"Tentative mix {attempt + 1} échouée: {parts}, Phrase: {phrase}, Nombre de mots: {final_word_count}, Attendu: {word_count}, Base: {base_lang}, Complément: {complement_lang}, Dict: {complement_pool['nom'][:3]}, Verbes: {base_pool['verbe'][tense][pronoun][:3]}, Compléments: {simple_complements[:3]}"
                )

            # Phrase de secours pour mix
            parts = [pronoun]
            parts.extend(verbe_parts)
            if word_count > initial_word_count:
                parts.append(nom)
            if word_count > initial_word_count + 1:
                parts[-1] = f"{article} {nom}"
            if word_count > initial_word_count + 2:
                parts.append(complement)
            if word_count > initial_word_count + 3:
                parts.append(adj)
            phrase = " ".join(parts).strip().rstrip("…")
            if complement_lang == "fr" and "je ai" in phrase:
                phrase = phrase.replace("je ai", "j’ai")
            final_word_count = len(phrase.split())
            print(
                f"Phrase mix de secours générée: {parts}, Phrase finale: {phrase}, Nombre de mots: {final_word_count}, Base: {base_lang}, Complément: {complement_lang}, Dict: {complement_pool['nom'][:3]}, Verbes: {base_pool['verbe'][tense][pronoun][:3]}, Compléments: {simple_complements[:3]}"
            )
            return JsonResponse({"phrase": " ".join(parts)})

        # Vérification du dictionnaire avant génération
        print(f"Dictionnaire chargé pour lang={lang}: {WORDS_BY_ROLE[lang]['nom'][:3]}")
        parts = build_phrase(WORDS_BY_ROLE[lang], lang, word_count)

        # Construire la phrase
        safe_special_chars = ["!", "@", "#", "$", "%", "&", "*", "?"]
        if use_special_chars and special_chars:
            if not all(c in safe_special_chars for c in special_chars):
                return JsonResponse(
                    {
                        "error": "Caractères spéciaux invalides. Utilisez : "
                        + ", ".join(safe_special_chars)
                    },
                    status=400,
                )
            cleaned_parts = [p.replace(" ", "") for p in parts]
            phrase = cleaned_parts[0]
            for i in range(1, len(cleaned_parts)):
                sep = special_chars[(i - 1) % len(special_chars)]
                phrase += sep + cleaned_parts[i]
        else:
            phrase = " ".join(parts).strip().rstrip("…")
            if lang == "fr" and "je ai" in phrase:
                phrase = phrase.replace("je ai", "j’ai")

        if add_security:
            if random.random() > 0.5:
                phrase += f"{random.choice(NUMBERS)}{random.choice(NUMBERS)}"
            if random.random() > 0.3:
                phrase += random.choice(SYMBOLS)

        phrase = escape(phrase)
        return JsonResponse({"phrase": phrase})

    except Exception as e:
        print(
            f"Erreur dans generate_phrase_view: {str(e)}, Trace: {traceback.format_exc()}"
        )
        return JsonResponse({"error": str(e)}, status=400)


@csrf_exempt
def generate_words_view(request):
    if request.method == "POST":
        try:
            body = request.body.decode("utf-8")
            print(f"Requête reçue pour /api/words/words/: {body}")
            data = json.loads(body)
            lang = data.get("lang", "fr")
            prefix = data.get("prefix", "")
            length = data.get("length")
            if not length:
                length = random.randint(5, 12)
            else:
                length = int(length)

            print(f"Paramètres : lang={lang}, prefix={prefix}, length={length}")

            word_dict = load_word_dictionary()

            if lang not in word_dict:
                print(f"Langue non trouvée : {lang}")
                return JsonResponse({"result": []})

            filtered = [
                word
                for word in word_dict[lang]
                if word.startswith(prefix) and len(word) == length
            ]

            if not filtered:
                print(
                    f"Aucun mot trouvé pour lang={lang}, prefix={prefix}, length={length}"
                )
                return JsonResponse({"result": []})

            result = random.sample(filtered, 1)
            print(f"Mots renvoyés : {result}")
            return JsonResponse({"result": result})
        except json.JSONDecodeError as e:
            print(f"Erreur JSON : {e}")
            return JsonResponse({"error": "Invalid JSON format"}, status=400)
        except ValueError as e:
            print(f"Erreur de valeur : {e}")
            return JsonResponse({"error": "Invalid length parameter"}, status=400)
        except Exception as e:
            print(f"Erreur inattendue : {e}")
            return JsonResponse({"error": str(e)}, status=400)
    print("Méthode non autorisée pour /api/words/words/")
    return JsonResponse({"error": "Méthode non autorisée"}, status=405)
