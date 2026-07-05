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

// which ML-pipeline steps light up per view (pedagogy ribbon)
const RIBBON: Record<ViewName, number[]> = {
  map: [7], tour: [6, 7], studio: [1, 2, 3, 4, 5], board: [7], factory: [1, 2],
};

export default function Home() {
  const [view, setView] = useState<ViewName>('map');
  const [tourTarget, setTourTarget] = useState<TourTarget | null>(null);
  const auth = useStore(authStore);

  useEffect(() => { initAuth(); }, []);

  const openStreetView = (lat: number, lng: number) => {
    setTourTarget({ kind: 'street', lat, lng, at: Date.now() });
    setView('tour');
  };
  const openTourFrame = (frame: { route_id?: string; id?: string }) => {
    if (!frame.route_id) return;
    setTourTarget({ kind: 'route', routeId: frame.route_id, frameId: frame.id, at: Date.now() });
    setView('tour');
  };

  return (
    <>
      <Toast />
      {auth.loaded && <AuthOverlay />}
      <div className="wrap">
        <TopBar view={view} onView={setView} />
        <Ribbon hot={RIBBON[view]} />
        <div style={{ display: view === 'map' ? '' : 'none' }}>
          <MapView active={view === 'map'} onStreetView={openStreetView} onTourFrame={openTourFrame} />
        </div>
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
