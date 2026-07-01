import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

// =============================================================================
// siKerenService — API keluar ke aplikasi SiKeren (SI-Keren BLU) untuk verifikasi
// dokumen Laporan Bulanan a.n. Kepala Seksi (Murdoko).
//
// Autentikasi: API Key di header (SIKEREN_API_KEY / SIKEREN_API_KEY_HEADER).
// Kiriman: berkas PDF laporan (multipart) + metadata + tautan verifikasi publik.
//
// CATATAN: nama field & bentuk response mengikuti default yang wajar. Bila kontrak
// API SiKeren berbeda, sesuaikan `verifyPath` (env) dan pemetaan field di bawah.
// =============================================================================

export function isSiKerenConfigured() {
  return Boolean(env.siKeren.baseUrl && env.siKeren.apiKey);
}

/**
 * Kirim dokumen ke SiKeren untuk diverifikasi.
 * @param {object} p
 * @param {Buffer} p.pdfBuffer  berkas PDF laporan
 * @param {string} p.filename   nama berkas (mis. laporan-2026-07.pdf)
 * @param {object} p.metadata   { nomor, periode, hal, penandatangan_nama, penandatangan_nip, ... }
 * @param {string} [p.verifyUrl] tautan verifikasi publik NetWatch
 * @returns {Promise<{ ok: boolean, status: number, ref?: string, url?: string, raw?: any }>}
 */
export async function sendToSiKeren({ pdfBuffer, filename, metadata = {}, verifyUrl = '' }) {
  if (!isSiKerenConfigured()) {
    throw new Error('Integrasi SiKeren belum dikonfigurasi (SIKEREN_BASE_URL & SIKEREN_API_KEY di .env).');
  }
  const url = `${env.siKeren.baseUrl}${env.siKeren.verifyPath}`;

  const form = new FormData();
  // Berkas PDF (field "file"). Blob tersedia global di Node 18+.
  form.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), filename || 'dokumen.pdf');
  // Metadata + akun tujuan + tautan verifikasi publik.
  if (env.siKeren.account) form.append('account', env.siKeren.account);
  if (verifyUrl) form.append('verify_url', verifyUrl);
  for (const [k, v] of Object.entries(metadata)) {
    if (v != null && v !== '') form.append(k, String(v));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { [env.siKeren.apiKeyHeader]: env.siKeren.apiKey, Accept: 'application/json' },
      body: form,
      signal: controller.signal,
    });
    let raw = null;
    try { raw = await res.json(); } catch { /* response bukan JSON */ }
    if (!res.ok) {
      const msg = raw?.message || raw?.error || `SiKeren menolak (HTTP ${res.status}).`;
      throw new Error(msg);
    }
    // Pemetaan lentur: ambil ref/token & url verifikasi dari beberapa kemungkinan nama field.
    const ref = raw?.ref || raw?.id || raw?.document_id || raw?.token || null;
    const vurl = raw?.url || raw?.verify_url || raw?.document_url || null;
    return { ok: true, status: res.status, ref, url: vurl, raw };
  } catch (e) {
    logger.error({ err: e?.message || String(e) }, '[siKeren] gagal kirim dokumen');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
