import json
from unittest.mock import patch
from django.test import TestCase, Client

ENDPOINT = '/api/hos-planner/'

# Fixed coords used by all tests — avoids real HTTP calls to Nominatim / OSRM
MOCK_COORDS = {
    "new york, ny":     (40.7128,  -74.0060),
    "philadelphia, pa": (39.9526,  -75.1652),
    "baltimore, md":    (39.2904,  -76.6122),
    "chicago, il":      (41.8781,  -87.6298),
    "los angeles, ca":  (34.0522, -118.2437),
    "dallas, tx":       (32.7767,  -96.7970),
    "seattle, wa":      (47.6062, -122.3321),
    "miami, fl":        (25.7617,  -80.1918),
    "detroit, mi":      (42.3314,  -83.0458),
    "columbus, oh":     (39.9612,  -82.9988),
}

MOCK_DISTANCES = {
    # (cur, pick, drop) → (dist_to_pickup, dist_to_dropoff)
    ("new york, ny",    "philadelphia, pa", "baltimore, md"):    (95.0,  100.0),
    ("chicago, il",     "dallas, tx",       "los angeles, ca"):  (920.0, 1240.0),
    ("seattle, wa",     "los angeles, ca",  "miami, fl"):        (1140.0, 2750.0),
    ("chicago, il",     "dallas, tx",       "miami, fl"):        (920.0, 1310.0),
}

def _mock_geocode(location: str):
    return MOCK_COORDS[location.strip().lower()]

def _mock_road_distance(c1, c2):
    """Haversine so tests stay deterministic without network."""
    import math
    R = 3958.8
    lat1, lon1 = math.radians(c1[0]), math.radians(c1[1])
    lat2, lon2 = math.radians(c2[0]), math.radians(c2[1])
    a = (math.sin((lat2-lat1)/2)**2
         + math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2)
    return R * 2 * math.asin(math.sqrt(a))


class HOSTestCase(TestCase):
    """Base class that patches external calls for all HOS tests."""
    def setUp(self):
        patcher_geo  = patch('hos_planner.views.geocode',            side_effect=_mock_geocode)
        patcher_dist = patch('hos_planner.views.road_distance_miles', side_effect=_mock_road_distance)
        self.mock_geo  = patcher_geo.start()
        self.mock_dist = patcher_dist.start()
        self.addCleanup(patcher_geo.stop)
        self.addCleanup(patcher_dist.stop)
        self.client = Client()


def post(client, payload):
    return client.post(
        ENDPOINT,
        data=json.dumps(payload),
        content_type='application/json',
    )


def sum_day_hours(day: dict) -> float:
    return sum(e['duration'] for e in day['log_entries'])


# ---------------------------------------------------------------------------
# Test 1: Short Trip
# ---------------------------------------------------------------------------

class ShortTripTest(HOSTestCase):
    """
    NY → Philadelphia (≈95 mi) → Baltimore (≈100 mi).
    Total driving fits inside one duty window, no rest break needed.
    """

    def setUp(self):
        super().setUp()
        self.payload = {
            "current_location": "New York, NY",
            "pickup_location": "Philadelphia, PA",
            "dropoff_location": "Baltimore, MD",
            "current_cycle_used": 0.0,
        }

    def test_returns_200(self):
        self.assertEqual(post(self.client, self.payload).status_code, 200)

    def test_response_has_required_keys(self):
        data = post(self.client, self.payload).json()
        for key in ('trip_summary', 'days', 'warnings'):
            self.assertIn(key, data)

    def test_trip_summary_fields(self):
        summary = post(self.client, self.payload).json()['trip_summary']
        for key in ('total_distance_miles', 'total_driving_hours',
                    'pickup_duration_hours', 'dropoff_duration_hours'):
            self.assertIn(key, summary)

    def test_pickup_duration_is_one_hour(self):
        summary = post(self.client, self.payload).json()['trip_summary']
        self.assertAlmostEqual(summary['pickup_duration_hours'], 1.0, places=5)

    def test_dropoff_duration_is_one_hour(self):
        summary = post(self.client, self.payload).json()['trip_summary']
        self.assertAlmostEqual(summary['dropoff_duration_hours'], 1.0, places=5)

    def test_days_is_nonempty_list(self):
        days = post(self.client, self.payload).json()['days']
        self.assertIsInstance(days, list)
        self.assertGreater(len(days), 0)

    def test_each_day_has_date_and_log_entries(self):
        for day in post(self.client, self.payload).json()['days']:
            self.assertIn('date', day)
            self.assertIn('log_entries', day)
            self.assertIsInstance(day['log_entries'], list)

    def test_log_entry_structure(self):
        for day in post(self.client, self.payload).json()['days']:
            for entry in day['log_entries']:
                for key in ('status', 'start_time', 'end_time', 'duration'):
                    self.assertIn(key, entry)

    def test_log_entry_statuses_are_valid(self):
        valid = {'DRIVING', 'ON_DUTY', 'OFF_DUTY', 'SLEEPER_BERTH'}
        for day in post(self.client, self.payload).json()['days']:
            for entry in day['log_entries']:
                self.assertIn(entry['status'], valid)

    def test_no_cycle_warning_for_fresh_driver(self):
        data = post(self.client, self.payload).json()
        self.assertFalse(data.get('34_hour_restart_required', False))

    def test_driving_hours_positive(self):
        summary = post(self.client, self.payload).json()['trip_summary']
        self.assertGreater(summary['total_driving_hours'], 0)


# ---------------------------------------------------------------------------
# Test 2: Long Multi-Day Trip
# ---------------------------------------------------------------------------

class LongTripTest(HOSTestCase):
    """
    NY → Chicago → Los Angeles ≈ 2,800 mi total, ~46.7 h driving.
    Must produce multiple days, 10-h rest breaks, and fueling stops every 1,000 mi.
    """

    def setUp(self):
        super().setUp()
        self.payload = {
            "current_location": "New York, NY",
            "pickup_location": "Chicago, IL",
            "dropoff_location": "Los Angeles, CA",
            "current_cycle_used": 0.0,
        }
        self._data = None

    @property
    def data(self):
        if self._data is None:
            self._data = post(self.client, self.payload).json()
        return self._data

    def test_returns_200(self):
        self.assertEqual(post(self.client, self.payload).status_code, 200)

    def test_spans_multiple_days(self):
        self.assertGreater(len(self.data['days']), 1)

    def test_rest_break_inserted(self):
        rest_statuses = {'SLEEPER_BERTH', 'OFF_DUTY'}
        all_statuses = {
            entry['status']
            for day in self.data['days']
            for entry in day['log_entries']
        }
        self.assertTrue(rest_statuses & all_statuses,
                        "No rest break found in multi-day trip")

    def test_rest_break_minimum_10_hours(self):
        # Only SLEEPER_BERTH marks a mandatory 10-h rest; OFF_DUTY is used for
        # 30-min breaks and day-padding so its duration varies.
        for day in self.data['days']:
            for entry in day['log_entries']:
                if entry['status'] == 'SLEEPER_BERTH':
                    self.assertGreaterEqual(
                        entry['duration'], 10.0,
                        f"Rest break too short: {entry['duration']} h on {day['date']}"
                    )

    def test_no_driving_segment_exceeds_11_hours(self):
        for day in self.data['days']:
            for entry in day['log_entries']:
                if entry['status'] == 'DRIVING':
                    self.assertLessEqual(
                        entry['duration'], 11.0 + 1e-9,
                        f"Driving segment exceeds 11 h: {entry['duration']} h"
                    )

    def test_fueling_stop_injected(self):
        fueling_entries = [
            entry
            for day in self.data['days']
            for entry in day['log_entries']
            if entry.get('reason') == 'FUELING'
        ]
        self.assertGreater(len(fueling_entries), 0,
                           "No fueling stop found for >1,000-mile trip")

    def test_fueling_stop_is_30_minutes(self):
        for day in self.data['days']:
            for entry in day['log_entries']:
                if entry.get('reason') == 'FUELING':
                    self.assertAlmostEqual(
                        entry['duration'], 0.5, places=5,
                        msg="Fueling stop duration should be 0.5 h"
                    )


# ---------------------------------------------------------------------------
# Test 3: HOS Cycle Violation — 34-hour restart required
# ---------------------------------------------------------------------------

class CycleViolationTest(HOSTestCase):
    """
    current_cycle_used=65 → only 5 h remain in the 70-h/8-day cycle.
    Any non-trivial trip must trigger 34_hour_restart_required=True.
    """

    def setUp(self):
        super().setUp()
        self.payload = {
            "current_location": "Chicago, IL",
            "pickup_location": "Detroit, MI",
            "dropoff_location": "Columbus, OH",
            "current_cycle_used": 65.0,
        }

    def test_returns_200(self):
        self.assertEqual(post(self.client, self.payload).status_code, 200)

    def test_restart_required_flag_true(self):
        data = post(self.client, self.payload).json()
        self.assertTrue(
            data.get('34_hour_restart_required', False),
            "Expected 34_hour_restart_required=True when cycle hours are high"
        )

    def test_restart_warning_in_warnings_list(self):
        data = post(self.client, self.payload).json()
        warnings = data.get('warnings', [])
        self.assertTrue(
            any('34' in str(w) or 'restart' in str(w).lower() for w in warnings),
            f"Expected restart warning in warnings list, got: {warnings}"
        )

    def test_still_returns_trip_days(self):
        data = post(self.client, self.payload).json()
        self.assertIn('days', data)
        self.assertIsInstance(data['days'], list)


# ---------------------------------------------------------------------------
# Test 4: 24-Hour Daily Integrity
# ---------------------------------------------------------------------------

class DailyIntegrityTest(HOSTestCase):
    """
    For every day in every response, the sum of all log entry durations
    must equal exactly 24.0 hours. Idle time must be padded with OFF_DUTY.
    """

    CASES = [
        {
            "label": "short_trip",
            "payload": {
                "current_location": "New York, NY",
                "pickup_location": "Philadelphia, PA",
                "dropoff_location": "Baltimore, MD",
                "current_cycle_used": 0.0,
            },
        },
        {
            "label": "long_trip",
            "payload": {
                "current_location": "New York, NY",
                "pickup_location": "Chicago, IL",
                "dropoff_location": "Los Angeles, CA",
                "current_cycle_used": 0.0,
            },
        },
        {
            "label": "cycle_near_limit",
            "payload": {
                "current_location": "Chicago, IL",
                "pickup_location": "Detroit, MI",
                "dropoff_location": "Columbus, OH",
                "current_cycle_used": 65.0,
            },
        },
    ]

    def setUp(self):
        super().setUp()

    def _run_integrity_check(self, payload, label):
        data = post(self.client, payload).json()
        days = data.get('days', [])
        self.assertGreater(len(days), 0, f"[{label}] No days returned")
        for day in days:
            total = sum_day_hours(day)
            self.assertAlmostEqual(
                total, 24.0, places=4,
                msg=(
                    f"[{label}] Day {day['date']} totals {total:.4f} h "
                    f"(expected 24.0). Entries: {day['log_entries']}"
                ),
            )

    def test_short_trip_24h_integrity(self):
        case = next(c for c in self.CASES if c['label'] == 'short_trip')
        self._run_integrity_check(case['payload'], case['label'])

    def test_long_trip_24h_integrity(self):
        case = next(c for c in self.CASES if c['label'] == 'long_trip')
        self._run_integrity_check(case['payload'], case['label'])

    def test_cycle_near_limit_24h_integrity(self):
        case = next(c for c in self.CASES if c['label'] == 'cycle_near_limit')
        self._run_integrity_check(case['payload'], case['label'])
