'use client';
import { useState, useEffect } from 'react';
import { authStore, login, signup } from '@/lib/auth';
import { useStore } from '@/lib/store';

export default function AuthOverlay() {
  const auth = useStore(authStore);
  // mobile is play-only: a viewer can do nothing, so require an account
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    setIsMobile(mq.matches);
    const on = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [team, setTeam] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  if (auth.user || auth.viewer) return null;

  const go = async () => {
    setErr(''); setOk('');
    if (!email.trim() || !pass) { setErr('צריך אימייל וסיסמה'); return; }
    setBusy(true);
    try {
      if (mode === 'signup') {
        const done = await signup(email.trim(), pass, team.trim() || email.split('@')[0]);
        if (!done) setOk('נשלח מייל אישור — פתחו אותו ואז התחברו.');
      } else {
        await login(email.trim(), pass);
      }
    } catch (e: any) {
      setErr(e.message === 'Invalid login credentials' ? 'אימייל או סיסמה שגויים' : (e.message || String(e)));
    }
    setBusy(false);
  };

  return (
    <div className="overlay">
      <div className="auth-card hud">
        <div className="logo-lg">SMART<span className="accent">CITY</span></div>
        <div className="muted" style={{ fontSize: 13.5, marginTop: 6, textAlign: 'center' }}>
          מאמנים AI לזהות מפגעים עירוניים — <b className="ink">ומתקנים את העיר.</b>
        </div>
        <div className="auth-tabs">
          <button className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>התחברות</button>
          <button className={mode === 'signup' ? 'on' : ''} onClick={() => setMode('signup')}>הרשמה</button>
        </div>
        {mode === 'signup' && (
          <>
            <label className="lbl">שם הקבוצה</label>
            <input type="text" value={team} onChange={(e) => setTeam(e.target.value)} placeholder="למשל: הנמרים של שדרות" />
          </>
        )}
        <label className="lbl">אימייל</label>
        <input
          type="text" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="name@mail.com" style={{ direction: 'ltr', textAlign: 'left' }} autoComplete="username"
        />
        <label className="lbl">סיסמה</label>
        <input
          type="password" value={pass} onChange={(e) => setPass(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && go()}
          placeholder="••••••••" style={{ direction: 'ltr', textAlign: 'left' }} autoComplete="current-password"
        />
        <div className="auth-err" style={ok ? { color: 'var(--cy)' } : undefined}>{err || ok}</div>
        <button className="primary" disabled={busy} onClick={go} style={{ width: '100%', fontSize: 15, padding: 13 }}>
          {mode === 'signup' ? 'צור חשבון' : 'כניסה'}
        </button>
        {isMobile ? (
          <div className="hint" style={{ textAlign: 'center', marginTop: 10, fontSize: 12 }}>
            נכנסים עם חשבון — ומתחילים לתפוס מפגעים ולצבור קרדיטים 🎮
          </div>
        ) : (
          <button className="ghost" onClick={() => authStore.set({ viewer: true })}
            style={{ width: '100%', marginTop: 8, fontSize: 12.5 }}>
            רק להציץ (צפייה בלבד)
          </button>
        )}
      </div>
    </div>
  );
}
