// Normalisasi nomor telepon Indonesia ke format internasional tanpa "+" (mis. 628xxxx)
// yang dibutuhkan gateway WA Barier (wwebjs). Menangani input "+62…", "62…", "08…", "8…".
// Mengembalikan string kosong bila tidak ada digit.
export function normalizeWaNumber(raw) {
  let p = String(raw ?? '').replace(/[^\d]/g, ''); // buang +, spasi, tanda hubung, dll.
  if (!p) return '';
  if (p.startsWith('0')) p = '62' + p.slice(1); // 08xx → 628xx
  else if (p.startsWith('62')) { /* sudah internasional */ }
  else if (p.startsWith('8')) p = '62' + p; // 8xx (tanpa prefix) → 628xx
  return p;
}
