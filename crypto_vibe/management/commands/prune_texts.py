
from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import timedelta
from crypto_vibe.models import SentimentData

class Command(BaseCommand):
    help = "Tronque le champ text des entrées Reddit anciennes"

    def add_arguments(self, parser):
        parser.add_argument('--days', type=int, default=7, help="Nombre de jours à partir duquel troncquer (default: 7)")
        parser.add_argument('--keep_chars', type=int, default=300, help="Nombre de caractères à garder (default: 300)")

    def handle(self, *args, **options):
        days = options['days']
        keep_chars = options['keep_chars']
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
        self.stdout.write(self.style.SUCCESS(f"{count} texts tronqués pour Reddit anciens (> {days} jours)."))