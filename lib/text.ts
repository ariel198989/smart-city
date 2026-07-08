// tiny Hebrew grammar fixups for class names students type themselves —
// "שתיים X" (standalone form) is wrong before a feminine plural noun,
// should be the construct form "שתי X" (e.g. "שתי אצבעות" not "שתיים אצבעות")
export function normalizeHebrewCount(label: string): string {
  return label.replace(/(^|\s)שתיים(?=\s)/g, '$1שתי');
}
