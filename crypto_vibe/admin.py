from django.contrib import admin
from django.http import HttpResponse
import csv
from .models import Subscriber

@admin.register(Subscriber)
class SubscriberAdmin(admin.ModelAdmin):
    list_display = ("email", "created_at", "confirmed", "source", "locale")
    search_fields = ("email",)
    list_filter = ("confirmed", "source", "created_at", "locale")
    actions = ["export_csv"]

    def export_csv(self, request, queryset):
        resp = HttpResponse(content_type="text/csv")
        resp["Content-Disposition"] = 'attachment; filename="subscribers.csv"'
        writer = csv.writer(resp)
        writer.writerow(["email", "created_at", "confirmed", "source", "locale"])
        for s in queryset:
            writer.writerow([s.email, s.created_at, s.confirmed, s.source, s.locale])
        return resp

    export_csv.short_description = "Exporter en CSV"
