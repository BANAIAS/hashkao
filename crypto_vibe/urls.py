from django.urls import path
from django.http import HttpResponse
from . import views

app_name = "crypto_vibe"

# Petit probe pour Chrome DevTools (facultatif)
def _chrome_probe(_request):
    return HttpResponse("{}", content_type="application/json", status=204)

urlpatterns = [
    # Home (dashboard)
    path("", views.vibe_index, name="index"),

    # Probe
    path(".well-known/appspecific/com.chrome.devtools.json", _chrome_probe),

    # --- API Vibe / History / News ---
    path("api/vibe/<str:crypto>/", views.get_vibe, name="get_vibe_simple"),
    path("api/vibe/<str:crypto>/<str:source>/", views.get_vibe, name="get_vibe"),
    path("history/<str:crypto>/", views.get_history, name="get_history"),
    path("history/all/", views.get_all_history, name="get_all_history"),
    path("api/news/", views.get_all_news, name="get_all_news"),
    path("api/news/wire/", views.get_wire_news, name="news_wire"),
    path("dev-inject/<str:crypto>/", views.inject_fake_data, name="inject_fake_data"),
    path("api/history/<str:crypto>/<str:source>/", views.get_sentiment_history, name="get_sentiment_history"),
    path("api/prices/", views.get_all_prices, name="get_all_prices"),
    path("api/prices/latest/", views.get_latest_prices, name="get_latest_prices"),
    path("api/prices/test/", views.latest_coingecko_test, name="latest_coingecko_test"),
    path("api/coincap/ticker/", views.get_coincap_ticker, name="coincap_ticker"),

    # --- Prédictions ---
    path("api/prediction/hko/<str:crypto>/", views.get_prediction_hko, name="prediction_hko"),
    path("api/prediction/source/<str:crypto>/<str:source>/", views.get_prediction_source, name="prediction_source"),

    # --- Détails / Subscribe ---
    path("details/<str:crypto>/<str:source>/", views.vibe_detail_view, name="vibe_detail"),
    path("subscribe/", views.subscribe, name="subscribe"),
]
