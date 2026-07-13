'use client';
// 📱 Mobile navigation done right: bottom tab bar (one-hand reach) +
// two full-screen hubs that slide up from the bottom.
// אימון hub = the END-TO-END journey as a visible stepper: the user
// always knows which step they're on and WHOSE turn it is (phone /
// desktop / Colab). No hidden menus, no dead ends.
import { useEffect, useState } from 'react';
import { authStore, logout } from '@/lib/auth';
import { useStore, toast } from '@/lib/store';
import { modelStore } from '@/lib/infer';
import { pocketStore } from '@/lib/pocket';
import { getHeading, SECTOR_NAMES, sectorOf } from '@/lib/compass';
import { fetchPoolStats, fetchUntaggedPhoneShots, type PoolStats } from '@/lib/citypool';
import { fetchJobs, type TrainJob } from '@/lib/trainjobs';
import { publicUrl, sb } from '@/lib/db';
import { fetchPoolGallery } from '@/lib/citypool';
import { DAILY_TARGET, DAILY_BONUS } from '@/lib/daily';
import { normalizeHebrewCount } from '@/lib/text';
import { fetchActiveCampaign, fetchCampaignProgress, type Campaign, type CampaignProgress } from '@/lib/campaigns';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Target02Icon, Brain02Icon, GraduationScrollIcon, Camera01Icon, Tag01Icon,
  Rocket01Icon, UserGroupIcon, SmartPhone01Icon, PlusSignIcon,
  Award01Icon, Image02Icon, ChampionIcon, City01Icon, CalendarCheckIn01Icon,
  Download04Icon, Compass01Icon, Logout01Icon, Login01Icon,
} from '@hugeicons/core-free-icons';

export type MobileTab = 'map' | 'cam' | 'train' | 'me';

const fmtAgo = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 60 ? `לפני ${m} דק'` : `לפני ${Math.round(m / 60)} שע'`;
};

// 🎖️ permanent progression — LIFETIME credits, survives the monthly
// leaderboard reset (the audit's Sisyphus problem)
const RANKS = [
  { at: 0, name: 'טירון', icon: '🔰' },
  { at: 60, name: 'צופה', icon: '👁️' },
  { at: 150, name: 'סייר', icon: '🥾' },
  { at: 300, name: 'סוכן', icon: '🕵️' },
  { at: 550, name: 'סוכן בכיר', icon: '🎖️' },
  { at: 900, name: 'מפקח', icon: '🛡️' },
  { at: 1400, name: 'אגדה עירונית', icon: '🌟' },
];
export function rankOf(xp: number) {
  let i = 0;
  while (i + 1 < RANKS.length && xp >= RANKS[i + 1].at) i++;
  const next = RANKS[i + 1] || null;
  return { ...RANKS[i], level: i + 1, next, toNext: next ? next.at - xp : 0 };
}

/* ─── bottom tab bar — RTL order: map (home) on the right.
   Custom monoline SVG icons (not emoji): consistent across every OS,
   stroke inherits currentColor so active-state glow just works ─── */
const ICONS: Record<MobileTab, React.ReactNode> = {
  map: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
      <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" /><path d="M9 4v14M15 6v14" opacity=".55" />
    </svg>
  ),
  cam: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
      <rect x="3" y="7" width="18" height="13" rx="0" /><path d="m9 7 1.5-3h3L15 7" /><circle cx="12" cy="13.5" r="3.6" />
    </svg>
  ),
  train: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
      <circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="7.5" opacity=".55" />
      <path d="M12 1.8v3M12 19.2v3M1.8 12h3M19.2 12h3" />
    </svg>
  ),
  me: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
      <circle cx="12" cy="8" r="4" /><path d="M4.5 20.5c1.6-3.6 4.2-5 7.5-5s5.9 1.4 7.5 5" />
    </svg>
  ),
};

export function BottomBar({ active, onTab }: { active: MobileTab; onTab: (t: MobileTab) => void }) {
  const tab = (id: MobileTab, label: string) => (
    <button className={'bb-tab' + (active === id ? ' on' : '')} aria-label={label}
      onClick={() => { if (navigator.vibrate) navigator.vibrate(10); onTab(id); }}>
      <span className="bb-ico">{ICONS[id]}</span>
      <span className="bb-lbl">{label}</span>
    </button>
  );
  return (
    <nav className="bottombar">
      {tab('map', 'מפה')}
      {tab('cam', 'מצלמה')}
      {tab('train', 'אימון')}
      {tab('me', 'אני')}
    </nav>
  );
}

/* ─── TWO WORLDS, cleanly separated:
   🎓 personal pocket training (the feel, 30s, on-device) vs
   🏭 the GROUP machine: shoot series → tag on phone → shared pool
   (merging is automatic) → cloud training → model for everyone ─── */
interface TrainHubProps {
  onClose: () => void;
  classes: string[];                    // the session's object LIST (multi-class)
  onClasses: (c: string[]) => void;     // add/remove objects
  myUntagged: number | null; // my shots waiting for a bbox
  onTrainer: () => void;                       // opens PocketTrainer
  onTrainReal: (scope: 'mine' | 'all') => void; // personal / class-merged cloud training
  onSeries: (focusClass?: string) => void;  // opens burst series capture (optionally jump to one class)
  onTagger: () => void;      // opens the phone tagger
}

// classroom presets — a student picks in one tap or types her own
const CLASS_PRESETS = ['מעבר חציה', 'בור בכביש', 'תמרור', 'פסולת', 'ספסל שבור', 'תאורה שבורה', 'גרפיטי'];

export function TrainingHub({ onClose, classes, onClasses, myUntagged, onTrainer, onTrainReal, onSeries, onTagger }: TrainHubProps) {
  const mission = classes[0] || 'מעבר חציה';
  const addClass = (v: string) => {
    const c = normalizeHebrewCount(v.trim());
    if (c && !classes.includes(c)) onClasses([...classes, c]);
  };
  const model = useStore(modelStore);
  const pocket = useStore(pocketStore);
  const [pool, setPool] = useState<PoolStats | null>(null);
  const [job, setJob] = useState<TrainJob | null | 'none'>(null);
  // 🎯 the city's live weekly mission — one banner every phone sees
  const [camp, setCamp] = useState<Campaign | null>(null);
  const [campProg, setCampProg] = useState<CampaignProgress | null>(null);
  useEffect(() => {
    fetchActiveCampaign().then((c) => {
      setCamp(c);
      if (c) fetchCampaignProgress(c.id).then(setCampProg).catch(() => {});
    }).catch(() => {});
  }, []);
  useEffect(() => {
    fetchPoolStats().then(setPool).catch(() => {});
    // live job status — poll while the hub is open so "התחל אימון" never
    // becomes a black hole (the audit's #2 finding)
    let stop = false;
    const tick = () => {
      if (stop) return;
      fetchJobs(1, { team: authStore.get().team || null, scope: 'all' }).then((j) => { if (!stop) setJob(j[0] || 'none'); }).catch(() => {});
      setTimeout(tick, 20000);
    };
    tick();
    return () => { stop = true; };
  }, []);

  const tagged = pool?.total || 0;
  const contributors = pool?.contributors || 0;
  const pendingJob = job && job !== 'none' && job.status === 'pending' ? job : null;
  const weakest = pool?.byClass.length ? Math.min(...pool.byClass.map((c) => c.count)) : 0;
  const ready = tagged > 0 && weakest >= 50;

  // the group machine, step by step — each tagged with WHOSE turn it is.
  // Rendered as a right-anchored icon accordion: closed = icon + title,
  // tap = the step opens with its full story + CTA (de-densified mobile UX)
  const steps = [
    {
      icon: Camera01Icon, who: 'אתם',
      title: classes.length > 1 ? `צלמו סדרה לכל אובייקט (${classes.length})` : `צלמו סדרה של ${mission}`,
      body: classes.length > 1
        ? 'המצלמה צולמת לבד כל 1.5 שניות. בוחרים אובייקט בצ\'יפ שלמעלה, מקיפים אותו — ואז עוברים לאובייקט הבא. רדאר זוויות נפרד לכל אחד.'
        : 'המצלמה צולמת לבד כל 1.5 שניות — פשוט מסתובבים סביב האובייקט. 60 תמונות בדקה וחצי, מכל הזוויות.',
      cta: { label: 'צלמו סדרה', run: () => onSeries(), hot: false },
      done: (myUntagged || 0) > 0 || tagged > 0,
    },
    {
      icon: Tag01Icon, who: 'אתם', title: 'תייגו בטלפון',
      body: myUntagged
        ? `${myUntagged} תמונות שלכם מחכות לתיבה — גוררים אצבע סביב האובייקט, שמור, הבא. דקות ספורות.`
        : 'אין תמונות בהמתנה כרגע. אחרי צילום סדרה — התיוג כאן. (תיוג עדין יותר אפשרי גם בדסקטופ בסטודיו.)',
      cta: myUntagged ? { label: `תייגו ${myUntagged} תמונות`, run: onTagger, hot: true } : null,
      done: tagged > 0 && !myUntagged,
    },
    {
      icon: Rocket01Icon, who: pendingJob ? 'הענן — תורו' : 'אתם לבד', title: 'אימון אישי אמיתי',
      body: pendingJob
        ? `משימה פתוחה: ${pendingJob.image_count} תמונות · נפתחה ${fmtAgo(pendingJob.created_at)} — הריצו את המחברת (Run all, ‏~15 דק'). הסטטוס מתעדכן כאן חי.`
        : 'המודל הראשון שלכם — רק על התמונות שאתם תייגתם. עוברים לבד את כל המסלול: דאטה → ענן → מודל. (רמז: הוא ייצא חלש — וזה בדיוק השיעור.)',
      cta: { label: pendingJob ? 'המשך במחברת' : 'אמנו מודל משלכם', run: () => onTrainReal('mine'), hot: true },
      done: !!(job && job !== 'none' && job.status === 'done'),
    },
    {
      icon: UserGroupIcon, who: 'כל הכיתה', title: 'האיחוד — מודל של כולם',
      body: `כל תמונה מתויגת של כל חבר קבוצה כבר במאגר אחד: ${tagged} תמונות מ-${contributors} תורמים` +
        (pool && tagged > 0 ? ` · הקטגוריה הדלה: ${weakest} (יעד 50+, ‏150+ = מצוין)` : '') +
        '. עכשיו מאמנים פעם אחת על הכל — ומשווים למודל האישי: 60 לבד נגד 400 ביחד.',
      cta: { label: 'התחל אימון כיתתי מאוחד', run: () => onTrainReal('all'), hot: false },
      done: ready,
    },
    {
      icon: SmartPhone01Icon, who: 'אוטומטי', title: 'המודל אצל כולם',
      body: model.ready
        ? `פעיל: ${model.name} — כל טלפון בעיר משתמש בו עכשיו.`
        : 'כשהמודל נרשם — כל טלפון מקבל אותו אוטומטית, והמשחק נהיה חכם.',
      cta: null,
      done: model.ready,
    },
  ];
  // accordion: one step open at a time; defaults to the first unfinished
  const [openStep, setOpenStep] = useState<number | null>(null);
  const firstUndone = steps.findIndex((s) => !s.done);
  const shownStep = openStep ?? (firstUndone === -1 ? steps.length - 1 : firstUndone);

  return (
    <section className="hub">
      <header className="hub-head">
        <button className="ghost hub-close" aria-label="סגירה" onClick={onClose}>✕</button>
        <b>אימון</b>
        <span>להרגיש איך AI לומד · ולבנות מודל אמיתי ביחד</span>
      </header>
      <div className="hub-body">
        {/* 🎯 THE weekly city mission — admin-defined; joining loads its
            objects into this session so every frame lands attributed */}
        {camp && (() => {
          const daysLeft = Math.max(0, Math.ceil((new Date(camp.ends_at).getTime() - Date.now()) / 86400000));
          const pct = campProg ? Math.min(100, Math.round((campProg.total / Math.max(1, camp.goal_images)) * 100)) : 0;
          const joined = camp.classes.every((c) => classes.includes(c));
          return (
            <div className="thx-camp">
              <div className="thx-camp-top">
                <span className="thx-ico gold"><HugeiconsIcon icon={Target02Icon} size={22} strokeWidth={1.6} /></span>
                <div className="thx-camp-txt">
                  <i>המשימה העירונית · {daysLeft > 0 ? `עוד ${daysLeft} ימים` : 'מסתיים היום'}</i>
                  <b>{camp.title}</b>
                </div>
              </div>
              <div className="thx-chips">
                {camp.classes.map((c) => <span key={c}>{c}</span>)}
              </div>
              {campProg && (
                <div className="thx-progress">
                  <div className="thx-bar"><i style={{ width: pct + '%' }} /></div>
                  <span><b>{campProg.total}</b>/{camp.goal_images} תמונות · {campProg.contributors} משתתפים</span>
                </div>
              )}
              <button className={joined ? 'primary' : 'hot'} style={{ width: '100%' }}
                onClick={() => {
                  if (!joined) {
                    onClasses([...new Set([...camp.classes, ...classes])]);
                    toast('הצטרפתם! האובייקטים של המשימה נטענו — צלמו סדרה וכל תמונה נספרת לעיר', true);
                  } else onSeries(camp.classes[0]);
                }}>
                {joined ? 'צלמו למשימה עכשיו' : 'הצטרפו למשימה העירונית'}
              </button>
            </div>
          );
        })()}

        {/* the answer to "where's my model + how good is it" — HONESTLY.
            weak model → says so + sends you to shoot more, never fakes success */}
        {(() => {
          const ic = model.imageCount, hv = model.honestVal;
          const verdict = !model.ready ? null
            : ic == null ? { t: 'unknown', msg: 'איכות לא נמדדה (מודל ישן).' }
            : (ic < 30 || hv === false) ? { t: 'weak', msg: `⚠️ מודל ניסיוני — אומן על ${ic} תמונות בלבד${hv === false ? ', בלי סט בדיקה אמיתי' : ''}. סביר שהוא "שינן" ולא באמת הבין. כדי שיהיה אמין — צלמו עוד תמונות מגוונות (עכברים שונים, רקעים שונים).` }
            : ic < 100 ? { t: 'basic', msg: `מודל בסיסי — ${ic} תמונות. עובד על מקרים דומים; עוד תמונות מגוונות ישפרו אותו הרבה.` }
            : { t: 'strong', msg: `מודל חזק — ${ic} תמונות עם סט בדיקה אמיתי. 💪` };
          const optimistic = model.accuracy != null && hv === false;
          return (
            <div className={'model-card hud' + (model.ready ? ' live' : '') + (verdict?.t === 'weak' ? ' warn' : '')}>
              {model.ready ? (
                <>
                  <div className="mc-top">
                    <span className="mc-dot" />
                    <b>מודל פעיל בעיר</b>
                    <span className="mc-acc">{model.accuracy != null ? `דיוק ${Math.round(model.accuracy * 100)}%${optimistic ? '*' : ''}` : 'דיוק לא נמדד'}</span>
                  </div>
                  <div className="mc-name">{model.name}</div>
                  <div className="mc-classes">
                    {model.classes.map((c) => <span key={c} className="mc-cls">{c}</span>)}
                  </div>
                  {model.accuracy != null && (
                    <div className="mc-bar"><i style={{ width: Math.round(model.accuracy * 100) + '%' }} /></div>
                  )}
                  {optimistic && <p className="mc-hint" style={{ opacity: .8 }}>*הציון אופטימי — נמדד על מעט תמונות בלי סט בדיקה נפרד.</p>}

                  {/* 📊 per-class feedback — the training loop closed: the
                      model itself tells the class WHICH object to shoot
                      more of. Tap a weak row → jump straight to shooting
                      that exact object. */}
                  {model.classStats && (
                    <div className="mc-stats">
                      <div className="mc-stats-head">מה המודל למד — לפי אובייקט:</div>
                      {model.classStats.map((s) => {
                        const nm = normalizeHebrewCount(s.name);
                        const pct = s.ap50 != null ? Math.round(s.ap50 * 100) : null;
                        const weak = (pct != null && pct < 50) || (s.boxes != null && s.boxes < 20);
                        return (
                          <button key={s.name} className={'mc-stat' + (weak ? ' weak' : '')}
                            onClick={() => weak && onSeries(nm)} disabled={!weak}>
                            <span className="mcs-name">{nm}</span>
                            <span className="mcs-bar"><i style={{ width: (pct ?? 4) + '%' }} /></span>
                            <span className="mcs-num">{pct != null ? pct + '%' : '—'}</span>
                            <span className="mcs-fix">{weak ? `📸 צלמו עוד (יש ${s.boxes ?? '?'} תמונות)` : '✓ חזק'}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className={'mc-verdict ' + (verdict!.t)}>{verdict!.msg}</div>
                  {(verdict!.t === 'weak' || verdict!.t === 'basic') && (
                    <button className="hot" style={{ width: '100%', marginTop: 8 }} onClick={() => onSeries()}>📸 צלמו עוד תמונות לשיפור</button>
                  )}
                  <p className="mc-hint">בדיקה כנה: צלמו {model.classes[0] || 'את זה'} <b>אחר</b> (צבע/רקע שונה). אם עדיין מזהה — באמת למד. 🎯</p>
                </>
              ) : (
                <div className="thx-strip">
                  <span className="thx-ico dim"><HugeiconsIcon icon={Brain02Icon} size={20} strokeWidth={1.6} /></span>
                  <span>אין מודל פעיל עדיין — כשהאימון למטה יסתיים, הוא יופיע כאן עם ציון כנה.</span>
                </div>
              )}
            </div>
          );
        })()}

        {/* world 1: the personal feel — one compact row */}
        <button className="thx-row" onClick={onTrainer}>
          <span className="thx-ico"><HugeiconsIcon icon={GraduationScrollIcon} size={22} strokeWidth={1.6} /></span>
          <span className="thx-row-txt">
            <b>אימון אישי — להרגיש את זה</b>
            <i>{pocket.ready ? `המודל שלכם מזהה "${pocket.className}" — שחקו או אמנו מחדש` : 'מודל צעצוע על הטלפון, 30 שניות, בלי ענן'}</i>
          </span>
          <span className="thx-go">‹</span>
        </button>

        {/* world 2: the group machine */}
        <div className="thx-sep">אימון קבוצתי אמיתי</div>

        {/* the session's OBJECT LIST — compact, chips scroll on one line */}
        <div className="thx-pick">
          <div className="thx-pick-head">
            <b>מה מאמנים היום?</b>
            <span>{classes.length > 1 ? `מודל אחד · ${classes.length} אובייקטים` : 'אפשר כמה אובייקטים'}</span>
          </div>
          {classes.length > 0 && (
            <div className="thx-chips sel">
              {classes.map((c) => (
                <span key={c}>
                  {c}
                  <button aria-label={'הסר ' + c} onClick={() => onClasses(classes.filter((x) => x !== c))}>✕</button>
                </span>
              ))}
            </div>
          )}
          <div className="thx-chips add">
            {CLASS_PRESETS.filter((c) => !classes.includes(c)).map((c) => (
              <button key={c} onClick={() => addClass(c)}>
                <HugeiconsIcon icon={PlusSignIcon} size={13} strokeWidth={2} />{c}
              </button>
            ))}
          </div>
          <input className="pick-free" placeholder='אובייקט משלכם… למשל: "אצבע אחת"'
            onBlur={(e) => { addClass(e.target.value); e.target.value = ''; }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        </div>

        {/* the machine as a right-anchored icon ACCORDION — closed steps are
            one calm line; the active step opens with its story + CTA */}
        <div className="thx-steps">
          {steps.map((s, i) => {
            const open = shownStep === i;
            return (
              <div key={i} className={'thx-step' + (open ? ' open' : '') + (s.done ? ' done' : '')}>
                <button className="thx-step-head" aria-expanded={open}
                  onClick={() => setOpenStep(open ? -1 : i)}>
                  <span className={'thx-ico' + (s.done ? ' ok' : '')}>
                    {s.done ? '✓' : <HugeiconsIcon icon={s.icon} size={21} strokeWidth={1.6} />}
                  </span>
                  <span className="thx-row-txt">
                    <b>{s.title}</b>
                    <i>{s.who}</i>
                  </span>
                  <span className="thx-go">{open ? '⌄' : '‹'}</span>
                </button>
                {open && (
                  <div className="thx-step-body">
                    <p>{s.body}</p>
                    {s.cta && <button className={s.cta.hot ? 'hot' : 'primary'} style={{ width: '100%' }} onClick={s.cta.run}>{s.cta.label}</button>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ─── אני hub: my stuff + community + device ─── */
interface MeHubProps {
  onClose: () => void;
  onMyLog: () => void;
  onBoard: () => void;
  credits: number; streak: number; dailyN: number;
}

export function MeHub({ onClose, onMyLog, onBoard, credits, streak, dailyN }: MeHubProps) {
  const auth = useStore(authStore);
  const [pool, setPool] = useState(false);
  const [sensors, setSensors] = useState(false);
  // lifetime XP = all-time credits (never resets — unlike the monthly board)
  const [xp, setXp] = useState<number | null>(null);
  useEffect(() => {
    if (!auth.user) return;
    sb.from('sc_detections').select('credits').eq('detected_by', auth.user.id).limit(1000)
      .then(({ data }) => setXp((data || []).reduce((s: number, r: any) => s + (r.credits || 0), 0)));
  }, [auth.user]);
  const rank = xp != null ? rankOf(xp) : null;

  async function install() {
    const evt = (window as any).__scInstall;
    if (!evt) { alert('פתחו בתפריט הדפדפן: "הוספה למסך הבית"'); return; }
    evt.prompt(); await evt.userChoice;
    (window as any).__scInstall = null;
  }

  // one calm row: right-anchored icon tile, label, optional badge, chevron
  const row = (icon: any, label: string, sub: string, run: () => void, badge = '') => (
    <button className="thx-row me" onClick={run} key={label}>
      <span className="thx-ico"><HugeiconsIcon icon={icon} size={20} strokeWidth={1.6} /></span>
      <span className="thx-row-txt"><b>{label}</b>{sub && <i>{sub}</i>}</span>
      {badge && <span className="thx-badge">{badge}</span>}
      <span className="thx-go">‹</span>
    </button>
  );

  const rankPct = rank?.next ? Math.min(100, Math.round(((xp! - rank.at) / (rank.next.at - rank.at)) * 100)) : 100;

  return (
    <section className="hub">
      <header className="hub-head">
        <button className="ghost hub-close" aria-label="סגירה" onClick={onClose}>✕</button>
        <b>{auth.team || 'אורח'}</b>
        <span>{auth.user?.email || 'לא מחוברים — הצטרפו למשחק'}</span>
      </header>
      <div className="hub-body">
        {/* rank + the month, one composed card instead of card+bar+3 tiles */}
        {rank && (
          <div className="me-hero">
            <div className="me-hero-top">
              <span className="thx-ico gold"><HugeiconsIcon icon={Award01Icon} size={22} strokeWidth={1.6} /></span>
              <div className="thx-row-txt">
                <b>{rank.name} · דרגה {rank.level}</b>
                <i>{rank.next ? `עוד ${rank.toNext} נק' לדרגת "${rank.next.name}"` : 'הדרגה הגבוהה ביותר'}</i>
              </div>
              <span className="me-xp">{xp}</span>
            </div>
            <div className="thx-bar"><i style={{ width: rankPct + '%' }} /></div>
            <div className="me-stats">
              <span><b>{credits}</b> החודש</span>
              <span><b>{streak}</b> רצף ימים</span>
              <span><b>{dailyN}/{DAILY_TARGET}</b> אתגר היום</span>
            </div>
          </div>
        )}

        <div className="thx-sep">הפעילות שלי</div>
        {row(Image02Icon, 'התמונות שלי', 'כל צילום ומה קרה איתו', onMyLog)}
        {row(ChampionIcon, 'מובילי החודש', 'שלושת הראשונים זוכים בפרס', onBoard)}
        {row(City01Icon, 'מאגר העיר', 'התמונות של כל הקהילה', () => setPool(true))}
        {row(CalendarCheckIn01Icon, 'האתגר היומי', `${DAILY_TARGET} תפיסות = בונוס ${DAILY_BONUS} לכל אחת`,
          () => toast(dailyN >= DAILY_TARGET
            ? 'השלמתם את האתגר של היום! מחר מתאפס — שמרו על הרצף'
            : `עוד ${DAILY_TARGET - dailyN} תפיסות דרך שער ה-AI היום. יאללה למצלמה!`, true),
          dailyN >= DAILY_TARGET ? '✓' : `${dailyN}/${DAILY_TARGET}`)}

        <div className="thx-sep">המכשיר</div>
        {row(Download04Icon, 'התקנת האפליקציה', 'למסך הבית, כמו אפליקציה', install)}
        {row(Compass01Icon, 'בדיקת חיישנים', 'מצפן ו-GPS לפני שטח', () => setSensors(true))}
        {auth.user
          ? row(Logout01Icon, 'התנתקות', '', () => { logout(); onClose(); })
          : row(Login01Icon, 'התחברות', 'כדי לתפוס ולצבור קרדיטים', () => { authStore.set({ viewer: false }); onClose(); })}
      </div>
      {pool && <PoolModal onClose={() => setPool(false)} />}
      {sensors && <SensorsModal onClose={() => setSensors(false)} />}
    </section>
  );
}

/* 🏙️ community pool — stats + gallery, phone-sized */
export function PoolModal({ onClose }: { onClose: () => void }) {
  const [stats, setStats] = useState<PoolStats | null>(null);
  const [gallery, setGallery] = useState<any[]>([]);
  useEffect(() => {
    fetchPoolStats().then(setStats).catch(() => {});
    fetchPoolGallery(9).then(setGallery).catch(() => {});
  }, []);
  return (
    <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card hud det-modal">
        <button className="ghost mclose" aria-label="סגירה" onClick={onClose}>✕</button>
        <h3 style={{ fontSize: 14, letterSpacing: '.2em' }}>🏙️ מאגר האימון של העיר</h3>
        {stats && (
          <div className="dw-poolstats">
            <div><b>{stats.total}</b><span>מתויגות</span></div>
            <div><b>{stats.byClass.length}</b><span>קטגוריות</span></div>
            <div><b>{stats.contributors}</b><span>תורמים</span></div>
          </div>
        )}
        {gallery.length > 0 ? (
          <div className="dw-gallery">
            {gallery.map((g, i) => (
              <div key={i} className="dw-gimg">
                <img src={publicUrl(g.frame_path)} alt="" loading="lazy" />
                <span>{g.class_name}</span>
              </div>
            ))}
          </div>
        ) : <div className="hint">כל תפיסה דרך שער ה-AI נכנסת לכאן אוטומטית 📸</div>}
        <div className="hint" style={{ marginTop: 8 }}>מכאן נולד המודל הבא: המאגר יורד לענן, מתאמן, וחוזר לכל טלפון בעיר.</div>
      </div>
    </div>
  );
}

/* 🧭 live sensors self-test */
export function SensorsModal({ onClose }: { onClose: () => void }) {
  const [heading, setHeading] = useState<number | null>(null);
  const [gps, setGps] = useState<'wait' | 'ok' | 'fail'>('wait');
  useEffect(() => {
    const h = setInterval(() => setHeading(getHeading()), 300);
    navigator.geolocation?.getCurrentPosition(() => setGps('ok'), () => setGps('fail'), { timeout: 8000 });
    return () => clearInterval(h);
  }, []);
  return (
    <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card hud det-modal">
        <button className="ghost mclose" aria-label="סגירה" onClick={onClose}>✕</button>
        <h3 style={{ fontSize: 14, letterSpacing: '.2em' }}>🧭 בדיקת חיישנים</h3>
        <div className="boxrow">🧭 מצפן: {heading != null
          ? <b style={{ color: 'var(--cy)' }}>{SECTOR_NAMES[sectorOf(heading)]} ({Math.round(heading)}°) — סובבו ותראו</b>
          : <span className="muted">אין אות — ייתכן שנדרש אישור חיישנים (iPhone)</span>}
        </div>
        <div className="boxrow">🛰️ GPS: {gps === 'ok' ? <b style={{ color: 'var(--cy)' }}>פעיל</b> : gps === 'fail' ? <span style={{ color: 'var(--gold)' }}>חסום — אשרו מיקום בהגדרות</span> : <span className="muted">בודק…</span>}</div>
        <div className="hint" style={{ marginTop: 8 }}>שניהם דרושים לשער הזוויות ולנעיצת פינים אוטומטית.</div>
      </div>
    </div>
  );
}
