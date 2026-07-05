'use client';

const STEPS = ['איסוף', 'אוצרות', 'תיוג', 'אימון', 'הערכה', 'פריסה', 'ניטור'];

export default function Ribbon({ hot }: { hot: number[] }) {
  return (
    <div className="ml-ribbon">
      {STEPS.map((label, i) => (
        <span key={label} style={{ display: 'contents' }}>
          <span className={'s' + (hot.includes(i + 1) ? ' hot' : '')}>{label}</span>
          {i < STEPS.length - 1 && <i />}
        </span>
      ))}
    </div>
  );
}
