import { env } from '../config/env.js';
import { normalizeWaNumber } from '../utils/phone.js';

// Error yang TIDAK boleh di-retry oleh worker (key salah, nomor invalid, dsb).
// Mengulang error semacam ini hanya membuang percobaan dan berisiko kirim ganda
// bila suatu saat gateway merespons lambat setelah pesan sebenarnya terkirim.
export class WaPermanentError extends Error {
  constructor(message) { super(message); this.name = 'WaPermanentError'; this.permanent = true; }
}

// Kirim pesan teks via gateway WhatsApp internal (dibangun sendiri).
//   POST {baseUrl}/api/v1/messages/send
//   Header: X-API-Key: <key>
//   Body:   { to, body, deviceId? }
//   Respons sukses: { success: true, data: { id, status, to } }
export async function sendWaGatewayMessage(phone, message) {
  if (!env.waGateway.apiKey) {
    throw new WaPermanentError('WAGATEWAY_API_KEY belum diset di .env — pesan tidak benar-benar terkirim');
  }
  // Gateway menerima format "08…" maupun "628…" dan menormalisasi sendiri, tetapi kita
  // tetap normalisasi ke 628xxxx agar log konsisten & nomor yang invalid tertangkap dini.
  const to = normalizeWaNumber(phone);
  if (!to) {
    throw new WaPermanentError('Nomor WhatsApp tujuan tidak tersedia/format tidak valid');
  }

  const payload = { to, body: message };
  // deviceId opsional & harus integer. Bila API key gateway terikat ke default device,
  // biarkan kosong (gateway pakai device itu otomatis). Bila key TANPA default device,
  // WAGATEWAY_DEVICE_ID wajib diisi — jika tidak, gateway menolak dengan HTTP 400.
  if (env.waGateway.deviceId) payload.deviceId = Number(env.waGateway.deviceId);

  const url = `${env.waGateway.baseUrl.replace(/\/$/, '')}/api/v1/messages/send`;
  let resp;
  try {
    // Timeout 15s agar tidak menggantung bila gateway tak merespons.
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'X-API-Key': env.waGateway.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    // fetch gagal di level koneksi (DNS/firewall/TLS/timeout). `err.message` undici
    // hanya "fetch failed" — sertakan penyebab asli (err.cause) agar bisa didiagnosis.
    const cause = err?.cause?.code || err?.cause?.message || err?.code || err?.name;
    throw new Error(
      `Gagal menghubungi WA Gateway di ${url}: ${err?.message || 'fetch failed'}` +
      (cause ? ` (${cause})` : '')
    );
  }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.success !== true) {
    const msg = data.message || data.error || `WA Gateway API error (HTTP ${resp.status})`;
    // Klasifikasi permanen: kredensial/otorisasi salah (401/403) atau input tak valid
    // (400/404, atau pesan gateway yang menyebut "API Key"/"tidak valid"/"unauthorized").
    // Error ini tak akan sembuh dengan retry, jadi hentikan agar tak "mengirim terus".
    const permanentHttp = [400, 401, 403, 404, 422].includes(resp.status);
    const permanentMsg = /api\s*key|unauthorized|forbidden|tidak valid|invalid|not\s*found|nomor/i.test(msg);
    if (permanentHttp || permanentMsg) throw new WaPermanentError(msg);
    throw new Error(msg);
  }
  return data;
}
