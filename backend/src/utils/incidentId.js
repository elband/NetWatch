import { pool } from '../db/pool.js';

// ID insiden berikutnya: 'INC-NNN' dari MAX nomor urut + 1 (BUKAN COUNT).
// COUNT+1 rapuh: bila ada insiden yang pernah dihapus / ID tidak berurutan, hasilnya
// bisa bentrok dengan ID yang masih ada → INSERT gagal (duplicate key) dan, pada
// ping sweep, menggagalkan seluruh siklus pemantauan. MAX+1 selalu menghasilkan
// nomor di atas semua yang ada. Terima `conn` (transaksi) atau pakai pool default.
export async function nextIncidentId(conn = pool) {
  const [rows] = await conn.query(
    "SELECT COALESCE(MAX(CAST(SUBSTRING(id, 5) AS UNSIGNED)), 0) + 1 AS n FROM incidents WHERE id REGEXP '^INC-[0-9]+$'"
  );
  return 'INC-' + String(rows[0].n).padStart(3, '0');
}
