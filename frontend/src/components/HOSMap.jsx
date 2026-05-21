import { useEffect, useState, useMemo } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// ── Tile config ──────────────────────────────────────────────────────────────
const DARK_TILES = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

const US_CENTER = [39.5, -98.35];

// ── Icon factory ─────────────────────────────────────────────────────────────
function makeIcon(type) {
  const configs = {
    start: {
      html: `<div class="hos-pin-start"></div>`,
      size: [16, 16],
      anchor: [8, 8],
    },
    pickup: {
      html: `<div class="hos-pin-badge" style="background:#6366f1;box-shadow:0 0 8px rgba(99,102,241,.55)">PU</div>`,
      size: [30, 20],
      anchor: [15, 10],
    },
    dropoff: {
      html: `<div class="hos-pin-badge" style="background:#f43f5e;box-shadow:0 0 8px rgba(244,63,94,.55)">DO</div>`,
      size: [30, 20],
      anchor: [15, 10],
    },
    rest: {
      html: `<div class="hos-pin-stop" style="background:#f59e0b;box-shadow:0 0 6px rgba(245,158,11,.6)"></div>`,
      size: [10, 10],
      anchor: [5, 5],
    },
    fuel: {
      html: `<div class="hos-pin-stop" style="background:#fb923c;box-shadow:0 0 6px rgba(251,146,60,.6)"></div>`,
      size: [10, 10],
      anchor: [5, 5],
    },
  };
  const { html, size, anchor } = configs[type] ?? configs.rest;
  return L.divIcon({ html, className: '', iconSize: size, iconAnchor: anchor });
}

// ── FitBounds inner component (must live inside MapContainer) ─────────────────
function FitBoundsToRoute({ positions }) {
  const map = useMap();
  useEffect(() => {
    if (!positions || positions.length < 2) return;
    const bounds = L.latLngBounds(positions);
    map.fitBounds(bounds, { padding: [50, 50], animate: true, duration: 0.8 });
  }, [positions, map]);
  return null;
}

// ── OSRM helper ───────────────────────────────────────────────────────────────
async function fetchOSRMRoute(waypoints) {
  // waypoints: array of [lat, lon]   OSRM expects lon,lat
  const coordStr = waypoints
    .map(([lat, lon]) => `${lon},${lat}`)
    .join(';');
  const url =
    `https://router.project-osrm.org/route/v1/driving/${coordStr}` +
    `?overview=full&geometries=geojson`;
  const res  = await fetch(url);
  const data = await res.json();
  if (!data.routes?.[0]) throw new Error('No route returned');
  // GeoJSON coords are [lon, lat] → flip to [lat, lon] for Leaflet
  return data.routes[0].geometry.coordinates.map(([lon, lat]) => [lat, lon]);
}

// ── Main component ────────────────────────────────────────────────────────────
/**
 * Props:
 *   start   [lat, lon]   – current driver location (green pulse)
 *   pickup  [lat, lon]   – pickup location (indigo PU badge)
 *   dropoff [lat, lon]   – dropoff location (rose DO badge)
 *   stops   Array<{ position:[lat,lon], type:'rest'|'fuel', label?:string }>
 */
export default function HOSMap({ start, pickup, dropoff, stops = [] }) {
  const [route, setRoute]     = useState([]);     // [[lat,lon], …]
  const [fetching, setFetching] = useState(false);
  const [routeError, setRouteError] = useState(null);

  // Memoise icons so L.divIcon isn't re-created on every render
  const icons = useMemo(() => ({
    start:   makeIcon('start'),
    pickup:  makeIcon('pickup'),
    dropoff: makeIcon('dropoff'),
    rest:    makeIcon('rest'),
    fuel:    makeIcon('fuel'),
  }), []);

  // Fetch OSRM route whenever key waypoints change
  useEffect(() => {
    if (!start || !pickup || !dropoff) {
      setRoute([]);
      return;
    }
    let cancelled = false;
    setFetching(true);
    setRouteError(null);

    // Include any intermediate stop positions in the route request
    const intermediateStops = stops
      .filter(s => s.position)
      .map(s => s.position);

    // Build ordered waypoint list: start → stops → pickup → stops → dropoff
    // For simplicity we just route start→pickup→dropoff; stops are overlaid as markers
    fetchOSRMRoute([start, pickup, dropoff])
      .then(positions => { if (!cancelled) setRoute(positions); })
      .catch(err => { if (!cancelled) setRouteError(err.message); })
      .finally(() => { if (!cancelled) setFetching(false); });

    return () => { cancelled = true; };
  }, [
    start?.[0], start?.[1],
    pickup?.[0], pickup?.[1],
    dropoff?.[0], dropoff?.[1],
  ]);

  const hasCoords = Boolean(start && pickup && dropoff);
  const center    = start ?? US_CENTER;
  const zoom      = hasCoords ? 5 : 4;

  return (
    <div className="relative rounded-2xl overflow-hidden border border-slate-700 shadow-xl"
         style={{ height: '280px' }}>

      {/* ── Header overlay ── */}
      <div className="absolute top-0 left-0 right-0 z-[1000] px-3 py-2
                      flex items-center gap-2
                      bg-gradient-to-b from-slate-950/90 to-transparent pointer-events-none">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
          Route Map
        </span>
        {fetching && (
          <span className="ml-auto text-[10px] text-slate-500 flex items-center gap-1">
            <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10"
                stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor"
                d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Loading route…
          </span>
        )}
        {routeError && (
          <span className="ml-auto text-[10px] text-red-400">Route unavailable</span>
        )}
      </div>

      {/* ── Leaflet Map ── */}
      <MapContainer
        center={center}
        zoom={zoom}
        style={{ height: '100%', width: '100%', background: '#0f172a' }}
        zoomControl={false}
        attributionControl={false}
      >
        {/* Dark CartoDB tiles */}
        <TileLayer url={DARK_TILES} attribution={ATTRIBUTION} />

        {/* Route — glow layer + crisp line */}
        {route.length > 1 && (
          <>
            <Polyline
              positions={route}
              pathOptions={{ color: '#00f2fe', weight: 8, opacity: 0.18 }}
            />
            <Polyline
              positions={route}
              pathOptions={{ color: '#00f2fe', weight: 2.5, opacity: 0.95 }}
            />
          </>
        )}

        {/* Key markers */}
        {start   && <Marker position={start}   icon={icons.start}   />}
        {pickup  && <Marker position={pickup}  icon={icons.pickup}  />}
        {dropoff && <Marker position={dropoff} icon={icons.dropoff} />}

        {/* Intermediate stop markers */}
        {stops.map((stop, i) => (
          stop.position && (
            <Marker
              key={i}
              position={stop.position}
              icon={stop.type === 'fuel' ? icons.fuel : icons.rest}
            />
          )
        ))}

        {/* Auto-fit bounds to the fetched polyline */}
        {route.length > 1 && <FitBoundsToRoute positions={route} />}
      </MapContainer>

      {/* ── Legend (bottom-right overlay) ── */}
      {hasCoords && (
        <div className="absolute bottom-2 right-2 z-[1000]
                        bg-slate-900/85 backdrop-blur rounded-lg
                        border border-slate-700 px-2.5 py-1.5
                        flex flex-col gap-1 text-[10px] text-slate-400">
          <LegendRow color="bg-emerald-400" pulse label="Start" />
          <LegendRow color="bg-indigo-500"        label="Pickup" />
          <LegendRow color="bg-rose-500"          label="Dropoff" />
          {stops.some(s => s.type === 'rest') && (
            <LegendRow color="bg-amber-400" label="Rest" />
          )}
          {stops.some(s => s.type === 'fuel') && (
            <LegendRow color="bg-orange-400" label="Fuel" />
          )}
        </div>
      )}
    </div>
  );
}

function LegendRow({ color, label, pulse }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${color} ${pulse ? 'animate-pulse' : ''}`} />
      {label}
    </div>
  );
}
