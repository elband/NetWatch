import { pool } from '../db/pool.js';

// Fase 4: identitas surat per unit. `lkp` efektif = global settings.lkp ditimpa
// oleh override per-unit (units.config) HANYA untuk field per-unit di bawah.
// Field kantor/atasan (bandara, kota, kasie_*) tetap global.
export const PER_UNIT_LKP_FIELDS = ['nd_kode', 'kop_url', 'unit', 'koord_nama', 'koord_nip', 'koord_jabatan', 'nd_dari', 'nd_yth'];

// Baca units.config (JSON) untuk satu unit. Kembalikan objek ({} bila kosong).
export async function getUnitConfig(unitId) {
  if (unitId == null) return {};
  const [[row]] = await pool.query('SELECT config FROM units WHERE id = ? LIMIT 1', [unitId]);
  if (!row?.config) return {};
  try { return typeof row.config === 'string' ? JSON.parse(row.config) : row.config; } catch { return {}; }
}

// Tulis kembali units.config (JSON) untuk satu unit.
export async function writeUnitConfig(unitId, config) {
  await pool.query('UPDATE units SET config = ? WHERE id = ?', [JSON.stringify(config), unitId]);
}

// Gabung: hanya field per-unit yang diisi (non-kosong) yang menimpa global.
export function mergeUnitLkp(globalLkp, unitConfig) {
  const out = { ...(globalLkp || {}) };
  for (const k of PER_UNIT_LKP_FIELDS) {
    const v = unitConfig?.[k];
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

// lkp efektif untuk sebuah unit (dipakai penomoran & render dokumen).
export async function effectiveLkp(globalLkp, unitId) {
  return mergeUnitLkp(globalLkp, await getUnitConfig(unitId));
}
