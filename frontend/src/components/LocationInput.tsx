import { useState, useEffect, useRef, useCallback } from 'react';

interface Suggestion {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

interface LocationInputProps {
  id: string;
  value: string;
  placeholder: string;
  /** Called on every keystroke (no coords = user typed manually) */
  onChange: (value: string, coords?: [number, number]) => void;
}

export default function LocationInput({ id, value, placeholder, onChange }: LocationInputProps) {
  const [query, setQuery]             = useState(value);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen]               = useState(false);
  const [activeIdx, setActiveIdx]     = useState(-1);
  const [loading, setLoading]         = useState(false);
  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setQuery(value); }, [value]);

  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.trim().length < 3) { setSuggestions([]); setOpen(false); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ q, format: 'json', limit: '5', addressdetails: '0', countrycodes: 'us' });
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
        headers: { 'Accept-Language': 'en' },
      });
      const data: Suggestion[] = await res.json();
      setSuggestions(data);
      setOpen(data.length > 0);
      setActiveIdx(-1);
    } catch {
      setSuggestions([]);
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }, []);

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setQuery(val);
    onChange(val); // no coords — user is typing manually
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(val), 350);
  }

  function select(s: Suggestion) {
    setQuery(s.display_name);
    onChange(s.display_name, [parseFloat(s.lat), parseFloat(s.lon)]);
    setSuggestions([]);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      select(suggestions[activeIdx]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <span className="absolute inset-y-0 left-3 flex items-center text-slate-500 pointer-events-none">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </span>

      {loading && (
        <span className="absolute inset-y-0 right-3 flex items-center pointer-events-none">
          <svg className="animate-spin h-3.5 w-3.5 text-slate-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
        </span>
      )}

      <input
        id={id}
        type="text"
        autoComplete="off"
        value={query}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        placeholder={placeholder}
        required
        className="w-full rounded-lg border border-slate-600 bg-slate-900 pl-8 pr-8 py-2.5
                   text-sm text-slate-100 placeholder-slate-600
                   focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                   transition"
      />

      {open && (
        <ul
          role="listbox"
          className="absolute z-50 mt-1 w-full rounded-lg border border-slate-700
                     bg-slate-900 shadow-2xl shadow-black/60 overflow-hidden"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.place_id}
              role="option"
              aria-selected={i === activeIdx}
              onMouseDown={() => select(s)}
              onMouseEnter={() => setActiveIdx(i)}
              className={`px-3 py-2.5 text-xs cursor-pointer leading-tight transition-colors
                          ${i === activeIdx
                            ? 'bg-indigo-600/30 text-indigo-200'
                            : 'text-slate-300 hover:bg-slate-800'}`}
            >
              <span className="mr-1.5 text-slate-500">📍</span>
              {s.display_name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
