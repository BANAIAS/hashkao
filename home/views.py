from django.shortcuts import render, redirect
from django.http import HttpResponseRedirect
from django.utils.translation import get_language_from_request
from django.conf import settings
from django.http import JsonResponse
from .models import EmailSubscriber


def home_view(request):
    return render(request, "home.html")


def redirect_based_on_language(request):
    lang = get_language_from_request(request)
    lang = lang.split("-")[0]  # par exemple 'fr-FR' → 'fr'
    if lang not in dict(settings.LANGUAGES):
        lang = settings.LANGUAGE_CODE  # fallback
    return HttpResponseRedirect(f"/{lang}/")


def subscribe_email(request):
    if request.method == "POST":
        email = request.POST.get("email")
        if email:
            _, created = EmailSubscriber.objects.get_or_create(email=email)
            return JsonResponse({"success": True})
    return JsonResponse({"success": False}, status=400)
