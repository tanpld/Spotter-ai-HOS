import { useState } from 'react';
import Sidebar from './components/Sidebar';
import ELDLog from './components/ELDLog';
import HOSMap from './components/HOSMap';
import './index.css';
import { TripForm, TripResult } from './types';

const INITIAL_FORM: TripForm = {
  current_location:   '',
  pickup_location:    '',
  dropoff_location:   '',
  current_cycle_used: 0,
};

export default function App() {
  const [form,    setForm]    = useState<TripForm>(INITIAL_FORM);
  const [result,  setResult]  = useState<TripResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [activeDay, setActiveDay] = useState(0);

  function handleChange(field: keyof TripForm, value: string | number) {
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
      const data = await res.json() as TripResult;
      setResult(data);
    } catch (err) {
      setError((err as Error).message);
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

          {/* 34-hour restart — amber, highly visible */}
          {restart && (
            <div className="rounded-xl border border-amber-500 bg-amber-950/70 px-5 py-4
                            flex items-start gap-4
                            shadow-lg shadow-amber-900/40
                            ring-1 ring-amber-400/20">
              <div className="shrink-0 w-10 h-10 rounded-xl
                              bg-amber-400/20 border border-amber-500/50
                              flex items-center justify-center text-xl mt-0.5">
                ⚠️
              </div>
              <div>
                <p className="font-extrabold text-amber-200 text-sm tracking-wide uppercase">
                  34-Hour Restart Required
                </p>
                <p className="text-xs text-amber-400/90 mt-1 leading-relaxed">
                  Cycle hours exceeded{' '}
                  <span className="font-bold text-amber-300">70 h</span>.{' '}
                  Driver must complete a mandatory{' '}
                  <span className="font-bold text-amber-300">34-hour</span>{' '}
                  off-duty restart before resuming operations.
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
            <div className="flex-1 flex flex-col items-center justify-center py-24 text-center">
              <div className="relative mb-6">
                <div className="w-20 h-20 rounded-2xl bg-slate-800/80 border border-slate-700
                                flex items-center justify-center text-4xl shadow-xl">
                  📋
                </div>
                <div className="absolute -bottom-1.5 -right-1.5 w-8 h-8 rounded-xl
                                bg-indigo-600 border-2 border-slate-900
                                flex items-center justify-center text-base shadow-lg">
                  🚛
                </div>
              </div>
              <h3 className="text-slate-300 font-bold text-base mb-2">No log generated yet</h3>
              <p className="text-slate-500 text-sm max-w-[260px] leading-relaxed">
                Enter trip details to generate{' '}
                <span className="text-slate-400 font-medium">FMCSA compliant</span>{' '}
                ELD logs and route map
              </p>
              <div className="mt-6 flex items-center gap-2 text-[11px] text-slate-700">
                <span className="w-1 h-1 rounded-full bg-slate-700" />
                <span>HOS Rules Enforced Automatically</span>
                <span className="w-1 h-1 rounded-full bg-slate-700" />
              </div>
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
