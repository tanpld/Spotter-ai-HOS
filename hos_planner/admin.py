from django.contrib import admin
from django.utils.html import format_html
from .models import TripLog


@admin.register(TripLog)
class TripLogAdmin(admin.ModelAdmin):
    list_display = (
        'created_at',
        'route',
        'total_distance_miles',
        'total_driving_hours',
        'total_days',
        'current_cycle_used',
        'cycle_after_trip',
        'restart_badge',
    )
    list_filter = ('restart_required', 'created_at')
    search_fields = ('current_location', 'pickup_location', 'dropoff_location')
    readonly_fields = (
        'created_at', 'route', 'total_distance_miles', 'total_driving_hours',
        'total_days', 'cycle_after_trip', 'restart_required', 'trip_data_pretty',
    )
    fieldsets = (
        ('Trip Input', {
            'fields': (
                'current_location', ('current_lat', 'current_lon'),
                'pickup_location',  ('pickup_lat',  'pickup_lon'),
                'dropoff_location', ('dropoff_lat', 'dropoff_lon'),
                'current_cycle_used',
            ),
        }),
        ('Computed Summary', {
            'fields': ('total_distance_miles', 'total_driving_hours',
                       'total_days', 'cycle_after_trip', 'restart_required'),
        }),
        ('Full Log (JSON)', {
            'classes': ('collapse',),
            'fields': ('trip_data_pretty',),
        }),
        ('Meta', {
            'fields': ('created_at',),
        }),
    )
    ordering = ('-created_at',)

    @admin.display(description='Route')
    def route(self, obj):
        return f"{obj.current_location} → {obj.pickup_location} → {obj.dropoff_location}"

    @admin.display(description='Restart?', boolean=False)
    def restart_badge(self, obj):
        if obj.restart_required:
            return format_html('<span style="color:red;font-weight:bold;">⚠ YES</span>')
        return format_html('<span style="color:green;">✓ No</span>')

    @admin.display(description='Full Trip JSON')
    def trip_data_pretty(self, obj):
        import json
        pretty = json.dumps(obj.trip_data, indent=2)
        return format_html(
            '<pre style="font-size:12px;max-height:500px;overflow:auto;">{}</pre>',
            pretty,
        )
