// hazard lifecycle: detection → treatment → field verification → closure
export const STATUS_META: Record<string, { label: string; pill: string }> = {
  pending: { label: '⏳ ממתין לאישור', pill: 'st-pending' },
  approved: { label: '🔧 בטיפול', pill: 'st-approved' },
  awaiting_verify: { label: '🔍 ממתין לאימות שטח', pill: 'st-awaiting' },
  verifying: { label: '🤖 באימות — ממתין למהנדס', pill: 'st-verifying' },
  resolved: { label: '🟢 טופל ואומת', pill: 'st-resolved' },
  rejected: { label: '❌ נדחה', pill: 'st-rejected' },
};

// statuses that still show as pins on the map (open events)
export const OPEN_STATUSES = ['pending', 'approved', 'awaiting_verify', 'verifying'];
