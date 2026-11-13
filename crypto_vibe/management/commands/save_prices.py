from django.core.management.base import BaseCommand
from django.utils import timezone
from django.core.cache import cache
from datetime import timedelta, time as dtime

from crypto_vibe.models import SentimentData
from crypto_vibe.services.prices import _fetch_from_provider
from crypto_vibe.views import get_real_price, collect_data, analyze_sentiment, predict_price

import logging
import time
import pytz

logger = logging.getLogger(__name__)

CRYPTO_LIST = [
    'bitcoin', 'ethereum', 'xrp', 'tether', 'bnb',
    'solana', 'usdc', 'dogecoin', 'tron', 'cardano'
]

# Forcer l'alias DB (évite la lecture sur une éventuelle réplica)
DB_ALIAS = "default"


def floor_to_5min(dt):
    """Aligner un datetime sur la tranche de 5 minutes exacte (UTC)."""
    minute = (dt.minute // 5) * 5
    return dt.replace(minute=minute, second=0, microsecond=0)


class Command(BaseCommand):
    help = "Enregistre les prix (CoinGecko, bucket 5 min) et les vibes Reddit (à 08:00 et 20:00 Europe/Paris)."

    def handle(self, *args, **kwargs):
        # Bucket prix en UTC (sert pour les enregistrements toutes 5 min)
        now_utc = timezone.now()
        timestamp = floor_to_5min(now_utc)

        # Horloge Europe/Paris pour décider des vibes
        paris = pytz.timezone("Europe/Paris")
        now_paris = timezone.localtime(now_utc, paris)

        # Vibes UNIQUEMENT aux minutes pile 00 des heures 08:00 et 20:00 Europe/Paris
        update_social = (now_paris.minute == 0) and (now_paris.hour in (8, 20))

        # --- 1) RÉCUP PRIX (batch + fallback individuel) ---
        cryptos = CRYPTO_LIST
        prices = {}
        try:
            prices = _fetch_from_provider()
            logger.info("[save_prices] Batch CoinGecko: %s", {k: prices.get(k) for k in cryptos})

            missing = [c for c in cryptos if prices.get(c) is None]
            for c in missing:
                time.sleep(0.3)
                p = get_real_price(c)
                prices[c] = float(p) if p is not None else None
                logger.info("[save_prices] Fallback %s -> %s", c, prices[c])
        except Exception:
            logger.exception("[save_prices] Erreur batch CoinGecko, fallback individuel intégral")
            for c in cryptos:
                time.sleep(0.3)
                p = get_real_price(c)
                prices[c] = float(p) if p is not None else None
                logger.info("[save_prices] Fallback %s -> %s", c, prices[c])

        # --- 2) ÉCRITURE PRIX EN DB (update_or_create strict sur le bucket 5 min) ---
        for crypto in cryptos:
            price = prices.get(crypto)
            if price is None:
                logger.warning("[save_prices] Prix indisponible pour %s, tentative dernier connu", crypto)
                last = (
                    SentimentData.objects.using(DB_ALIAS)
                    .filter(crypto=crypto, source='coingecko', price_eur__isnull=False)
                    .order_by('-timestamp')
                    .first()
                )
                if last and last.price_eur is not None:
                    price = float(last.price_eur)
                    logger.info("[save_prices] Reprise dernier prix connu %s: %s", crypto, price)
                else:
                    defaults = {
                        'bitcoin': 98000, 'ethereum': 3000, 'xrp': 2.5, 'tether': 0.86,
                        'bnb': 645, 'solana': 140, 'usdc': 0.86, 'dogecoin': 0.17,
                        'tron': 0.28, 'cardano': 0.62
                    }
                    price = float(defaults.get(crypto))
                    logger.warning("[save_prices] Aucun prix connu pour %s, défaut: %s", crypto, price)

            try:
                obj, created = SentimentData.objects.using(DB_ALIAS).update_or_create(
                    crypto=crypto,
                    source='coingecko',
                    timestamp=timestamp,  # égalité stricte: on ne laisse pas le modèle écraser
                    defaults={
                        'text': '',
                        'sentiment': '',
                        'score': 0.0,
                        'price_eur': price,
                    }
                )
                logger.debug(
                    "[save_prices] %s %s/coingecko: %s @ %s (id=%s)",
                    "Créé" if created else "MAJ",
                    crypto, price, timestamp, obj.id
                )
            except Exception as e:
                logger.exception("[save_prices] Erreur insert/maj prix %s: %s", crypto, e)
                continue

        # --- 2b) Vibes Reddit — uniquement 08:00 et 20:00 Europe/Paris, minute 00 ---
        if update_social:
            # On verrouille par instant Paris (YYYYMMDDHHMM) pour éviter les doublons multi-process
            social_slot = now_paris.replace(minute=0, second=0, microsecond=0)
            lock_key = f"lock:vibes:{social_slot.strftime('%Y%m%d%H%M')}"
            if not cache.add(lock_key, 1, timeout=15 * 60):  # 15 minutes
                logger.info("[save_prices] Social déjà exécuté pour ce slot %s, skip.", social_slot)
            else:
                logger.info("[save_prices] Social RUN @ %s (Europe/Paris)", social_slot)
                # timestamp social: on force le bucket exact 08:00/20:00 en UTC.
                # On prend la date/heure Paris (minute 00) et on convertit en UTC
                social_utc = timezone.make_aware(
                    social_slot.replace(tzinfo=None), paris
                ).astimezone(pytz.UTC)
                social_ts = floor_to_5min(social_utc)

                for crypto in cryptos:
                    price = prices.get(crypto)
                    try:
                        # AUCUN fetch côté views ailleurs : on collecte ici (quota maîtrisé)
                        texts = collect_data(crypto, 'reddit') or []
                        vibe, avg_score = analyze_sentiment(texts)
                        pred, conf = predict_price(crypto, 'reddit')

                        obj, created = SentimentData.objects.using(DB_ALIAS).update_or_create(
                            crypto=crypto,
                            source='reddit',
                            timestamp=social_ts,
                            defaults={
                                'text': "; ".join(texts[:3]),
                                'sentiment': vibe,
                                'score': avg_score,
                                'price_eur': price,
                                'predicted_price': pred,
                                'confidence': conf,
                            }
                        )
                        logger.debug(
                            "[save_prices] %s %s/reddit: %s @ %s (id=%s)",
                            "Créé" if created else "MAJ",
                            crypto, price, social_ts, obj.id
                        )

                        self.stdout.write(
                            f"Enregistré vibes: {crypto}/reddit | prix: {price} | "
                            f"score: {avg_score:.4f} | pred: {pred:.2f} | conf: {conf:.1f}%"
                        )
                    except Exception as e:
                        logger.exception("[save_prices] Erreur vibes reddit %s: %s", crypto, e)
                        continue
        else:
            logger.info("[save_prices] Social skip (pas 08:00/20:00 pile) @ %s Europe/Paris", now_paris)

        # --- 3) Invalidation cache ---
        try:
            def _cache_key_for(dt):
                bucket = (dt.minute // 5) * 5
                return f"latest_prices_{dt.strftime('%Y-%m-%d_%H')}:{bucket:02d}"

            key_now = _cache_key_for(timestamp)
            key_prev = _cache_key_for(timestamp - timedelta(minutes=5))
            cache.delete(key_now)
            cache.delete(key_prev)
            logger.info("[save_prices] Cache invalidé: %s et %s", key_now, key_prev)
        except Exception:
            logger.exception("[save_prices] Erreur lors de l'invalidation du cache")
