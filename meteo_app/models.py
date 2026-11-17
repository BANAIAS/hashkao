
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

    # Mesures utiles à l'état du ciel (tableau « Conditions météo »).
    # Toutes facultatives : elles restent vides si le flux ne les fournit pas.
    # Visibilité horizontale en mètres
    visibilite = models.FloatField(null=True, blank=True)
    # Nébulosité totale, telle que publiée (octas ou pourcentage)
    nebulosite = models.FloatField(null=True, blank=True)
    # Durée d'insolation sur l'heure précédente, en minutes
    insolation = models.FloatField(null=True, blank=True)
    # Rayonnement global sur les 6 minutes précédentes, en J/m²
    rayonnement = models.FloatField(null=True, blank=True)
    # Hauteur de neige au sol, en mètres
    hauteur_neige = models.FloatField(null=True, blank=True)

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


# ---------------------------------------------------------------------------
# Collecte automatique et historique
# ---------------------------------------------------------------------------

SOURCES_HKO = [
    ("stations", "Stations Météo-France"),
    ("radar", "Radar Météo-France"),
    ("satellite", "Satellite EUMETSAT"),
    ("arome", "Modèle AROME"),
    ("fusion", "Fusion HKO"),
    ("maintenance", "Purge et agrégation"),
]


class JournalCollecte(models.Model):
    """Une ligne par exécution de collecteur : sert à la surveillance."""

    STATUTS = [
        ("en_cours", "En cours"),
        ("succes", "Succès"),
        ("rien_de_neuf", "Rien de neuf"),
        ("verrouille", "Déjà en cours"),
        ("echec", "Échec"),
    ]

    source = models.CharField(max_length=20, choices=SOURCES_HKO)
    debut = models.DateTimeField(auto_now_add=True)
    fin = models.DateTimeField(null=True, blank=True)
    statut = models.CharField(max_length=20, choices=STATUTS)
    message = models.TextField(blank=True, default="")
    details = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-debut"]
        indexes = [models.Index(fields=["source", "-debut"])]

    def __str__(self):
        return f"{self.source} {self.debut:%Y-%m-%d %H:%M} {self.statut}"


class ProduitMeteo(models.Model):
    """
    Catalogue des produits conservés (grilles dérivées, images publiées).

    instant    heure que décrit le produit (validité), en UTC
    reference  heure du run pour AROME, vide pour les observations
    nature     « observation » ou « prevision » : jamais confondues
    """

    NATURES = [("observation", "Observation"), ("prevision", "Prévision")]

    source = models.CharField(max_length=20, choices=SOURCES_HKO)
    nature = models.CharField(max_length=12, choices=NATURES)
    instant = models.DateTimeField()
    reference = models.DateTimeField(null=True, blank=True)
    debut_periode = models.DateTimeField(null=True, blank=True)
    fichier = models.CharField(max_length=300)
    taille = models.PositiveIntegerField(default=0)
    empreinte = models.CharField(max_length=64, blank=True, default="")
    qualite = models.JSONField(default=dict, blank=True)
    cree = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-instant"]
        constraints = [
            models.UniqueConstraint(
                fields=["source", "nature", "instant", "reference"],
                name="unique_produit_source_instant",
            ),
        ]
        indexes = [
            models.Index(fields=["source", "nature", "-instant"]),
            models.Index(fields=["empreinte"]),
        ]

    def __str__(self):
        return f"{self.source} {self.nature} {self.instant:%Y-%m-%d %H:%M}"


class ObservationHoraire(models.Model):
    """
    Résumé horaire des observations 6 minutes, conservé durablement
    une fois les relevés détaillés purgés.
    """

    station = models.ForeignKey(
        StationMeteo, on_delete=models.CASCADE, related_name="observations_horaires"
    )
    heure = models.DateTimeField()  # début de l'heure, UTC

    temperature = models.FloatField(null=True, blank=True)
    temperature_min = models.FloatField(null=True, blank=True)
    temperature_max = models.FloatField(null=True, blank=True)
    humidite = models.FloatField(null=True, blank=True)
    vent_moyen = models.FloatField(null=True, blank=True)
    rafale_max = models.FloatField(null=True, blank=True)
    precipitation = models.FloatField(null=True, blank=True)  # cumul (mm)
    visibilite_min = models.FloatField(null=True, blank=True)
    pression = models.FloatField(null=True, blank=True)
    mesures = models.PositiveSmallIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["station", "heure"], name="unique_observation_horaire"
            ),
        ]
        indexes = [models.Index(fields=["heure"])]
