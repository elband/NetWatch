// Masking PII untuk penyimpanan/log (mis. nomor telepon di wa_log).
// Nomor ASLI tetap dipakai untuk pengiriman (di payload job), hanya versi
// tersimpan/tampil yang disamarkan — mitigasi kebocoran data (UU PDP).
export function maskPhone(p) {
  const s = String(p ?? '').trim();
  if (!s) return null;
  if (s.length <= 6) return `${s.slice(0, 1)}***`; // terlalu pendek untuk dipotong rapi
  const head = s.slice(0, 4);
  const tail = s.slice(-2);
  return `${head}${'*'.repeat(s.length - 6)}${tail}`;
}
