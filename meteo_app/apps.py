from django.apps import AppConfig


class MeteoAppConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'meteo_app'

    def ready(self):
        from django.conf import settings
        from django.db.backends.signals import connection_created

        # SQLite en mode WAL (facultatif, réglage HKO_SQLITE_WAL = True) :
        # les lectures du site ne sont plus bloquées pendant qu'une collecte
        # écrit. Le mode est enregistré dans le fichier de base ; pour revenir
        # en arrière : PRAGMA journal_mode=DELETE (voir DEPLOIEMENT_REFONTE.md).
        if getattr(settings, "HKO_SQLITE_WAL", False):
            connection_created.connect(_reglages_sqlite, dispatch_uid="hko_sqlite_wal")


def _reglages_sqlite(sender, connection, **kwargs):
    if connection.vendor != "sqlite":
        return
    with connection.cursor() as curseur:
        curseur.execute("PRAGMA journal_mode=WAL;")
        curseur.execute("PRAGMA synchronous=NORMAL;")
        curseur.execute("PRAGMA busy_timeout=20000;")
