// 🎭 Demo hazard layer — the VISION of the live city map: real-looking
// urban hazards spread across Sderot streets, each pin carrying a visible
// info tag (what + characteristic + severity). Shown while real street
// data is still thin; clearly tagged "דמו" so nobody mistakes it for live.
export interface DemoHazard {
  id: string;
  class_name: string;
  trait: string;              // המאפיין — the human-readable detail
  severity: 'גבוהה' | 'בינונית' | 'נמוכה';
  agoMin: number;             // "reported X minutes ago"
  dlat: number;               // offset from city center
  dlng: number;
}

export const DEMO_HAZARDS: DemoHazard[] = [
  { id: 'dm1', class_name: 'מעבר חציה דהוי', trait: 'צבע מחוק ~70% · ליד בי"ס', severity: 'גבוהה',  agoMin: 42,  dlat:  0.0028, dlng: -0.0031 },
  { id: 'dm2', class_name: 'בור בכביש',      trait: 'עומק ~12 ס"מ · נתיב ימני', severity: 'גבוהה',  agoMin: 95,  dlat: -0.0021, dlng:  0.0038 },
  { id: 'dm3', class_name: 'תאורה שבורה',    trait: 'עמוד כבוי · חניון ציבורי', severity: 'בינונית', agoMin: 180, dlat:  0.0044, dlng:  0.0022 },
  { id: 'dm4', class_name: 'פסולת בשטח ציבורי', trait: 'ערימה גדולה · פינת רחוב', severity: 'בינונית', agoMin: 240, dlat: -0.0038, dlng: -0.0026 },
  { id: 'dm5', class_name: 'תמרור פגום',     trait: 'עצור מעוקם · צומת', severity: 'גבוהה',  agoMin: 310, dlat:  0.0012, dlng:  0.0051 },
  { id: 'dm6', class_name: 'ספסל שבור',      trait: 'קרש חסר · גינה ציבורית', severity: 'נמוכה',  agoMin: 420, dlat: -0.0047, dlng:  0.0014 },
  { id: 'dm7', class_name: 'גרפיטי',         trait: 'קיר מבנה ציבור · ~4 מ"ר', severity: 'נמוכה',  agoMin: 510, dlat:  0.0035, dlng: -0.0048 },
  { id: 'dm8', class_name: 'מעבר חציה דהוי', trait: 'צבע מחוק ~40% · ליד קופ"ח', severity: 'בינונית', agoMin: 600, dlat: -0.0009, dlng: -0.0055 },
  { id: 'dm9', class_name: 'בור מים',        trait: 'שלולית עומדת · חשש לנזילת צנרת', severity: 'גבוהה', agoMin: 720, dlat: -0.0052, dlng: -0.0007 },
  { id: 'dm10', class_name: 'מדרכה שקועה',   trait: 'הפרש ~5 ס"מ · נגישות', severity: 'בינונית', agoMin: 850, dlat:  0.0056, dlng: -0.0012 },
];

export function fmtAgoMin(min: number): string {
  if (min < 60) return `לפני ${min} דק'`;
  const h = Math.round(min / 60);
  return h < 24 ? `לפני ${h} שע'` : `לפני יום`;
}
