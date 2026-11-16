
from django.db import models


class StationMeteo(models.Model):
    """Station météorologique Météo-France."""

    identifiant = models.CharField(max_length=8, unique=True)
    nom = models.CharField(max_length=150)
    latitude = models.FloatField()
    longitude = models.FloatField()
    altitude = models.FloatField(null=True, blank=True)
    commune = models.CharField(max_length=150, null=True, blank=True)
    code_insee = models.CharField(max_length=5, null=True, blank=True)

    def __str__(self):
        return f"{self.nom} ({self.identifiant})"


class ObservationMeteo(models.Model):
    """Observation météorologique enregistrée à une date UTC."""

    station = models.ForeignKey(
        StationMeteo,
        on_delete=models.CASCADE,
        related_name="observations"
    )

    date = models.DateTimeField()

    # Températures en degrés Celsius
    temperature = models.FloatField(null=True, blank=True)
    point_rosee = models.FloatField(null=True, blank=True)

    # Humidité relative en %
    humidite = models.FloatField(null=True, blank=True)

    # Vent : direction en degrés, vitesse en m/s
    direction_vent = models.FloatField(null=True, blank=True)
    vitesse_vent = models.FloatField(null=True, blank=True)
    rafale_vent = models.FloatField(null=True, blank=True)

    # Précipitations en mm
    precipitation = models.FloatField(null=True, blank=True)

    # Pression en hPa
    pression = models.FloatField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["station", "date"],
                name="unique_observation_station_date"
            )
        ]
        indexes = [
            models.Index(fields=["date"]),
        ]
        ordering = ["-date"]

    def __str__(self):
        return f"{self.station.nom} - {self.date}"
