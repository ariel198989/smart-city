'use client';
// device compass — which way is the camera facing (0=N, 90=E, 180=S, 270=W)

let heading: number | null = null;
let started = false;

function onOrient(e: DeviceOrientationEvent) {
  const wk = (e as any).webkitCompassHeading;           // iOS: true compass
  if (wk != null && isFinite(wk)) { heading = wk; return; }
  if (e.alpha != null && isFinite(e.alpha)) heading = (360 - e.alpha) % 360;
}

export function startCompass() {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('deviceorientationabsolute' as any, onOrient as any, true);
  window.addEventListener('deviceorientation', onOrient as any, true);
}

// iOS 13+ needs an explicit permission request from a user gesture
export async function requestCompassPermission() {
  const D: any = (window as any).DeviceOrientationEvent;
  if (D?.requestPermission) {
    try { await D.requestPermission(); } catch { /* denied — heading stays null */ }
  }
  startCompass();
}

export const getHeading = (): number | null => heading;

// ---- angle sectors (8 × 45°) ----
export const SECTOR_NAMES = ['צפון', 'צפון-מזרח', 'מזרח', 'דרום-מזרח', 'דרום', 'דרום-מערב', 'מערב', 'צפון-מערב'];
export const sectorOf = (h: number) => Math.round(((h % 360) + 360) % 360 / 45) % 8;
