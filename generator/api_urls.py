# generator/api_urls.py

from django.urls import path
from . import views

app_name = "generator_api"

urlpatterns = [
    path("generate/phrase/", views.generate_phrase_view, name="generate_phrase"),
    path("generate/words/", views.generate_words_view, name="generate_words"),
]
