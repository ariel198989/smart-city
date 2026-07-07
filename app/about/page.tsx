import type { Metadata } from 'next';
import './landing.css';

// Marketing landing — the municipality/school pitch page.
// The app itself lives at "/"; this page sells the idea.
// Design per the taste-pack: AIDA structure, cinematic chapters with
// massive vertical spacing, wide 2-line hero, gapless bento, CSS-only
// scroll motion (view-timeline with static fallback), zero emojis.

export const metadata: Metadata = {
  title: 'Smart City — הילדים שמלמדים את העיר לראות',
  description: 'פלטפורמה עירונית שבה תושבים צעירים מצלמים מפגעים, AI מאמת בזמן אמת, והעיר מקבלת מפה חיה ומודל שמשתפר מכל תמונה.',
};

const Arrow = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M19 12H5m6-6-6 6 6 6" />
  </svg>
);

export default function AboutPage() {
  return (
    <main className="ld" dir="rtl">
      {/* nav — minimal split, floating */}
      <nav className="ld-nav">
        <span className="ld-logo">SMART&nbsp;CITY<i /></span>
        <a className="ld-nav-cta" href="/">פתחו את האפליקציה <Arrow /></a>
      </nav>

      {/* ATTENTION — cinematic center hero, full-bleed art, radial wash */}
      <header className="ld-hero">
        <div className="ld-hero-bg" />
        <h1>הילדים שמלמדים את העיר לראות</h1>
        <p className="ld-hero-sub">
          תושבים צעירים מצלמים מפגעים ברחוב. בינה מלאכותית מאמתת בזמן אמת.
          העירייה מקבלת מפה חיה — והמודל משתפר מכל תמונה.
        </p>
        <div className="ld-hero-ctas">
          <a className="ld-btn gold" href="/">נסו את המשחק</a>
          <a className="ld-btn line" href="#city">אני מהעירייה</a>
        </div>
      </header>

      {/* INTEREST — gapless bento: how it works, four interlocking cells */}
      <section className="ld-sec">
        <h2 className="ld-h2">
          מצלמים <span className="ld-inline-img" style={{ backgroundImage: 'url(/art/drone-scan.jpg)' }} aria-hidden />
          ומהתמונה נולד מודל
        </h2>
        <div className="ld-bento">
          <article className="ld-cell big" style={{ backgroundImage: 'url(/art/drone-scan.jpg)' }}>
            <div className="ld-cell-txt">
              <b>שער AI בזמן אמת</b>
              <p>המודל רץ על הטלפון עצמו ושופט כל תמונה במקום — צילום לא רלוונטי נחסם בעדינות, תפיסה אמיתית מתוגמלת מיד.</p>
            </div>
          </article>
          <article className="ld-cell" style={{ backgroundImage: 'url(/art/hazard-resolved.jpg)' }}>
            <div className="ld-cell-txt">
              <b>פין שגם יורד מהמפה</b>
              <p>מפגע מדווח, מטופל, מאומת בשטח בצילום חוזר — ורק אז נסגר.</p>
            </div>
          </article>
          <article className="ld-cell" style={{ backgroundImage: 'url(/art/training-core.jpg)' }}>
            <div className="ld-cell-txt">
              <b>כל תמונה מאמנת</b>
              <p>תפיסות מאומתות הופכות אוטומטית לדאטת אימון — המודל הבא חכם יותר.</p>
            </div>
          </article>
          <article className="ld-cell" style={{ backgroundImage: 'url(/art/podium.jpg)' }}>
            <div className="ld-cell-txt">
              <b>תחרות חודשית אמיתית</b>
              <p>קרדיטים, דרגות סוכן ופרסים מהעירייה — כלכלה שמחושבת בצד השרת.</p>
            </div>
          </article>
        </div>
      </section>

      {/* marquee — the hazard classes, continuously scrolling */}
      <div className="ld-marquee" aria-hidden>
        <div className="ld-marquee-track">
          {Array.from({ length: 2 }, (_, k) => (
            <span key={k}>
              מעברי חציה · בורות בכביש · תמרורים · פסולת · תאורה שבורה · מדרכות · הצפות · גרפיטי ·&nbsp;
            </span>
          ))}
        </div>
      </div>

      {/* DESIRE — the flywheel, sticky chapter with scroll-reveal steps */}
      <section className="ld-sec ld-fly">
        <div className="ld-fly-pin">
          <h2 className="ld-h2">גלגל התנופה העירוני</h2>
          <p className="ld-lead">ככל שמשחקים יותר — העיר גם מתוקנת יותר, וגם רואה טוב יותר.</p>
        </div>
        <ol className="ld-fly-steps">
          <li><b>01</b><span>ילד מצלם מעבר חציה דהוי בדרך מבית הספר</span></li>
          <li><b>02</b><span>המודל שעל הטלפון מאשר: זה אמיתי. פין עולה למפת העיר</span></li>
          <li><b>03</b><span>מוקד העירייה רואה, מתעדף, שולח צוות — הילד מאמת שתוקן</span></li>
          <li><b>04</b><span>התמונה מצטרפת למאגר האימון המשותף של כל התושבים</span></li>
          <li><b>05</b><span>מודל חדש מתאמן בענן וחוזר לכל טלפון — חד יותר מאתמול</span></li>
        </ol>
      </section>

      {/* numbers strip — engineered digits */}
      <section className="ld-nums">
        <div><b>30<i>שנ׳</i></b><span>אימון מודל אישי ראשון על הטלפון</span></div>
        <div><b>90<i>שנ׳</i></b><span>סדרת 60 תמונות אימון סביב מפגע</span></div>
        <div><b>8</b><span>זוויות צילום שהמערכת דורשת למפגע</span></div>
        <div><b>0<i>₪</i></b><span>חומרה נוספת — רק הטלפונים שכבר בכיס</span></div>
      </section>

      {/* ACTION — municipality CTA */}
      <section className="ld-sec ld-city" id="city">
        <h2 className="ld-h2">לעירייה: מוקד 106 שמזין את עצמו</h2>
        <div className="ld-city-grid">
          <ul className="ld-city-list">
            <li>מפה חיה של מפגעים פתוחים, בטיפול וסגורים — מסונכרנת מכל טלפון בזמן אמת</li>
            <li>מעגל סגירה מלא: דיווח, טיפול, אימות שטח בצילום חוזר וחתימת מהנדס</li>
            <li>דוח CSV חודשי מוכן להנהלה, לידרבורד קהילתי ופרסים ממותגים</li>
            <li>תכנית חינוכית מובנית: הכיתה מאמנת מודל אמיתי מקצה לקצה</li>
          </ul>
          <div className="ld-city-cta">
            <p>פיילוט עירוני עולה פחות מעמוד תאורה אחד.</p>
            <a className="ld-btn gold" href="mailto:ariel@ao-fin.co.il?subject=Smart City — פיילוט עירוני">דברו איתנו</a>
            <a className="ld-btn line" href="/">או פשוט נסו את המשחק</a>
          </div>
        </div>
      </section>

      <footer className="ld-foot">
        <span className="ld-logo">SMART&nbsp;CITY<i /></span>
        <span>נבנה בשדרות · הדור הבא של עיניים עירוניות</span>
      </footer>
    </main>
  );
}
