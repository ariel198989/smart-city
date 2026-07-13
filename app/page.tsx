'use client';
import { useEffect, useState } from 'react';
import { initAuth, authStore } from '@/lib/auth';
import { useStore } from '@/lib/store';
import Toast from '@/components/Toast';
import AuthOverlay from '@/components/AuthOverlay';
import TopBar, { type ViewName } from '@/components/TopBar';
import Ribbon from '@/components/Ribbon';
import MapView from '@/components/MapView';
import TourView, { type TourTarget } from '@/components/TourView';
import StudioView from '@/components/StudioView';
import BoardView from '@/components/BoardView';
import FactoryView from '@/components/FactoryView';
import VerifyModal from '@/components/VerifyModal';
import PatrolView from '@/components/PatrolView';
import { subscribeDetections } from '@/lib/realtime';

// which ML-pipeline steps light up per view (pedagogy ribbon)
const RIBBON: Record<ViewName, number[]> = {
  map: [7], patrol: [1, 6, 7], tour: [6, 7], studio: [1, 2, 3, 4, 5], board: [7], factory: [1, 2],
};

export default function Home() {
  const [view, setView] = useState<ViewName>('map');
  const [tourTarget, setTourTarget] = useState<TourTarget | null>(null);
  const [isMobile, setIsMobile] = useState<boolean | null>(null);
  const [installEvt, setInstallEvt] = useState<any>(null);
  const auth = useStore(authStore);

  useEffect(() => {
    initAuth();
    subscribeDetections();   // 🔄 phone catch → desktop map, live
    // installable PWA — production only. In dev the SW intercepts
    // Next's /_next/ chunks and breaks dynamic import() (ERR_FAILED),
    // so on localhost we actively UNREGISTER any stale worker instead.
    if ('serviceWorker' in navigator) {
      if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
        navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
      } else {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
      }
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e);
      (window as any).__scInstall = e;   // the drawer's install button reads this
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    // phone = game-only experience (Pokémon-style patrol, no dashboard)
    const mq = window.matchMedia('(max-width: 767px)');
    setIsMobile(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => {
      mq.removeEventListener('change', onChange);
      window.removeEventListener('beforeinstallprompt', onPrompt);
    };
  }, []);

  const openStreetView = (lat: number, lng: number) => {
    setTourTarget({ kind: 'street', lat, lng, at: Date.now() });
    setView('tour');
  };
  const openTourFrame = (frame: { route_id?: string; id?: string }) => {
    if (!frame.route_id) return;
    setTourTarget({ kind: 'route', routeId: frame.route_id, frameId: frame.id, at: Date.now() });
    setView('tour');
  };

  if (isMobile === null) return null;

  // 📱 phone: the game IS the app — login → mission briefing → walk & shoot
  if (isMobile) {
    return (
      <>
        <Toast />
        <VerifyModal />
        {auth.loaded && <AuthOverlay />}
        <div className="mgame">
          <header className="mg-top">
            <img src="/logo-lockup.png" alt="SMART CITY" style={{ height: 26, width: 'auto', display: 'block', filter: 'drop-shadow(0 1px 6px rgba(2,5,9,.6))' }} />
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {installEvt && (
                <button className="hot" style={{ fontSize: 11, padding: '6px 10px' }}
                  onClick={async () => { installEvt.prompt(); await installEvt.userChoice; setInstallEvt(null); }}>
                  📲 התקן
                </button>
              )}
              {auth.user
                ? <span className="pill">🕵️ {auth.team || 'סוכן'}</span>
                : <button className="ghost" style={{ fontSize: 12 }} onClick={() => authStore.set({ viewer: false })}>כניסה</button>}
            </span>
          </header>
          <PatrolView defaultCam />
        </div>
      </>
    );
  }

  return (
    <>
      <Toast />
      <VerifyModal />
      {auth.loaded && <AuthOverlay />}
      <div className="wrap">
        <TopBar view={view} onView={setView} />
        <Ribbon hot={RIBBON[view]} />
        <div style={{ display: view === 'map' ? '' : 'none' }}>
          <MapView active={view === 'map'} onStreetView={openStreetView} onTourFrame={openTourFrame} />
        </div>
        {view === 'patrol' && <PatrolView />}
        {view === 'tour' && <TourView target={tourTarget} />}
        <div style={{ display: view === 'studio' ? '' : 'none' }}>
          <StudioView />
        </div>
        {view === 'board' && <BoardView />}
        {view === 'factory' && <FactoryView />}
        <footer className="foot">SMART CITY · שדרות · הילדים מאמנים, ה-AI מזהה, העיר מתוקנת · YOLOv8 בדפדפן</footer>
      </div>
    </>
  );
}
