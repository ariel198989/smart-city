// Shared DB row types — the Supabase boundary is where silent runtime
// bugs are born (strict:false); typing it kills most of them.

export interface Detection {
  id: string;
  class_name: string;
  confidence: number;
  lat: number;
  lng: number;
  status: 'pending' | 'approved' | 'rejected' | 'awaiting_verify' | 'verifying' | 'resolved';
  crop_path: string | null;
  frame_path: string | null;
  bbox: { x: number; y: number; w: number; h: number } | null;
  detected_by: string | null;
  team_name: string | null;
  credits: number;
  heading: number | null;
  created_at: string;
  verify_photo_path: string | null;
  verify_ai_passed: boolean | null;
  verify_ai_conf: number | null;
  verified_by: string | null;
  resolved_at: string | null;
}

export interface CityModel {
  id: string;
  owner: string;
  team_name: string;
  name: string;
  classes: string[];
  zip_path: string;
  approved: boolean;
  created_at: string;
}

export interface City {
  id: string;
  name: string;
  center_lat: number;
  center_lng: number;
  created_at: string;
}

export interface RouteRow {
  id: string;
  city_id: string;
  name: string;
  created_at: string;
}

export interface FrameRow {
  id: string;
  route_id: string;
  seq: number;
  lat: number;
  lng: number;
  storage_path: string;
  created_at: string;
}

export interface FeedbackRow {
  id: string;
  kind: 'dispute' | 'negative';
  class_name: string;
  frame_path: string;
  status: 'pending' | 'accepted' | 'rejected';
  submitted_by: string;
  team_name: string | null;
  created_at: string;
}
