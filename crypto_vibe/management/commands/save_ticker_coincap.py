# crypto_vibe/management/commands/save_ticker_coincap.py
from django.core.management.base import BaseCommand
from django.utils import timezone
from django.core.cache import cache
from django.conf import settings
from django.db import transaction

from crypto_vibe.models import CoinCapTicker

import requests
import logging
from datetime import datetime, timezone as py_tz

logger = logging.getLogger(__name__)

COINCAP_BASE = "https://rest.coincap.io/v3"
COINCAP_API_KEY = getattr(settings, "COINCAP_API_KEY", "")
HEADERS = {"User-Agent": "hashkao-crypto-vibe/1.0", "Accept": "application/json"}

TOP_LIMIT = 50
MIN_INTERVAL_MIN = 30        # pas plus d'un fetch toutes les 30min
SHORT_COOLDOWN_MIN = 120     # 2h après 429/5xx
BLOCK_KEY = "coincap:block_until"
LAST_TS_KEY = "coincap:last_fetch_ts"

FX_FALLBACK = 0.8539         # tu peux l'ajuster, c'est juste pour l'affichage EUR si besoin

def ffloat(v, default=0.0):
    try:
        return float(v)
    except Exception:
        return default

def first_of_next_month(now_dt):
    y = now_dt.year + (1 if now_dt.month == 12 else 0)
    m = 1 if now_dt.month == 12 else now_dt.month + 1
    return now_dt.replace(year=y, month=m, day=1, hour=0, minute=15, second=0, microsecond=0)

def get_fx_usd_eur():
    try:
        r = requests.get(
            "https://api.frankfurter.app/latest?from=USD&to=EUR",
            timeout=6,
            headers=HEADERS,
        )
        r.raise_for_status()
        return ffloat((r.json() or {}).get("rates", {}).get("EUR"), FX_FALLBACK)
    except Exception as e:
        logger.warning("[FX] fallback USD→EUR (reason: %s)", e)
        return FX_FALLBACK

def fetch_coincap_top(limit=TOP_LIMIT):
    params = {"limit": int(limit)}
    if COINCAP_API_KEY:
        params["apiKey"] = COINCAP_API_KEY
    url = f"{COINCAP_BASE}/assets"
    resp = requests.get(url, params=params, headers=HEADERS, timeout=12)
    if not resp.ok:
        body = (resp.text or "")[:200].replace("\n", " ")
        logger.error("[CoinCap] %s -> %s (body: %s)", url, resp.status_code, body)
        resp.raise_for_status()
    data = (resp.json() or {}).get("data", [])
    return data if isinstance(data, list) else []

class Command(BaseCommand):
    help = "Enregistre le ticker depuis CoinCap v3 (avec quotas protégés) dans CoinCapTicker. Aucun fallback externe."

    def handle(self, *args, **kwargs):
        now = timezone.now()

        # 0) respect des fenêtres : block et min interval
        block_until = cache.get(BLOCK_KEY)
        if block_until and now < block_until:
            self._copy_last(now, reason=f"cooldown until {block_until.isoformat()}")
            return

        last_ts = cache.get(LAST_TS_KEY)
        if last_ts and (now - last_ts).total_seconds() < MIN_INTERVAL_MIN * 60:
            self._copy_last(now, reason=f"min-interval {MIN_INTERVAL_MIN}m not elapsed")
            return

        fx = get_fx_usd_eur()
        logger.info("[CoinCap] USD→EUR = %.6f", fx)

        # 1) essai d'appel CoinCap
        try:
            assets = fetch_coincap_top(TOP_LIMIT)
            if not assets:
                raise RuntimeError("empty payload")
        except requests.HTTPError as e:
            status = getattr(e.response, "status_code", None)
            body = (getattr(e.response, "text", "") or "")[:200]
            if status == 403 and "Monthly usage limit exceeded" in body:
                # bloque jusqu'au 1er du mois prochain 00:15 UTC (large)
                next_reset = first_of_next_month(now.astimezone(py_tz.utc))
                next_reset = next_reset.astimezone(now.tzinfo)
                cache.set(BLOCK_KEY, next_reset, timeout=60*24*60)  # ~60 jours max
                logger.warning("[CoinCap] quota mensuel atteint -> block jusqu'au %s", next_reset.isoformat())
                self._copy_last(now, reason="monthly limit exceeded")
                return
            if status in (429, 500, 502, 503, 504):
                cooldown = now + timezone.timedelta(minutes=SHORT_COOLDOWN_MIN)
                cache.set(BLOCK_KEY, cooldown, timeout=SHORT_COOLDOWN_MIN*60)
                logger.warning("[CoinCap] %s -> cooldown %dmin", status, SHORT_COOLDOWN_MIN)
                self._copy_last(now, reason=f"http {status}")
                return
            logger.exception("[CoinCap] HTTP error -> copy last")
            self._copy_last(now, reason="http error")
            return
        except Exception:
            logger.exception("[CoinCap] unexpected error -> copy last")
            self._copy_last(now, reason="unexpected error")
            return

        # 2) insert normalisé (CoinCap uniquement)
        rows = []
        for a in assets:
            cid = (a.get("id") or "").strip()
            if not cid:
                continue
            price_usd = ffloat(a.get("priceUsd"), 0.0)
            ch24 = ffloat(a.get("changePercent24Hr"), 0.0)
            rows.append({
                "id": cid,
                "price_usd": price_usd,
                "price_eur": price_usd * fx if price_usd > 0 else 0.0,
                "change_24h": ch24,
            })

        inserted = 0
        ts = now
        with transaction.atomic():
            for r in rows:
                try:
                    ch1h = r["change_24h"] / 24.0
                    CoinCapTicker.objects.create(
                        crypto=r["id"],
                        price_usd=r["price_usd"],
                        price_eur=r["price_eur"],
                        change_1h=ch1h,
                        change_24h=r["change_24h"],
                        timestamp=ts,
                    )
                    inserted += 1
                except Exception:
                    logger.exception("[CoinCap] insert fail for %s", r.get("id"))
        cache.set(LAST_TS_KEY, now, timeout=90*60)
        cache.delete(BLOCK_KEY)
        logger.info("[CoinCap] ok: %d rows at %s", inserted, ts.isoformat())

    def _copy_last(self, ts, reason=""):
        # recopie 1 dernière ligne par crypto existante (aucun appel réseau)
        seen = (CoinCapTicker.objects
                .values_list("crypto", flat=True)
                .distinct())
        copied = 0
        for cid in seen:
            last = (CoinCapTicker.objects
                    .filter(crypto=cid)
                    .order_by("-timestamp")
                    .first())
            if not last:
                continue
            try:
                if not CoinCapTicker.objects.filter(crypto=cid, timestamp=ts).exists():
                    CoinCapTicker.objects.create(
                        crypto=cid,
                        price_usd=last.price_usd,
                        price_eur=last.price_eur,
                        change_1h=last.change_1h,
                        change_24h=last.change_24h,
                        timestamp=ts,
                    )
                    copied += 1
                else:
                    logger.warning(f"[CoinCap] Entrée existante pour {cid} à {ts}, skip insertion")
            except Exception as e:
                logger.error(f"[CoinCap] copy-last fail pour {cid}: {str(e)}")
        cache.set(LAST_TS_KEY, ts, timeout=90*60)
        logger.info("[CoinCap] copy-last %d rows (reason=%s)", copied, reason or "n/a")
