// Small, consistent UI primitives. Styling lives in styles/app.css (design
// tokens + component classes) instead of per-component inline style objects.
import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'ai';
export function Button({ variant = 'secondary', size, busy, children, className = '', ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm'; busy?: boolean }) {
  return (
    <button className={`btn btn--${variant} ${size === 'sm' ? 'btn--sm' : ''} ${className}`} disabled={busy || rest.disabled} {...rest}>
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export const Spinner = () => <span className="spinner" aria-hidden />;

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

export const Input = ({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) => <input className={`input ${className}`} {...rest} />;
export const Textarea = ({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea className={`input textarea ${className}`} {...rest} />;

/**
 * An input that edits locally and saves on blur (or Enter) only if the value
 * changed — the pattern used for every inline-editable cell. Re-syncs when the
 * server value changes, without clobbering what the user is typing.
 */
export function InlineInput({ value, onSave, className = '', multiline, ...rest }:
  { value: string; onSave: (v: string) => void; multiline?: boolean } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setDraft(value); }, [value, focused]);
  const commit = () => { setFocused(false); if (draft !== value) onSave(draft); };
  if (multiline) {
    return (
      <textarea className={`input textarea inline ${className}`} value={draft} rows={2} placeholder={rest.placeholder}
        onFocus={() => setFocused(true)} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />
    );
  }
  return (
    <input className={`input inline ${className}`} value={draft} {...rest}
      onFocus={() => setFocused(true)} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setDraft(value); setTimeout(() => (e.target as HTMLInputElement).blur()); } }} />
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'draft'; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__title">{title}</div>
      {children && <div className="empty__body">{children}</div>}
      {action && <div className="empty__action">{action}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card__head">
          {title && <h3 className="card__title">{title}</h3>}
          {actions && <div className="card__actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="loading"><Spinner /> {label}</div>;
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : 'Something went wrong';
  return (
    <div className="error-box" role="alert">
      <span>{msg}</span>
      {onRetry && <Button size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

/** Product thumbnail from a signed URL, with a graceful empty state. */
export function Thumb({ src, alt, size = 'md' }: { src?: string; alt: string; size?: 'sm' | 'md' | 'lg' }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  if (!src || broken) return <div className={`thumb thumb--${size} thumb--empty`} aria-label="No image">—</div>;
  return <img className={`thumb thumb--${size}`} src={src} alt={alt} loading="lazy" onError={() => setBroken(true)} />;
}
