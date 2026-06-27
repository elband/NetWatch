import { useEffect, useState } from 'react';
import { api } from '../api/client';

interface NotifEvent { key: string; label: string; roles: string[] }
type Prefs = Record<string, Record<string, boolean>>;

const ROLE_LABEL: Record<string, string> = { admin: 'Admin', koordinator: 'Koordinator', teknisi: 'Teknisi' };
const ROLES = ['admin', 'koordinator', 'teknisi'];

export default function NotificationSettings() {
  const [events, setEvents] = useState<NotifEvent[]>([]);
  const [prefs, setPrefs] = useState<Prefs>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get('/notification-prefs').then((res) => {
      setEvents(res.data.events || []);
      setPrefs(res.data.prefs || {});
    });
  }, []);

  function toggle(eventKey: string, role: string) {
    setPrefs((p) => ({ ...p, [eventKey]: { ...p[eventKey], [role]: !p[eventKey]?.[role] } }));
  }

  async function save() {
    setSaving(true);
    try {
      await api.put('/notification-prefs', { prefs });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="mb-4"><div className="text-[17px] font-bold">🔔 Pengaturan Notifikasi</div></div>
      <div className="bg-surface border border-border rounded-[10px] overflow-hidden">
        <div className="px-4 py-3 border-b border-border text-[13px] font-semibold">Daftar Notifikasi WhatsApp</div>
        <p className="px-4 pt-3 text-[11px] text-text2">Centang penerima yang harus mendapat notifikasi WA untuk tiap kejadian. Bila tidak dicentang, peran tersebut tidak akan menerima notifikasi (tindakan/penalti pada sistem tetap berjalan seperti biasa).</p>
        <table className="w-full text-[12px] mt-2">
          <thead>
            <tr className="text-text2 border-b border-border">
              <th className="text-left px-4 py-2">Kejadian</th>
              {ROLES.map((r) => <th key={r} className="text-center px-3 py-2">{ROLE_LABEL[r]}</th>)}
            </tr>
          </thead>
          <tbody>
            {events.map((ev) => (
              <tr key={ev.key} className="border-b border-border/40">
                <td className="px-4 py-2.5">{ev.label}</td>
                {ROLES.map((r) => (
                  <td key={r} className="text-center px-3 py-2.5">
                    {ev.roles.includes(r) ? (
                      <input
                        type="checkbox"
                        className="w-4 h-4"
                        checked={prefs[ev.key]?.[r] !== false}
                        onChange={() => toggle(ev.key, r)}
                      />
                    ) : (
                      <span className="text-text2/40">—</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {events.length === 0 && (
              <tr><td colSpan={ROLES.length + 1} className="text-center text-text2 px-4 py-6">Memuat...</td></tr>
            )}
          </tbody>
        </table>
        <div className="p-4 flex items-center gap-3">
          <button disabled={saving} className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50" onClick={save}>💾 Simpan</button>
          {saved && <span className="text-success text-xs">Tersimpan ✅</span>}
        </div>
      </div>
    </div>
  );
}
