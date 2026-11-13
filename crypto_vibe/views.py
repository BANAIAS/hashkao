import praw
import random
from django.conf import settings
from django.core.cache import cache
from datetime import timedelta, datetime, timezone as py_tz
import numpy as np
from sklearn.linear_model import LinearRegression
from .models import SentimentData
import logging
from django.shortcuts import render
from django.http import JsonResponse
from textblob import TextBlob
import pandas as pd
from prophet import Prophet
from django.utils import timezone
import pytz
import time
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import requests
from django.http import HttpResponse

from crypto_vibe.models import SentimentData
from .models import CoinCapTicker


from datetime import datetime


import threading
import schedule
from django.core.management import call_command


import math

from django.views.decorators.http import require_GET
from datetime import timedelta



import os

from django.conf import settings

from .coincap_api import fetch_coincap_data

from django.apps import AppConfig

from collections import OrderedDict


from datetime import timedelta

from django.db.models import F


import pytz


from django.views.decorators.http import require_POST
from django.core.validators import validate_email
from django.core.exceptions import ValidationError
from django.utils.translation import get_language
from .models import Subscriber

DB_ALIAS = "default"  # même alias que dans save_prices









# --- BATCH COINGECKO (EUR) ---









from .views_utils_guardrails import postprocess_pred_1h  # ou adapte l'import si besoin

import zlib

logger = logging.getLogger('crypto_vibe.views')

CRYPTO_LIST = ['bitcoin', 'ethereum', 'xrp', 'tether', 'bnb', 'solana', 'usdc', 'dogecoin', 'tron', 'cardano']




def index(request):
    return render(request, 'crypto_vibe/vibe_dashboard.html', {'cryptos': [
        {'id': 'bitcoin', 'name': 'Bitcoin'},
        {'id': 'ethereum', 'name': 'Ethereum'},
        {'id': 'xrp', 'name': 'XRP'},
        {'id': 'tether', 'name': 'Tether'},
        {'id': 'bnb', 'name': 'BNB'},
        {'id': 'solana', 'name': 'Solana'},
        {'id': 'usdc', 'name': 'USDC'},
        {'id': 'dogecoin', 'name': 'Dogecoin'},
        {'id': 'tron', 'name': 'TRON'},
        {'id': 'cardano', 'name': 'Cardano'},
    ]})







def _hour_bucket():
    return timezone.now().strftime("%Y%m%d%H")

def take_budget(source: str, tokens: int = 1) -> bool:
    """
    Leaky bucket horaire en cache. True = budget OK, False = dépassé.
    """
    limit = (getattr(settings, "RATE_LIMITS", {}).get(source, {}) or {}).get("per_hour", 30)
    key = f"rl:{source}:{_hour_bucket()}"
    # init compteur si absent (TTL > 1h)
    cache.add(key, 0, timeout=4000)
    try:
        current = cache.incr(key, tokens)
    except ValueError:
        cache.set(key, tokens, 4000)
        current = tokens
    return current <= limit

def collect_data_cached(crypto: str, source: str):
    """
    Wrapper autour collect_data(crypto, source) avec:
      - cache (min/max TTL),
      - budget horaire,
      - anti-stampede,
      - retours ("how") pour logs.
    """
    crypto = (crypto or "").lower()
    source = (source or "").lower()

    min_ttl = getattr(settings, "TEXTS_MIN_TTL", 900)
    max_ttl = getattr(settings, "TEXTS_MAX_TTL", 3600)
    now_ts  = time.time()

    key = f"texts2:{source}:{crypto}"
    payload = cache.get(key)  # {"texts": [...], "ts": float}

    # 1) si cache récent (< min_ttl) → on sert direct
    if payload:
        age = now_ts - float(payload.get("ts", 0))
        if age < min_ttl:
            return payload["texts"], payload["ts"], "cache_fresh"

    # 2) budget: si pas de budget → on sert ce qu'on a (même vieux) ou vide
    if not take_budget(source, 1):
        if payload:
            return payload["texts"], payload["ts"], "cache_stale_no_budget"
        return [], None, "empty_no_budget"

    # 3) anti-stampede: un lock court (10s) pour éviter >1 fetch simultané
    lock_key = f"lock:{key}"
    if not cache.add(lock_key, 1, timeout=10):
        # quelqu'un est déjà en train de l'actualiser → retourne cache actuel
        if payload:
            return payload["texts"], payload["ts"], "cache_wait"
        return [], None, "empty_wait"

    try:
        # 4) on fetch vraiment (1 seule fois) puis on met en cache
        texts = collect_data(crypto, source) or []
        cache.set(key, {"texts": texts, "ts": now_ts}, timeout=max_ttl)
        return texts, now_ts, "fetched"
    finally:
        cache.delete(lock_key)







class CryptoVibeConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'crypto_vibe'

    def ready(self):
        """
        Planifie l'enregistrement des prix toutes les 5 minutes.
        - Anti double-lancement sous runserver (auto-reload)
        - Lock cache pour éviter les overlaps si un run est long
        - 1er tir au boot
        """
        # Evite le double scheduler avec le reloader Django
        if settings.DEBUG and os.environ.get("RUN_MAIN") != "true":
            return

        # Evite plusieurs schedulers si le process est relancé (gunicorn workers, etc.)
        # Si tu utilises un cache partagé (redis), ça protège aussi en prod.
        if not cache.add("scheduler:prices_started", 1, timeout=24*3600):
            return

        def save_prices_job():
            lock_key = "joblock:save_prices"
            # lock 60s : si déjà en cours, on saute
            if not cache.add(lock_key, 1, timeout=60):
                return
            try:
                call_command('save_prices')
                logger.info("[scheduler] save_prices exécuté")
            except Exception:
                logger.exception("save_prices a échoué")
            finally:
                cache.delete(lock_key)

        # planification
        schedule.every(5).minutes.do(save_prices_job)

        # boucle du scheduler
        def run_scheduler():
            while True:
                schedule.run_pending()
                time.sleep(1)

        threading.Thread(target=run_scheduler, daemon=True).start()

        # premier tir au démarrage (optionnel mais pratique)
        try:
            save_prices_job()
        except Exception:
            logger.exception("save_prices (boot) a échoué")



logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)



TICKER_CRYPTO_LIST = [  # IDs CoinCap corrects
    'avalanche', 'polkadot-new', 'chainlink', 'litecoin', 'stellar', 'matic-network', 'uniswap', 'cosmos', 'near-protocol', 'internet-computer',
    'monero', 'unus-sed-leo', 'dai', 'filecoin', 'ethereum-classic', 'bittensor', 'hedera', 'aptos', 'cronos', 'vechain',
    'stacks', 'maker', 'sui', 'injective-protocol', 'arbitrum', 'the-graph', 'immutable-x', 'optimism', 'lido-dao', 'render-token',
    'mantle', 'aave', 'bittorrent-new', 'arweave', 'helium', 'rocket-pool-eth', 'algorand', 'thorchain', 'elrond-egld', 'fantom',
    'floki-inu', 'theta-network', 'the-sandbox', 'axie-infinity', 'kucoin-token', 'first-digital-usd', 'eos', 'gala', 'neo', 'whitebit-token'
]




def get_price_fallback(crypto):
    mapping = {
        'bitcoin': 'BTC',
        'ethereum': 'ETH',
        'solana': 'SOL',
        'cardano': 'ADA',
        'xrp': 'XRP',
        'polkadot': 'DOT',
        'avalanche': 'AVAX'
    }
    symbol = mapping.get(crypto.lower())
    if not symbol:
        return None
    try:
        url = f"https://min-api.cryptocompare.com/data/price?fsym={symbol}&tsyms=EUR"
        response = requests.get(url, timeout=5)
        response.raise_for_status()
        price = response.json().get('EUR')
        if price:
            logger.info(f"Prix fallback CryptoCompare pour {crypto}: {price} EUR")
            return price
    except Exception as e:
        logger.error(f"Erreur CryptoCompare pour {crypto}: {str(e)}")
    return None


def check_coingecko_quota():
    cache_key = f"coingecko_calls_{timezone.now().strftime('%Y-%m-%d_%H:%M')}"
    calls = cache.get(cache_key, 0)
    if calls >= 30:  # Limite conservatrice (ajuste selon ton expérience)
        logger.warning("Quota CoinGecko atteint, skipping")
        return False
    cache.set(cache_key, calls + 1, 60)  # Cache par minute
    return True





def collect_data(crypto, source='reddit'):
    """
    Récupère une liste de textes (posts) pour une crypto donnée depuis 'reddit' (ou 'x' en mode simulé).
    - Utilise un cache journalier par (source, crypto).
    - Respecte un quota global (simple) par jour pour Reddit.
    - Détection par alias (ex. xrp|ripple|xrpl|$xrp) + mots-clés de marché.
    - Retourne au plus 30 textes, éventuellement un petit fallback simulé si rien n'est trouvé.
    """
    crypto = (crypto or "").lower().strip()
    if source not in ['reddit', 'x']:
        logger.warning(f"Source {source} not supported, falling back to reddit")
        source = 'reddit'

    # --- cache journalier ---
    cache_key = f"{source}_data_{crypto}_{timezone.now().strftime('%Y-%m-%d')}"
    texts = cache.get(cache_key, [])
    if texts and len(texts) >= 3:
        logger.info(f"{source.capitalize()} data from cache for {crypto}")
        return texts

    time.sleep(0.5)  # garde un léger backoff

    # --- alias & keywords locaux (au cas où non définis globalement) ---
    CRYPTO_ALIASES = globals().get("CRYPTO_ALIASES", {
        'bitcoin':  ['bitcoin', 'btc', '$btc'],
        'ethereum': ['ethereum', 'eth', '$eth'],
        'xrp':      ['xrp', '$xrp', 'ripple', 'xrpl'],
        'tether':   ['tether', 'usdt', '$usdt'],
        'bnb':      ['bnb', 'binance coin', '$bnb', 'binancecoin'],
        'solana':   ['solana', 'sol', '$sol'],
        'usdc':     ['usdc', 'usd coin', '$usdc', 'usd-coin'],
        'dogecoin': ['dogecoin', 'doge', '$doge'],
        'tron':     ['tron', 'trx', '$trx'],
        'cardano':  ['cardano', 'ada', '$ada'],
    })
    SENTI_KEYWORDS = [k.lower() for k in globals().get("SENTI_KEYWORDS", [
        'bullish', 'bearish', 'price', 'market', 'trading', 'invest', 'crypto',
        'buy', 'sell', 'sentiment', 'analysis', 'forecast', 'trend', 'adoption',
        'blockchain', 'stablecoin', 'value', 'wallet', 'exchange', 'defi', 'hodl',
        'pump', 'dump', 'bull', 'bear',
        # utiles pour XRP
        'xrpl', 'partner', 'lawsuit', 'sec', 'on-chain', 'bridge', 'utility'
    ])]

    if source == 'reddit':
        # --- quota global journalier ---
        global_quota_key = f"reddit_calls_{timezone.now().strftime('%Y-%m-%d')}"
        global_calls = cache.get(global_quota_key, 0)
        if global_calls >= 500:
            logger.warning(f"Quota Reddit atteint, using cache for {crypto}")
            return texts or []

        try:
            reddit = praw.Reddit(
                client_id=settings.REDDIT_CLIENT_ID,
                client_secret=settings.REDDIT_CLIENT_SECRET,
                user_agent='CryptoVibe/1.0 (by u/hashkao)'
            )

            # Subreddits ciblés
            subreddit = {
                'bitcoin': 'bitcoin+cryptocurrency+CryptoMarkets+BitcoinBeginners',
                'ethereum': 'ethereum+cryptocurrency+CryptoMarkets+ethfinance',
                'solana': 'solana+cryptocurrency+CryptoMarkets+CryptoMoonShots',
                'xrp': 'xrp+cryptocurrency+CryptoMarkets',
                'tether': 'cryptocurrency+stablecoin+CryptoMarkets+DeFi',
                'bnb': 'binance+cryptocurrency+CryptoMarkets+DeFi',
                'usdc': 'cryptocurrency+stablecoin+CryptoMarkets+DeFi',
                'dogecoin': 'dogecoin+cryptocurrency+CryptoMarkets+CryptoMoonShots',
                'tron': 'tron+cryptocurrency+CryptoMarkets',
                'cardano': 'cardano+cryptocurrency+CryptoMarkets'
            }.get(crypto, 'cryptocurrency')

            # Aliases + requête plus robuste
            aliases = [a.lower() for a in CRYPTO_ALIASES.get(crypto, [crypto])]
            # dédoublonne en gardant l'ordre
            aliases = list(dict.fromkeys(aliases))
            query = " OR ".join(aliases)

            texts_all = []
            for submission in reddit.subreddit(subreddit).search(query, sort='new', limit=600):
                title = submission.title or ""
                body  = submission.selftext or ""
                text  = f"{title} {body}".strip()
                if not text:
                    continue

                low = text.lower()
                has_alias   = any(a in low for a in aliases)
                has_senti_k = any(k in low for k in SENTI_KEYWORDS)

                # on accepte si alias présent + (keyword marché OU cas particulier xrp)
                if has_alias and (has_senti_k or crypto == 'xrp'):
                    # NB: on calcule le sentiment ailleurs; ici on n'empêche pas la collecte
                    # mais on log une mesure indicative
                    try:
                        pol = TextBlob(text).sentiment.polarity
                    except Exception:
                        pol = 0.0
                    texts_all.append(text)
                    logger.debug(f"Reddit {crypto}: texte={text[:80]}..., polarity={pol:.3f}")

            # Fallback léger pour xrp si rien dans subs dédiés
            if not texts_all and crypto == 'xrp':
                for submission in reddit.subreddit('cryptocurrency+CryptoMarkets').search(query, sort='new', limit=200):
                    title = submission.title or ""
                    body  = submission.selftext or ""
                    text  = f"{title} {body}".strip()
                    if not text:
                        continue
                    low = text.lower()
                    if any(a in low for a in aliases):
                        texts_all.append(text)

            texts = texts_all[:30]
            logger.info(f"Reddit fetched for {crypto}, {len(texts)} posts (query='{query}', sub='{subreddit}')")

            # maj quota + cache
            cache.set(global_quota_key, global_calls + 1, 86400)
            cache.set(cache_key, texts, 86400)

        except Exception as e:
            logger.error(f"Erreur collecting Reddit pour {crypto}: {e}")
            texts = []

    elif source == 'x':
        # Quota X simulé
        x_quota_key = f"x_calls_{timezone.now().strftime('%Y-%m')}"
        x_calls = cache.get(x_quota_key, 0)
        if x_calls >= 1500:
            logger.warning(f"Quota X atteint, using cache for {crypto}")
            return texts or []

        try:
            # Simulation simple (en attente d'une vraie clé X/Twitter)
            sentiments = ['bullish', 'bearish', 'neutral']
            texts = []
            for _ in range(10):
                s = random.choice(sentiments)
                text = f"{crypto.capitalize()} {s} sentiment on X. Price expected to {'rise' if s == 'bullish' else 'fall' if s == 'bearish' else 'stabilize'}."
                texts.append(text)
            logger.info(f"X simulation for {crypto}, {len(texts)} posts")
            cache.set(cache_key, texts, 86400)
        except Exception as e:
            logger.error(f"Erreur collecting X pour {crypto}: {e}")
            texts = []

    # Fallback final si rien du tout
    if not texts:
        logger.warning(f"Aucun texte pour {crypto}/{source}, using simulation")
        texts = [f"{crypto} {random.choice(['bullish sentiment', 'stable market', 'bearish outlook'])}." for _ in range(3)]

    return texts


def get_news(source='reddit'):
    cache_key = f"news_{source}_{timezone.now().strftime('%Y-%m-%d')}"
    cached_news = cache.get(cache_key)
    if cached_news:
        logger.info(f"News {source} récupérées du cache")
        return cached_news
    
    news_items = []
    
    if source == 'reddit':
        global_quota_key = f"reddit_calls_{timezone.now().strftime('%Y-%m-%d')}"
        global_calls = cache.get(global_quota_key, 0)
        if global_calls >= 500:
            logger.warning(f"Quota Reddit atteint pour get_news, using cache")
            return cached_news or []
        
        try:
            reddit = praw.Reddit(
                client_id=settings.REDDIT_CLIENT_ID,
                client_secret=settings.REDDIT_CLIENT_SECRET,
                user_agent='CryptoVibe/1.0 (by u/hashkao)'
            )
            # Utiliser des subreddits spécifiques comme dans collect_data
            subreddits = {
                'bitcoin': 'bitcoin+cryptocurrency+CryptoMarkets+BitcoinBeginners',
                'ethereum': 'ethereum+cryptocurrency+CryptoMarkets+ethfinance',
                'solana': 'solana+cryptocurrency+CryptoMarkets+CryptoMoonShots',
                'xrp': 'xrp+cryptocurrency+CryptoMarkets',
                'tether': 'cryptocurrency+stablecoin+CryptoMarkets+DeFi',
                'bnb': 'binance+cryptocurrency+CryptoMarkets+DeFi',
                'usdc': 'cryptocurrency+stablecoin+CryptoMarkets+DeFi',
                'dogecoin': 'dogecoin+cryptocurrency+CryptoMarkets+CryptoMoonShots',
                'tron': 'tron+cryptocurrency+CryptoMarkets',
                'cardano': 'cardano+cryptocurrency+CryptoMarkets'
            }
            for crypto in CRYPTO_LIST:
                subreddit = subreddits.get(crypto.lower(), 'cryptocurrency')
                for submission in reddit.subreddit(subreddit).search(crypto, sort='new', limit=50):
                    text = submission.title
                    if len(text) > 20 and crypto.lower() in text.lower() and any(kw in text.lower() for kw in ['bullish', 'bearish', 'price', 'market', 'trading', 'invest', 'crypto', 'buy', 'sell', 'sentiment', 'analysis', 'forecast', 'trend', 'adoption', 'blockchain', 'stablecoin', 'value', 'wallet', 'exchange', 'defi', 'hodl', 'pump', 'dump', 'bull', 'bear']):
                        news_items.append({
                            'text': text,
                            'link': f"https://www.reddit.com{submission.permalink}",
                            'source': 'reddit'
                        })
                        logger.debug(f"News Reddit: {text[:50]}...")
            news_items = news_items[:30]  # Limiter à 30 posts
            logger.info(f"Reddit news fetched: {len(news_items)} items")
            cache.set(global_quota_key, global_calls + 1, 86400)
        except Exception as e:
            logger.error(f"Erreur Reddit news: {e}")
    
    elif source == 'x':
        x_quota_key = f"x_calls_{timezone.now().strftime('%Y-%m')}"
        x_calls = cache.get(x_quota_key, 0)
        if x_calls >= 1500:
            logger.warning(f"Quota X atteint pour get_news, using cache")
            return cached_news or []
        
        try:
            # Simulation réaliste
            sentiments = ['bullish', 'bearish', 'neutral']
            for _ in range(10):
                crypto = random.choice(CRYPTO_LIST)
                sentiment = random.choice(sentiments)
                text = f"{crypto.capitalize()} {sentiment} sentiment on X. Price expected to {'rise' if sentiment == 'bullish' else 'fall' if sentiment == 'bearish' else 'stabilize'}."
                news_items.append({'text': text, 'link': '#', 'source': 'x'})
            logger.info(f"X news simulation: {len(news_items)} items")
            # Décommentez fin août avec clé HKO
            """
            headers = {'Authorization': f'Bearer {settings.X_API_KEY}'}
            query = ' OR '.join(CRYPTO_LIST)
            url = f"https://api.x.com/2/tweets/search/recent?query={query}&max_results=100"
            response = requests.get(url, headers=headers, timeout=5)
            response.raise_for_status()
            for tweet in response.json().get('data', []):
                text = tweet['text']
                if any(crypto.lower() in text.lower() for crypto in CRYPTO_LIST) and any(kw in text.lower() for kw in ['bullish', 'bearish', 'price', 'market', 'trading', 'invest', 'crypto', 'buy', 'sell', 'sentiment', 'analysis', 'forecast', 'trend', 'adoption', 'blockchain', 'stablecoin', 'value', 'wallet', 'exchange', 'defi', 'hodl', 'pump', 'dump', 'bull', 'bear']):
                    news_items.append({'text': text, 'link': f"https://x.com/statuses/{tweet['id']}", 'source': 'x'})
            logger.info(f"X news fetched: {len(news_items)} items")
            cache.set(x_quota_key, x_calls + 1, 30*86400)
            """
        except Exception as e:
            logger.error(f"Erreur X news: {e}")
    
    if not news_items:
        logger.warning(f"Aucune news pour {source}, using fallback")
        news_items = [
            {'text': f"{random.choice(CRYPTO_LIST).capitalize()} stable market.", 'link': '#', 'source': source},
            {'text': f"{random.choice(CRYPTO_LIST).capitalize()} bullish sentiment.", 'link': '#', 'source': source},
            {'text': f"{random.choice(CRYPTO_LIST).capitalize()} bearish outlook.", 'link': '#', 'source': source}
        ]
    
    cache.set(cache_key, news_items, 86400)
    return news_items

def analyze_sentiment(texts):
    if not texts:
        return "Neutre", 0.0
    scores = [TextBlob(text).sentiment.polarity for text in texts]
    avg_score = sum(scores) / len(scores)
    vibe = "Positif" if avg_score > 0.05 else "Négatif" if avg_score < -0.05 else "Neutre"
    return vibe, avg_score


def _calibrate_conf(rel_width: float) -> float:
    """
    rel_width = (yhat_up - yhat_low)/|yhat|
    Mapping plus prudent:
      - width 1%  -> ~80%
      - width 3%  -> ~60%
      - width 6%  -> ~30%
    Et on borne à [10, 85].
    """
    raw = 100.0 * (1.0 - (rel_width / 0.12))  # 12% de largeur -> 0%
    return round(max(10.0, min(85.0, raw)), 1)




def predict_price(crypto: str, source: str | None = None, lookback_hours: int = 72, base_freq: str = "5min", horizon_minutes: int = 60):
    crypto = (crypto or "").lower()
    if source != 'reddit':
        source = 'reddit'
    
    since = timezone.now() - timedelta(hours=lookback_hours + 2)
    
    # 1) Prix CoinGecko
    rows_price = (SentimentData.objects
                  .filter(crypto=crypto, source="coingecko", timestamp__gte=since, price_eur__isnull=False)
                  .order_by("timestamp")
                  .values("timestamp", "price_eur"))
    
    if not rows_price:
        return 0.0, 0.0
    
    df_raw = pd.DataFrame(list(rows_price))
    ts = pd.to_datetime(df_raw["timestamp"], errors="coerce", utc=True)
    df = pd.DataFrame({
        "ds": ts.dt.tz_convert("UTC").dt.tz_localize(None),
        "y": pd.to_numeric(df_raw["price_eur"], errors="coerce")
    }).dropna(subset=["ds", "y"])
    
    if df.empty:
        return 0.0, 0.0
    
    df = df.drop_duplicates(subset=["ds"]).sort_values("ds")
    df_price = (df.set_index("ds").resample(base_freq).last().ffill().reset_index())
    
    # 2) Sentiments Reddit
    rows_sentiment = (SentimentData.objects
                      .filter(crypto=crypto, source='reddit', timestamp__gte=since, score__isnull=False)
                      .order_by("timestamp")
                      .values("timestamp", "score"))
    
    if rows_sentiment:
        df_sent = pd.DataFrame(list(rows_sentiment))
        ts_sent = pd.to_datetime(df_sent["timestamp"], errors="coerce", utc=True)
        df_sent = pd.DataFrame({
            "ds": ts_sent.dt.tz_convert("UTC").dt.tz_localize(None),
            "score": pd.to_numeric(df_sent["score"], errors="coerce")
        }).dropna(subset=["ds", "score"])
        
        df_sent = df_sent.drop_duplicates(subset=["ds"]).sort_values("ds")
        df_sent_resampled = (df_sent.set_index("ds")
                             .resample(base_freq)
                             .ffill(limit=12)
                             .reset_index())
        df_sent_resampled['score'] = df_sent_resampled['score'].fillna(0.0)
        
        df = df_price.merge(df_sent_resampled, on="ds", how="left")
        df['score'] = df['score'].ffill().fillna(0.0)
        logger.info(f"Mean score for {crypto}/reddit: {df['score'].mean()}")
    else:
        df['score'] = 0.0
        logger.warning(f"No sentiment data for {crypto}/reddit")
    
    # 3) Smoothing
    if len(df) >= 40:
        logy = np.log(df["y"].values)
        rets = np.diff(logy)
        sigma = np.nanstd(rets)
        if np.isfinite(sigma) and sigma > 0:
            rets_clipped = np.clip(rets, -5 * sigma, 5 * sigma)
            logy_smooth = np.empty_like(logy)
            logy_smooth[0] = logy[0]
            logy_smooth[1:] = logy_smooth[0] + np.cumsum(rets_clipped)
            df["y"] = np.exp(logy_smooth)
    
    # 4) Fallback court
    if len(df) < 30:
        df = df.set_index("ds").resample("1H").last().ffill().reset_index()
        base_freq = "1H"
    
    if len(df) < 10:
        return float(df["y"].iloc[-1]), 20.0
    
    # 5) Prophet
    m = Prophet(
        yearly_seasonality=False,
        weekly_seasonality=True,
        daily_seasonality=True,
        seasonality_mode="multiplicative",
        changepoint_prior_scale=0.01,
        changepoint_range=0.8,
    )
    if 'score' in df.columns:
        m.add_regressor('score', prior_scale=0.5, mode='multiplicative')
    
    try:
        m.fit(df[["ds", "y", "score"]] if 'score' in df.columns else df[["ds", "y"]])
    except Exception as e:
        logger.error(f"Prophet fit error: {e}")
        return float(df["y"].iloc[-1]), 50.0
    
    # 6) Horizon
    step_minutes = 60 if base_freq.upper() == "1H" else 5
    periods = max(1, int(math.ceil(horizon_minutes / step_minutes)))
    future = m.make_future_dataframe(periods=periods, freq=base_freq, include_history=True)
    if 'score' in df.columns:
        recent_score = df['score'].iloc[-12:].mean()
        future['score'] = recent_score
    
    fcst = m.predict(future)
    row = fcst.iloc[-1]
    yhat = float(row["yhat"])
    yhat_low = float(row.get("yhat_lower", yhat))
    yhat_up = float(row.get("yhat_upper", yhat))
    
    # Nouvelle calibration de confiance
    rel_width = (yhat_up - yhat_low) / max(1e-9, abs(yhat))
    base_conf = 65.0 - min(30.0, rel_width * 50.0)  # Plafonné à 65%
    score_mean = df['score'].mean() if 'score' in df.columns else 0.0
    data_points = len(df)
    
    conf = base_conf
    if crypto == 'bitcoin':
        conf *= 0.9  # Réduction plus forte pour Bitcoin
    if abs(score_mean) < 0.01:  # Score proche de 0
        conf *= 0.7
    elif score_mean < -0.05:  # Score négatif significatif
        conf *= 0.8
    if data_points < 20:  # Peu de données
        conf *= 0.6
    
    conf = max(30.0, min(65.0, conf))  # Plage 30-65%
    
    # Simulation de postprocess_pred_1h (ajustez selon votre version)
    safe_price = yhat
    safe_conf = max(30.0, min(65.0, conf))  # Forcer la plage
    logger.info(f"Confidence for {crypto}: {safe_conf:.1f}% (before postprocess: {conf:.1f}%)")
    
    return float(safe_price), float(safe_conf)








def crypto_slot(crypto: str, interval_min: int = 15) -> int:
    """Décalage stable (0..interval_min-1) pour étaler les rafraîchissements."""
    h = zlib.adler32((crypto or "").encode("utf-8"))
    return h % interval_min

def safe_collect_data(crypto: str, source: str) -> list[str]:
    """Collecte protégée: ne jette jamais d'exception, renvoie [] en cas d'erreur."""
    try:
        return collect_data(crypto, source) or []
    except Exception:
        logger.exception("collect_data failed for %s/%s", crypto, source)
        return []




def predict_price_cached(crypto: str, source: str | None = None, ttl: int = 3600):
    key = f"pred1h:{crypto.lower()}:{(source or 'none').lower()}"
    cached = cache.get(key)
    if cached:
        return cached

    # anti-stampede: lock 20s
    lock_key = f"lock:{key}"
    if not cache.add(lock_key, 1, timeout=20):
        # Quelqu’un calcule déjà -> attendre un tout petit peu le résultat
        cached = cache.get(key)
        if cached:
            return cached
        # petit backoff (optionnel)
        time.sleep(0.3)
        cached = cache.get(key)
        if cached:
            return cached
        # Sinon on sert un fallback léger (dernier prix connu) pour ne pas bloquer
        # ou on calcule quand même si tu préfères.
    
    try:
        price, conf = predict_price(crypto, source)
        payload = (float(price), float(conf))
        cache.set(key, payload, ttl)
        return payload
    finally:
        cache.delete(lock_key)






from datetime import timedelta
import pytz
import logging

logger = logging.getLogger(__name__)








from .views import predict_price_cached  # adapte l'import si nécessaire

@require_GET
def get_vibe(request, crypto, source='reddit'):
    crypto_l = (crypto or "").lower()
    source = 'reddit'  # on verrouille la source "vibe"

    # --- clé cache par tranche 5 minutes ---
    now = timezone.now()
    bucket_minute = (now.minute // 5) * 5
    bucket = now.replace(minute=bucket_minute, second=0, microsecond=0)
    cache_key = f"vibe_{crypto_l}_{source}_{bucket.strftime('%Y%m%d_%H%M')}"
    data = cache.get(cache_key)

    if not data:
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        last24 = now - timedelta(hours=24)

        # ✅ NOUVEAU : on prend simplement la DERNIÈRE mesure dispo (plus de minute==0)
        last = (
            SentimentData.objects
            .filter(
                crypto=crypto_l,
                source=source,
                score__isnull=False,
            )
            .order_by('-timestamp')
            .first()
        )

        # --- Prix: cache → DB (fallbacks en cascade, source=coingecko) ---
        price = None
        prices_cache = cache.get(f"all_prices_{time.strftime('%Y-%m-%d_%H')}")
        if prices_cache:
            v = prices_cache.get(crypto_l)
            if v is not None:
                try:
                    price = float(v)
                except Exception:
                    price = None

        def _latest_cg(qs):
            obj = (
                qs.filter(source='coingecko')
                  .exclude(price_eur__isnull=True)
                  .order_by('-timestamp')
                  .first()
            )
            return float(obj.price_eur) if obj and obj.price_eur is not None else None

        if price is None:
            qs = SentimentData.objects.filter(
                crypto__in=[crypto_l, 'ripple'], timestamp__gte=today_start
            )
            price = _latest_cg(qs)

        if price is None:
            qs = SentimentData.objects.filter(
                crypto__in=[crypto_l, 'ripple'], timestamp__gte=last24
            )
            price = _latest_cg(qs)

        if price is None:
            qs = SentimentData.objects.filter(crypto__in=[crypto_l, 'ripple'])
            price = _latest_cg(qs)

        # Valeurs vibe & score (défauts si aucune ligne trouvée)
        vibe = last.sentiment if last and last.sentiment else "Neutre"
        score = float(last.score) if last and last.score is not None else 0.0
        last_update = last.timestamp.isoformat() if last else None

        # Prédiction (heure locale Paris +1h affichée)
        local_now = now.astimezone(pytz.timezone('Europe/Paris'))
        prediction_time = (local_now + timedelta(hours=1)).strftime('%H:%M')
        predicted_price, confidence = predict_price_cached(crypto_l, source)

        data = {
            'crypto': crypto_l,
            'vibe': vibe,
            'score': score,
            'price_eur': price,
            'predicted_price': predicted_price,
            'confidence': confidence,
            'source': source,
            'prediction_time': prediction_time,
            'last_update': last_update,
            'next_update_hint': '08:00 & 20:00 Europe/Paris',
        }
        cache.set(cache_key, data, 5 * 60)

    logger.info(f"[get_vibe] {crypto_l} ({source}) => {data}")
    return JsonResponse(data)




@require_GET
def get_history(request, crypto):
    """
    Historique horaire (1 point / heure, dernière valeur de chaque heure).
    Params:
      ?hours=H  (défaut 24)
      ?limit=N  (défaut 24)
      ?include_current=0/1 (optionnel) :
         - si absent, on inclut l'heure en cours S'IL EXISTE au moins un point dans cette heure.
    """
    crypto = (crypto or "").lower()

    # Params
    try:
        hours = int(request.GET.get("hours", 24))
    except Exception:
        hours = 24
    hours = max(1, min(hours, 24 * 7))  # borne: 1h..7j

    try:
        limit = int(request.GET.get("limit", 24))
    except Exception:
        limit = 24
    limit = max(1, min(limit, 24 * 7))

    force_param = (request.GET.get("include_current") or "").lower().strip()
    force_include_current = None
    if force_param in ("1", "true", "yes", "y", "on"):
        force_include_current = True
    elif force_param in ("0", "false", "no", "n", "off"):
        force_include_current = False

    now_utc = timezone.now()
    since = now_utc - timedelta(hours=hours)

    # Query brut (on lit sur le primary)
    qs = (
        SentimentData.objects.using(DB_ALIAS)
        .filter(
            crypto=crypto,
            source="coingecko",
            timestamp__gte=since,
            price_eur__isnull=False,
        )
        .order_by("timestamp")
        .values("price_eur", "timestamp")
    )

    # Agrégation par heure Europe/Paris : on conserve la DERNIÈRE valeur de chaque heure
    paris = pytz.timezone("Europe/Paris")
    by_hour = {}
    for item in qs:
        ts_utc = item["timestamp"]
        ts_local = ts_utc.astimezone(paris)
        hour_key = ts_local.strftime("%Y-%m-%d %H")  # clé heure locale
        # on écrase à chaque fois → au final, c'est la dernière valeur de l'heure
        by_hour[hour_key] = {
            "price_eur": float(item["price_eur"]),
            "timestamp": ts_utc.isoformat(),
        }

    keys_sorted = sorted(by_hour.keys())
    out = [by_hour[k] for k in keys_sorted]

    # Heure courante (Europe/Paris)
    now_local = now_utc.astimezone(paris)
    current_hour_key = now_local.strftime("%Y-%m-%d %H")
    has_current_hour = current_hour_key in by_hour

    # Inclure ou non l'heure courante
    if force_include_current is not None:
        include_current = force_include_current
        mode = "forced"
    else:
        include_current = has_current_hour  # par défaut: inclure seulement si on a au moins 1 point dans l'heure
        mode = "auto"

    if not include_current and out:
        last_key = keys_sorted[-1]
        if last_key == current_hour_key:
            out = out[:-1]

    if len(out) > limit:
        out = out[-limit:]

    logger.info(
        "History(hourly) for %s: %d points, include_current=%s(%s), has_current=%s, first=%s",
        crypto, len(out), include_current, mode, has_current_hour, out[:3]
    )
    return JsonResponse(out, safe=False)







from datetime import timedelta
import pytz
import logging


logger = logging.getLogger(__name__)

def get_all_history(request):
    """
    Retourne l'historique horaire (1 point / heure) pour un ensemble de cryptos.
    
    Paramètres GET :
      ?hours=H   -> Nombre d'heures à inclure (défaut : 24)
      ?limit=N   -> Nombre maximum de points par crypto (défaut : 24)
    """
    try:
        hours = int(request.GET.get("hours", 24))
    except (ValueError, TypeError):
        hours = 24

    try:
        limit = int(request.GET.get("limit", 24))
    except (ValueError, TypeError):
        limit = 24

    since = timezone.now() - timedelta(hours=hours)
    cryptos = ['bitcoin', 'ethereum', 'xrp', 'tether', 'bnb', 'solana', 'usdc', 'dogecoin', 'tron', 'cardano']

    paris = pytz.timezone('Europe/Paris')
    result = {}

    for crypto in cryptos:
        # Récupération des données filtrées
        qs = (
            SentimentData.objects
            .filter(
                crypto=crypto,
                source='coingecko',
                timestamp__gte=since,
                price_eur__isnull=False
            )
            .order_by('timestamp')
            .values('price_eur', 'timestamp')
        )

        # Regroupement par heure locale
        by_hour = {}
        for item in qs:
            ts_local = item["timestamp"].astimezone(paris)
            hour_key = ts_local.strftime('%Y-%m-%d %H')
            by_hour[hour_key] = {
                "price_eur": float(item["price_eur"]),
                "timestamp": item["timestamp"].isoformat()
            }

        # Conversion en liste ordonnée
        arr = [by_hour[k] for k in sorted(by_hour.keys())]

        # Limitation du nombre de points
        if len(arr) > limit:
            arr = arr[-limit:]

        result[crypto] = arr
        logger.info("AllHistory(hourly) %s: %d points", crypto, len(arr))

    return JsonResponse(result)




def get_all_news(request):
    news_items = get_news()
    return JsonResponse(news_items, safe=False)

def vibe_index(request):
    return render(request, 'crypto_vibe/vibe_dashboard.html')




def is_valid_price(crypto, price):
    """Validation stricte avec seuils minimum/maximum par crypto."""
    try:
        p = float(price)
    except (TypeError, ValueError):
        return False
    if p <= 0:
        return False
    thresholds = {
        'bitcoin': (1000, 2_000_000),
        'ethereum': (100, 10_000),
        'xrp': (0.1, 10),
        'tether': (0.5, 2),
        'bnb': (50, 2000),
        'solana': (10, 500),
        'usdc': (0.5, 2),
        'dogecoin': (0.01, 1),
        'tron': (0.01, 1),
        'cardano': (0.01, 5),
    }
    min_price, max_price = thresholds.get(crypto.lower(), (0.0001, 1_000_000))
    valid = min_price <= p <= max_price
    if not valid:
        logger.warning(f"[is_valid_price] Prix invalide pour {crypto}: {p} (min: {min_price}, max: {max_price})")
    return valid





# --- Batch CoinGecko (EUR) avec auto-détection demo/pro + cache ---


CG_IDS = {
    'bitcoin': 'bitcoin',
    'ethereum': 'ethereum',
    'xrp': 'ripple',
    'tether': 'tether',
    'bnb': 'bnb',
    'bnb': 'binancecoin',
    'solana': 'solana',
    'usdc': 'usd-coin',
    'dogecoin': 'dogecoin',
    'tron': 'tron',
    'cardano': 'cardano',
}

CC_SYMBOLS = {
    'bitcoin': 'BTC', 'ethereum': 'ETH', 'xrp': 'XRP', 'tether': 'USDT',
    'bnb': 'BNB', 'solana': 'SOL', 'usdc': 'USDC', 'dogecoin': 'DOGE',
    'tron': 'TRX', 'cardano': 'ADA',
}

def _coingecko_base_and_header():
    """Choisit l'URL + header selon la clé (Demo vs Pro)."""
    key = getattr(settings, "COINGECKO_API_KEY", None)
    ua = {"User-Agent": "hashkao-crypto-vibe/1.0"}
    if not key:
        # public sans clé (évite 429 si possible, mais on a le batch+cache)
        return "https://api.coingecko.com", ua
    # Essaye DEMO d’abord (ton cas actuel)
    h = dict(ua); h["x-cg-demo-api-key"] = key
    return "https://api.coingecko.com", h
    # Si un jour tu passes en PRO, remplace par :
    # h = dict(ua); h["x-cg-pro-api-key"] = key
    # return "https://pro-api.coingecko.com", h

def _coingecko_batch_prices_eur(cryptos, cache_ttl=55):
    """
    Un SEUL appel CoinGecko pour plusieurs coins.
    Cache ~55s pour éviter 429 et sur-solliciter l'API.
    Retour: {local_id: price_eur|None}
    """
    cryptos = [c.lower() for c in cryptos]
    minute_bucket = timezone.now().strftime('%Y-%m-%d_%H:%M')
    cache_key = f"cg:batch:eur:{minute_bucket}"
    cached = cache.get(cache_key)
    if cached is not None:
        logger.info("[COINGECKO][batch] from cache")
        return cached

    cg_ids = []
    local_by_cg = {}
    for local in sorted(set(cryptos)):
        cg = CG_IDS.get(local)
        if cg:
            cg_ids.append(cg)
            local_by_cg[cg] = local
    if not cg_ids:
        return {}

    base, headers = _coingecko_base_and_header()
    url = f"{base}/api/v3/simple/price"
    params = {"ids": ",".join(cg_ids), "vs_currencies": "eur"}

    data = {}
    for attempt in range(3):
        resp = requests.get(url, params=params, headers=headers, timeout=8)
        # Retry/backoff sur 429/5xx
        if resp.status_code in (429, 500, 502, 503, 504):
            wait = (attempt + 1) * 1.5
            logger.warning("[COINGECKO][batch] %s -> retry in %.1fs", resp.status_code, wait)
            time.sleep(wait)
            continue
        resp.raise_for_status()
        payload = resp.json()
        # payload attendu: {cg_id: {"eur": 123.45}, ...}
        out = {}
        for cg_id, obj in payload.items():
            local = local_by_cg.get(cg_id)
            if not local:
                continue
            price = obj.get("eur")
            out[local] = price if isinstance(price, (int, float)) and 0 < price < 1_000_000 else None
        data = out
        break

    cache.set(cache_key, data, cache_ttl)
    return data




def get_real_price(crypto_id):
    """
    Lit le prix EUR via batch CoinGecko (cache ~55s).
    Fallback CryptoCompare si manquant.
    """
    local = (crypto_id or "").lower().strip()
    try:
        # Remplit/consomme le cache batch avec ta liste globale
        all_ids = CRYPTO_LIST if 'CRYPTO_LIST' in globals() else [local]
        batch = _coingecko_batch_prices_eur(all_ids, cache_ttl=55)
        price = batch.get(local)
        if price:
            logger.info(f"[COINGECKO] Prix pour {local}: {price} EUR")
            return price
        logger.warning(f"[COINGECKO] Pas de prix pour {local} dans batch")
    except Exception as e:
        logger.error(f"[COINGECKO] Erreur batch pour {local}: {e}")

    # Fallback CryptoCompare (symboles mappés)
    try:
        sym = CC_SYMBOLS.get(local)
        if not sym:
            logger.warning(f"[CRYPTOCOMPARE] Symbole inconnu pour {local}")
            return None
        cc_url = f"https://min-api.cryptocompare.com/data/price?fsym={sym}&tsyms=EUR"
        rr = requests.get(cc_url, timeout=6, headers={"User-Agent": "hashkao-crypto-vibe/1.0"})
        rr.raise_for_status()
        eur = rr.json().get("EUR")
        if isinstance(eur, (int, float)) and 0 < eur < 1_000_000:
            logger.info(f"[CRYPTOCOMPARE] Prix fallback pour {local}: {eur} EUR")
            return eur
        logger.warning(f"[CRYPTOCOMPARE] Prix invalide pour {local}: {eur}")
    except Exception as ee:
        logger.error(f"[CRYPTOCOMPARE] Erreur pour {local}: {ee}")
    return None






def inject_fake_data(request, crypto='bitcoin'):
    return HttpResponse("Cette fonction est désactivée : les vraies données sont désormais utilisées.")

def vibe_detail(request, crypto, source):
    context = {
        'crypto': crypto,
        'source': source,
    }
    return render(request, 'crypto_vibe/vibe_detail.html', context)

def get_sentiment_history(request, crypto, source):
    from django.utils.timezone import now
    since = now() - timedelta(hours=24)
    data = (
        SentimentData.objects
        .filter(crypto=crypto.lower(), source=source, timestamp__gte=since)
        .order_by('timestamp')
    )
    seen_hours = set()
    filtered = []
    for entry in data:
        if entry.price_eur is not None and entry.price_eur != 0:
            hour_str = entry.timestamp.astimezone(pytz.timezone('Europe/Paris')).strftime('%Y-%m-%d %H')
            if hour_str not in seen_hours:
                seen_hours.add(hour_str)
                filtered.append({
                    'price_eur': entry.price_eur,
                    'timestamp': entry.timestamp.isoformat(),
                })
    logger.info(f"Raw history prices for {crypto}/{source}: {[item['price_eur'] for item in filtered if item]}")
    return JsonResponse(filtered, safe=False)

def vibe_detail_view(request, crypto, source):
    return render(request, 'crypto_vibe/vibe_detail.html', {
        'crypto': crypto,
        'source': source
    })

from crypto_vibe.services.prices import get_all_prices_core

@require_GET
def get_all_prices(request):
    # support debug: ?nocache=1
    bypass = request.GET.get("nocache") == "1"
    data = get_all_prices_core(bypass_cache=bypass)

    # harmoniser l’alias ripple → xrp si besoin
    if "ripple" in data and "xrp" not in data:
        data["xrp"] = data.pop("ripple")

    return JsonResponse(data, safe=False)












@require_GET
def get_latest_prices(request):
    # Option debug: ?nocache=1 pour contourner le cache
    bypass_cache = (request.GET.get("nocache") == "1")

    # Bucket de 5 minutes pour coller aux insertions save_prices
    now = timezone.now()
    minute_bucket = (now.minute // 5) * 5  # 0,5,10,15,...
    bucket_dt = now.replace(minute=minute_bucket, second=0, microsecond=0)
    cache_key = f"latest_prices_{now.strftime('%Y-%m-%d_%H')}:{minute_bucket:02d}"

    if not bypass_cache:
        cached_prices = cache.get(cache_key)
        if cached_prices is not None:
            logger.info("Prix récupérés du cache (bucket 5min)")
            return JsonResponse(cached_prices, safe=False)

    prices = {}

    # 1) essai: lire toutes les valeurs du bucket exact en un seul query
    rows = (SentimentData.objects.using(DB_ALIAS)
            .filter(
                source='coingecko',
                timestamp=bucket_dt,
                crypto__in=CRYPTO_LIST,
                price_eur__isnull=False
            )
            .values('crypto', 'price_eur', 'timestamp'))

    for r in rows:
        c = r['crypto']
        p = float(r['price_eur'])
        ts = r['timestamp'].isoformat()
        prices[c] = {'price': p, 'price_eur': p, 'timestamp': ts}

    # 2) fallback par crypto manquante: dernière valeur < 24h
    if len(prices) < len(CRYPTO_LIST):
        since = now - timedelta(hours=24)
        for crypto_id in CRYPTO_LIST:
            if crypto_id in prices:
                continue
            latest = (SentimentData.objects.using(DB_ALIAS)
                      .filter(
                          crypto=crypto_id,
                          source='coingecko',
                          timestamp__gte=since,
                          price_eur__isnull=False
                      )
                      .order_by('-timestamp')
                      .values('price_eur', 'timestamp')
                      .first())
            if latest:
                p = float(latest['price_eur'])
                ts = latest['timestamp'].isoformat()
                prices[crypto_id] = {'price': p, 'price_eur': p, 'timestamp': ts}
            else:
                prices[crypto_id] = {'price': None, 'price_eur': None, 'timestamp': None}

    # TTL légèrement > 5 min pour tolérer un léger drift d’horloge
    cache.set(cache_key, prices, 330)
    return JsonResponse(prices, safe=False)







def latest_coingecko_test(request):
    data = {}
    for crypto in CRYPTO_LIST:
        entry = SentimentData.objects.filter(crypto=crypto, source='coingecko').order_by('-timestamp').first()
        if entry:
            data[crypto] = {
                'price_eur': entry.price_eur,
                'timestamp': entry.timestamp.isoformat(),  # Iso pour JSON safe
            }
            logger.info(f"Test dernier prix {crypto}: {entry.price_eur} € à {entry.timestamp}")
        else:
            logger.warning(f"Aucune entrée coingecko pour {crypto}")
    return JsonResponse(data)

from django.http import HttpResponse, JsonResponse


def status_view(request):
    # JSON "riche"
    return JsonResponse({
        "ok": True,
        "app": "hashkao",
        "time": timezone.now().isoformat()
    })

def stat_view(request):
    # Variante minimaliste en texte
    return HttpResponse("OK", content_type="text/plain")


# views.py

from django.db.models import OuterRef, Subquery


def get_coincap_ticker(request):
    """
    Renvoie le dernier ticker CoinCap par crypto, au format:
    {
      ok: True,
      count: N,
      data: [{id, price_eur, price_usd, change_1h, change_24h, direction, ts}]
    }
    Params optionnels:
      ?sort=alpha|change1h|change24h (def: alpha)
      ?dir=asc|desc (def: desc pour change*, asc pour alpha)
      ?limit=40
      ?basis=1h|24h  (def: 1h pour la flèche)
    """
    basis = (request.GET.get("basis") or "1h").lower()  # flèche basée sur 1h par défaut
    sort = (request.GET.get("sort") or "alpha").lower()
    direction = (request.GET.get("dir") or "").lower()
    try:
        limit = int(request.GET.get("limit") or 0)
    except ValueError:
        limit = 0

    # Sous-requête: dernier id par crypto
    latest_ids = (
        CoinCapTicker.objects
        .filter(crypto=OuterRef('crypto'))
        .order_by('-timestamp')
        .values('id')[:1]
    )

    rows = (
        CoinCapTicker.objects
        .filter(id__in=Subquery(latest_ids))
        .values('crypto','price_eur','price_usd','change_1h','change_24h','timestamp')
    )

    data = []
    for r in rows:
        ch1h = float(r['change_1h'] or 0.0)
        ch24 = float(r['change_24h'] or 0.0)
        dir_flag = 'up' if (ch1h if basis=='1h' else ch24) > 0 else ('down' if (ch1h if basis=='1h' else ch24) < 0 else 'flat')
        data.append({
            "id": r["crypto"],
            "price_eur": float(r["price_eur"]),
            "price_usd": float(r["price_usd"]),
            "change_1h": ch1h,
            "change_24h": ch24,
            "direction": dir_flag,
            "ts": r["timestamp"].isoformat(),
        })

    # Tri
    if sort == "change1h":
        data.sort(key=lambda x: x["change_1h"], reverse=(direction != "asc"))
    elif sort == "change24h":
        data.sort(key=lambda x: x["change_24h"], reverse=(direction != "asc"))
    else:  # alpha
        data.sort(key=lambda x: x["id"].lower(), reverse=(direction == "desc"))

    if limit > 0:
        data = data[:limit]

    return JsonResponse({"ok": True, "count": len(data), "data": data})




@require_GET
def get_prediction_source(request, crypto, source):
    try:
        crypto = (crypto or "").lower()
        if source != "reddit":
            return JsonResponse({"ok": False, "error": "Seule la source 'reddit' est supportée"}, status=400)

        now = timezone.now()
        key = f"predv2:reddit:{crypto}"
        cached = cache.get(key)

        if cached is None:
            last = (SentimentData.objects
                    .filter(crypto=crypto, source='reddit')
                    .exclude(predicted_price__isnull=True, confidence__isnull=True)
                    .order_by('-timestamp')
                    .first())
            price = float(getattr(last, "predicted_price", 0.0) or 0.0)
            conf = float(getattr(last, "confidence", 0.0) or 0.0)
            cached = {"price": price, "conf": conf, "ts": float(now.timestamp())}
            cache.set(key, cached, 900)  # 15 min

        price = round(float(cached.get("price", 0.0)), 2)
        conf = round(float(cached.get("conf", 0.0)), 1)
        ts = float(cached.get("ts", now.timestamp()))
        cached_at = datetime.fromtimestamp(ts, tz=py_tz.utc).isoformat()

        return JsonResponse({
            "ok": True,
            "crypto": crypto,
            "source": "reddit",
            "predicted_price": price,
            "confidence": conf,
            "predict_at": (now + timedelta(hours=1)).isoformat(),
            "cached_at": cached_at,
            "method": "DB(reddit)",  # ← plus "Prophet(reddit)"
        })

    except Exception:
        logger.exception("get_prediction_source fatal for %s/reddit", crypto)
        return JsonResponse({
            "ok": False,
            "crypto": crypto,
            "source": "reddit",
            "error": "internal_error"
        }, status=200)



















logger = logging.getLogger(__name__)

@require_GET
def get_prediction_hko(request, crypto):
    now = timezone.now()
    crypto = (crypto or "").lower()

    # --- helpers d'affichage & jitter ---
    def _round_step(last_p):
        try:
            lp = float(last_p)
        except Exception:
            lp = 1.0
        if lp >= 10:
            return 0.01
        elif lp >= 1:
            return 0.0001
        else:
            return 0.000001

    def _round_by_scale(val, last_p):
        step = _round_step(last_p)
        return float(round(float(val) / step) * step)

    def _tiny_jitter_eur(base_price, seed):
        """
        Jitter déterministe minuscule mais visible selon l'ordre de grandeur.
        """
        p = float(base_price or 1.0)
        if p >= 50_000:
            lo, hi = 1.0, 3.0
        elif p >= 1_000:
            lo, hi = 0.5, 2.0
        elif p >= 10:
            lo, hi = 0.02, 0.20
        elif p >= 1:
            lo, hi = 0.005, 0.05
        else:
            lo, hi = 0.0001, 0.005

        u = (seed % 10_000) / 10_000.0  # 0..1
        sign = 1.0 if (seed % 2 == 0) else -1.0
        amp = lo + (hi - lo) * u
        return sign * amp

    # --- récup prédiction "Prophet(reddit)" (cache ~15 min) ---
    def _get_cached_source_pred(_crypto, ttl=900):
        key = f"predv2:reddit:{_crypto}"
        item = cache.get(key)
        if item:
            return item
        try:
            from .views import predict_price
            price, conf = predict_price(_crypto, 'reddit')
        except Exception:
            price, conf = 0.0, 0.0
        payload = {
            "price": float(price or 0.0),
            "conf": float(conf or 0.0),
            "ts": now.timestamp(),
        }
        cache.set(key, payload, ttl)
        return payload

    # --- cache court HKO (par minute) ---
    cache_key = f"hko_pred:{crypto}:{now.strftime('%Y%m%d%H%M')}"
    cached = cache.get(cache_key)
    if cached:
        return JsonResponse(cached)

    # --- fenêtre d'observation ---
    try:
        lookback_hours = int(request.GET.get("hours", 6))
    except Exception:
        lookback_hours = 6
    lookback_hours = max(2, min(lookback_hours, 72))

    since = now - timedelta(hours=lookback_hours)
    qs = (SentimentData.objects
          .filter(crypto=crypto, source='coingecko',
                  timestamp__gte=since, price_eur__isnull=False)
          .order_by('timestamp')
          .values('timestamp', 'price_eur'))

    prices = [float(r['price_eur']) for r in qs]
    times = [r['timestamp'] for r in qs]

    if len(prices) < 4:
        last = prices[-1] if prices else 0.0
        payload = {
            "ok": True, "crypto": crypto,
            "predicted_price": _round_by_scale(last, last),
            "confidence": 50.0,
            "predict_at": (now + timedelta(hours=1)).isoformat(),
            "valid_for_minutes": 60,
            "method": "fallback",
            "last_price": _round_by_scale(last, last),
        }
        cache.set(cache_key, payload, 55)
        return JsonResponse(payload)

    last_price = prices[-1]

    # --- baseline: régression linéaire ---
    t0 = times[0]
    tmins = np.array([(t - t0).total_seconds() / 60.0 for t in times], dtype=float)
    y = np.array(prices, dtype=float)
    A = np.vstack([np.ones_like(tmins), tmins]).T
    try:
        coef, _, _, _ = np.linalg.lstsq(A, y, rcond=None)
        a, b = coef
    except Exception:
        a, b = last_price, 0.0
    pred_60 = a + b * (tmins[-1] + 60.0)

    # --- petit ajustement vibe (±1%) ---
    today = now.date()
    senti = (SentimentData.objects
             .filter(crypto=crypto, source='reddit', timestamp__date=today)
             .order_by('-timestamp')
             .values_list('score', flat=True)
             .first())
    vibe_adj = 0.0
    if senti is not None:
        s = float(senti)
        vibe_adj = last_price * (0.01 * s)
    pred_60 += vibe_adj

    # --- bornes ---
    is_stable = crypto in ('usdc', 'usdt', 'tether')
    max_pct = 0.005 if is_stable else 0.05
    min_price = last_price * (1 - max_pct)
    max_price = last_price * (1 + max_pct)
    pred_baseline = max(min(pred_60, max_price), min_price)

    # --- confiance baseline via vol 1h ---
    one_hour_ago = now - timedelta(hours=1)
    recent_vals = [p for p, t in zip(prices, times) if t >= one_hour_ago]
    if len(recent_vals) < 2:
        recent_vals = prices[-12:]
    vol = float(np.std(recent_vals)) if len(recent_vals) > 1 else 0.0
    vol_pct = (vol / last_price) if last_price > 0 else 0.0
    conf_baseline = max(40.0, min(85.0, 85.0 - 250.0 * vol_pct))

    # --- source reddit/Prophet ---
    sp = None
    try:
        sp = _get_cached_source_pred(crypto, ttl=900)
    except Exception:
        sp = None

    preds = [float(pred_baseline)]
    weights = [1.0]
    confs = [float(conf_baseline)]
    p_reddit = None

    if sp and sp.get('price', 0.0) > 0.0:
        p_reddit = float(sp.get('price'))
        c_reddit = float(sp.get('conf') or 0.0)
        ts_epoch = float(sp.get('ts', now.timestamp()))
        age_min = max(0.0, (now.timestamp() - ts_epoch) / 60.0)
        fresh = math.exp(-age_min / 120.0)  # demi-vie ~2h
        w_reddit = min(0.35, 0.35 * fresh * (c_reddit / 100.0))
        preds.append(p_reddit)
        weights.append(w_reddit)
        confs.append(c_reddit)

    # --- combinaison pondérée ---
    wsum = sum(weights)
    pred_wmean = (sum(p * w for p, w in zip(preds, weights)) / wsum) if wsum > 0 else pred_baseline

    # spread relatif
    spread = 0.0
    if pred_wmean > 0:
        spread = (max(preds) - min(preds)) / pred_wmean

    pred_fused = float(pred_wmean)

    # --- forcer une petite divergence quand trop proche ---
    try:
        base_cmp = p_reddit if p_reddit is not None else pred_baseline
        rel_gap = abs(pred_fused - base_cmp) / max(1e-9, abs(pred_wmean))
        step = _round_step(last_price)
        if rel_gap < 0.0005 or abs(pred_fused - base_cmp) < step * 0.5:
            seed = zlib.adler32(f"{crypto}:{now.strftime('%Y%m%d%H%M')}:HKO".encode())
            jitter = _tiny_jitter_eur(last_price, seed)
            pred_fused = pred_wmean + jitter
    except Exception:
        pass

    # clamp final + confiance
    pred_final = max(min(pred_fused, max_price), min_price)
    conf_fused = float(np.mean(confs)) if confs else float(conf_baseline)
    if spread > 0.02:
        conf_final = max(40.0, min(85.0, conf_fused - 100.0 * spread * 0.5))
    else:
        conf_final = max(40.0, min(85.0, conf_fused + 2.0))

    payload = {
        "ok": True,
        "crypto": crypto,
        "predicted_price": _round_by_scale(pred_final, last_price),
        "confidence": float(round(conf_final, 1)),
        "predict_at": (now + timedelta(hours=1)).isoformat(),
        "valid_for_minutes": 60,
        "method": f"HKO_fusion(+det_jitter, spread={spread:.4f}, vibe_adj={float(vibe_adj):.6f})",
        "last_price": _round_by_scale(last_price, last_price),
    }

    cache.set(cache_key, payload, 55)
    return JsonResponse(payload)











def get_cached_source_pred(crypto, source, ttl=900):
    """
    Récupère/stocke la prédiction Prophet par source (reddit/news) en cache pendant ~15 min.
    Retourne: {'crypto','source','predicted_price','confidence','ts'}
    """
    crypto = crypto.lower()
    source = source.lower()
    key = f"pred_{source}_{crypto}"
    payload = cache.get(key)
    if payload:
        return payload

    # ⬇️ Ta fonction existante (Prophet)
    price, conf = predict_price(crypto, source)

    payload = {
        "crypto": crypto,
        "source": source,
        "predicted_price": float(price or 0.0),
        "confidence": float(conf or 0.0),
        "ts": timezone.now().isoformat(),
    }
    cache.set(key, payload, ttl)  # 15 minutes
    return payload






# --- en tête de views.py (imports utilitaires) ---
import feedparser, html
from datetime import datetime, timedelta


# ...

@require_GET
def get_wire_news(request):
    """
    Flux titres courts (crypto / finance / AI) pour la barre noire.
    - Sources: RSS publics
    - Cache: 10 minutes
    - Sort: plus récents d'abord
    - Limite: ~80 items (suffisant pour défiler)
    """
    CACHE_KEY = "wire_news:v1"
    cached = cache.get(CACHE_KEY)
    if cached:
        return JsonResponse(cached, safe=False)

    # Catégories -> (Nom affiché, URL RSS)
    FEEDS = {
        "crypto": [
            ("CoinDesk",       "https://www.coindesk.com/arc/outboundfeeds/rss/"),
            ("Cointelegraph",  "https://cointelegraph.com/rss"),
            ("Decrypt",        "https://decrypt.co/feed"),
        ],
        "finance": [
            ("Reuters Markets","https://feeds.reuters.com/reuters/marketsNews"),
            ("Reuters Business","https://feeds.reuters.com/reuters/businessNews"),
            ("Yahoo Finance",  "https://finance.yahoo.com/news/rssindex"),
        ],
        "ai": [
            ("VentureBeat AI", "https://venturebeat.com/category/ai/feed"),
            ("MIT Tech Review","https://www.technologyreview.com/feed/"),
        ],
    }

    items = []
    now = timezone.now()

    def _safe_parse_date(entry):
        # feedparser fournit parfois 'published_parsed' (time.struct_time)
        dt = None
        try:
            if getattr(entry, "published_parsed", None):
                dt = datetime(*entry.published_parsed[:6], tzinfo=py_tz.utc)
            elif getattr(entry, "updated_parsed", None):
                dt = datetime(*entry.updated_parsed[:6], tzinfo=py_tz.utc)
        except Exception:
            dt = None
        return dt or now

    for cat, feeds in FEEDS.items():
        for src_name, url in feeds:
            try:
                d = feedparser.parse(url)
                for e in d.entries[:10]:  # on ne prend que ~10 titres par feed
                    title = html.unescape(e.get("title", "")).strip()
                    if not title:
                        continue
                    # compactage du titre (bandeau)
                    if len(title) > 140:
                        title = title[:137].rstrip() + "…"
                    items.append({
                        "cat": cat,
                        "source": src_name,
                        "title": title,
                        "link": e.get("link", ""),
                        "published": _safe_parse_date(e).isoformat(),
                    })
            except Exception:
                logger.exception("[wire] RSS error for %s", url)
                continue

    # Dédupe (par lien ou titre)
    seen = set()
    uniq = []
    for it in items:
        key = (it["link"] or it["title"]).strip().lower()
        if key and key not in seen:
            uniq.append(it)
            seen.add(key)

    # Tri du plus récent au plus ancien
    def _k(it):
        try:
            return datetime.fromisoformat(it["published"].replace("Z", "+00:00"))
        except Exception:
            return now
    uniq.sort(key=_k, reverse=True)

    # Limiter la taille envoyée au front (ça suffit pour un long défilement)
    out = uniq[:80]

    # Cache 10 minutes, lock anti-stampede simple
    cache.set(CACHE_KEY, out, 600)
    return JsonResponse(out, safe=False)





@require_POST
def subscribe(request):
    email = (request.POST.get("email") or "").strip().lower()
    source = (request.POST.get("source") or "web").strip()

    # Honeypot anti-bot : si rempli, on dit "ok" sans rien faire
    if request.POST.get("website"):
        return JsonResponse({"ok": True})

    if not email:
        return JsonResponse({"ok": False, "error": "Email manquant"}, status=400)
    try:
        validate_email(email)
    except ValidationError:
        return JsonResponse({"ok": False, "error": "Email invalide"}, status=400)

    sub, created = Subscriber.objects.get_or_create(
        email=email,
        defaults={"source": source, "locale": get_language() or ""}
    )
    return JsonResponse({"ok": True, "duplicate": not created})
































