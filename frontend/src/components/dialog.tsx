import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Sistem dialog global (pengganti window.confirm/alert/prompt bawaan browser).
 *
 * Pemakaian imperatif berbasis Promise — nyaris drop-in untuk native dialog:
 *   if (!(await confirmDialog('Hapus item ini?'))) return;
 *   await alertDialog('Tersimpan.');
 *   const v = await promptDialog('Alasan penolakan:');   // string | null
 *
 * `<DialogHost />` dipasang sekali di root (main.tsx). Sebelum host ter-mount,
 * fungsi otomatis fallback ke dialog native agar tidak pernah menggantung.
 */

export type DialogVariant = 'danger' | 'warning' | 'info' | 'success';
type DialogKind = 'confirm' | 'alert' | 'prompt';

const VAR_META: Record<DialogVariant, { color: string; icon: string }> = {
  danger: { color: 'var(--color-danger)', icon: '🗑️' },
  warning: { color: 'var(--color-warn)', icon: '⚠️' },
  info: { color: 'var(--color-accent2)', icon: 'ℹ️' },
  success: { color: 'var(--color-success)', icon: '✅' },
};

export interface DialogOptions {
  title?: string;
  message?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: DialogVariant;
  icon?: string;
  /* khusus prompt */
  placeholder?: string;
  defaultValue?: string;
  multiline?: boolean;
  required?: boolean;
  inputLabel?: string;
}

interface ActiveDialog extends DialogOptions {
  id: number;
  kind: DialogKind;
  variant: DialogVariant;
  resolve: (value: unknown) => void;
}

let pushDialog: ((d: ActiveDialog) => void) | null = null;
let seq = 0;

function plain(o: DialogOptions): string {
  const parts = [o.title, typeof o.message === 'string' ? o.message : ''];
  return parts.filter(Boolean).join('\n');
}

function open(kind: DialogKind, o: DialogOptions): Promise<unknown> {
  return new Promise((resolve) => {
    const d: ActiveDialog = { ...o, id: ++seq, kind, variant: o.variant ?? 'info', resolve };
    if (pushDialog) { pushDialog(d); return; }
    // Fallback bila host belum ter-mount — jangan sampai promise menggantung.
    if (kind === 'confirm') resolve(window.confirm(plain(o)));
    else if (kind === 'prompt') resolve(window.prompt(plain(o), o.defaultValue || ''));
    else { window.alert(plain(o)); resolve(undefined); }
  });
}

/** String → {title, message}: baris pertama jadi judul bila pesan multi-baris. */
function norm(input: string | DialogOptions): DialogOptions {
  if (typeof input !== 'string') return input;
  const nl = input.indexOf('\n');
  if (nl > 0) return { title: input.slice(0, nl), message: input.slice(nl + 1).trim() };
  return { message: input };
}

export function confirmDialog(input: string | DialogOptions): Promise<boolean> {
  return open('confirm', { variant: 'warning', title: 'Konfirmasi', confirmText: 'Ya, lanjut', cancelText: 'Batal', ...norm(input) }) as Promise<boolean>;
}

export function alertDialog(input: string | DialogOptions): Promise<void> {
  return open('alert', { variant: 'info', title: 'Pemberitahuan', confirmText: 'Oke', ...norm(input) }) as Promise<void>;
}

export function promptDialog(input: string | DialogOptions, defaultValue = ''): Promise<string | null> {
  return open('prompt', { variant: 'info', title: 'Masukan', confirmText: 'Simpan', cancelText: 'Batal', defaultValue, ...norm(input) }) as Promise<string | null>;
}

/** Host tunggal — render di root aplikasi. */
export function DialogHost() {
  const [stack, setStack] = useState<ActiveDialog[]>([]);
  useEffect(() => {
    pushDialog = (d) => setStack((s) => [...s, d]);
    return () => { pushDialog = null; };
  }, []);

  function close(d: ActiveDialog, value: unknown) {
    d.resolve(value);
    setStack((s) => s.filter((x) => x.id !== d.id));
  }

  const current = stack[stack.length - 1];
  if (!current) return null;
  return <DialogView key={current.id} dialog={current} onClose={close} />;
}

function DialogView({ dialog, onClose }: { dialog: ActiveDialog; onClose: (d: ActiveDialog, value: unknown) => void }) {
  const { kind } = dialog;
  const meta = VAR_META[dialog.variant];
  const ic = dialog.icon || meta.icon;
  const [value, setValue] = useState(dialog.defaultValue || '');
  const confirmRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  const isPrompt = kind === 'prompt';
  const blocked = isPrompt && dialog.required && !value.trim();

  function confirm() {
    if (blocked) return;
    if (kind === 'prompt') onClose(dialog, value);
    else if (kind === 'alert') onClose(dialog, undefined);
    else onClose(dialog, true);
  }
  function cancel() {
    if (kind === 'prompt') onClose(dialog, null);
    else if (kind === 'alert') onClose(dialog, undefined);
    else onClose(dialog, false);
  }

  useEffect(() => {
    const t = setTimeout(() => {
      if (isPrompt) { inputRef.current?.focus(); inputRef.current?.select(); }
      else confirmRef.current?.focus();
    }, 50);
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      else if (e.key === 'Enter' && !(isPrompt && dialog.multiline && !e.ctrlKey)) { e.preventDefault(); confirm(); }
    }
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, blocked]);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4"
      role="dialog" aria-modal="true" aria-label={dialog.title}
      onMouseDown={cancel}
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
          {dialog.title && <h3 className="text-base font-bold">{dialog.title}</h3>}
          {dialog.message && <div className="text-[12.5px] text-text2 mt-1.5 leading-relaxed whitespace-pre-line">{dialog.message}</div>}

          {isPrompt && (
            <div className="w-full mt-4 text-left">
              {dialog.inputLabel && <label className="block text-[11px] text-text2 mb-1">{dialog.inputLabel}</label>}
              {dialog.multiline ? (
                <textarea
                  ref={inputRef}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={dialog.placeholder}
                  className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-[13px] min-h-[80px] outline-none focus:border-accent2/60"
                />
              ) : (
                <input
                  ref={inputRef}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={dialog.placeholder}
                  className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-[13px] outline-none focus:border-accent2/60"
                />
              )}
            </div>
          )}

          <div className="flex gap-2.5 w-full mt-5">
            {kind !== 'alert' && (
              <button
                onClick={cancel}
                className="flex-1 py-2.5 rounded-lg border border-border text-[13px] font-semibold text-text2 hover:text-text hover:bg-text/5 transition"
              >
                {dialog.cancelText || 'Batal'}
              </button>
            )}
            <button
              ref={confirmRef}
              onClick={confirm}
              disabled={blocked}
              className="flex-1 py-2.5 rounded-lg text-[13px] font-bold text-text transition active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: meta.color }}
            >
              {dialog.confirmText || 'Oke'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
