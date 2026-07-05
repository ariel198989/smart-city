'use client';
// GPX parsing + track interpolation for geotagging drive-video frames

export interface GpxPoint { lat: number; lng: number; time: number | null }
export interface GeoPos { lat: number; lng: number; heading: number }

export function parseGPX(xml: string): GpxPoint[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('קובץ GPX לא תקין');
  return [...doc.querySelectorAll('trkpt, rtept, wpt')].map((pt) => {
    const t = pt.querySelector('time');
    return {
      lat: parseFloat(pt.getAttribute('lat') || ''),
      lng: parseFloat(pt.getAttribute('lon') || ''),
      time: t ? Date.parse(t.textContent || '') : null,
    };
  }).filter((p) => isFinite(p.lat) && isFinite(p.lng));
}

// position at fraction u∈[0,1] of the track
// (time-weighted when timestamps exist, index-weighted otherwise)
export function interpolate(points: GpxPoint[], u: number): GeoPos {
  if (points.length === 1) return { lat: points[0].lat, lng: points[0].lng, heading: 0 };
  const first = points[0], last = points[points.length - 1];
  const hasTime = first.time != null && last.time != null && last.time > first.time;
  if (hasTime) {
    const target = first.time! + u * (last.time! - first.time!);
    let i = points.findIndex((p) => (p.time ?? -Infinity) >= target);
    if (i <= 0) i = 1;
    const a = points[i - 1], b = points[i];
    const f = (b.time! > a.time!) ? (target - a.time!) / (b.time! - a.time!) : 0;
    return lerpPt(a, b, f);
  }
  const idxF = u * (points.length - 1);
  const i = Math.min(points.length - 2, Math.floor(idxF));
  return lerpPt(points[i], points[i + 1], idxF - i);
}

function lerpPt(a: GpxPoint, b: GpxPoint, f: number): GeoPos {
  const lat = a.lat + (b.lat - a.lat) * f;
  const lng = a.lng + (b.lng - a.lng) * f;
  const heading = Math.atan2(b.lng - a.lng, b.lat - a.lat) * 180 / Math.PI;
  return { lat, lng, heading: (heading + 360) % 360 };
}
