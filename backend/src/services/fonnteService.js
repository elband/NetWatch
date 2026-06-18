import { env } from '../config/env.js';

export async function sendFonnteMessage(phone, message) {
  if (!env.fonnte.token) {
    throw new Error('FONNTE_TOKEN belum diset di .env — pesan tidak benar-benar terkirim');
  }
  if (!phone) {
    throw new Error('Nomor WhatsApp tujuan tidak tersedia');
  }
  const resp = await fetch(env.fonnte.apiUrl, {
    method: 'POST',
    headers: {
      Authorization: env.fonnte.token,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ target: phone, message }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.status === false) {
    throw new Error(data.reason || `Fonnte API error (HTTP ${resp.status})`);
  }
  return data;
}
