"""
Collecte des prévisions AROME (Météo-France, service WCS).

    python manage.py collecter_arome --diagnostic     première validation
    python manage.py collecter_arome                  collecte du dernier cycle

Clé : METEO_FRANCE_AROME_API_KEY (environnement ou .env).

--diagnostic déroule, sans rien enregistrer en base :
  1. GetCapabilities et choix du dernier cycle complet ;
  2. DescribeCoverage de chaque paramètre retenu (axes, niveaux,
     échéances, unité, valeurs « sans donnée ») ;
  3. un GetCoverage réduit (région de Paris, température à 2 m), en
     essayant les deux formes de temps (secondes depuis le run, date ISO) ;
  4. le contrôle des valeurs et du géoréférencement du GeoTIFF reçu ;
  5. l'estimation du volume téléchargé par cycle.
Le diagnostic s'arrête au premier échec, avec la réponse du serveur.

Collecte normale : pour le dernier cycle complet, les heures de validité
utiles (voir echeances_a_collecter), chaque paramètre ramené sur la
grille commune et archivé avec le run et l'échéance. Puis la fusion des
prévisions est relancée.
"""

import json
from datetime import datetime, time as heure, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError

from meteo_app.sources.commun import (
    CleManquante, DejaEnCours, ErreurSource, dossier, ecrire_atomique,
    journal, lire_cle, maintenant, verrou,
)

PARIS = ZoneInfo("Europe/Paris")

# Heures locales retenues pour les jours suivants (tableaux de prévision)
HEURES_PREVISION = (9, 15)
JOURS_PREVISION = (1, 2)
# Heures de validité retenues autour de maintenant (complément des observations)
HEURES_PROCHES = range(-1, 4)


def echeances_a_collecter(cycle, instant=None, horizon_heures=51):
    """Heures de validité (UTC) utiles pour un cycle, dans sa portée."""
    instant = (instant or maintenant()).replace(minute=0, second=0, microsecond=0)
    fin = cycle + timedelta(hours=horizon_heures)
    validites = set()

    for decalage in HEURES_PROCHES:
        v = instant + timedelta(hours=decalage)
        if cycle <= v <= fin:
            validites.add(v)

    aujourdhui = instant.astimezone(PARIS).date()
    for jour in JOURS_PREVISION:
        for h in HEURES_PREVISION:
            locale = datetime.combine(aujourdhui + timedelta(days=jour), heure(h), tzinfo=PARIS)
            v = locale.astimezone(timezone.utc)
            if cycle <= v <= fin:
                validites.add(v)

    return sorted(validites)


class Command(BaseCommand):
    help = "Télécharge les prévisions AROME utiles à HKO Météo."

    def add_arguments(self, parser):
        parser.add_argument("--diagnostic", action="store_true", help="Valider l'accès pas à pas (rien n'est enregistré).")
        parser.add_argument("--cycle", help="Cycle à collecter (AAAA-MM-JJTHH), défaut : le dernier complet.")
        parser.add_argument("--forme-temps", choices=["secondes", "iso"], default=None,
                            help="Forme du sous-ensemble temporel (défaut : celle validée par le diagnostic).")
        parser.add_argument("--sans-fusion", action="store_true")

    # ------------------------------------------------------------------
    def handle(self, *args, **options):
        from meteo_app.sources.arome import ClientArome

        if options["diagnostic"]:
            try:
                return self.diagnostic(ClientArome(lire_cle("METEO_FRANCE_AROME_API_KEY")))
            except (CleManquante, ErreurSource) as erreur:
                raise CommandError(str(erreur))

        try:
            with verrou("arome", duree_max_secondes=3600):
                with journal("arome", self.stdout) as suivi:
                    client = ClientArome(lire_cle("METEO_FRANCE_AROME_API_KEY"))
                    self.collecter(client, options, suivi)
        except DejaEnCours as erreur:
            self.stdout.write(str(erreur))
            return
        except (CleManquante, ErreurSource) as erreur:
            raise CommandError(str(erreur))

        if not options["sans_fusion"] and getattr(self, "nouveautes", 0):
            call_command("fusionner_conditions", "--previsions", stdout=self.stdout, stderr=self.stderr)

    # ------------------------------------------------------------------
    def _reglages(self):
        chemin = dossier("cache") / "arome_reglages.json"
        if chemin.exists():
            return json.loads(chemin.read_text(encoding="utf-8"))
        return {}

    def _description(self, client, cycle, nom):
        """DescribeCoverage, mise en cache par paramètre (la structure change peu)."""
        from meteo_app.sources import arome

        chemin = dossier("cache") / f"arome_description_{nom}.json"
        if chemin.exists():
            description = json.loads(chemin.read_text(encoding="utf-8"))
            if description.get("cycle") == cycle.isoformat():
                return description

        description = arome.lire_description(client.description(arome.identifiant(nom, cycle)))
        description["cycle"] = cycle.isoformat()
        ecrire_atomique(chemin, json.dumps(description))
        return description

    # ------------------------------------------------------------------
    def diagnostic(self, client):
        from meteo_app.sources import arome

        ecrire = self.stdout.write
        ecrire("Étape 1 — GetCapabilities")
        catalogue = arome.lire_catalogue(client.catalogue())
        ecrire(f"  {sum(len(c) for v in catalogue.values() for c in v.values())} couvertures, "
               f"{len(catalogue)} paramètres")

        manquants = [n for n, p in arome.PARAMETRES.items()
                     if p.get("suffixe", "") not in catalogue.get(p["indicateur"], {})]
        if manquants:
            raise CommandError(f"Paramètres absents du catalogue : {', '.join(manquants)}")

        cycle = arome.dernier_cycle_complet(catalogue)
        if cycle is None:
            raise CommandError("Aucun cycle commun à tous les paramètres.")
        ecrire(f"  Dernier cycle complet : {cycle:%Y-%m-%d %H} UTC")

        ecrire("\nÉtape 2 — DescribeCoverage")
        descriptions = {}
        for nom, p in arome.PARAMETRES.items():
            texte = client.description(arome.identifiant(nom, cycle))
            d = arome.lire_description(texte)
            descriptions[nom] = d
            ecrire(f"  {nom:20s} axes={d['axes']} unité={d['unite']} nil={d['nil'][:2]}")
            ecrire(f"  {'':20s} hauteurs={d['hauteurs'][:8]} temps={d['temps'][:4]}…{d['temps'][-2:]} "
                   f"({len(d['temps'])} valeurs)")
            if p.get("hauteur") is not None and d["hauteurs"] and p["hauteur"] not in d["hauteurs"]:
                raise CommandError(f"{nom} : le niveau {p['hauteur']} m n'est pas proposé ({d['hauteurs']}).")

        diag = dossier("brut", "arome", "diagnostic")
        (diag / f"describe_temperature_{cycle:%Y%m%dT%H}.xml").write_text(
            client.description(arome.identifiant("temperature", cycle)), encoding="utf-8")

        ecrire("\nÉtape 3 — GetCoverage réduit (température à 2 m, région de Paris)")
        echeances = descriptions["temperature"]["echeances"]
        validite = cycle + timedelta(seconds=echeances[1] if len(echeances) > 1 else 3600) if echeances \
            else cycle + timedelta(hours=1)
        zone = {"lat": (48.3, 49.3), "long": (1.8, 3.0)}

        octets, forme_retenue, erreurs = None, None, []
        for forme in ("secondes", "iso"):
            try:
                octets = client.couverture(arome.identifiant("temperature", cycle), cycle, validite,
                                           hauteur=2, forme_temps=forme, zone=zone)
                forme_retenue = forme
                break
            except Exception as erreur:
                erreurs.append(f"{forme} : {erreur}")
                ecrire(f"  Forme « {forme} » refusée : {erreur}")

        if octets is None:
            raise CommandError("GetCoverage refusé sous les deux formes de temps.\n" + "\n".join(erreurs))

        (diag / "echantillon_temperature.tif").write_bytes(octets)
        ecrire(f"  Forme de temps acceptée : {forme_retenue} — {len(octets)} octets reçus "
               f"(validité {validite:%Y-%m-%d %H:%M} UTC)")

        ecrire("\nÉtape 4 — Contrôle du GeoTIFF")
        valeurs, ouest, nord, pas_lon, pas_lat, nodata = arome.lire_geotiff(octets)
        ecrire(f"  Taille {valeurs.shape[1]} x {valeurs.shape[0]}, coin nord-ouest {ouest:.3f}° / {nord:.3f}°, "
               f"pas {pas_lon:.4f}° x {pas_lat:.4f}°, nodata {nodata}")
        finies = valeurs[np.isfinite(valeurs)]
        ecrire(f"  Valeurs : min {finies.min():.2f}, médiane {np.median(finies):.2f}, max {finies.max():.2f}")

        problemes = []
        if not (1.7 <= ouest <= 1.9 and 49.2 <= nord <= 49.4):
            problemes.append("l'emprise reçue ne correspond pas à la zone demandée")
        if not (0.005 <= pas_lon <= 0.03):
            problemes.append(f"pas inattendu ({pas_lon})")
        mediane = float(np.median(finies))
        if not (230 <= mediane <= 320 or -40 <= mediane <= 45):
            problemes.append(f"température médiane invraisemblable ({mediane})")
        ecrire("  Unité de température : " + ("kelvins" if mediane > 150 else "degrés Celsius"))

        ligne = int((nord - 48.8566) / pas_lat)
        colonne = int((2.3522 - ouest) / pas_lon)
        if 0 <= ligne < valeurs.shape[0] and 0 <= colonne < valeurs.shape[1]:
            ecrire(f"  Valeur au point de Paris (48,857° N, 2,352° E) : {valeurs[ligne, colonne]:.2f}")

        if problemes:
            raise CommandError("Contrôle du GeoTIFF : " + "; ".join(problemes))
        ecrire("  OK")

        ecrire("\nÉtape 5 — Volume estimé")
        surface = (arome.ZONE["lat"][1] - arome.ZONE["lat"][0]) * (arome.ZONE["long"][1] - arome.ZONE["long"][0])
        surface_test = (zone["lat"][1] - zone["lat"][0]) * (zone["long"][1] - zone["long"][0])
        par_champ = len(octets) * surface / surface_test
        echeances_cycle = len(echeances_a_collecter(cycle))
        total = par_champ * len(arome.PARAMETRES) * echeances_cycle
        ecrire(f"  Environ {par_champ / 1e6:.1f} Mo par champ sur la France, "
               f"{len(arome.PARAMETRES)} paramètres x {echeances_cycle} échéances "
               f"= {total / 1e6:.0f} Mo par cycle")

        reglages = {"forme_temps": forme_retenue, "valide_le": maintenant().isoformat()}
        ecrire_atomique(dossier("cache") / "arome_reglages.json", json.dumps(reglages))
        ecrire(self.style.SUCCESS("\nDiagnostic réussi. Réglage enregistré : forme de temps « "
                                  f"{forme_retenue} ». La collecte normale peut être lancée."))

    # ------------------------------------------------------------------
    def collecter(self, client, options, suivi):
        from meteo_app.models import ProduitMeteo
        from meteo_app.sources import arome, stockage

        self.nouveautes = 0
        forme = options["forme_temps"] or self._reglages().get("forme_temps")
        if not forme:
            suivi.echec("Lancez d'abord : python manage.py collecter_arome --diagnostic")
            raise CommandError("Diagnostic AROME jamais réussi : lancez collecter_arome --diagnostic.")

        catalogue = arome.lire_catalogue(client.catalogue())
        if options["cycle"]:
            cycle = datetime.strptime(options["cycle"], "%Y-%m-%dT%H").replace(tzinfo=timezone.utc)
        else:
            cycle = arome.dernier_cycle_complet(catalogue)
        if cycle is None:
            suivi.echec("Aucun cycle complet dans le catalogue.")
            return

        validites = echeances_a_collecter(cycle)
        deja = set(ProduitMeteo.objects.filter(source="arome", reference=cycle).values_list("instant", flat=True))
        a_faire = [v for v in validites if v not in deja]

        if not a_faire:
            suivi.rien_de_neuf(f"Cycle {cycle:%Y-%m-%d %H} UTC déjà collecté.")
            return

        descriptions = {nom: self._description(client, cycle, nom) for nom in arome.PARAMETRES}
        erreurs = []

        for validite in a_faire:
            champs = {}
            for nom, p in arome.PARAMETRES.items():
                echeances = descriptions[nom]["echeances"]
                ecart = int((validite - cycle).total_seconds())
                if echeances and ecart not in echeances:
                    continue  # échéance non proposée pour ce paramètre
                try:
                    octets = client.couverture(
                        arome.identifiant(nom, cycle), cycle, validite,
                        hauteur=p.get("hauteur"), forme_temps=forme,
                    )
                    valeurs, ouest, nord, pas_lon, pas_lat, _ = arome.lire_geotiff(octets)
                    champs[nom] = arome.sur_grille(valeurs, ouest, nord, pas_lon, pas_lat,
                                                   categoriel=p.get("categoriel", False))
                except Exception as erreur:
                    erreurs.append(f"{nom} {validite:%d %H}h : {erreur}")

            if len(champs) < len(arome.PARAMETRES) // 2:
                continue  # trop incomplet pour être utile

            champs = arome.normaliser(champs)
            stockage.enregistrer_grille(
                "arome", "prevision", validite, champs, reference=cycle,
                qualite={
                    "echeance_heures": (validite - cycle).total_seconds() / 3600,
                    "parametres": sorted(champs),
                    "manquants": sorted(set(arome.PARAMETRES) - set(champs)),
                },
            )
            self.nouveautes += 1

        details = {"cycle": cycle.isoformat(), "echeances": len(a_faire), "requetes": client.requetes,
                   "octets": client.octets, "erreurs": erreurs[:20]}
        message = (f"Cycle {cycle:%Y-%m-%d %H} UTC : {self.nouveautes}/{len(a_faire)} échéance(s), "
                   f"{client.requetes} requêtes, {client.octets / 1e6:.0f} Mo")

        if self.nouveautes:
            suivi.succes(message, **details)
        else:
            suivi.echec(message + " — aucune échéance exploitable.", **details)
