# coincap_api.py
import requests
import time
from django.conf import settings

# Cache local : {crypto_id: (timestamp, data)}
CACHE = {}
CACHE_DURATION = 5 * 60  # 5 minutes

def fetch_coincap_data(crypto_id):
    now = time.time()
    # Vérifie si on a déjà les données en cache
    if crypto_id in CACHE:
        timestamp, data = CACHE[crypto_id]
        if now - timestamp < CACHE_DURATION:
            return data  # Données valides : retourne le cache

    # Sinon, fait l’appel API
    url = f"https://rest.coincap.io/v3/assets/{crypto_id}"
    headers = {"Authorization": f"Bearer {settings.COINCAP_API_KEY}"}
    response = requests.get(url, headers=headers)
    response.raise_for_status()
    data = response.json()["data"]

    # Met à jour le cache
    CACHE[crypto_id] = (now, data)
    return data
