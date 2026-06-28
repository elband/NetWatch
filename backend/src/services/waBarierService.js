import { env } from '../config/env.js';
import { normalizeWaNumber } from '../utils/phone.js';

export async function sendWaBarierMessage(phone, message) {
  if (!env.waBarier.apiKey) {
    throw new Error('WABARIER_API_KEY belum diset di .env — pesan tidak benar-benar terkirim');
  }
  if (!env.waBarier.sessionId) {
    throw new Error('WABARIER_SESSION_ID belum diset di .env');
  }
  // Normalisasi ke format 628xxxx (gateway wwebjs tidak menerima "+"/"08…" → pesan
  // tampak terkirim tapi tidak sampai). Ini juga memperbaiki kasus nomor Kepala Seksi
  // yang biasanya disimpan dalam format "08…".
  const target = normalizeWaNumber(phone);
  if (!target) {
    throw new Error('Nomor WhatsApp tujuan tidak tersedia/format tidak valid');
  }
  const url = `${env.waBarier.baseUrl}/sessions/${encodeURIComponent(env.waBarier.sessionId)}/send/text`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.waBarier.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ target, message }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.status === false) {
    throw new Error(data.error || data.reason || `WA Barier API error (HTTP ${resp.status})`);
  }
  return data;
}
