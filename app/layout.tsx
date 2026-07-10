import type { Metadata, Viewport } from 'next';
import 'maplibre-gl/dist/maplibre-gl.css';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://smart-city-cyan.vercel.app'),
  title: 'Smart City — הילדים שמתקנים את העיר עם AI',
  description: 'פלטפורמה לימודית להאקתונים: ילדים מאמנים מודלי ראייה ממוחשבת לזהות מפגעים עירוניים בשדרות',
  openGraph: {
    title: 'Smart City — הילדים שמתקנים את העיר עם AI',
    description: 'צלמו מפגעים, ה-AI בודק, העיר מתקנת. קרדיטים ופרסים מהעירייה 🏙️',
    images: [{ url: '/og-image.jpg', width: 1200, height: 675 }],
    locale: 'he_IL',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Smart City — פטרול המפגעים של שדרות',
    images: ['/og-image.jpg'],
  },
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Smart City' },
  icons: {
    icon: [{ url: '/icon-192.png', sizes: '192x192' }, { url: '/icon-512.png', sizes: '512x512' }],
    apple: '/apple-touch-icon.png',
  },
};

// width+initialScale are REQUIRED — exporting a viewport object replaces
// Next's default, so without these the phone renders at ~980px.
// a11y (WCAG 1.4.4): do NOT set maximumScale/userScalable — never disable
// pinch-zoom. Inputs are ≥13px so iOS won't auto-zoom on focus.
// viewportFit:cover powers our env(safe-area-inset-*) offsets.
export const viewport: Viewport = {
  themeColor: '#020509',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700;800;900&family=Space+Grotesk:wght@500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <CityBackdrop />
        {children}
      </body>
    </html>
  );
}

function CityBackdrop() {
  return (
    <div className="city-bg" aria-hidden="true">
      <div className="grid-floor" />
      <div className="glow glow-a" />
      <div className="glow glow-b" />
      <svg className="skyline" viewBox="0 0 1000 460" preserveAspectRatio="xMidYMax meet">
        <g className="sky-line">
          <polygon points="120,360 120,250 175,235 230,250 230,360" />
          <line x1="120" y1="250" x2="230" y2="250" strokeOpacity=".25" />
          <line x1="175" y1="235" x2="175" y2="360" strokeOpacity=".18" />
          <rect x="300" y="180" width="90" height="180" />
          <line x1="300" y1="215" x2="390" y2="215" strokeOpacity=".2" />
          <line x1="300" y1="255" x2="390" y2="255" strokeOpacity=".2" />
          <line x1="300" y1="295" x2="390" y2="295" strokeOpacity=".2" />
          <line x1="345" y1="180" x2="345" y2="360" strokeOpacity=".16" />
          <polygon points="440,360 440,150 490,120 540,150 540,360" />
          <line x1="440" y1="150" x2="540" y2="150" strokeOpacity=".22" />
          <line x1="490" y1="120" x2="490" y2="360" strokeOpacity=".16" />
          <rect x="600" y="210" width="70" height="150" />
          <line x1="600" y1="250" x2="670" y2="250" strokeOpacity=".2" />
          <line x1="600" y1="300" x2="670" y2="300" strokeOpacity=".2" />
          <polygon points="710,360 710,190 760,170 810,190 810,360" />
          <line x1="710" y1="190" x2="810" y2="190" strokeOpacity=".22" />
          <rect x="860" y="240" width="60" height="120" />
          <line x1="860" y1="290" x2="920" y2="290" strokeOpacity=".2" />
          <line x1="60" y1="360" x2="960" y2="360" strokeOpacity=".4" />
        </g>
        <g className="sky-dots">
          <circle cx="120" cy="250" r="3" /><circle cx="230" cy="250" r="3" /><circle cx="175" cy="235" r="3" />
          <circle cx="300" cy="180" r="3" /><circle cx="390" cy="180" r="3" />
          <circle cx="440" cy="150" r="3" /><circle cx="540" cy="150" r="3" /><circle cx="490" cy="120" r="3.4" />
          <circle cx="600" cy="210" r="3" /><circle cx="670" cy="210" r="3" />
          <circle cx="710" cy="190" r="3" /><circle cx="810" cy="190" r="3" /><circle cx="760" cy="170" r="3" />
          <circle cx="860" cy="240" r="3" /><circle cx="920" cy="240" r="3" />
        </g>
      </svg>
    </div>
  );
}
