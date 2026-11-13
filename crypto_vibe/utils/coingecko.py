import requests

def get_real_price(crypto):
    ids = {'bitcoin': 'bitcoin', 'ethereum': 'ethereum'}
    if crypto.lower() not in ids:
        return None
    url = f"https://api.coingecko.com/api/v3/simple/price?ids={ids[crypto.lower()]}&vs_currencies=eur"
    response = requests.get(url)
    if response.status_code == 200:
        return response.json()[ids[crypto.lower()]]['eur']
    return None
