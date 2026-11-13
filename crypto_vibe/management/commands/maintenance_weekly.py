
from django.core.management.base import BaseCommand
from django.db import connection
from django.utils import timezone
from datetime import timedelta
from crypto_vibe.models import SentimentData
from django.core.management import call_command

class Command(BaseCommand):
    help = "Maintenance hebdomadaire : prune texts, clearsessions, vacuum, rapport taille DB"

    def add_arguments(self, parser):
        parser.add_argument('--days', type=int, default=7, help="Jours pour prune texts")
        parser.add_argument('--keep_chars', type=int, default=300, help="Chars à garder pour text")

    def handle(self, *args, **options):
        days = options['days']
        keep_chars = options['keep_chars']

        # 1. Prune texts
        cutoff = timezone.now() - timedelta(days=days)
        qs = SentimentData.objects.filter(source="reddit", timestamp__lt=cutoff).exclude(text__isnull=True)
        batch = []
        count = 0
        for e in qs.only("id", "text").iterator(chunk_size=1000):
            if e.text and len(e.text) > keep_chars:
                e.text = e.text[:keep_chars]
                batch.append(e)
                count += 1
            if len(batch) >= 1000:
                SentimentData.objects.bulk_update(batch, ["text"])
                batch.clear()
        if batch:
            SentimentData.objects.bulk_update(batch, ["text"])
        self.stdout.write(self.style.SUCCESS(f"{count} texts tronqués."))

        # 2. Clearsessions
        call_command('clearsessions')
        self.stdout.write(self.style.SUCCESS("Sessions nettoyées."))

        # 3. Indexes check (optionnel, log seulement)
        self.stdout.write(self.style.SUCCESS("Indexes OK (check manuel si besoin)."))

        # 4. Vacuum SQLite
        cursor = connection.cursor()
        cursor.execute("PRAGMA auto_vacuum = INCREMENTAL;")
        cursor.execute("PRAGMA incremental_vacuum;")
        cursor.execute("VACUUM;")
        self.stdout.write(self.style.SUCCESS("VACUUM exécuté."))

        # 5. Rapport taille DB
        cursor.execute("PRAGMA page_size;")
        page_size = cursor.fetchone()[0]
        cursor.execute("PRAGMA page_count;")
        page_count = cursor.fetchone()[0]
        db_size_mb = (page_size * page_count) / (1024 * 1024)
        self.stdout.write(self.style.SUCCESS(f"Taille DB : {db_size_mb:.2f} MB"))