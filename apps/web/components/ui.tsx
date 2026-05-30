'use client';

import { ReactNode } from 'react';

export function Card({ title, subtitle, children, actions, className = '' }: {
  title?: string; subtitle?: string; children: ReactNode; actions?: ReactNode; className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-[var(--shadow-sm)] ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            {title && <div className="font-semibold">{title}</div>}
            {subtitle && <div className="text-xs text-[var(--muted)] mt-0.5">{subtitle}</div>}
          </div>
          {actions}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

export function Button({ children, onClick, disabled, variant = 'primary', type = 'button', size = 'md', className = '' }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean;
  variant?: 'primary' | 'ghost' | 'soft'; type?: 'button' | 'submit'; size?: 'sm' | 'md'; className?: string;
}) {
  const sizing = size === 'sm' ? 'px-3 py-1.5 text-[13px]' : 'px-4 py-2 text-sm';
  const base = `inline-flex items-center justify-center gap-2 rounded-full font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed active:translate-y-px ${sizing}`;
  const styles = {
    primary: 'bg-[var(--accent)] text-[var(--on-accent)] shadow-[var(--shadow-sm)] hover:bg-[var(--accent-press)]',
    soft: 'bg-[var(--panel-2)] text-[var(--text)] hover:bg-[var(--border)]',
    ghost: 'border border-[var(--border-strong)] text-[var(--text)] bg-[var(--panel)] hover:bg-[var(--panel-2)]'
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${styles} ${className}`}>
      {children}
    </button>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-xl border border-[var(--border)] bg-[var(--panel)] px-3.5 py-2.5 text-sm text-[var(--text)] outline-none transition-colors placeholder:text-[var(--faint)] focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent)]/10 ${props.className ?? ''}`}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-xl border border-[var(--border)] bg-[var(--panel)] px-3.5 py-2.5 text-sm text-[var(--text)] outline-none transition-colors placeholder:text-[var(--faint)] focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent)]/10 ${props.className ?? ''}`}
    />
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <label className="block text-xs font-medium text-[var(--muted)] mb-1.5">{children}</label>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="mb-4"><Label>{label}</Label>{children}</div>;
}

type Tone = 'muted' | 'ok' | 'warn' | 'bad' | 'accent' | 'info';

const PILL_TONES: Record<Tone, string> = {
  muted: 'text-[var(--muted)] bg-[var(--panel-2)] border-[var(--border)]',
  ok: 'text-[var(--ok)] bg-[var(--ok-bg)] border-transparent',
  warn: 'text-[var(--warn)] bg-[var(--warn-bg)] border-transparent',
  bad: 'text-[var(--bad)] bg-[var(--bad-bg)] border-transparent',
  info: 'text-[var(--info)] bg-[var(--info-bg)] border-transparent',
  accent: 'text-[var(--accent)] bg-[var(--ok-bg)] border-transparent'
};

export function Pill({ children, tone = 'muted', dot = false }: { children: ReactNode; tone?: Tone; dot?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${PILL_TONES[tone]}`}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />}
      {children}
    </span>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-end justify-between mb-6">
      <div>
        <h1 className="font-display text-[26px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-[var(--muted)] mt-1">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <div className="rounded-xl border border-[var(--bad)]/30 bg-[var(--bad-bg)] px-3.5 py-2.5 text-sm text-[var(--bad)]">{children}</div>;
}

/* A circular match-percentage ring (SVG, no deps). */
export function MatchRing({ value, size = 44 }: { value: number; size?: number }) {
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  const dash = (pct / 100) * c;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border-strong)" strokeWidth={stroke} opacity={0.5} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--accent)" strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={`${dash} ${c}`}
        />
      </svg>
      <div className="absolute text-center leading-none">
        <div className="text-[12px] font-semibold">{pct}%</div>
      </div>
    </div>
  );
}

/* A monogram avatar for a company (deterministic warm tint). */
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const tints = ['var(--tint-butter)', 'var(--tint-sky)', 'var(--tint-mint)', 'var(--tint-lav)', 'var(--tint-blush)'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const bg = tints[h % tints.length];
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '·';
  return (
    <div
      className="grid place-items-center rounded-xl font-semibold text-[var(--text)] shrink-0"
      style={{ width: size, height: size, background: bg, fontSize: size * 0.36 }}
    >
      {initials}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, active, onChange }: {
  tabs: { key: T; label: string; count?: number }[]; active: T; onChange: (k: T) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--panel-2)] p-1">
      {tabs.map(t => {
        const on = t.key === active;
        return (
          <button key={t.key} onClick={() => onChange(t.key)}
            className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
              on ? 'bg-[var(--panel)] text-[var(--text)] shadow-[var(--shadow-sm)]' : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}>
            {t.label}
            {typeof t.count === 'number' && (
              <span className={`ml-1.5 text-[11px] ${on ? 'text-[var(--accent)]' : 'text-[var(--faint)]'}`}>{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
