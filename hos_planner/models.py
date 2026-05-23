from django.db import models


class TripLog(models.Model):
    current_location = models.CharField(max_length=255)
    current_lat = models.FloatField(null=True)
    current_lon = models.FloatField(null=True)

    pickup_location = models.CharField(max_length=255)
    pickup_lat = models.FloatField(null=True)
    pickup_lon = models.FloatField(null=True)

    dropoff_location = models.CharField(max_length=255)
    dropoff_lat = models.FloatField(null=True)
    dropoff_lon = models.FloatField(null=True)

    current_cycle_used = models.FloatField()

    total_distance_miles = models.FloatField()
    total_driving_hours = models.FloatField()
    total_days = models.PositiveIntegerField()
    cycle_after_trip = models.FloatField()
    restart_required = models.BooleanField(default=False)

    trip_data = models.JSONField()  # full API response payload
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Trip Log"
        verbose_name_plural = "Trip Logs"

    def __str__(self):
        return (
            f"{self.current_location} → {self.pickup_location} → "
            f"{self.dropoff_location}  |  {self.total_distance_miles:.0f} mi  "
            f"|  {self.created_at:%Y-%m-%d %H:%M}"
        )
