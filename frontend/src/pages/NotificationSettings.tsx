import { useEffect, useState } from 'react';
import { api } from '../api/client';

interface NotifEvent { key: string; label: string; roles: string[] }
interface NotifUser { id: number; name: string; role: string; roles: string[] | null }
type Prefs = Record<string, Record<number, boolean>>;

const ROLE_LABEL: Record<string, string> = { admin: 'Admin', koordinator: 'Koordinator', teknisi: 'Teknisi', viewer: 'Viewer' };

function userHasRole(u: NotifUser, role: string) {
  return u.role === role || (u.roles || []).includes(role);
}

export default function NotificationSettings() {
  const [events, setEvents] = useState<NotifEvent[]>([]);
  const [users, setUsers] = useState<NotifUser[]>([]);
  const [prefs, setPrefs] = useState<Prefs>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get('/notification-prefs').then((res) => {
      setEvents(res.data.events || []);
      setUsers(res.data.users || []);
      setPrefs(res.data.prefs || {});
    });
  }, []);

  function toggle(eventKey: string, userId: number) {
    const currentlyEnabled = prefs[eventKey]?.[userId] !== false;
    setPrefs((p) => ({ ...p, [eventKey]: { ...p[eventKey], [userId]: !currentlyEnabled } }));
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
        <p className="px-4 pt-3 text-[11px] text-text2">Centang setiap orang yang harus mendapat notifikasi WA untuk tiap kejadian. Bila tidak dicentang, orang tersebut tidak akan menerima notifikasi itu (tindakan/penalti pada sistem tetap berjalan seperti biasa). "—" berarti orang itu tidak relevan untuk kejadian tersebut.</p>
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-text2 border-b border-border">
                <th className="text-left px-4 py-2 sticky left-0 bg-surface">Kejadian</th>
                {users.map((u) => (
                  <th key={u.id} className="text-center px-2 py-2 whitespace-nowrap">
                    <div>{u.name}</div>
                    <div className="text-[9px] text-text2/70 font-normal">{ROLE_LABEL[u.role] || u.role}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => (
                <tr key={ev.key} className="border-b border-border/40">
                  <td className="px-4 py-2.5 sticky left-0 bg-surface">{ev.label}</td>
                  {users.map((u) => {
                    const relevant = ev.roles.some((r) => userHasRole(u, r));
                    return (
                      <td key={u.id} className="text-center px-2 py-2.5">
                        {relevant ? (
                          <input
                            type="checkbox"
                            className="w-4 h-4"
                            checked={prefs[ev.key]?.[u.id] !== false}
                            onChange={() => toggle(ev.key, u.id)}
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
                <tr><td colSpan={users.length + 1} className="text-center text-text2 px-4 py-6">Memuat...</td></tr>
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
