// Render dokumen ke PDF asli memakai Puppeteer (headless Chrome). Membuka halaman cetak
// publik frontend (/doc-print?token=…) yang me-reuse logika render dokumen, lalu page.pdf().
//
// Browser di-launch sekali (singleton) dan dipakai ulang antar-request; akan di-relaunch
// otomatis bila proses Chromium mati/terputus.
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

let browserPromise = null;

async function launchBrowser() {
  // Import dinamis agar backend tetap bisa start walau puppeteer belum terpasang
  // (fitur PDF baru aktif setelah `npm install`).
  const { default: puppeteer } = await import('puppeteer');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  browser.on('disconnected', () => { browserPromise = null; });
  return browser;
}

async function getBrowser() {
  if (!browserPromise) browserPromise = launchBrowser().catch((e) => { browserPromise = null; throw e; });
  return browserPromise;
}

// Render dokumen untuk sebuah token TTE menjadi Buffer PDF.
// Mengembalikan { buffer } atau melempar error.
export async function renderDocPdf(token) {
  const url = `${env.selfBaseUrl}/doc-print?token=${encodeURIComponent(token)}`;
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
    // Tunggu halaman cetak menandai dokumen siap (HTML + semua gambar selesai dimuat),
    // atau menandai error/invalid.
    await page.waitForFunction('window.__DOC_READY__ === true || window.__DOC_ERROR__ === true', { timeout: 30000 });
    const isError = await page.evaluate('window.__DOC_ERROR__ === true');
    if (isError) {
      const reason = await page.evaluate('window.__DOC_ERROR_MSG__ || "Dokumen tidak dapat dirender"');
      throw new Error(String(reason));
    }
    const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
    // page.pdf() mengembalikan Uint8Array; bungkus jadi Buffer agar res.send mengirim biner
    // (bukan men-JSON-kan array byte).
    return { buffer: Buffer.from(pdf) };
  } finally {
    await page.close().catch(() => {});
  }
}

// Tutup browser saat shutdown (opsional, dipanggil dari graceful shutdown).
export async function closePdfBrowser() {
  if (!browserPromise) return;
  try { const b = await browserPromise; await b.close(); } catch (e) { logger?.warn?.({ err: e }, 'Gagal menutup browser PDF'); }
  browserPromise = null;
}
