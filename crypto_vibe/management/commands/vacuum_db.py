
from django.core.management.base import BaseCommand
from django.db import connection

class Command(BaseCommand):
    help = "Exécute VACUUM sur la base SQLite"

    def handle(self, *args, **options):
        cursor = connection.cursor()
        cursor.execute("PRAGMA auto_vacuum = INCREMENTAL;")
        cursor.execute("PRAGMA incremental_vacuum;")
        cursor.execute("VACUUM;")
        self.stdout.write(self.style.SUCCESS("VACUUM exécuté avec succès."))