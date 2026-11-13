from django.urls import path
from . import views

app_name = "generator"

urlpatterns = [
    path("", views.generator_view, name="generator_home"),
    path("api/generate/phrase/", views.generate_phrase_view, name="generate_phrase"),
    path("api/generate/words/", views.generate_words_view, name="generate_words"),
]
