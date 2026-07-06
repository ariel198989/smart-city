'use client';
// live cross-device sync: any detection change anywhere → every open
// screen (phone patrol, desktop map, board) refreshes within a second
import { sb } from './db';
import { bumpData } from './store';

let subscribed = false;
let throttle: ReturnType<typeof setTimeout> | null = null;

export function subscribeDetections() {
  if (subscribed) return;
  subscribed = true;
  sb.channel('sc-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sc_detections' }, () => {
      if (throttle) return;
      throttle = setTimeout(() => { throttle = null; bumpData(); }, 600);
    })
    .subscribe();
}
