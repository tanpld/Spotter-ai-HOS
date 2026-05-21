import { render, screen } from '@testing-library/react';
import ELDLog from './ELDLog';

// ---------------------------------------------------------------------------
// Mock payloads
// ---------------------------------------------------------------------------

/** Standard day: totals exactly 24 h */
const DAY_24H = {
  date: '2026-05-22',
  log_entries: [
    { status: 'OFF_DUTY',      start_time: '00:00', end_time: '08:00', duration: 8 },
    { status: 'DRIVING',       start_time: '08:00', end_time: '19:00', duration: 11 },
    { status: 'ON_DUTY',       start_time: '19:00', end_time: '21:00', duration: 2 },
    { status: 'SLEEPER_BERTH', start_time: '21:00', end_time: '24:00', duration: 3 },
  ],
};

/** Day with all 4 statuses at non-trivial hours */
const DAY_ALL_STATUSES = {
  date: '2026-05-23',
  log_entries: [
    { status: 'SLEEPER_BERTH', start_time: '00:00', end_time: '10:00', duration: 10 },
    { status: 'ON_DUTY',       start_time: '10:00', end_time: '11:00', duration: 1 },
    { status: 'DRIVING',       start_time: '11:00', end_time: '22:00', duration: 11 },
    { status: 'OFF_DUTY',      start_time: '22:00', end_time: '24:00', duration: 2 },
  ],
};

/** Broken day: only 20 h → should show integrity warning */
const DAY_20H = {
  date: '2026-05-24',
  log_entries: [
    { status: 'OFF_DUTY', start_time: '00:00', end_time: '08:00', duration: 8 },
    { status: 'DRIVING',  start_time: '08:00', end_time: '20:00', duration: 12 },
    // missing 4 h — total = 20, not 24
  ],
};

/** Edge: all 24 h as a single OFF_DUTY (rest day) */
const DAY_FULL_REST = {
  date: '2026-05-25',
  log_entries: [
    { status: 'OFF_DUTY', start_time: '00:00', end_time: '24:00', duration: 24 },
  ],
};

// ---------------------------------------------------------------------------
// Test Suite 1: Basic rendering
// ---------------------------------------------------------------------------

describe('ELDLog — basic rendering', () => {
  test('renders without crashing', () => {
    render(<ELDLog day={DAY_24H} />);
  });

  test('displays the date', () => {
    render(<ELDLog day={DAY_24H} />);
    expect(screen.getByText(/2026-05-22/)).toBeInTheDocument();
  });

  test('renders all 4 HOS status rows', () => {
    render(<ELDLog day={DAY_24H} />);
    // Each label appears in both the row header and the footer recap — use getAllByText
    expect(screen.getAllByText(/Off Duty/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Sleeper Berth/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Driving/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/On Duty/i).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Test Suite 2: Hour totals per status row
// ---------------------------------------------------------------------------

describe('ELDLog — per-status hour totals (DAY_24H)', () => {
  beforeEach(() => render(<ELDLog day={DAY_24H} />));

  test('shows correct OFF_DUTY total: 8 h', () => {
    expect(screen.getByTestId('total-OFF_DUTY')).toHaveTextContent('8');
  });

  test('shows correct DRIVING total: 11 h', () => {
    expect(screen.getByTestId('total-DRIVING')).toHaveTextContent('11');
  });

  test('shows correct ON_DUTY total: 2 h', () => {
    expect(screen.getByTestId('total-ON_DUTY')).toHaveTextContent('2');
  });

  test('shows correct SLEEPER_BERTH total: 3 h', () => {
    expect(screen.getByTestId('total-SLEEPER_BERTH')).toHaveTextContent('3');
  });
});

describe('ELDLog — per-status hour totals (DAY_ALL_STATUSES)', () => {
  beforeEach(() => render(<ELDLog day={DAY_ALL_STATUSES} />));

  test('SLEEPER_BERTH total: 10 h', () => {
    expect(screen.getByTestId('total-SLEEPER_BERTH')).toHaveTextContent('10');
  });

  test('ON_DUTY total: 1 h', () => {
    expect(screen.getByTestId('total-ON_DUTY')).toHaveTextContent('1');
  });

  test('DRIVING total: 11 h', () => {
    expect(screen.getByTestId('total-DRIVING')).toHaveTextContent('11');
  });

  test('OFF_DUTY total: 2 h', () => {
    expect(screen.getByTestId('total-OFF_DUTY')).toHaveTextContent('2');
  });
});

// ---------------------------------------------------------------------------
// Test Suite 3: 24-hour integrity warning
// ---------------------------------------------------------------------------

describe('ELDLog — 24-hour integrity warning', () => {
  test('shows NO warning when day totals exactly 24 h', () => {
    render(<ELDLog day={DAY_24H} />);
    expect(screen.queryByTestId('integrity-warning')).not.toBeInTheDocument();
  });

  test('shows warning when day totals less than 24 h (20 h)', () => {
    render(<ELDLog day={DAY_20H} />);
    const warning = screen.getByTestId('integrity-warning');
    expect(warning).toBeInTheDocument();
    expect(warning).toHaveTextContent(/20/);
  });

  test('warning message mentions expected 24 h', () => {
    render(<ELDLog day={DAY_20H} />);
    expect(screen.getByTestId('integrity-warning')).toHaveTextContent(/24/);
  });

  test('no warning for full-rest day (24 h OFF_DUTY)', () => {
    render(<ELDLog day={DAY_FULL_REST} />);
    expect(screen.queryByTestId('integrity-warning')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Test Suite 4: Zero-hours for absent statuses
// ---------------------------------------------------------------------------

describe('ELDLog — zero totals for absent statuses', () => {
  test('SLEEPER_BERTH total is 0 when not present in day', () => {
    const dayNoSleeper = {
      date: '2026-05-26',
      log_entries: [
        { status: 'OFF_DUTY', start_time: '00:00', end_time: '13:00', duration: 13 },
        { status: 'DRIVING',  start_time: '13:00', end_time: '24:00', duration: 11 },
      ],
    };
    render(<ELDLog day={dayNoSleeper} />);
    expect(screen.getByTestId('total-SLEEPER_BERTH')).toHaveTextContent('0');
  });
});
