import { useState } from 'react';

// Halaman dokumentasi API NetWatch (statis) — untuk integrator eksternal (mis. SiKeren):
// API verifikasi dokumen publik + integrasi keluar SiKeren. Tidak memanggil backend.

const METHOD_CLS: Record<string, string> = {
  GET: 'text-success bg-success/15 border-success/40',
  POST: 'text-accent2 bg-accent2/15 border-accent2/40',
};

function Method({ m }: { m: string }) {
  return <span className={`inline-block px-2 py-0.5 rounded border text-[10px] font-bold font-mono ${METHOD_CLS[m] || 'text-text2 border-border'}`}>{m}</span>;
}

function Code({ children }: { children: React.ReactNode }) {
  return <pre className="bg-surface2 border border-border rounded-md p-3 text-[11px] font-mono overflow-x-auto whitespace-pre">{children}</pre>;
}

function Endpoint({ method, path, auth, desc, children }: { method: string; path: string; auth: string; desc: string; children?: React.ReactNode }) {
  return (
    <div className="border border-border rounded-lg p-3.5 bg-surface">
      <div className="flex items-center gap-2 flex-wrap">
        <Method m={method} />
        <code className="text-[12px] font-mono font-semibold break-all">{path}</code>
        <span className="text-[10px] text-text2 ml-auto">🔒 {auth}</span>
      </div>
      <p className="text-[11px] text-text2 mt-2">{desc}</p>
      {children && <div className="mt-2 space-y-2">{children}</div>}
    </div>
  );
}

export default function ApiDocs() {
  const base = typeof window !== 'undefined' ? window.location.origin : 'https://netwatch.example';
  const [tab, setTab] = useState<'verify' | 'sikeren'>('verify');

  return (
    <div>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="text-[17px] font-bold">🔌 Dokumentasi API</div>
        <div className="flex gap-1 bg-surface2 border border-border rounded-lg p-1">
          <button onClick={() => setTab('verify')} className={`px-3 py-1.5 text-xs rounded-md ${tab === 'verify' ? 'bg-accent text-bg font-semibold' : 'text-text2'}`}>Verifikasi Dokumen</button>
          <button onClick={() => setTab('sikeren')} className={`px-3 py-1.5 text-xs rounded-md ${tab === 'sikeren' ? 'bg-accent text-bg font-semibold' : 'text-text2'}`}>Integrasi SiKeren</button>
        </div>
      </div>
      <p className="text-[11px] text-text2 mb-4">Base URL: <code className="font-mono bg-surface2 border border-border rounded px-1.5 py-0.5">{base}</code></p>

      {tab === 'verify' && (
        <div className="space-y-3">
          <div className="bg-accent2/5 border border-accent2/20 rounded-lg p-3 text-[11px] text-text2">
            API <b>publik</b> (tanpa autentikasi) untuk memverifikasi keaslian dokumen ber-TTE NetWatch (Nota Dinas, Laporan Bulanan, LKP, Surat Pernyataan). Cukup gunakan <code className="font-mono">token</code> yang tertera pada QR / dokumen. Dipakai antara lain oleh SiKeren untuk mengecek dokumen Laporan Bulanan.
          </div>

          <Endpoint method="GET" path="/api/verify-tte/:token" auth="Publik (tanpa auth)" desc="Periksa validitas token TTE & ambil ringkasan dokumen (nomor, hal, penanda tangan, waktu).">
            <div className="text-[10px] text-text2 font-semibold">Contoh respons — valid</div>
            <Code>{`{
  "valid": true,
  "jenis": "Nota Dinas",
  "token": "NS1A2B...",
  "nomor": "PL.108/.../APTP/2026",
  "hal": "Laporan Bulanan Juli 2026",
  "signer_name": "PRAYUDA ELFANDRO",
  "signer_nip": "19930311 202203 1 008",
  "signed_at": "2026-07-01T09:00:00.000Z"
}`}</Code>
            <div className="text-[10px] text-text2 font-semibold">Tidak valid</div>
            <Code>{`{ "valid": false }`}</Code>
          </Endpoint>

          <Endpoint method="GET" path="/api/verify-tte/:token/doc-data" auth="Publik (tanpa auth)" desc="Data lengkap dokumen (untuk merender ulang halaman cetak). JSON isi dokumen sesuai jenisnya." />

          <Endpoint method="GET" path="/api/verify-tte/:token/document.pdf" auth="Publik (tanpa auth)" desc="Unduh berkas PDF resmi dokumen (dirender server). Content-Type: application/pdf.">
            <div className="text-[10px] text-text2 font-semibold">Contoh</div>
            <Code>{`curl -L "${base}/api/verify-tte/NS1A2B.../document.pdf" -o laporan.pdf`}</Code>
          </Endpoint>
        </div>
      )}

      {tab === 'sikeren' && (
        <div className="space-y-3">
          <div className="bg-accent2/5 border border-accent2/20 rounded-lg p-3 text-[11px] text-text2">
            Integrasi <b>keluar</b> NetWatch → SiKeren (SI-Keren BLU): saat Laporan Bulanan disahkan (TTE) atau tombol <b>Kirim ke SiKeren</b> ditekan, NetWatch mengirim berkas PDF + metadata ke SiKeren untuk verifikasi a.n. Kepala Seksi. Autentikasi: <b>API Key</b> di header.
          </div>

          <div className="border border-border rounded-lg p-3.5 bg-surface">
            <div className="text-xs font-semibold mb-2">Konfigurasi server (<code className="font-mono">backend/.env</code>)</div>
            <Code>{`SIKEREN_BASE_URL=https://sikeren.contoh.go.id
SIKEREN_VERIFY_PATH=/api/v1/documents/verify
SIKEREN_API_KEY=xxxxxxxx          # rahasia — jangan commit
SIKEREN_API_KEY_HEADER=X-API-Key
SIKEREN_ACCOUNT=murdoko           # id/akun tujuan (opsional)`}</Code>
            <p className="text-[10px] text-text2 mt-2">Kosongkan <code className="font-mono">SIKEREN_API_KEY</code> untuk menonaktifkan integrasi.</p>
          </div>

          <Endpoint method="POST" path="{SIKEREN_BASE_URL}{SIKEREN_VERIFY_PATH}" auth="API Key (header) — dikirim oleh NetWatch" desc="Request yang DIKIRIM NetWatch ke SiKeren. multipart/form-data.">
            <div className="text-[10px] text-text2 font-semibold">Header</div>
            <Code>{`X-API-Key: <SIKEREN_API_KEY>
Accept: application/json`}</Code>
            <div className="text-[10px] text-text2 font-semibold">Body (multipart/form-data)</div>
            <Code>{`file           : <berkas PDF laporan>
account        : murdoko
verify_url     : ${base}/verify-tte?token=NS1A2B...
jenis          : Nota Dinas
nomor          : PL.108/.../APTP/2026
hal            : Laporan Bulanan Juli 2026
periode        : 2026-07
penandatangan_nama : PRAYUDA ELFANDRO
penandatangan_nip  : 19930311 202203 1 008
verifikator_nama   : MURDOKO
verifikator_nip    : 19780319 200012 1 001`}</Code>
            <div className="text-[10px] text-text2 font-semibold">Respons yang diharapkan (fleksibel)</div>
            <Code>{`{ "ref": "SK-2026-0001", "url": "https://sikeren.../doc/SK-2026-0001" }`}</Code>
            <p className="text-[10px] text-text2">NetWatch membaca <code className="font-mono">ref/id/document_id/token</code> dan <code className="font-mono">url/verify_url/document_url</code> dari respons. Bila kontrak berbeda, sesuaikan pemetaan di <code className="font-mono">services/siKerenService.js</code>.</p>
          </Endpoint>

          <Endpoint method="POST" path="/api/surat/:id/kirim-sikeren" auth="Login (koordinator/admin)" desc="Endpoint internal NetWatch untuk memicu pengiriman manual sebuah surat (Laporan Bulanan ber-TTE) ke SiKeren.">
            <div className="text-[10px] text-text2 font-semibold">Respons</div>
            <Code>{`{ "surat": { ...sikeren_status: "terkirim", sikeren_ref, sikeren_url... },
  "sikeren": { "ok": true, "ref": "SK-2026-0001", "url": "..." } }`}</Code>
          </Endpoint>
        </div>
      )}
    </div>
  );
}
