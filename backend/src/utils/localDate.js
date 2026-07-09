// Tanggal 'YYYY-MM-DD' pada zona waktu LOKAL server (WITA). Pakai ini untuk default
// "hari ini" pada pencatatan — JANGAN `new Date().toISOString()` yang SELALU UTC, karena
// sebelum ~08:00 pagi di WITA (UTC+8) tanggalnya masih kemarin → salah hari.
// Selaras dengan dateKey() di config/shifts.js.
export function localDate(d = new Date()) {
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
