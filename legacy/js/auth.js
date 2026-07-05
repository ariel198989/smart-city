// Smart City — auth (email+password, team in user_metadata; viewer mode allowed)
import { sb } from './db.js';
import { ADMINS } from './config.js';
import { $, toast } from './util.js';

export const AUTH = { user: null, team: '', admin: false, viewer: false };
const listeners = [];
export const onAuth = (fn) => listeners.push(fn);
const emit = () => listeners.forEach((fn) => { try { fn(AUTH); } catch (e) { console.error(e); } });

function routeUI() {
  $('#authScreen').style.display = (AUTH.user || AUTH.viewer) ? 'none' : 'grid';
  $('#teamBadge').style.display = AUTH.user ? '' : 'none';
  $('#teamBadge').textContent = AUTH.team ? '👥 ' + AUTH.team : '';
  $('#loginBtn').style.display = AUTH.user ? 'none' : '';
  $('#logoutBtn').style.display = AUTH.user ? '' : 'none';
  $('#factoryTab').style.display = AUTH.admin ? '' : 'none';
}

let authMode = 'login';

export async function initAuth() {
  $('#tabLogin').onclick = () => {
    authMode = 'login';
    $('#tabLogin').classList.add('on'); $('#tabSignup').classList.remove('on');
    $('#signupExtra').style.display = 'none'; $('#authGo').textContent = 'כניסה'; $('#authErr').textContent = '';
  };
  $('#tabSignup').onclick = () => {
    authMode = 'signup';
    $('#tabSignup').classList.add('on'); $('#tabLogin').classList.remove('on');
    $('#signupExtra').style.display = ''; $('#authGo').textContent = 'צור חשבון'; $('#authErr').textContent = '';
  };
  $('#authPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#authGo').click(); });

  $('#authGo').onclick = async () => {
    const email = $('#authEmail').value.trim(), pass = $('#authPass').value;
    const err = $('#authErr'); err.style.color = 'var(--danger)'; err.textContent = '';
    if (!email || !pass) { err.textContent = 'צריך אימייל וסיסמה'; return; }
    $('#authGo').disabled = true;
    try {
      if (authMode === 'signup') {
        const team = $('#authTeam').value.trim() || email.split('@')[0];
        const r = await sb.auth.signUp({ email, password: pass, options: { data: { class_name: team } } });
        if (r.error) throw r.error;
        if (!r.data.session) {
          err.style.color = 'var(--ok)';
          err.textContent = 'נשלח מייל אישור — פתחו אותו ואז התחברו.';
          $('#authGo').disabled = false;
          return;
        }
      } else {
        const r = await sb.auth.signInWithPassword({ email, password: pass });
        if (r.error) throw r.error;
      }
      await refresh();
    } catch (e) {
      err.textContent = e.message === 'Invalid login credentials' ? 'אימייל או סיסמה שגויים' : (e.message || e);
    }
    $('#authGo').disabled = false;
  };

  $('#skipAuth').onclick = () => { AUTH.viewer = true; routeUI(); emit(); };
  $('#loginBtn').onclick = () => { AUTH.viewer = false; routeUI(); };
  $('#logoutBtn').onclick = async () => { await sb.auth.signOut(); location.reload(); };

  await refresh();
}

async function refresh() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    AUTH.user = session?.user || null;
    AUTH.team = AUTH.user?.user_metadata?.class_name || AUTH.user?.email?.split('@')[0] || '';
    AUTH.admin = !!(AUTH.user && ADMINS.includes((AUTH.user.email || '').toLowerCase()));
  } catch (e) { toast('בעיה בהתחברות: ' + (e.message || e)); }
  routeUI();
  emit();
}

export function requireAuth() {
  if (AUTH.user) return true;
  AUTH.viewer = false;
  routeUI();
  toast('צריך להתחבר בשביל הפעולה הזו', true);
  return false;
}
