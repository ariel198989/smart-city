# DESIGN.md — Smart City "Command Center"

מקור אמת: `app/globals.css` (נוצר ב-Claude Design מרפרנס Smart Zone, פורט לקוד).

## Color (dark-only — חמ"ל לילי; המפה, הרחוב והלוויין כהים מטבעם)
- Space: `--bg-0 #020509 → --bg-1 #061020 → --bg-2 #0A1424` (gradient 155deg, fixed)
- Panels: `rgba(6,16,28,.72)` + blur; קו `rgba(53,225,255,.35)`
- Cyan `#35E1FF` = מערכת, דאטה, כיסוי, אישור. Gold `#FFB627` = מפגעים, משימות, פרסים, focus zones
- Ink `#eafbff`, body `#bfe3f0`, muted `rgba(191,227,240,.55)`
- Danger `#FF6B6B`, resolved-green `#7CFFCB` (נדיר, רק לסגירות)

## Signature elements (אל תשבור)
- **HUD corner ticks**: 4 פינות בכל פאנל (`.hud::after`, 8 גרדיאנטים)
- **Framed hero numbers**: מספר Space Grotesk במסגרת זוהרת ("453.7 亩" treatment)
- **Gold diagonal hatch**: `repeating-linear-gradient(45deg …)` = אזור תפוס/מוקד
- **Bracket ornaments**: 〈 כותרת 〉 letterspaced
- **Scan lines / pulse rings**: AI עובד / ישות חיה
- radius 0 בכל מקום (חדות = שפה); pills רק ל-status
- particle field נודד + wireframe skyline ברקע

## Typography
- Rubik 400-900 (עברית UI), Space Grotesk 500/700 (מספרים, LIVE, לוגו)
- תוויות: 10-12px + letter-spacing .14-.34em; מספרי hero: 34-44px/700

## Motion
- `sc-drift` (חלקיקים 18s), `sc-ring` (pulse נעצים), `sc-scan` (סריקות), `sc-dot` (blink), `pt-pop` (תוצאות, cubic-bezier(.2,1.4,.4,1))
- כל אנימציה = מידע. אין bounce/elastic

## Surfaces
- דסקטופ: topbar + ml-ribbon (7 שלבי ML) + views (map/tour/studio/board/factory)
- מובייל: `.mgame` — header מיני + פטרול 100dvh בלבד (מצלמה כברירת מחדל)
- מפות: MapLibre, CARTO dark + brightness(1.55); Esri satellite toggle

## Known debt (מועמדים ל-overdrive)
- רקע סטטי יחסית בדסקטופ; אין depth למפה הראשית
- מעברי views הם fade בסיסי (vin .3s)
- אין prefers-reduced-motion handling
