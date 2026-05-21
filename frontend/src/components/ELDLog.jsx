const STATUSES = [
  { key: 'OFF_DUTY',      label: 'Off Duty',      color: 'bg-slate-500' },
  { key: 'SLEEPER_BERTH', label: 'Sleeper Berth',  color: 'bg-indigo-600' },
  { key: 'DRIVING',       label: 'Driving',        color: 'bg-emerald-500' },
  { key: 'ON_DUTY',       label: 'On Duty',        color: 'bg-amber-500' },
];

const HOURS = Array.from({ length: 25 }, (_, i) => i); // 0–24

function toMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

export default function ELDLog({ day }) {
  if (!day) return null;

  const { date, log_entries = [] } = day;

  // Sum hours per status
  const totals = Object.fromEntries(STATUSES.map(s => [s.key, 0]));
  for (const entry of log_entries) {
    if (totals[entry.status] !== undefined) {
      totals[entry.status] += entry.duration;
    }
  }
  const grandTotal = Object.values(totals).reduce((a, b) => a + b, 0);
  const integrityOk = Math.abs(grandTotal - 24) < 0.001;

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700 bg-slate-900">
        <span className="text-xs font-semibold text-slate-400 tracking-widest uppercase">
          Drivers Daily Log
        </span>
        <span className="text-sm font-bold text-white">{date}</span>
      </div>

      {/* Integrity warning */}
      {!integrityOk && (
        <div
          data-testid="integrity-warning"
          className="mx-4 mt-3 rounded-lg bg-red-900/50 border border-red-700 px-3 py-2 text-xs text-red-300"
        >
          ⚠ Day total is <strong>{grandTotal}</strong> h — expected <strong>24</strong> h.
          Log may be incomplete.
        </div>
      )}

      {/* Grid */}
      <div className="px-4 py-3 space-y-1">
        {/* Hour ruler */}
        <div className="flex ml-28">
          {HOURS.map(h => (
            <div
              key={h}
              className="flex-1 text-center text-[9px] text-slate-500 font-mono leading-tight"
            >
              {h === 0 ? 'Mid' : h === 12 ? 'Noon' : h === 24 ? 'Mid' : h}
            </div>
          ))}
        </div>

        {/* Status rows */}
        {STATUSES.map(({ key, label, color }) => {
          const rowEntries = log_entries.filter(e => e.status === key);
          const rowTotal = totals[key];

          return (
            <div key={key} className="flex items-center gap-2">
              {/* Label + total */}
              <div className="w-28 flex items-center justify-between shrink-0">
                <span className="text-xs text-slate-300 font-medium">{label}</span>
                <span
                  data-testid={`total-${key}`}
                  className="text-xs font-mono font-bold text-white w-6 text-right"
                >
                  {rowTotal % 1 === 0 ? rowTotal : rowTotal.toFixed(1)}
                </span>
              </div>

              {/* Timeline bar */}
              <div className="relative flex-1 h-5 bg-slate-700/50 rounded overflow-hidden border border-slate-600/40">
                {rowEntries.map((entry, i) => {
                  const startMin = toMinutes(entry.start_time);
                  const endMin   = toMinutes(entry.end_time === '24:00' ? '23:59' : entry.end_time);
                  const left  = (startMin / (24 * 60)) * 100;
                  const width = ((endMin - startMin) / (24 * 60)) * 100;
                  return (
                    <div
                      key={i}
                      className={`absolute top-0 h-full ${color} opacity-90`}
                      style={{ left: `${left}%`, width: `${Math.max(width, 0.3)}%` }}
                      title={`${entry.start_time}–${entry.end_time} (${entry.duration}h)`}
                    />
                  );
                })}

                {/* Hour grid lines */}
                {HOURS.slice(1, 24).map(h => (
                  <div
                    key={h}
                    className="absolute top-0 h-full border-l border-slate-600/30"
                    style={{ left: `${(h / 24) * 100}%` }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer totals recap */}
      <div className="grid grid-cols-4 gap-px bg-slate-700 border-t border-slate-700">
        {STATUSES.map(({ key, label, color }) => (
          <div key={key} className="bg-slate-800 px-3 py-2 text-center">
            <div className={`inline-block w-2 h-2 rounded-full ${color} mb-1`} />
            <div className="text-[10px] text-slate-400 leading-tight">{label}</div>
            <div className="text-sm font-bold text-white font-mono">
              {totals[key] % 1 === 0 ? totals[key] : totals[key].toFixed(1)}h
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
