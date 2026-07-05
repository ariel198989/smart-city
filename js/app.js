// Smart City — app entry: routing, view lifecycle, module init
import { initAuth } from './auth.js';
import { initMap, refreshMapData, setTourHandlers } from './map.js';
import { initTour, openStreetViewAt, openTourAtFrame } from './tour.js';
import { initStudio } from './studio.js';
import { initBoard, loadBoard } from './board.js';
import { initFactory } from './factory.js';
import { $, $$ } from './util.js';

const VIEWS = ['map', 'tour', 'studio', 'board', 'factory'];
// which ML-pipeline steps light up per view (pedagogy ribbon)
const RIBBON = { map: [7], tour: [6, 7], studio: [1, 2, 3, 4, 5], board: [7], factory: [1, 2] };

let mapStarted = false, factoryStarted = false;

function switchView(name) {
  VIEWS.forEach((v) => { $('#view-' + v).style.display = v === name ? '' : 'none'; });
  $$('#mainTabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === name));
  $$('.ml-ribbon .s').forEach((s) => s.classList.toggle('hot', (RIBBON[name] || []).includes(+s.dataset.step)));
  if (name === 'map') { refreshMapData(); setTimeout(() => window.dispatchEvent(new Event('resize')), 50); }
  if (name === 'board') loadBoard();
  if (name === 'factory' && !factoryStarted) { factoryStarted = true; initFactory(); }
}

$$('#mainTabs button').forEach((b) => { b.onclick = () => switchView(b.dataset.view); });

(async function boot() {
  await initAuth();
  await initMap();
  mapStarted = true;
  setTourHandlers({
    tourRequest: (frame) => openTourAtFrame(frame),
    streetView: (lat, lng) => openStreetViewAt(lat, lng),
  });
  initTour();
  initStudio();
  initBoard();
  switchView('map');
})();
