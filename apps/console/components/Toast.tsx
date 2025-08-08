'use client';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

type Toast = { id: string; message: string; type?: 'info' | 'success' | 'error' };

const ToastCtx = createContext<{ toasts: Toast[]; push: (t: Omit<Toast, 'id'>) => void; remove: (id: string) => void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const remove = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, ...t }]);
    setTimeout(() => remove(id), 3500);
  }, [remove]);
  const value = useMemo(() => ({ toasts, push, remove }), [toasts, push, remove]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toast-host">
        {toasts.map((t) => (
          <div key={t.id} className={`toast glass ${t.type || 'info'}`}>{t.message}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('ToastProvider missing');
  return ctx;
}

