import { useMemo } from 'react';

// ── SVG layout constants ──────────────────────────────────────────────────────
const ML  = 126;          // margin-left  (row label area)
const MT  = 42;           // margin-top   (hour label area)
const GW  = 824;          // grid width   = 24 h span
const RH  = 32;           // one row height
const GH  = RH * 4;       // total grid height = 128
const TG  = 8;            // gap before totals column
const TW  = 44;           // totals column width
const SW  = ML + GW + TG + TW + 6;   // SVG total width  ≈ 1008
const SH  = MT + GH + 12;            // SVG total height ≈ 182

// ── Data ─────────────────────────────────────────────────────────────────────
const ROWS = ['OFF_DUTY', 'SLEEPER_BERTH', 'DRIVING', 'ON_DUTY'];

const LABELS = ['Off Duty', 'Sleeper Berth', 'Driving', 'On Duty'];

const SVG_ROW_LABELS = [
  '1.  Off Duty',
  '2.  Sleeper Berth',
  '3.  Driving',
  '4.  On Duty',
];

const ROW_BG = ['#0d1a2e', '#0b1826', '#0b1e17', '#0c1530'];

const ROW_ACCENT = ['#1e3a5f40', '#1a305040', '#1a4a3040', '#1e286040'];

// 25 labels: Midnight … Noon … Midnight
const HOUR_LABELS = [
  'Mid', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11',
  'Noon',
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', 'Mid',
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(h) {
  return h % 1 === 0 ? String(h) : h.toFixed(1);
}

function timeToX(t) {
  if (t === '24:00') return ML + GW;
  const [h, m] = t.split(':').map(Number);
  return ML + ((h * 60 + m) / 1440) * GW;
}

function rowY(status) {
  const i = ROWS.indexOf(status);
  if (i === -1) return MT + GH / 2;
  return MT + (i + 0.5) * RH;
}

function buildSegments(entries) {
  const valid = [...entries]
    .filter(e => ROWS.includes(e.status))
    .sort((a, b) => timeToX(a.start_time) - timeToX(b.start_time));

  const segs = [];
  let prevY = null;

  for (const e of valid) {
    const x1 = timeToX(e.start_time);
    const x2 = timeToX(e.end_time);
    const y  = rowY(e.status);

    if (prevY !== null && Math.abs(prevY - y) > 0.5) {
      segs.push({ x1, y1: prevY, x2: x1, y2: y });
    }
    segs.push({ x1, y1: y, x2, y2: y });
    prevY = y;
  }
  return segs;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function ELDLog({ day }) {
  if (!day) return null;

  const { date, log_entries = [] } = day;

  const totals = useMemo(() => {
    const t = Object.fromEntries(ROWS.map(r => [r, 0]));
    for (const e of log_entries) {
      if (t[e.status] !== undefined) t[e.status] += e.duration;
    }
    return t;
  }, [log_entries]);

  const grandTotal  = Object.values(totals).reduce((a, b) => a + b, 0);
  const integrityOk = Math.abs(grandTotal - 24) < 0.001;

  const segments = useMemo(() => buildSegments(log_entries), [log_entries]);

  console.log('Segments:', segments);

  return (
    <div className="rounded-xl overflow-hidden border border-slate-700 bg-slate-950 shadow-2xl select-none">

      {/* ── Paper header ── */}
      <div className="flex items-center justify-between px-4 py-2
                      bg-slate-900 border-b border-slate-700">
        <div>
          <span className="text-[10px] font-black uppercase tracking-[.15em] text-slate-400">
            Driver's Daily Log
          </span>
          <span className="ml-2 text-[10px] text-slate-600">(24 Hours)</span>
        </div>
        <span className="font-mono text-sm font-bold text-white tracking-wider">{date}</span>
      </div>

      {/* ── SVG Grid ── */}
      <svg
        viewBox={`0 0 ${SW} ${SH}`}
        width="100%"
        style={{ display: 'block', background: '#060e1a' }}
        aria-label="ELD log grid"
      >
        <defs>
          {/* Subtle glow — very low stdDeviation so it doesn't bleed across rows */}
          <filter id="lineGlow" x="-2%" y="-60%" width="104%" height="220%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="0.8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Clip path so the line stays inside the grid */}
          <clipPath id="gridClip">
            <rect x={ML} y={MT} width={GW} height={GH} />
          </clipPath>
        </defs>

        {/* ── Row backgrounds ── */}
        {ROWS.map((row, i) => (
          <rect
            key={row}
            x={ML} y={MT + i * RH}
            width={GW} height={RH}
            fill={ROW_BG[i]}
          />
        ))}

        {/* ── Vertical hour lines (full grid height) ── */}
        {Array.from({ length: 25 }, (_, h) => {
          const x = ML + (h / 24) * GW;
          const isMajor = h % 12 === 0;
          return (
            <line
              key={`h${h}`}
              x1={x} y1={MT} x2={x} y2={MT + GH}
              stroke={isMajor ? '#2a4a7a' : '#1a3050'}
              strokeWidth={isMajor ? 1.4 : 0.8}
            />
          );
        })}

        {/* ── Sub-minute tick marks (15 / 30 / 45 min) ── */}
        {Array.from({ length: 24 }, (_, h) =>
          [15, 30, 45].map(min => {
            const x  = ML + ((h * 60 + min) / 1440) * GW;
            const th = min === 30 ? RH * 0.48 : RH * 0.22; // tick height
            return ROWS.map((_, ri) => (
              <line
                key={`s${h}-${min}-${ri}`}
                x1={x} y1={MT + ri * RH}
                x2={x} y2={MT + ri * RH + th}
                stroke={min === 30 ? '#1d3d6a' : '#162e52'}
                strokeWidth={min === 30 ? 0.9 : 0.6}
              />
            ));
          })
        )}

        {/* ── Horizontal row separator lines ── */}
        {Array.from({ length: 5 }, (_, i) => (
          <line
            key={`row${i}`}
            x1={ML} y1={MT + i * RH}
            x2={ML + GW} y2={MT + i * RH}
            stroke="#243e5c"
            strokeWidth={i === 0 || i === 4 ? 1.2 : 0.7}
          />
        ))}

        {/* Left border */}
        <line x1={ML} y1={MT} x2={ML} y2={MT + GH}
              stroke="#243e5c" strokeWidth="1.2" />

        {/* ── Hour labels (top) ── */}
        {HOUR_LABELS.map((label, i) => (
          <text
            key={`hl${i}`}
            x={ML + (i / 24) * GW}
            y={MT - 10}
            textAnchor="middle"
            fontSize="8"
            fill="#4a6080"
            fontFamily="monospace"
          >
            {label}
          </text>
        ))}

        {/* Tick marks above grid at each hour */}
        {Array.from({ length: 25 }, (_, h) => (
          <line
            key={`t${h}`}
            x1={ML + (h / 24) * GW} y1={MT - 5}
            x2={ML + (h / 24) * GW} y2={MT}
            stroke="#2a4a7a" strokeWidth="0.8"
          />
        ))}

        {/* ── Row labels (left) ── */}
        {SVG_ROW_LABELS.map((label, i) => (
          <text
            key={`rl${i}`}
            x={ML - 8}
            y={MT + (i + 0.52) * RH}
            textAnchor="end"
            fontSize="9.5"
            fill="#94a3b8"
            fontFamily="system-ui, sans-serif"
            dominantBaseline="middle"
          >
            {label}
          </text>
        ))}

        {/* ── Totals column header ── */}
        <text
          x={ML + GW + TG + TW / 2} y={MT - 10}
          textAnchor="middle" fontSize="7.5" fill="#4a6080"
          fontFamily="monospace" fontWeight="bold"
        >
          HRS
        </text>
        <line
          x1={ML + GW + TG} y1={MT}
          x2={ML + GW + TG} y2={MT + GH}
          stroke="#243e5c" strokeWidth="0.8"
        />

        {/* ── Total hours per row ── */}
        {ROWS.map((row, i) => (
          <text
            key={`tot${row}`}
            x={ML + GW + TG + TW / 2}
            y={MT + (i + 0.52) * RH}
            textAnchor="middle"
            fontSize="12"
            fontWeight="bold"
            fontFamily="monospace"
            fill={totals[row] > 0 ? '#e2e8f0' : '#334155'}
            dominantBaseline="middle"
          >
            {fmt(totals[row])}
          </text>
        ))}

        {/* ── Driver log line ── */}
        <g clipPath="url(#gridClip)" filter="url(#lineGlow)">
          {segments.map((s, i) => (
            <line
              key={i}
              x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
              stroke="#00eeff"
              strokeWidth="2"
              strokeOpacity="0.95"
            />
          ))}
        </g>

        {/* ── "Total Hours" label bottom-right of grid ── */}
        <text
          x={ML + GW - 4} y={MT + GH + 10}
          textAnchor="end"
          fontSize="7.5" fill="#334155"
          fontFamily="monospace"
        >
          Total On-Duty Hours: {fmt(totals.DRIVING + totals.ON_DUTY)}
        </text>
      </svg>

      {/* ── Integrity warning (HTML for data-testid) ── */}
      {!integrityOk && (
        <div
          data-testid="integrity-warning"
          className="mx-4 my-2 flex items-center gap-2 rounded-lg
                     bg-red-950/60 border border-red-800 px-3 py-2
                     text-xs text-red-300"
        >
          <span className="text-base">⚠</span>
          <span>
            Day total is <strong className="text-red-200">{fmt(grandTotal)}</strong> h —
            expected <strong className="text-red-200">24</strong> h.
            Log may be incomplete.
          </span>
        </div>
      )}

      {/* ── Status totals row (HTML — carries data-testid for tests) ── */}
      <div className="grid grid-cols-4 gap-px bg-slate-800 border-t border-slate-700">
        {ROWS.map((row, i) => (
          <div key={row} className="bg-slate-900 px-3 py-2.5 text-center">
            <div className="text-[9px] uppercase tracking-widest text-slate-500 mb-0.5 font-semibold">
              {LABELS[i]}
            </div>
            <div
              data-testid={`total-${row}`}
              className="text-sm font-extrabold font-mono text-white"
            >
              {fmt(totals[row])}
            </div>
          </div>
        ))}
      </div>

      {/* ── Official form fields ── */}
      <div className="grid grid-cols-3 gap-3 px-4 py-3 border-t border-slate-800 bg-slate-950">
        {[
          { label: 'Carrier Name',     placeholder: 'Spotter Logistics Inc.' },
          { label: 'Truck / Vehicle ID', placeholder: 'e.g. TRK-4821' },
          { label: 'Driver Signature', placeholder: 'Sign here…' },
        ].map(({ label, placeholder }) => (
          <div key={label} className="flex flex-col gap-1">
            <label className="text-[9px] uppercase tracking-widest text-slate-600 font-semibold">
              {label}
            </label>
            <div className="border-b border-slate-700 pb-0.5">
              <input
                type="text"
                placeholder={placeholder}
                className="w-full bg-transparent text-xs text-slate-400
                           placeholder-slate-700 focus:outline-none focus:text-slate-200
                           transition caret-indigo-400"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
