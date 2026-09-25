// Toast notifications and a confirm dialog — replacing window.alert/confirm,
// which block the page, can't be styled, and are suppressed by some browsers.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

type Tone = 'info' | 'success' | 'error';
interface Toast { id: number; tone: Tone; text: string }
interface ConfirmOpts { title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean }

interface Feedback {
  toast: (text: string, tone?: Tone) => void;
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
}
const Ctx = createContext<Feedback | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<(ConfirmOpts & { resolve: (ok: boolean) => void }) | null>(null);
  const nextId = useRef(1);

  const toast = useCallback((text: string, tone: Tone = 'info') => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 4000);
  }, []);

  const confirm = useCallback((opts: ConfirmOpts) => new Promise<boolean>((resolve) => setDialog({ ...opts, resolve })), []);
  const close = (ok: boolean) => { dialog?.resolve(ok); setDialog(null); };

  return (
    <Ctx.Provider value={{ toast, confirm }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.tone}`} onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
            {t.text}
          </div>
        ))}
      </div>
      {dialog && <ConfirmDialog {...dialog} onClose={close} />}
    </Ctx.Provider>
  );
}

function ConfirmDialog({ title, body, confirmLabel = 'Confirm', danger, onClose }: ConfirmOpts & { onClose: (ok: boolean) => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose(false)}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <h3 id="confirm-title" className="modal__title">{title}</h3>
        {body && <div className="modal__body">{body}</div>}
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={() => onClose(false)}>Cancel</button>
          <button ref={confirmRef} className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`} onClick={() => onClose(true)}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export function useFeedback(): Feedback {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useFeedback must be used inside FeedbackProvider');
  return ctx;
}
