import { pool } from '../db/pool.js';

// Catat jejak audit (best-effort, tidak menggagalkan request bila error).
export async function audit(actor, action, targetType, targetId, detail) {
  try {
    await pool.query(
      'INSERT INTO audit_log (actor_id, actor_name, action, target_type, target_id, detail) VALUES (?,?,?,?,?,?)',
      [actor?.id ?? null, actor?.name ?? null, action, targetType ?? null, targetId != null ? String(targetId) : null, (detail ?? '').slice(0, 255) || null]
    );
  } catch { /* abaikan */ }
}
