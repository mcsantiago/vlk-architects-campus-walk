import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

interface Ask {
  title: string;
  detail?: string;
  confirmLabel?: string;
  danger?: boolean;
}

type AskFn = (ask: Ask) => Promise<boolean>;

const ConfirmContext = createContext<AskFn>(() => Promise.resolve(false));

/**
 * In-app confirmation sheet, replacing window.confirm. The native dialog is unreliable in
 * iOS home-screen mode and can be suppressed by browsers after a few uses; this one is a
 * normal <dialog> with the same look as the rest of the app.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const resolver = useRef<(ok: boolean) => void>(() => {});

  const confirm = useCallback<AskFn>((a) => {
    setAsk(a);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (ask && !d.open) d.showModal();
    if (!ask && d.open) d.close();
  }, [ask]);

  const settle = (ok: boolean) => {
    resolver.current(ok);
    setAsk(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <dialog ref={ref} className="sheet" onClose={() => ask && settle(false)}>
        {ask && (
          <div className="stack">
            <h2>{ask.title}</h2>
            {ask.detail && <p className="muted" style={{ margin: 0 }}>{ask.detail}</p>}
            <div className="btn-row">
              <button className={`btn ${ask.danger ? 'danger' : 'primary'}`} style={{ minHeight: 52 }} onClick={() => settle(true)} autoFocus>
                {ask.confirmLabel ?? 'Confirm'}
              </button>
              <button className="btn" onClick={() => settle(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </dialog>
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);
