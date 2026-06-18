import { pool } from '../db/pool.js';

// Hitung daftar layanan kritis dengan status LIVE dari perangkat.
// Layanan terhubung ke perangkat lewat kategori (device.category = service.name):
// semua perangkat online = OK, ada yang offline = terganggu. Layanan tanpa
// perangkat terkait memakai status manual yang tersimpan.
export async function computeServices() {
  const [rows] = await pool.query('SELECT * FROM services ORDER BY sort_order, id');
  const [devs] = await pool.query("SELECT category, status, icon FROM devices WHERE category IS NOT NULL AND category <> ''");
  const byCat = {};
  for (const d of devs) {
    const k = d.category.toLowerCase().trim();
    (byCat[k] ||= { name: d.category.trim(), total: 0, offline: 0, icon: null });
    byCat[k].total++;
    if (d.status === 'offline') byCat[k].offline++;
    if (!byCat[k].icon && d.icon) byCat[k].icon = d.icon; // ikon dari perangkat pertama yg punya
  }

  // Layanan manual: status mengikuti perangkat bila ada yang sekategori.
  const result = rows.map((s) => {
    const g = byCat[String(s.name).toLowerCase().trim()];
    if (!g) return { ...s, linked: 0 };
    const ok = g.offline === 0;
    return {
      ...s,
      is_ok: ok ? 1 : 0,
      status: ok ? 'Online' : 'Terganggu',
      detail: `${g.total - g.offline}/${g.total} perangkat online`,
      linked: g.total,
    };
  });

  // Kategori perangkat yang BELUM punya kartu layanan → otomatis jadi kartu.
  const known = new Set(rows.map((s) => String(s.name).toLowerCase().trim()));
  let autoId = -1;
  for (const k of Object.keys(byCat)) {
    if (known.has(k)) continue;
    const g = byCat[k];
    const ok = g.offline === 0;
    result.push({
      id: autoId--, name: g.name, icon: g.icon || '🗂️',
      is_ok: ok ? 1 : 0,
      status: ok ? 'Online' : 'Terganggu',
      detail: `${g.total - g.offline}/${g.total} perangkat online`,
      sort_order: 999, linked: g.total, auto: true,
    });
  }
  return result;
}
