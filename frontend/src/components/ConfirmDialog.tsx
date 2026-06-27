import { useEffect, useRef, type ReactNode } from 'react';

export type ConfirmVariant = 'danger' | 'warning' | 'info' | 'success';

const VAR_META: Record<ConfirmVariant, { color: string; icon: string }> = {
  danger: { color: 'var(--color-danger)', icon: '⚠️' },
  warning: { color: 'var(--color-warn)', icon: '🟡' },
  info: { color: 'var(--color-accent2)', icon: 'ℹ️' },
  success: { color: 'var(--color-success)', icon: '✅' },
};

interface Props {
  open: boolean;
  title: string;
  message?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: ConfirmVariant;
  icon?: string;          // override emoji
  loading?: boolean;      // spinner pada tombol konfirmasi
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Modal konfirmasi reusable. Controlled: render dengan `open` + handler.
 * Esc/klik-luar = batal, Enter = konfirmasi (kecuali saat loading).
 */
export default function ConfirmDialog({
  open, title, message, confirmText = 'Ya, lanjut', cancelText = 'Batal',
  variant = 'danger', icon, loading = false, onConfirm, onCancel,
}: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => confirmRef.current?.focus(), 40);
    function onKey(e: KeyboardEvent) {
      if (loading) return;
      if (e.key === 'Escape') onCancel();
      else if (e.key === 'Enter') onConfirm();
    }
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); };
  }, [open, loading, onCancel, onConfirm]);

  if (!open) return null;
  const meta = VAR_META[variant];
  const ic = icon || meta.icon;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      role="dialog" aria-modal="true" aria-label={title}
      onMouseDown={() => { if (!loading) onCancel(); }}
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)' }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="nw-pop relative w-full max-w-sm rounded-2xl border border-border overflow-hidden shadow-2xl shadow-black/50"
        style={{ background: 'var(--glass-bg)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}
      >
        <div className="absolute inset-x-0 top-0 h-1" style={{ background: meta.color }} />
        <div className="p-5 pt-6 flex flex-col items-center text-center">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center text-2xl mb-3"
            style={{
              background: `color-mix(in srgb, ${meta.color} 18%, transparent)`,
              boxShadow: `0 0 0 6px color-mix(in srgb, ${meta.color} 8%, transparent)`,
            }}
          >
            {ic}
          </div>
          <h3 className="text-base font-bold">{title}</h3>
          {message && <div className="text-[12.5px] text-text2 mt-1.5 leading-relaxed">{message}</div>}

          <div className="flex gap-2.5 w-full mt-5">
            <button
              onClick={onCancel} disabled={loading}
              className="flex-1 py-2.5 rounded-lg border border-border text-[13px] font-semibold text-text2 hover:text-text hover:bg-text/5 transition disabled:opacity-50"
            >
              {cancelText}
            </button>
            <button
              ref={confirmRef} onClick={onConfirm} disabled={loading}
              className="flex-1 py-2.5 rounded-lg text-[13px] font-bold text-white transition active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-2"
              style={{ background: meta.color }}
            >
              {loading && <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
              {loading ? 'Memproses…' : confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
