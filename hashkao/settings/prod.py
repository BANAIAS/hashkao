from .base import *

DEBUG = False
ALLOWED_HOSTS = ["hashkao.com", "www.hashkao.com", "51.15.193.22", "127.0.0.1", "localhost"]
CSRF_TRUSTED_ORIGINS = ["https://hashkao.com", "https://www.hashkao.com"]

SECURE_SSL_REDIRECT = True
SECURE_HSTS_SECONDS = 0
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

USE_X_FORWARDED_HOST = True


# Configuration logging avec console + fichier rotatif pour la prod
LOGGING = {
    "version": 1,
    "disable_existing_loggers": True,
    "formatters": {
        "verbose": {
            "format": "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "verbose",
        },
        "rotating_file": {
            "class": "logging.handlers.RotatingFileHandler",
            "filename": "/var/log/hashkao/app.log",
            "maxBytes": 20 * 1024 * 1024,  # 20 MB
            "backupCount": 5,  # 5 fichiers de backup
            "encoding": "utf-8",
            "formatter": "verbose",
        },
    },
    "root": {
        "handlers": ["console", "rotating_file"],
        "level": "INFO",
    },
    "loggers": {
        "django": {
            "handlers": ["console", "rotating_file"],
            "level": "WARNING",
            "propagate": False,
        },
        "django.server": {
            "handlers": ["console"],
            "level": "INFO",
            "propagate": False,
        },
        "django.request": {
            "handlers": ["console", "rotating_file"],
            "level": "WARNING",
            "propagate": False,
        },
        "django.db.backends": {
            "handlers": ["rotating_file"],
            "level": "WARNING",
            "propagate": False,
        },
        "crypto_vibe": {
            "handlers": ["console", "rotating_file"],
            "level": "INFO",
            "propagate": False,
        },
        "crypto_vibe.views": {
            "handlers": ["console", "rotating_file"],
            "level": "INFO",
            "propagate": False,
        },
        "cmdstanpy": {
            "handlers": ["console", "rotating_file"],
            "level": "WARNING",
            "propagate": False,
        },
        "prophet": {
            "handlers": ["console", "rotating_file"],
            "level": "WARNING",
            "propagate": False,
        },
        "urllib3": {
            "handlers": ["console", "rotating_file"],
            "level": "WARNING",
            "propagate": False,
        },
    },
}

# Le site est derrière Nginx (HTTPS public → HTTP interne) :
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
