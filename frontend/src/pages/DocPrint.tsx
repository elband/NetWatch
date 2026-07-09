// Halaman cetak publik. Membangun HTML dokumen lengkap (sama persis dengan hasil "Cetak"
// di Surat Keluar) dari data publik token, lalu menulisnya ke seluruh halaman. Dipakai oleh
// Puppeteer (lihat backend services/pdfRenderer.js) untuk menghasilkan PDF asli, dan bisa
// juga dibuka langsung manusia. Menandai window.__DOC_READY__ saat dokumen siap dirender.
import { useEffect } from 'react';
import { api } from '../api/client';
import type { Surat, Incident } from '../types';
import type { LaporanData } from '../utils/laporanReport';
import type { AabReportData } from '../utils/aabReport';
import { buildDocHtml, LKP_DEFAULT } from '../utils/docTemplates';

declare global {
  interface Window {
    __DOC_READY__?: boolean;
    __DOC_ERROR__?: boolean;
    __DOC_ERROR_MSG__?: string;
  }
}

// Tunggu semua gambar (kop, QR, foto bukti) selesai dimuat agar PDF tidak terpotong.
function waitForImages(): Promise<void> {
  const imgs = Array.from(document.images);
  return Promise.all(
    imgs.map((img) => (img.complete ? Promise.resolve() : new Promise<void>((resolve) => {
      img.addEventListener('load', () => resolve(), { once: true });
      img.addEventListener('error', () => resolve(), { once: true });
    }))),
  ).then(() => undefined);
}

export default function DocPrint() {
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token') || '';
    (async () => {
      try {
        if (!token) throw new Error('Token verifikasi tidak ada pada URL.');
        const { data } = await api.get(`/verify-tte/${encodeURIComponent(token)}/doc-data`);
        if (!data?.valid || !data.surat) throw new Error('Dokumen tidak ditemukan untuk token ini.');

        const lkp = { ...LKP_DEFAULT, ...(data.lkp || {}) };
        const incident = (data.incident as Incident | null) ?? null;
        const laporan = (data.laporan as LaporanData | AabReportData | null) ?? null;
        const html = await buildDocHtml(data.surat as Surat, {
          lkp,
          origin: window.location.origin,
          fetchIncident: async () => incident,
          fetchLaporan: async () => laporan,
          reportKind: data.report_kind,
        });

        // Ganti seluruh dokumen dengan HTML siap-cetak.
        document.open();
        document.write(html);
        document.close();

        await waitForImages();
        window.__DOC_READY__ = true;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Gagal memuat dokumen.';
        window.__DOC_ERROR_MSG__ = msg;
        window.__DOC_ERROR__ = true;
        try {
          document.open();
          document.write(`<div style="font-family:system-ui,sans-serif;padding:32px;color:#b91c1c">⚠️ ${msg}</div>`);
          document.close();
        } catch { /* abaikan */ }
      }
    })();
  }, []);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 32, color: '#475569' }}>
      Menyiapkan dokumen…
    </div>
  );
}
