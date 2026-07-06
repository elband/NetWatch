// Render dokumen ke PDF asli memakai Puppeteer (headless Chrome). Membuka halaman cetak
// publik frontend (/doc-print?token=…) yang me-reuse logika render dokumen, lalu page.pdf().
//
// Browser di-launch sekali (singleton) dan dipakai ulang antar-request; akan di-relaunch
// otomatis bila proses Chromium mati/terputus.
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_ROOT = path.join(__dirname, '..', '..', 'uploads');

let browserPromise = null;

// Gabungkan lampiran PDF (surat_lampiran) ke AKHIR PDF utama memakai pdf-lib, agar
// isi lampiran ikut di file unduhan TTE (Puppeteer tidak bisa me-render iframe PDF).
// `lampiran`: array {file_url, mimetype}; hanya application/pdf yang digabung.
// Fail-soft: bila pdf-lib tak ada / file rusak → kembalikan PDF utama apa adanya.
export async function mergeAttachmentPdfs(mainBuffer, lampiran = []) {
  const pdfs = (lampiran || []).filter((l) => l?.mimetype === 'application/pdf' && l.file_url);
  if (!pdfs.length) return mainBuffer;
  let PDFDocument;
  try { ({ PDFDocument } = await import('pdf-lib')); }
  catch { logger?.warn?.('pdf-lib belum terpasang — lampiran PDF tidak digabung'); return mainBuffer; }
  try {
    const out = await PDFDocument.load(mainBuffer);
    for (const l of pdfs) {
      try {
        const rel = String(l.file_url).replace(/^\/?uploads\//, '');
        const bytes = await fs.readFile(path.join(UPLOADS_ROOT, rel));
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages = await out.copyPages(src, src.getPageIndices());
        for (const pg of pages) out.addPage(pg);
      } catch (e) { logger?.warn?.({ err: e?.message, file: l.file_url }, 'Gagal menggabungkan satu lampiran PDF'); }
    }
    return Buffer.from(await out.save());
  } catch (e) {
    logger?.warn?.({ err: e?.message }, 'Gagal merge lampiran PDF — kirim PDF utama saja');
    return mainBuffer;
  }
}

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
