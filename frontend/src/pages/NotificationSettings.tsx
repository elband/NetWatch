import { useEffect, useState } from 'react';
import { api } from '../api/client';

interface NotifEvent { key: string; label: string; roles: string[] }
type Prefs = Record<string, Record<string, boolean>>;

const ROLE_LABEL: Record<string, string> = { admin: 'Admin', koordinator: 'Koordinator', teknisi: 'Teknisi', viewer: 'Viewer' };

export default function NotificationSettings() {
  const [events, setEvents] = useState<NotifEvent[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [prefs, setPrefs] = useState<Prefs>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get('/notification-prefs').then((res) => {
      setEvents(res.data.events || []);
      setRoles(res.data.roles || []);
      setPrefs(res.data.prefs || {});
    });
  }, []);

  function toggle(eventKey: string, role: string) {
    const currentlyEnabled = prefs[eventKey]?.[role] !== false;
    setPrefs((p) => ({ ...p, [eventKey]: { ...p[eventKey], [role]: !currentlyEnabled } }));
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
        <p className="px-4 pt-3 text-[11px] text-text2">Centang setiap <b>peran</b> yang harus mendapat notifikasi WA untuk tiap kejadian. Bila tidak dicentang, peran tersebut tidak akan menerima notifikasi itu (tindakan/penalti pada sistem tetap berjalan seperti biasa). "—" berarti peran itu tidak relevan untuk kejadian tersebut.</p>
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-text2 border-b border-border">
                <th className="text-left px-4 py-2 sticky left-0 bg-surface">Kejadian</th>
                {roles.map((r) => (
                  <th key={r} className="text-center px-2 py-2 whitespace-nowrap">{ROLE_LABEL[r] || r}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => (
                <tr key={ev.key} className="border-b border-border/40">
                  <td className="px-4 py-2.5 sticky left-0 bg-surface">{ev.label}</td>
                  {roles.map((r) => {
                    const relevant = ev.roles.includes(r);
                    return (
                      <td key={r} className="text-center px-2 py-2.5">
                        {relevant ? (
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
                    );
                  })}
                </tr>
              ))}
              {events.length === 0 && (
                <tr><td colSpan={roles.length + 1} className="text-center text-text2 px-4 py-6">Memuat...</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="p-4 flex items-center gap-3">
          <button disabled={saving} className="bg-accent text-bg rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50" onClick={save}>💾 Simpan</button>
          {saved && <span className="text-success text-xs">Tersimpan ✅</span>}
        </div>
      </div>
    </div>
  );
}
