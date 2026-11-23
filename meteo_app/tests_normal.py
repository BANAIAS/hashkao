"""
Tests de la rubrique « Est-ce normal ? » (page refondue).
"""

from django.test import TestCase
from django.urls import reverse


class PageEstCeNormal(TestCase):

    def test_page_affiche_le_bandeau_et_les_rubriques(self):
        reponse = self.client.get(reverse("meteo_app:est_ce_normal"))
        self.assertEqual(reponse.status_code, 200)

        html = reponse.content.decode()
        for identifiant in ("n-bande", "n-valeur", "n-reponse", "n-classement",
                            "n-station", "n-explorer", "n-comprendre", "n-calendrier"):
            self.assertIn(f'id="{identifiant}"', html)

        # L'API est annoncée au script
        self.assertIn(f'data-api="{reverse("meteo_app:api_normal")}"', html)

    def test_page_sans_photo_ne_reference_pas_d_image_absente(self):
        html = self.client.get(reverse("meteo_app:est_ce_normal")).content.decode()
        self.assertNotIn("montsouris.jpg", html)
