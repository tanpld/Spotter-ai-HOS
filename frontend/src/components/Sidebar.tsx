import { TripForm } from "../types";
import LocationInput from "./LocationInput";

interface SidebarProps {
  values: TripForm;
  onChange: (
    field: keyof TripForm,
    value: string | number,
    coords?: [number, number],
  ) => void;
  onSubmit: () => void;
  loading: boolean;
}

const FIELDS: Array<{
  id: keyof TripForm;
  label: string;
  placeholder: string;
}> = [
  {
    id: "current_location",
    label: "Current Location",
    placeholder: "e.g. New York, NY",
  },
  {
    id: "pickup_location",
    label: "Pickup Location",
    placeholder: "e.g. Chicago, IL",
  },
  {
    id: "dropoff_location",
    label: "Dropoff Location",
    placeholder: "e.g. Los Angeles, CA",
  },
];

function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4 text-white"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
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
  );
}

export default function Sidebar({
  values,
  onChange,
  onSubmit,
  loading,
}: SidebarProps) {
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmit();
  }

  return (
    <aside className="flex flex-col gap-6">
      {/* Card */}
      <div className="rounded-2xl border border-slate-700 bg-slate-800/60 backdrop-blur p-6 shadow-xl">
        <h2 className="text-sm font-bold text-slate-300 uppercase tracking-widest mb-5">
          Trip Planner
        </h2>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {FIELDS.map(({ id, label, placeholder }) => (
            <div key={id} className="flex flex-col gap-1.5">
              <label
                htmlFor={id}
                className="text-xs font-semibold text-slate-400 uppercase tracking-wide"
              >
                {label}
              </label>
              <LocationInput
                id={id}
                value={(values[id] as string) ?? ""}
                placeholder={placeholder}
                onChange={(val, coords) => onChange(id, val, coords)}
              />
            </div>
          ))}

          {/* Cycle Used */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="current_cycle_used"
              className="text-xs font-semibold text-slate-400 uppercase tracking-wide"
            >
              Current Cycle Used
              <span className="ml-1 normal-case text-slate-500">(hrs)</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                id="current_cycle_used"
                type="number"
                min="0"
                max="70"
                step="0.5"
                value={values.current_cycle_used ?? ""}
                onChange={(e) =>
                  onChange(
                    "current_cycle_used",
                    parseFloat(e.target.value) || 0,
                  )
                }
                placeholder="0"
                required
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2.5
                           text-sm text-slate-100 placeholder-slate-600
                           focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                           transition"
              />
              <div className="shrink-0 w-20">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[10px] text-slate-500">0</span>
                  <span className="text-[10px] text-slate-500">70</span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-700 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-red-500 transition-all"
                    style={{
                      width: `${Math.min(((values.current_cycle_used ?? 0) / 70) * 100, 100)}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="mt-2 flex items-center justify-center gap-2 rounded-xl
                       bg-gradient-to-r from-indigo-600 to-violet-600
                       hover:from-indigo-500 hover:to-violet-500
                       disabled:opacity-60 disabled:cursor-not-allowed
                       px-4 py-3 text-sm font-bold text-white
                       shadow-lg shadow-indigo-900/40
                       transition-all active:scale-[0.98]"
          >
            {loading ? (
              <>
                <Spinner />
                Calculating…
              </>
            ) : (
              <>
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
                  />
                </svg>
                Plan My Trip
              </>
            )}
          </button>
        </form>
      </div>
    </aside>
  );
}
