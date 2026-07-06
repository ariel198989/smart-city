'use client';
// live cross-device sync: any detection change anywhere → every open
// screen (phone patrol, desktop map, board) refreshes shortly after.
// SCALE NOTE: every bumpData() triggers a full refetch on every open
// client — with thousands of concurrent users a short throttle becomes
// a thundering herd on the DB. 4s batches bursts of inserts into one
// refetch, and hidden tabs defer until they're visible again.
import { sb } from './db';
import { bumpData } from './store';

const THROTTLE_MS = 4000;
let subscribed = false;
let throttle: ReturnType<typeof setTimeout> | null = null;
let pendingWhileHidden = false;

export function subscribeDetections() {
  if (subscribed) return;
  subscribed = true;

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && pendingWhileHidden) {
      pendingWhileHidden = false;
      bumpData();
    }
  });

  sb.channel('sc-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sc_detections' }, () => {
      if (document.hidden) { pendingWhileHidden = true; return; }
      if (throttle) return;
      throttle = setTimeout(() => { throttle = null; bumpData(); }, THROTTLE_MS);
    })
    .subscribe();
}
