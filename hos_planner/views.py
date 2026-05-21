import json
import math
from datetime import date, timedelta

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from .models import TripLog

# ---------------------------------------------------------------------------
# Constants (FMCSA HOS rules)
# ---------------------------------------------------------------------------

SPEED_MPH = 60.0
PICKUP_DURATION = 1.0          # hours, ON_DUTY
DROPOFF_DURATION = 1.0         # hours, ON_DUTY
FUEL_STOP_DURATION = 0.5       # hours, ON_DUTY
FUEL_INTERVAL_MILES = 1000.0
MAX_DRIVING_HOURS = 11.0       # per rest cycle
MAX_DUTY_WINDOW = 14.0         # hours from start of duty period
MIN_REST_HOURS = 10.0          # consecutive off-duty required
BREAK_THRESHOLD = 8.0          # cumulative on-duty before mandatory break
BREAK_DURATION = 0.5           # 30-minute break
MAX_CYCLE_HOURS = 70.0         # 70-hour / 8-day cycle limit

# ---------------------------------------------------------------------------
# Mock city coordinates (lat, lon)
# ---------------------------------------------------------------------------

CITY_COORDS = {
    "new york, ny":      (40.7128,  -74.0060),
    "philadelphia, pa":  (39.9526,  -75.1652),
    "baltimore, md":     (39.2904,  -76.6122),
    "chicago, il":       (41.8781,  -87.6298),
    "los angeles, ca":   (34.0522, -118.2437),
    "detroit, mi":       (42.3314,  -83.0458),
    "columbus, oh":      (39.9612,  -82.9988),
    "houston, tx":       (29.7604,  -95.3698),
    "phoenix, az":       (33.4484, -112.0740),
    "dallas, tx":        (32.7767,  -96.7970),
    "denver, co":        (39.7392, -104.9903),
    "seattle, wa":       (47.6062, -122.3321),
    "atlanta, ga":       (33.7490,  -84.3880),
    "miami, fl":         (25.7617,  -80.1918),
    "boston, ma":        (42.3601,  -71.0589),
}


def _lerp(a, b, t):
    return a + t * (b - a)


def _interpolate_on_route(miles, d_to_pick, total_dist, cur, pick, drop):
    """Return [lat, lon] at `miles` along the cur→pick→drop straight-line path."""
    if total_dist < 1e-6:
        return [round(cur[0], 5), round(cur[1], 5)]
    if miles <= d_to_pick:
        t = miles / d_to_pick if d_to_pick > 1e-6 else 0.0
        return [round(_lerp(cur[0], pick[0], t), 5),
                round(_lerp(cur[1], pick[1], t), 5)]
    t = min((miles - d_to_pick) / max(total_dist - d_to_pick, 1e-6), 1.0)
    return [round(_lerp(pick[0], drop[0], t), 5),
            round(_lerp(pick[1], drop[1], t), 5)]


def _build_stop_markers(events, d_to_pick, total_dist, cur, pick, drop):
    """Scan the flat event list and return map marker dicts for rest/fuel stops."""
    markers = []
    cum_miles = 0.0
    for ev in events:
        dur = ev["end"] - ev["start"]
        if ev["status"] == "DRIVING":
            cum_miles += dur * SPEED_MPH
        if ev["status"] == "SLEEPER_BERTH":
            markers.append({
                "position": _interpolate_on_route(cum_miles, d_to_pick, total_dist, cur, pick, drop),
                "type": "rest",
                "label": "Rest Stop",
            })
        elif ev["status"] == "ON_DUTY" and ev.get("reason") == "FUELING":
            markers.append({
                "position": _interpolate_on_route(cum_miles, d_to_pick, total_dist, cur, pick, drop),
                "type": "fuel",
                "label": "Fuel Stop",
            })
    return markers


def haversine_miles(c1, c2):
    R = 3958.8
    lat1, lon1 = math.radians(c1[0]), math.radians(c1[1])
    lat2, lon2 = math.radians(c2[0]), math.radians(c2[1])
    a = (math.sin((lat2 - lat1) / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2)
    return R * 2 * math.asin(math.sqrt(a))


def geocode(location: str):
    key = location.strip().lower()
    if key in CITY_COORDS:
        return CITY_COORDS[key]
    try:
        from geopy.geocoders import Nominatim
        geo = Nominatim(user_agent="spotter_hos")
        loc = geo.geocode(location)
        if loc:
            return (loc.latitude, loc.longitude)
    except Exception:
        pass
    raise ValueError(f"Cannot geocode: {location!r}")


# ---------------------------------------------------------------------------
# HOS Engine
# ---------------------------------------------------------------------------

class HOSEngine:
    """
    Builds a flat chronological event list starting at absolute hour 0.
    Enforces:
      - 11-h driving limit per rest cycle
      - 14-h on-duty window per rest cycle
      - 10-h SLEEPER_BERTH reset
      - 8-h cumulative on-duty → 30-min OFF_DUTY break
      - Fueling stop (ON_DUTY) every 1,000 miles
    """

    def __init__(self, current_cycle_used: float):
        self.clock = 0.0
        self.events: list = []

        self.driving_since_rest = 0.0    # driving hours since last 10-h rest
        self.window_start = 0.0          # absolute hour when current duty window began
        self.duty_since_break = 0.0      # cumulative on-duty since last 30-min break
        self.miles_since_fuel = 0.0

        self.current_cycle_used = current_cycle_used
        self.trip_duty_hours = 0.0       # accumulated during this trip

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _add(self, duration: float, status: str, reason: str = None):
        if duration < 1e-6:
            return
        entry = {
            "start": self.clock,
            "end": self.clock + duration,
            "status": status,
        }
        if reason:
            entry["reason"] = reason
        self.events.append(entry)
        self.clock += duration

    def _rest(self):
        """10-hour SLEEPER_BERTH; resets driving and duty-window counters."""
        self._add(MIN_REST_HOURS, "SLEEPER_BERTH")
        self.driving_since_rest = 0.0
        self.duty_since_break = 0.0
        self.window_start = self.clock

    def _break(self):
        """30-minute OFF_DUTY break; resets the 8-h break counter only."""
        self._add(BREAK_DURATION, "OFF_DUTY")
        self.duty_since_break = 0.0
        # 14-h window keeps ticking

    def _fuel(self):
        """0.5-h ON_DUTY fueling stop."""
        self._add(FUEL_STOP_DURATION, "ON_DUTY", "FUELING")
        self.miles_since_fuel = 0.0
        self.duty_since_break += FUEL_STOP_DURATION
        self.trip_duty_hours += FUEL_STOP_DURATION

    # ------------------------------------------------------------------
    # Public trip actions
    # ------------------------------------------------------------------

    def drive(self, miles: float):
        """Drive `miles`, automatically inserting breaks/rests/fueling."""
        remaining = miles
        guard = 0

        while remaining > 1e-4:
            guard += 1
            if guard > 10_000:
                break  # safety valve

            # Hours available under each constraint
            h_drive = MAX_DRIVING_HOURS - self.driving_since_rest
            h_window = MAX_DUTY_WINDOW - (self.clock - self.window_start)
            h_break = BREAK_THRESHOLD - self.duty_since_break
            mi_fuel = FUEL_INTERVAL_MILES - self.miles_since_fuel

            # Resolve exhausted limits in priority order
            if h_drive <= 1e-6 or h_window <= 1e-6:
                self._rest()
                continue
            if h_break <= 1e-6:
                self._break()
                continue
            if mi_fuel <= 1e-4:
                self._fuel()
                continue

            # Tightest limit wins
            segment_h = min(
                remaining / SPEED_MPH,
                h_drive,
                h_window,
                h_break,
                mi_fuel / SPEED_MPH,
            )
            segment_h = max(segment_h, 0.0)
            if segment_h < 1e-6:
                break

            self._add(segment_h, "DRIVING")
            driven_mi = segment_h * SPEED_MPH
            remaining -= driven_mi
            self.driving_since_rest += segment_h
            self.duty_since_break += segment_h
            self.miles_since_fuel += driven_mi
            self.trip_duty_hours += segment_h

    def on_duty(self, duration: float, reason: str = None):
        """Add an ON_DUTY (not driving) block, taking rest first if needed."""
        # Force rest if the 14-h window would be exceeded
        window_used = self.clock - self.window_start
        if window_used + duration > MAX_DUTY_WINDOW + 1e-6:
            self._rest()

        # Force rest if driving hours are exhausted (can't start duty without rest)
        if self.driving_since_rest >= MAX_DRIVING_HOURS - 1e-6:
            self._rest()

        self._add(duration, "ON_DUTY", reason)
        self.duty_since_break += duration
        self.trip_duty_hours += duration


# ---------------------------------------------------------------------------
# Day segmentation helpers
# ---------------------------------------------------------------------------

def _hours_to_hhmm(h: float) -> str:
    h = max(0.0, h)
    total_min = round(h * 60)
    if total_min >= 1440:
        return "24:00"
    hh = total_min // 60
    mm = total_min % 60
    return f"{hh:02d}:{mm:02d}"


def _fill_gaps(entries: list, day_end: float = 24.0) -> list:
    """Insert OFF_DUTY blocks for any gaps; pad tail to day_end."""
    result = []
    cursor = 0.0
    for e in sorted(entries, key=lambda x: x["start"]):
        if e["start"] > cursor + 1e-6:
            result.append({
                "start": cursor,
                "end": e["start"],
                "status": "OFF_DUTY",
                "duration": e["start"] - cursor,
            })
        result.append(e)
        cursor = e["end"]
    if cursor < day_end - 1e-6:
        result.append({
            "start": cursor,
            "end": day_end,
            "status": "OFF_DUTY",
            "duration": day_end - cursor,
        })
    return result


def segment_into_days(events: list, start_date: date) -> list:
    if not events:
        return []

    total_hours = events[-1]["end"]
    num_days = max(1, math.ceil(total_hours / 24.0))

    days = []
    for d in range(num_days):
        day_abs_start = d * 24.0
        day_abs_end = day_abs_start + 24.0

        raw = []
        for ev in events:
            clip_start = max(ev["start"], day_abs_start)
            clip_end = min(ev["end"], day_abs_end)
            if clip_end - clip_start < 1e-6:
                continue
            entry = {
                "start": clip_start - day_abs_start,
                "end": clip_end - day_abs_start,
                "status": ev["status"],
                "duration": clip_end - clip_start,
            }
            if "reason" in ev:
                entry["reason"] = ev["reason"]
            raw.append(entry)

        filled = _fill_gaps(raw)

        log_entries = []
        for e in filled:
            le = {
                "status": e["status"],
                "start_time": _hours_to_hhmm(e["start"]),
                "end_time": _hours_to_hhmm(e["end"]),
                "duration": round(e["duration"], 6),
            }
            if "reason" in e:
                le["reason"] = e["reason"]
            log_entries.append(le)

        days.append({
            "date": (start_date + timedelta(days=d)).isoformat(),
            "log_entries": log_entries,
        })

    return days


# ---------------------------------------------------------------------------
# View
# ---------------------------------------------------------------------------

@csrf_exempt
@require_http_methods(["POST"])
def hos_planner(request):
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    required = ["current_location", "pickup_location", "dropoff_location", "current_cycle_used"]
    missing = [f for f in required if f not in body]
    if missing:
        return JsonResponse({"error": f"Missing fields: {missing}"}, status=400)

    try:
        cur_coords    = geocode(body["current_location"])
        pick_coords   = geocode(body["pickup_location"])
        drop_coords   = geocode(body["dropoff_location"])
    except ValueError as exc:
        return JsonResponse({"error": str(exc)}, status=400)

    current_cycle_used = float(body["current_cycle_used"])

    dist_to_pickup  = haversine_miles(cur_coords, pick_coords)
    dist_to_dropoff = haversine_miles(pick_coords, drop_coords)
    total_distance  = dist_to_pickup + dist_to_dropoff

    engine = HOSEngine(current_cycle_used)
    engine.drive(dist_to_pickup)
    engine.on_duty(PICKUP_DURATION, "PICKUP")
    engine.drive(dist_to_dropoff)
    engine.on_duty(DROPOFF_DURATION, "DROPOFF")

    cycle_after_trip = current_cycle_used + engine.trip_duty_hours
    restart_required = cycle_after_trip > MAX_CYCLE_HOURS

    warnings = []
    if restart_required:
        warnings.append(
            f"34_hour_restart_required: total on-duty {cycle_after_trip:.1f} h "
            f"exceeds 70-h/8-day cycle limit"
        )

    total_driving_hours = sum(
        ev["end"] - ev["start"]
        for ev in engine.events
        if ev["status"] == "DRIVING"
    )

    days = segment_into_days(engine.events, date.today())

    stop_markers = _build_stop_markers(
        engine.events, dist_to_pickup, total_distance,
        cur_coords, pick_coords, drop_coords,
    )

    response_payload = {
        "trip_summary": {
            "total_distance_miles":       round(total_distance, 2),
            "total_driving_hours":        round(total_driving_hours, 4),
            "pickup_duration_hours":      PICKUP_DURATION,
            "dropoff_duration_hours":     DROPOFF_DURATION,
            "current_cycle_used":         current_cycle_used,
            "estimated_cycle_after_trip": round(cycle_after_trip, 2),
        },
        "map_data": {
            "start":   list(cur_coords),
            "pickup":  list(pick_coords),
            "dropoff": list(drop_coords),
            "stops":   stop_markers,
        },
        "days": days,
        "warnings": warnings,
        "34_hour_restart_required": restart_required,
    }

    TripLog.objects.create(
        current_location=body["current_location"],
        pickup_location=body["pickup_location"],
        dropoff_location=body["dropoff_location"],
        current_cycle_used=current_cycle_used,
        total_distance_miles=round(total_distance, 2),
        total_driving_hours=round(total_driving_hours, 4),
        total_days=len(days),
        cycle_after_trip=round(cycle_after_trip, 2),
        restart_required=restart_required,
        trip_data=response_payload,
    )

    return JsonResponse(response_payload)
