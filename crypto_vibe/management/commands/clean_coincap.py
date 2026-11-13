from django.core.management.base import BaseCommand
from crypto_vibe.models import SentimentData
import logging

logger = logging.getLogger(__name__)

class Command(BaseCommand):
    help = "Nettoie les anciennes entrées CoinCap de SentimentData (supprime uniquement source='coincap')"

    def handle(self, *args, **kwargs):
        # Supprimer par source 'coincap'
        count_cap = SentimentData.objects.filter(source='coincap').count()
        if count_cap > 0:
            SentimentData.objects.filter(source='coincap').delete()
            logger.info(f"{count_cap} entrées CoinCap supprimées.")
            self.stdout.write(self.style.SUCCESS(f"{count_cap} entrées supprimées par source 'coincap'."))
        else:
            logger.info("Aucune entrée CoinCap à supprimer.")
            self.stdout.write("Rien à nettoyer par source.")

        if count_cap > 0:
            self.stdout.write(self.style.SUCCESS(f"Nettoyage terminé : {count_cap} entrées supprimées au total. Les courbes devraient être stables maintenant (seulement CoinCap enlevé, pas les bons prix BTC)."))
        else:
            self.stdout.write("Base de données déjà propre.")