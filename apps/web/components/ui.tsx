'use client';

import { ReactNode } from 'react';

export function Card({ title, subtitle, children, actions }: {
  title?: string; subtitle?: string; children: ReactNode; actions?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)]">
      {(title || actions) && (
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            {title && <div className="font-medium">{title}</div>}
            {subtitle && <div className="text-xs text-[var(--muted)] mt-0.5">{subtitle}</div>}
          </div>
          {actions}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

export function Button({ children, onClick, disabled, variant = 'primary', type = 'button' }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean;
  variant?: 'primary' | 'ghost'; type?: 'button' | 'submit';
}) {
  const base = 'rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  const styles = variant === 'primary'
    ? 'bg-[var(--accent)] text-[#0b0e14] hover:brightness-110'
    : 'border border-[var(--border)] text-[var(--text)] hover:bg-[var(--panel-2)]';
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${styles}`}>
      {children}
    </button>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] ${props.className ?? ''}`}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] ${props.className ?? ''}`}
    />
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <label className="block text-xs font-medium text-[var(--muted)] mb-1.5">{children}</label>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="mb-4"><Label>{label}</Label>{children}</div>;
}

export function Pill({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'ok' | 'warn' | 'bad' | 'accent' }) {
  const c = {
    muted: 'text-[var(--muted)] border-[var(--border)]',
    ok: 'text-[var(--ok)] border-[var(--ok)]/40',
    warn: 'text-[var(--warn)] border-[var(--warn)]/40',
    bad: 'text-[var(--bad)] border-[var(--bad)]/40',
    accent: 'text-[var(--accent)] border-[var(--accent)]/40'
  }[tone];
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] ${c}`}>{children}</span>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-end justify-between mb-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-[var(--muted)] mt-1">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <div className="rounded-lg border border-[var(--bad)]/40 bg-[var(--bad)]/10 px-3 py-2 text-sm text-[var(--bad)]">{children}</div>;
}
