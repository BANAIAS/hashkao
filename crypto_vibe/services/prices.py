# crypto_vibe/services/prices.py
from __future__ import annotations

import logging
from typing import Dict, Any

import requests
from django.conf import settings
from django.core.cache import cache
from django.utils import timezone
from django.db import transaction

from crypto_vibe.models import SentimentData

logger = logging.getLogger(__name__)

CRYPTO_LIST = [
    "bitcoin", "ethereum", "xrp", "tether", "bnb",
    "solana", "usdc", "dogecoin", "tron", "cardano",
]
CACHE_TTL_SECONDS = 300  # 5 minutes
COINGECKO_SIMPLE_URL = "https://api.coingecko.com/api/v3/simple/price"

def floor_to_5min(dt):
    """Aligne un datetime sur la tranche de 5 minutes courante."""
    minute = (dt.minute // 5) * 5
    return dt.replace(minute=minute, second=0, microsecond=0)

def _cache_key_for_5min(ts) -> str:
    """Clé de cache alignée sur 5 minutes (UTC)."""
    return f"latest_prices_{ts.strftime('%Y%m%d_%H%M')}"

def _coingecko_headers() -> Dict[str, str]:
    """Utilise la clé DEMO si disponible (x-cg-demo-api-key). Sinon, public."""
    h = {
        "Accept": "application/json",
        "User-Agent": "hashkao-crypto-vibe/1.0",
    }
    key = getattr(settings, "COINGECKO_API_KEY", None)
    if key:
        h["x-cg-demo-api-key"] = key
        logger.info("[prices] CoinGecko DEMO OK (clé utilisée)")
    else:
        logger.info("[prices] CoinGecko FREE OK (sans clé)")
    return h

def _fetch_from_provider() -> Dict[str, float | None]:
    """Appel groupé à CoinGecko (simple/price). Retourne { 'bitcoin': 12345.67, ... }."""
    ids = ",".join([
        "bitcoin", "ethereum", "ripple", "tether", "binancecoin",  # Changé xrp en ripple
        "solana", "usd-coin", "dogecoin", "tron", "cardano",
    ])
    id_map = {
        "bitcoin": "bitcoin",
        "ethereum": "ethereum",
        "xrp": "ripple",  # Changé pour correspondre à l’ID CoinGecko
        "tether": "tether",
        "bnb": "binancecoin",
        "solana": "solana",
        "usdc": "usd-coin",
        "dogecoin": "dogecoin",
        "tron": "tron",
        "cardano": "cardano",
    }
    try:
        resp = requests.get(
            COINGECKO_SIMPLE_URL,
            params={"ids": ids, "vs_currencies": "eur"},
            headers=_coingecko_headers(),
            timeout=10,
        )
        resp.raise_for_status()
        payload = resp.json()
        out: Dict[str, float | None] = {}
        for sym, cg_id in id_map.items():
            try:
                v = payload.get(cg_id, {}).get("eur", None)
                out[sym] = float(v) if v is not None else None
            except Exception:
                out[sym] = None
        if "ripple" in out and "xrp" not in out:
            out["xrp"] = out.pop("ripple")
        logger.info(
            "[prices] Fetch groupé CoinGecko OK: %s",
            {k: out.get(k) for k in ("bitcoin", "ethereum", "xrp", "tether")}
        )
        return out
    except requests.HTTPError as e:
        logger.error("[prices] CoinGecko HTTP error: %s", e)
        raise
    except Exception as e:
        logger.exception("[prices] Provider error: %s", e)
        raise

def get_all_prices_core(*, bypass_cache: bool = False, persist: bool = True) -> Dict[str, Any]:
    """Source unique pour les prix."""
    ts_bucket = floor_to_5min(timezone.now())
    key = _cache_key_for_5min(ts_bucket)
    if not bypass_cache:
        cached = cache.get(key)
        if cached is not None:
            logger.info("Prix groupés récupérés du cache (5min) key=%s", key)
            if persist:
                try:
                    _persist_coingecko_bucket(cached, ts_bucket)
                except Exception:
                    logger.exception("[prices] Échec persistance bucket %s (depuis cache)", ts_bucket)
            return cached
    data = _fetch_from_provider()
    cache.set(key, data, CACHE_TTL_SECONDS)
    logger.info("Prix groupés mis en cache 5min key=%s", key)
    if persist:
        try:
            _persist_coingecko_bucket(data, ts_bucket)
        except Exception:
            logger.exception("[prices] Échec persistance bucket %s", ts_bucket)
    return data

def _normalize_price(val: Any) -> float | None:
    """Normalise un prix en float ou None."""
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, dict):
        for k in ("price_eur", "eur", "price"):
            if k in val and val[k] is not None:
                try:
                    return float(val[k])
                except Exception:
                    return None
    return None

def _persist_coingecko_bucket(prices: Dict[str, Any], ts_bucket):
    """Persisté 1 fois par tranche de 5 minutes (idempotent via update_or_create)."""
    symbols = set(CRYPTO_LIST)
    seen = set(prices.keys())
    if seen != symbols:
        logger.warning("[prices] Jeu de cryptos inattendu pour %s: %s", ts_bucket, sorted(seen))
    saved = 0
    with transaction.atomic():
        for sym in CRYPTO_LIST:
            v = _normalize_price(prices.get(sym))
            try:
                obj, created = SentimentData.objects.update_or_create(
                    crypto=sym,
                    source="coingecko",
                    timestamp=ts_bucket,
                    defaults={
                        "price_eur": v,
                        "text": "",
                        "sentiment": "",
                        "score": 0.0
                    }
                )
                logger.debug("[prices] DB %s %s/coingecko: %s @ %s (id=%s)",
                             "créé" if created else "mis à jour", sym, v, ts_bucket, obj.id)
                saved += 1
            except Exception as e:
                logger.error("[prices] Erreur persistance %s: %s", sym, str(e))
                continue
    count = SentimentData.objects.filter(source="coingecko", timestamp=ts_bucket).count()
    if count < len(CRYPTO_LIST):
        logger.warning(
            "Saved CoinGecko bucket %s incomplet: %d/%d (écrits=%d)",
            ts_bucket.strftime("%H:%M"), count, len(CRYPTO_LIST), saved
        )
    else:
        logger.info(
            "Saved CoinGecko bucket %s (%d/%d)",
            ts_bucket.strftime("%H:%M"), count, len(CRYPTO_LIST)
        )