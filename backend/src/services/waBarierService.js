import { env } from '../config/env.js';

export async function sendWaBarierMessage(phone, message) {
  if (!env.waBarier.apiKey) {
    throw new Error('WABARIER_API_KEY belum diset di .env — pesan tidak benar-benar terkirim');
  }
  if (!env.waBarier.sessionId) {
    throw new Error('WABARIER_SESSION_ID belum diset di .env');
  }
  if (!phone) {
    throw new Error('Nomor WhatsApp tujuan tidak tersedia');
  }
  const url = `${env.waBarier.baseUrl}/sessions/${encodeURIComponent(env.waBarier.sessionId)}/send/text`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'x-api-key': env.waBarier.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ target: phone, message }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.status === false) {
    throw new Error(data.error || data.reason || `WA Barier API error (HTTP ${resp.status})`);
  }
  return data;
}
