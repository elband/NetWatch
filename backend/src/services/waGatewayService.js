import { env } from '../config/env.js';
import { normalizeWaNumber } from '../utils/phone.js';

// Kirim pesan teks via gateway WhatsApp internal (dibangun sendiri).
//   POST {baseUrl}/api/v1/messages/send
//   Header: X-API-Key: <key>
//   Body:   { to, body, deviceId? }
//   Respons sukses: { success: true, data: { id, status, to } }
export async function sendWaGatewayMessage(phone, message) {
  if (!env.waGateway.apiKey) {
    throw new Error('WAGATEWAY_API_KEY belum diset di .env — pesan tidak benar-benar terkirim');
  }
  // Gateway menerima format "08…" maupun "628…" dan menormalisasi sendiri, tetapi kita
  // tetap normalisasi ke 628xxxx agar log konsisten & nomor yang invalid tertangkap dini.
  const to = normalizeWaNumber(phone);
  if (!to) {
    throw new Error('Nomor WhatsApp tujuan tidak tersedia/format tidak valid');
  }

  const payload = { to, body: message };
  // deviceId opsional & harus integer. Bila API key gateway terikat ke default device,
  // biarkan kosong (gateway pakai device itu otomatis). Bila key TANPA default device,
  // WAGATEWAY_DEVICE_ID wajib diisi — jika tidak, gateway menolak dengan HTTP 400.
  if (env.waGateway.deviceId) payload.deviceId = Number(env.waGateway.deviceId);

  const url = `${env.waGateway.baseUrl.replace(/\/$/, '')}/api/v1/messages/send`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'X-API-Key': env.waGateway.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.success !== true) {
    throw new Error(data.message || data.error || `WA Gateway API error (HTTP ${resp.status})`);
  }
  return data;
}
