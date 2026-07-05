'use client';
import { useEffect, useState } from 'react';
import { toastStore, useStore, toast } from '@/lib/store';

export default function Toast() {
  const t = useStore(toastStore);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onErr = (e: ErrorEvent) => toast('שגיאה: ' + (e.message || 'לא ידועה'));
    const onRej = (e: PromiseRejectionEvent) =>
      toast('שגיאה: ' + ((e.reason && e.reason.message) || e.reason || 'לא ידועה'));
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onRej);
    return () => {
      window.removeEventListener('error', onErr);
      window.removeEventListener('unhandledrejection', onRej);
    };
  }, []);

  useEffect(() => {
    if (!t.at) return;
    setVisible(true);
    const h = setTimeout(() => setVisible(false), 6000);
    return () => clearTimeout(h);
  }, [t.at]);

  if (!visible || !t.msg) return null;
  return (
    <div id="toast" className={t.info ? 'info' : ''} style={{ display: 'block' }}>
      {(t.info ? 'ℹ️ ' : '⚠️ ') + t.msg}
    </div>
  );
}
