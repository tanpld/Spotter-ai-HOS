import { useState } from 'react';
import Sidebar from './components/Sidebar';
import ELDLog from './components/ELDLog';
import HOSMap from './components/HOSMap';
import './index.css';

const INITIAL_FORM = {
  current_location:   '',
  pickup_location:    '',
  dropoff_location:   '',
  current_cycle_used: 0,
};

export default function App() {
  const [form,    setForm]    = useState(INITIAL_FORM);
  const [result,  setResult]  = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [activeDay, setActiveDay] = useState(0);

  function handleChange(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function handleSubmit() {
    setLoading(true);
    setError(null);
    setActiveDay(0);
    try {
      const res = await fetch('/api/hos-planner/', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(form),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const days    = result?.days ?? [];
  const summary = result?.trip_summary ?? null;
  const restart = result?.['34_hour_restart_required'] ?? false;
  const mapData = result?.map_data ?? null;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col">
      {/* ── Header ── */}
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-screen-xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl font-extrabold tracking-tight text-white">
              💡 Spotter HOS
            </span>
            <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5
                             rounded-full bg-indigo-600/20 text-indigo-400 border border-indigo-700/50">
              Full-Stack Assessment
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            FMCSA HOS Compliant
          </div>
        </div>
      </header>

      {/* ── Body ── */}
      <main className="flex-1 max-w-screen-xl mx-auto w-full px-6 py-6 grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">

        {/* ── Left column: form + map ── */}
        <div className="flex flex-col gap-4">
          <Sidebar
            values={form}
            onChange={handleChange}
            onSubmit={handleSubmit}
            loading={loading}
          />
          <HOSMap
            start={mapData?.start}
            pickup={mapData?.pickup}
            dropoff={mapData?.dropoff}
            stops={mapData?.stops ?? []}
          />
        </div>

        {/* ── Right column: Results ── */}
        <section className="flex flex-col gap-4">

          {/* Restart warning banner */}
          {restart && (
            <div className="rounded-xl border border-red-700 bg-red-900/30 px-4 py-3
                            flex items-center gap-3 text-sm text-red-300">
              <span className="text-2xl">⚠️</span>
              <div>
                <p className="font-bold text-red-200">34-Hour Restart Required</p>
                <p className="text-xs text-red-400 mt-0.5">
                  Cycle hours exceeded 70 h. Driver must take a 34-hour off-duty restart before continuing.
                </p>
              </div>
            </div>
          )}

          {/* Trip summary pills */}
          {summary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Total Distance', value: `${summary.total_distance_miles} mi` },
                { label: 'Driving Hours',  value: `${summary.total_driving_hours} h` },
                { label: 'Cycle After',    value: `${summary.estimated_cycle_after_trip} h` },
                { label: 'Trip Days',      value: `${days.length} day${days.length !== 1 ? 's' : ''}` },
              ].map(({ label, value }) => (
                <div key={label}
                  className="rounded-xl border border-slate-700 bg-slate-800/50 px-4 py-3 text-center">
                  <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">{label}</div>
                  <div className="text-lg font-extrabold text-white font-mono">{value}</div>
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-xl border border-red-700 bg-red-900/20 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Day tabs + ELD log */}
          {days.length > 0 && (
            <div className="rounded-2xl border border-slate-700 bg-slate-800/40 overflow-hidden shadow-xl">
              {/* Tab bar */}
              <div className="flex overflow-x-auto border-b border-slate-700 bg-slate-900/50">
                {days.map((day, i) => (
                  <button
                    key={day.date}
                    onClick={() => setActiveDay(i)}
                    className={`shrink-0 px-5 py-3 text-xs font-bold uppercase tracking-wider
                                transition border-b-2
                                ${i === activeDay
                                  ? 'border-indigo-500 text-indigo-300 bg-slate-800/60'
                                  : 'border-transparent text-slate-500 hover:text-slate-300'}`}
                  >
                    Day {i + 1}
                    <span className="ml-1.5 text-[9px] font-mono opacity-60">{day.date}</span>
                  </button>
                ))}
              </div>

              {/* ELD log for active day */}
              <div className="p-4">
                <ELDLog day={days[activeDay]} />
              </div>
            </div>
          )}

          {/* Empty state */}
          {!result && !loading && (
            <div className="flex-1 flex flex-col items-center justify-center py-20 text-center space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-slate-800 border border-slate-700
                              flex items-center justify-center text-3xl shadow-lg">
                🚛
              </div>
              <p className="text-slate-500 text-sm max-w-xs">
                Fill in the trip details on the left and click <strong className="text-slate-400">Plan My Trip</strong> to generate a FMCSA-compliant ELD log.
              </p>
            </div>
          )}

          {/* Loading skeleton */}
          {loading && (
            <div className="space-y-3 animate-pulse">
              <div className="h-20 rounded-xl bg-slate-800 border border-slate-700" />
              <div className="h-56 rounded-xl bg-slate-800 border border-slate-700" />
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
