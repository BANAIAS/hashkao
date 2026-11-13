
# crypto_vibe/views_utils_guardrails.py
from datetime import timedelta
from django.utils import timezone
from .models import SentimentData

import numpy as np

def _realized_sigma_1h(crypto: str, lookback_hours: int = 24):
    """
    Volatilité réalisée à 1h (approx) à partir des retours log 5 min sur 24h.
    Retourne sigma_1h (en proportion), ou None si insuffisant.
    """
    since = timezone.now() - timedelta(hours=lookback_hours)
    qs = (SentimentData.objects
          .filter(crypto=crypto.lower(),
                  source="coingecko",
                  timestamp__gte=since,
                  price_eur__isnull=False)
          .order_by("timestamp")
          .values_list("price_eur", flat=True))

    prices = list(qs)
    if len(prices) < 10:
        return None

    arr = np.array(prices, dtype=float)
    logret = np.diff(np.log(arr))
    if logret.size == 0 or not np.isfinite(logret).any():
        return None

    # std(5min) -> std(1h) via sqrt(12) (12 pas de 5 min dans 1h)
    sigma5 = float(np.nanstd(logret))
    sigma1h = sigma5 * (12 ** 0.5)
    return sigma1h

def postprocess_pred_1h(crypto: str, yhat: float, conf: float,
                        cap_floor: float = 0.03,   # min ±3%
                        cap_ceiling: float = 0.12  # max ±12%
                        ):
    """
    Garde-fou court terme:
      - clamp le move à ±cap, cap dépend de la vol réalisée (≈3σ, bornée entre 3% et 12%)
      - réduit la confiance si on a clampé
    """
    row = (SentimentData.objects
           .filter(crypto=crypto.lower(),
                   source="coingecko",
                   price_eur__isnull=False)
           .order_by("-timestamp")
           .values("price_eur")
           .first())
    if not row:
        return float(yhat), float(max(5.0, min(95.0, conf)))

    last = float(row["price_eur"] or 0.0)
    if last <= 0:
        return float(yhat), float(max(5.0, min(95.0, conf)))

    rel = (float(yhat) - last) / last

    sigma1h = _realized_sigma_1h(crypto)
    if sigma1h is not None and np.isfinite(sigma1h):
        cap = max(cap_floor, min(cap_ceiling, 3.0 * sigma1h))
    else:
        cap = 0.08  # défaut ±8% si pas de vol dispo

    rel_clamped = max(-cap, min(cap, rel))
    if rel != rel_clamped:
        overshoot = abs(rel) - cap
        penalty = 40.0 * max(0.0, overshoot / max(1e-6, cap))  # jusqu’à ~-40 pts
        conf = max(5.0, conf - penalty)

    y_safe = last * (1.0 + rel_clamped)
    return float(y_safe), float(max(5.0, min(95.0, conf)))
