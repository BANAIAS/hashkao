from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('meteo_app', '0002_stationmeteo_code_insee_stationmeteo_commune'),
    ]

    operations = [
        migrations.AddField(
            model_name='observationmeteo',
            name='visibilite',
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='observationmeteo',
            name='nebulosite',
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='observationmeteo',
            name='insolation',
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='observationmeteo',
            name='rayonnement',
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='observationmeteo',
            name='hauteur_neige',
            field=models.FloatField(blank=True, null=True),
        ),
    ]
