export type HosStatus = "OFF_DUTY" | "SLEEPER_BERTH" | "DRIVING" | "ON_DUTY";

export interface LogEntry {
  status: HosStatus;
  start_time: string;
  end_time: string;
  duration: number;
  reason?: string;
}

export interface Day {
  date: string;
  log_entries: LogEntry[];
}

export interface TripSummary {
  total_distance_miles: number;
  total_driving_hours: number;
  estimated_cycle_after_trip: number;
  pickup_duration_hours: number;
  dropoff_duration_hours: number;
  current_cycle_used: number;
}

export interface MapStop {
  position?: [number, number];
  progress?: number;
  type: "rest" | "fuel";
  label?: string;
}

export interface MapData {
  start: [number, number];
  pickup: [number, number];
  dropoff: [number, number];
  stops: MapStop[];
}

export interface TripResult {
  days: Day[];
  trip_summary: TripSummary;
  "34_hour_restart_required": boolean;
  map_data: MapData;
}

export interface TripForm {
  current_location: string;
  pickup_location: string;
  dropoff_location: string;
  current_cycle_used: number;
}
