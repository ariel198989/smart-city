// 🎭 Demo hazard layer — the VISION of the live city map: urban hazards
// pinned at REAL Sderot street locations (coords sampled from OpenStreetMap
// roads), each carrying a visible info tag (what + where + characteristic +
// severity). Shown while real street data is still thin; clearly tagged
// "דמו" so nobody mistakes it for live. Pins sit ON actual roads, exactly
// where such a hazard would be photographed.
export interface DemoHazard {
  id: string;
  class_name: string;
  trait: string;              // המאפיין — human-readable detail incl. street
  severity: 'גבוהה' | 'בינונית' | 'נמוכה';
  agoMin: number;
  lat: number;                // real coordinate on a Sderot street
  lng: number;
}

// 6 well-spread incidents (was 10 — the center got too crowded, tags overlapped)
export const DEMO_HAZARDS: DemoHazard[] = [
  { id: 'dm1',  class_name: 'מעבר חציה דהוי',    trait: 'צבע מחוק ~70% · רח\' הרצל, ליד בי"ס', severity: 'גבוהה',  agoMin: 42,  lat: 31.52361, lng: 34.59474 },
  { id: 'dm3',  class_name: 'תאורה שבורה',        trait: 'עמוד כבוי · רח\' גיורא יוספטל',       severity: 'בינונית', agoMin: 180, lat: 31.52852, lng: 34.59027 },
  { id: 'dm4',  class_name: 'פסולת בשטח ציבורי',  trait: 'ערימה גדולה · רח\' שלום איפרגן',      severity: 'בינונית', agoMin: 240, lat: 31.52646, lng: 34.58903 },
  { id: 'dm6',  class_name: 'ספסל שבור',          trait: 'קרש חסר · רח\' הבנים, גינה ציבורית',  severity: 'נמוכה',  agoMin: 420, lat: 31.52063, lng: 34.59842 },
  { id: 'dm9',  class_name: 'בור מים',            trait: 'שלולית עומדת · רח\' מבצע סיני, חשש לנזילה', severity: 'גבוהה', agoMin: 720, lat: 31.52785, lng: 34.59678 },
  { id: 'dm10', class_name: 'מדרכה שקועה',        trait: 'הפרש ~5 ס"מ · רח\' יצחק שמיר',        severity: 'בינונית', agoMin: 850, lat: 31.52689, lng: 34.60053 },
];

export function fmtAgoMin(min: number): string {
  if (min < 60) return `לפני ${min} דק'`;
  const h = Math.round(min / 60);
  return h < 24 ? `לפני ${h} שע'` : `לפני יום`;
}
