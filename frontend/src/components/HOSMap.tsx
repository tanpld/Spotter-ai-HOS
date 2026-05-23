import { useEffect, useState } from "react";
import { useFullscreen } from "../hooks/useFullscreen";
import {
  MapContainer,
  TileLayer,
  Polyline,
  Marker,
  useMap,
} from "react-leaflet";
import L, { LatLngTuple } from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapStop } from "../types";

// ── Tile config ──────────────────────────────────────────────────────────────
const DARK_TILES =
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

const US_CENTER: LatLngTuple = [39.5, -98.35];

// ── Icon factory ─────────────────────────────────────────────────────────────
type IconType = "start" | "pickup" | "dropoff" | "rest" | "fuel";

interface IconConfig {
  html: string;
  size: [number, number];
  anchor: [number, number];
}

function makeIcon(type: IconType): L.DivIcon {
  const configs: Record<IconType, IconConfig> = {
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
  const { html, size, anchor } = configs[type];
  return L.divIcon({ html, className: "", iconSize: size, iconAnchor: anchor });
}

// ── FitBounds inner component (must live inside MapContainer) ─────────────────
interface FitBoundsProps {
  positions: LatLngTuple[];
}

function FitBoundsToRoute({ positions }: FitBoundsProps) {
  const map = useMap();
  useEffect(() => {
    if (!positions || positions.length < 2) return;
    const bounds = L.latLngBounds(positions);
    map.fitBounds(bounds, { padding: [50, 50], animate: true, duration: 0.8 });
  }, [positions, map]);
  return null;
}

// ── Fullscreen sync — invalidate size + zoom when container resizes ────────────
interface FullscreenSyncProps {
  isFullscreen: boolean;
}

function FullscreenSync({ isFullscreen }: FullscreenSyncProps) {
  const map = useMap();
  useEffect(() => {
    // 100ms delay lets the CSS transition finish before invalidateSize reads the new dimensions
    setTimeout(() => {
      map.invalidateSize({ animate: false });
      if (isFullscreen) {
        map.zoomIn(3, { animate: true });
      } else {
        map.zoomOut(3, { animate: true });
      }
    }, 100);
  }, [isFullscreen, map]);
  return null;
}

// ── OSRM helper ───────────────────────────────────────────────────────────────
async function fetchOSRMRoute(
  waypoints: [number, number][],
): Promise<LatLngTuple[]> {
  // waypoints: array of [lat, lon]   OSRM expects lon,lat
  const coordStr = waypoints.map(([lat, lon]) => `${lon},${lat}`).join(";");
  const url =
    `https://router.project-osrm.org/route/v1/driving/${coordStr}` +
    `?overview=full&geometries=geojson`;
  const res = await fetch(url);
  const data = (await res.json()) as {
    routes?: Array<{ geometry: { coordinates: [number, number][] } }>;
  };
  if (!data.routes?.[0]) throw new Error("No route returned");
  // GeoJSON coords are [lon, lat] → flip to [lat, lon] for Leaflet
  return data.routes[0].geometry.coordinates.map(
    ([lon, lat]): LatLngTuple => [lat, lon],
  );
}

// ── Polyline interpolation ────────────────────────────────────────────────────
function interpolateOnPolyline(
  route: LatLngTuple[],
  progress: number,
): LatLngTuple {
  if (route.length < 2) return route[0];
  let total = 0;
  const cumulative = [0];
  for (let i = 1; i < route.length; i++) {
    const dlat = route[i][0] - route[i - 1][0];
    const dlon = route[i][1] - route[i - 1][1];
    total += Math.sqrt(dlat * dlat + dlon * dlon);
    cumulative.push(total);
  }
  const target = Math.min(Math.max(progress, 0), 1) * total;
  for (let i = 1; i < route.length; i++) {
    if (cumulative[i] >= target) {
      const segLen = cumulative[i] - cumulative[i - 1];
      const t = segLen < 1e-10 ? 0 : (target - cumulative[i - 1]) / segLen;
      return [
        route[i - 1][0] + t * (route[i][0] - route[i - 1][0]),
        route[i - 1][1] + t * (route[i][1] - route[i - 1][1]),
      ];
    }
  }
  return route[route.length - 1];
}

// makeIcon is pure — create icons once at module level instead of per render
const ICONS = {
  start: makeIcon("start"),
  pickup: makeIcon("pickup"),
  dropoff: makeIcon("dropoff"),
  rest: makeIcon("rest"),
  fuel: makeIcon("fuel"),
} as const;

// ── Main component ────────────────────────────────────────────────────────────
interface HOSMapProps {
  start?: [number, number];
  pickup?: [number, number];
  dropoff?: [number, number];
  stops?: MapStop[];
}

export default function HOSMap({
  start,
  pickup,
  dropoff,
  stops = [],
}: HOSMapProps) {
  const [route, setRoute] = useState<LatLngTuple[]>([]);
  const [fetching, setFetching] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const {
    ref: containerRef,
    isFullscreen,
    toggle: toggleFullscreen,
  } = useFullscreen();

  // Fetch OSRM route whenever key waypoints change
  useEffect(() => {
    if (!start || !pickup || !dropoff) {
      setRoute([]);
      return;
    }
    let cancelled = false;
    setFetching(true);
    setRouteError(null);

    // Build ordered waypoint list: start → pickup → dropoff
    // Stops are overlaid as markers only
    fetchOSRMRoute([start, pickup, dropoff])
      .then((positions) => {
        if (!cancelled) setRoute(positions);
      })
      .catch((err: Error) => {
        if (!cancelled) setRouteError(err.message);
      })
      .finally(() => {
        if (!cancelled) setFetching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    start?.[0],
    start?.[1],
    pickup?.[0],
    pickup?.[1],
    dropoff?.[0],
    dropoff?.[1],
  ]);

  const hasCoords = Boolean(start && pickup && dropoff);
  const center: LatLngTuple = start ?? US_CENTER;
  const zoom = hasCoords ? 5 : 4;

  return (
    <div
      ref={containerRef as React.RefObject<HTMLDivElement>}
      className="relative isolate rounded-2xl overflow-hidden border border-slate-700 shadow-xl bg-slate-950"
      style={{ height: isFullscreen ? "100vh" : "280px" }}
    >
      {/* ── Header overlay ── */}
      <div
        className="absolute top-0 left-0 right-0 z-[1000] px-3 py-2
                      flex items-center gap-2
                      bg-gradient-to-b from-slate-950/90 to-transparent"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
          Route Map
        </span>
        {fetching && (
          <span className="text-[10px] text-slate-500 flex items-center gap-1">
            <svg
              className="w-3 h-3 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v8H4z"
              />
            </svg>
            Loading route…
          </span>
        )}
        {routeError && (
          <span className="text-[10px] text-red-400">Route unavailable</span>
        )}
        <button
          onClick={toggleFullscreen}
          className="ml-auto pointer-events-auto p-1.5 rounded-lg
                     bg-slate-800/70 border border-slate-700 hover:bg-slate-700
                     text-slate-400 hover:text-slate-200 transition"
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        >
          {isFullscreen ? (
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 9L4 4m0 0h5m-5 0v5M15 9l5-5m0 0h-5m5 0v5M9 15l-5 5m0 0h5m-5 0v-5M15 15l5 5m0 0h-5m5 0v-5"
              />
            </svg>
          ) : (
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 8V4m0 0h4M4 4l5 5M20 8V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5M20 16v4m0 0h-4m4 0l-5-5"
              />
            </svg>
          )}
        </button>
      </div>

      {/* ── Leaflet Map ── */}
      <MapContainer
        center={center}
        zoom={zoom}
        style={{ height: "100%", width: "100%", background: "#0f172a" }}
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
              pathOptions={{ color: "#00f2fe", weight: 8, opacity: 0.18 }}
            />
            <Polyline
              positions={route}
              pathOptions={{ color: "#00f2fe", weight: 2.5, opacity: 0.95 }}
            />
          </>
        )}

        {/* Key markers */}
        {start && <Marker position={start} icon={ICONS.start} />}
        {pickup && <Marker position={pickup} icon={ICONS.pickup} />}
        {dropoff && <Marker position={dropoff} icon={ICONS.dropoff} />}

        {/* Intermediate stop markers */}
        {stops.map((stop, i) => {
          const pos =
            stop.progress !== undefined && route.length > 1
              ? interpolateOnPolyline(route, stop.progress)
              : stop.position;
          return pos ? (
            <Marker
              key={i}
              position={pos}
              icon={stop.type === "fuel" ? ICONS.fuel : ICONS.rest}
            />
          ) : null;
        })}

        {/* Auto-fit bounds to the fetched polyline */}
        {route.length > 1 && <FitBoundsToRoute positions={route} />}

        {/* Sync map size + zoom on fullscreen toggle */}
        <FullscreenSync isFullscreen={isFullscreen} />
      </MapContainer>

      {/* ── Empty-state overlay ── */}
      {!hasCoords && (
        <div
          className="absolute inset-0 z-[1000] flex flex-col items-center justify-center
                        bg-slate-950/60 backdrop-blur-[2px] pointer-events-none"
        >
          <div className="text-center px-6">
            <div
              className="w-12 h-12 mx-auto rounded-xl bg-slate-800 border border-slate-700
                            flex items-center justify-center text-2xl mb-3 shadow-lg"
            >
              🗺️
            </div>
            <p className="text-slate-300 text-xs font-semibold mb-1">
              No route to display
            </p>
            <p className="text-slate-500 text-[11px] leading-relaxed max-w-[180px] mx-auto">
              Enter trip details to generate FMCSA compliant logs
            </p>
          </div>
        </div>
      )}

      {/* ── Legend (bottom-right overlay) ── */}
      {hasCoords && (
        <div
          className="absolute bottom-2 right-2 z-[1000]
                        bg-slate-900/85 backdrop-blur rounded-lg
                        border border-slate-700 px-2.5 py-1.5
                        flex flex-col gap-1 text-[10px] text-slate-400"
        >
          <LegendRow color="bg-emerald-400" pulse label="Start" />
          <LegendRow color="bg-indigo-500" label="Pickup" />
          <LegendRow color="bg-rose-500" label="Dropoff" />
          {stops.some((s) => s.type === "rest") && (
            <LegendRow color="bg-amber-400" label="Rest" />
          )}
          {stops.some((s) => s.type === "fuel") && (
            <LegendRow color="bg-orange-400" label="Fuel" />
          )}
        </div>
      )}
    </div>
  );
}

interface LegendRowProps {
  color: string;
  label: string;
  pulse?: boolean;
}

function LegendRow({ color, label, pulse }: LegendRowProps) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`w-2 h-2 rounded-full ${color} ${pulse ? "animate-pulse" : ""}`}
      />
      {label}
    </div>
  );
}
