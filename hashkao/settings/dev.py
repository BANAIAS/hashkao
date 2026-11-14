from .base import *

DEBUG = True
ALLOWED_HOSTS = ["127.0.0.1", "localhost"]
CSRF_TRUSTED_ORIGINS = ["http://127.0.0.1", "http://localhost"]

SECURE_SSL_REDIRECT = False
SECURE_HSTS_SECONDS = 0
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False

# Logs uniquement dans la console en développement
LOGGING["root"]["handlers"] = ["console"]
LOGGING["handlers"].pop("rotating_file", None)

for logger_config in LOGGING.get("loggers", {}).values():
    logger_config["handlers"] = [
        h for h in logger_config.get("handlers", [])
        if h != "rotating_file"
    ]

# Cache en mémoire pour le développement local
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
    }
}