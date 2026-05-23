import json
import math
import urllib.request
import urllib.parse
from datetime import date, timedelta
from typing import Tuple

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from .models import TripLog

Coords = Tuple[float, float]

# ---------------------------------------------------------------------------
# Constants (FMCSA HOS rules)
# ---------------------------------------------------------------------------

SPEED_MPH = 60.0
PICKUP_DURATION = 1.0  # hours, ON_DUTY
DROPOFF_DURATION = 1.0  # hours, ON_DUTY
FUEL_STOP_DURATION = 0.5  # hours, ON_DUTY
FUEL_INTERVAL_MILES = 1000.0
MAX_DRIVING_HOURS = 11.0  # per rest cycle
MAX_DUTY_WINDOW = 14.0  # hours from start of duty period
MIN_REST_HOURS = 10.0  # consecutive off-duty required
BREAK_THRESHOLD = 8.0  # cumulative on-duty before mandatory break
BREAK_DURATION = 0.5  # 30-minute break
MAX_CYCLE_HOURS = 70.0  # 70-hour / 8-day cycle limit

# ---------------------------------------------------------------------------
# Geocoding — Nominatim (OpenStreetMap) with in-memory cache
# ---------------------------------------------------------------------------

_geocode_cache: dict = {}


def geocode(location: str) -> Coords:
    key = location.strip().lower()
    if key in _geocode_cache:
        return _geocode_cache[key]

    params = urllib.parse.urlencode(
        {
            "q": location,
            "format": "json",
            "limit": 1,
            "addressdetails": 0,
        }
    )
    url = f"https://nominatim.openstreetmap.org/search?{params}"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "SpotterHOS/1.0 (educational project; contact: spotter@example.com)",
            "Accept-Language": "en",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            results = json.loads(resp.read().decode())
        if results:
            coords: Coords = (float(results[0]["lat"]), float(results[0]["lon"]))
            _geocode_cache[key] = coords
            return coords
    except Exception as exc:
        raise ValueError(f"Geocoding failed for {location!r}: {exc}")

    raise ValueError(f"No geocoding results for {location!r}")


# ---------------------------------------------------------------------------
# Distance — OSRM road distance with haversine fallback
# ---------------------------------------------------------------------------


def _build_stop_markers(events, total_dist):
    """Return stop markers with a progress fraction (0–1) along the total route."""
    markers = []
    cum_miles = 0.0
    safe_total = max(total_dist, 1e-6)
    for ev in events:
        dur = ev["end"] - ev["start"]
        if ev["status"] == "DRIVING":
            cum_miles += dur * SPEED_MPH
        if ev["status"] == "SLEEPER_BERTH":
            markers.append(
                {
                    "progress": round(min(cum_miles / safe_total, 1.0), 5),
                    "type": "rest",
                    "label": "Rest Stop",
                }
            )
        elif ev["status"] == "ON_DUTY" and ev.get("reason") == "FUELING":
            markers.append(
                {
                    "progress": round(min(cum_miles / safe_total, 1.0), 5),
                    "type": "fuel",
                    "label": "Fuel Stop",
                }
            )
    return markers


def haversine_miles(c1: Coords, c2: Coords) -> float:
    R = 3958.8
    lat1, lon1 = math.radians(c1[0]), math.radians(c1[1])
    lat2, lon2 = math.radians(c2[0]), math.radians(c2[1])
    a = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return R * 2 * math.asin(math.sqrt(a))


def road_distance_miles(c1: Coords, c2: Coords) -> float:
    """Real road distance via OSRM public API; falls back to haversine."""
    lat1, lon1 = c1
    lat2, lon2 = c2
    url = (
        f"https://router.project-osrm.org/route/v1/driving/"
        f"{lon1},{lat1};{lon2},{lat2}"
        f"?overview=false"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "SpotterHOS/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode())
        if data.get("routes"):
            return data["routes"][0]["distance"] / 1609.344  # metres → miles
    except Exception:
        pass
    return haversine_miles(c1, c2)


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

        self.driving_since_rest = 0.0  # driving hours since last 10-h rest
        self.window_start = 0.0  # absolute hour when current duty window began
        self.duty_since_break = 0.0  # cumulative on-duty since last 30-min break
        self.miles_since_fuel = 0.0

        self.current_cycle_used = current_cycle_used
        self.trip_duty_hours = 0.0  # accumulated during this trip

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
            result.append(
                {
                    "start": cursor,
                    "end": e["start"],
                    "status": "OFF_DUTY",
                    "duration": e["start"] - cursor,
                }
            )
        result.append(e)
        cursor = e["end"]
    if cursor < day_end - 1e-6:
        result.append(
            {
                "start": cursor,
                "end": day_end,
                "status": "OFF_DUTY",
                "duration": day_end - cursor,
            }
        )
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

        days.append(
            {
                "date": (start_date + timedelta(days=d)).isoformat(),
                "log_entries": log_entries,
            }
        )

    return days


# ---------------------------------------------------------------------------
# Trip planner — pure function, no HTTP / DB concerns
# ---------------------------------------------------------------------------


def _plan_trip(
    cur_coords: Coords,
    pick_coords: Coords,
    drop_coords: Coords,
    current_cycle_used: float,
) -> dict:
    dist_to_pickup = road_distance_miles(cur_coords, pick_coords)
    dist_to_dropoff = road_distance_miles(pick_coords, drop_coords)
    total_distance = dist_to_pickup + dist_to_dropoff

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
        ev["end"] - ev["start"] for ev in engine.events if ev["status"] == "DRIVING"
    )

    days = segment_into_days(engine.events, date.today())
    stop_markers = _build_stop_markers(engine.events, total_distance)

    return {
        "trip_summary": {
            "total_distance_miles": round(total_distance, 2),
            "total_driving_hours": round(total_driving_hours, 4),
            "pickup_duration_hours": PICKUP_DURATION,
            "dropoff_duration_hours": DROPOFF_DURATION,
            "current_cycle_used": current_cycle_used,
            "estimated_cycle_after_trip": round(cycle_after_trip, 2),
        },
        "map_data": {
            "start": list(cur_coords),
            "pickup": list(pick_coords),
            "dropoff": list(drop_coords),
            "stops": stop_markers,
        },
        "days": days,
        "warnings": warnings,
        "34_hour_restart_required": restart_required,
    }


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

    required = [
        "current_location",
        "pickup_location",
        "dropoff_location",
        "current_cycle_used",
    ]
    missing = [f for f in required if f not in body]
    if missing:
        return JsonResponse({"error": f"Missing fields: {missing}"}, status=400)

    def _resolve(key: str, coords_key: str) -> Coords:
        raw = body.get(coords_key)
        if raw and len(raw) == 2:
            return (float(raw[0]), float(raw[1]))
        return geocode(body[key])

    try:
        cur_coords = _resolve("current_location", "current_coords")
        pick_coords = _resolve("pickup_location", "pickup_coords")
        drop_coords = _resolve("dropoff_location", "dropoff_coords")
    except ValueError as exc:
        return JsonResponse({"error": str(exc)}, status=400)

    current_cycle_used = float(body["current_cycle_used"])
    payload = _plan_trip(cur_coords, pick_coords, drop_coords, current_cycle_used)

    try:
        summary = payload["trip_summary"]
        TripLog.objects.create(
            current_location=body["current_location"],
            current_lat=cur_coords[0],
            current_lon=cur_coords[1],
            pickup_location=body["pickup_location"],
            pickup_lat=pick_coords[0],
            pickup_lon=pick_coords[1],
            dropoff_location=body["dropoff_location"],
            dropoff_lat=drop_coords[0],
            dropoff_lon=drop_coords[1],
            current_cycle_used=current_cycle_used,
            total_distance_miles=summary["total_distance_miles"],
            total_driving_hours=summary["total_driving_hours"],
            total_days=len(payload["days"]),
            cycle_after_trip=summary["estimated_cycle_after_trip"],
            restart_required=payload["34_hour_restart_required"],
            trip_data=payload,
        )
    except Exception:
        pass  # log write failure must not fail the API response

    return JsonResponse(payload)
