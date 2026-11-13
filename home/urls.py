# home/urls.py
from django.urls import path
from . import views

urlpatterns = [
    path("", views.home_view, name="home"),
    path("subscribe/", views.subscribe_email, name="subscribe_email"),
]
