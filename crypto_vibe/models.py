from django.db import models
from django.utils import timezone

class SentimentData(models.Model):
    crypto = models.CharField(max_length=20)
    source = models.CharField(max_length=20)
    text = models.TextField()
    sentiment = models.CharField(max_length=10)
    score = models.FloatField()
    price_eur = models.FloatField(null=True, blank=True)
    predicted_price = models.FloatField(null=True, blank=True)  # ➕ nouveau
    confidence = models.FloatField(null=True, blank=True)       # ➕ nouveau
    vibe = models.CharField(max_length=10, null=True, blank=True)  # ➕ nouveau
    # IMPORTANT : pas d'auto_now/add pour accepter le bucket exact
    timestamp = models.DateTimeField(db_index=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['crypto', 'source', 'timestamp'],
                name='uniq_crypto_source_bucket'
            )
        ]
        indexes = [
            models.Index(fields=['source', 'crypto', 'timestamp']),
            models.Index(fields=['timestamp']),
            models.Index(fields=['source', 'timestamp']),
        ]

class CachedPrice(models.Model):
    crypto = models.CharField(max_length=20)
    price_eur = models.FloatField()
    timestamp = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.crypto} - {self.price_eur} EUR @ {self.timestamp}"


class CoinCapTicker(models.Model):
    crypto = models.CharField(max_length=50)  # ex. 'avalanche'
    price_usd = models.FloatField()
    price_eur = models.FloatField()
    change_1h = models.FloatField(null=True)
    change_24h = models.FloatField(null=True)
    timestamp = models.DateTimeField(default=timezone.now)

    class Meta:
        unique_together = ('crypto', 'timestamp')
        ordering = ['-timestamp']

    def __str__(self):
        return f"{self.crypto} at {self.timestamp}: {self.price_eur} €"




class Subscriber(models.Model):
    email = models.EmailField(unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    confirmed = models.BooleanField(default=False)  # pour plus tard (double opt-in)
    source = models.CharField(max_length=64, blank=True)  # "header_plus", etc.
    locale = models.CharField(max_length=8, blank=True)   # ex: "fr", "en"

    def __str__(self):
        return self.email
