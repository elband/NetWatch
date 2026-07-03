# Audit Keamanan NetWatch — 2026-07-03

Audit menyeluruh `backend/src` atas permintaan pengelola. Metode: 3 telaah paralel
(isolasi lintas-unit · auth & endpoint publik · injection/upload/secrets/SSRF),
lalu **verifikasi manual di kode** untuk setiap temuan sebelum dicatat, dan uji
smoke E2E untuk memastikan perbaikan berjalan tanpa merusak fungsi sah.

## Kesimpulan utama
✅ **Tidak ada kebocoran data lintas unit.** Isolasi ELB↔AAB (multi-unit) diterapkan
konsisten di seluruh 30 route + 10 controller: list difilter unit, akses by-id cek
`rowInUnit` (anti-IDOR), INSERT ambil `unit_id` dari server, non-admin dikunci ke
unitnya (header `X-Unit-Id` diabaikan). Modul baru (aset, sparepart, obat air,
checklist, PM, laporan AAB) semua ter-scope benar.

Audit menemukan isu keamanan lain (bukan lintas-unit); **semuanya sudah diperbaiki**
di branch `security-hardening`.

## Temuan & status

| # | Tingkat | Temuan | Berkas | Status |
|---|---|---|---|---|
| 1 | Tinggi | **SSRF** — teknisi menyetel `check_url`/`check_type` device tanpa validasi; ping worker `fetch(redirect:'follow')` + probe SNMP ke IP apa pun → oracle scan internal & endpoint metadata cloud | `controllers/deviceController.js`, `services/monitorProbe.js`, `routes/deviceRoutes.js` | ✅ Diperbaiki |
| 2 | Menengah-Tinggi | **Stored-XSS** via unggahan dokumen tanpa `fileFilter` (terima `.html`/`.svg`/`.js`), disajikan inline dari `/uploads`; filter kop/peta terima `image/svg+xml` | `routes/dokumenRoutes.js`, `routes/masterRoutes.js`, `routes/unitRoutes.js` | ✅ Diperbaiki |
| 3 | Menengah | **Brute-force login PIN** — satu PIN dicocokkan ke seluruh user; PIN valid apa pun = login sebagai pemiliknya | `controllers/authController.js`, `routes/authRoutes.js`, `middleware/rateLimit.js` | ✅ Dimitigasi |
| 4 | Rendah | Role `viewer` bisa mengubah/menghapus foto & menyelesaikan jendela maintenance | `routes/maintenanceRoutes.js`, `routes/equipmentRoutes.js` | ✅ Diperbaiki |
| 5 | Rendah | Halaman publik bukti SKP menautkan laporan bulanan tanpa filter unit | `routes/skpRoutes.js` | ✅ Diperbaiki |

### Rincian perbaikan
1. **SSRF:** `probeHttp` kini `redirect:'manual'`, wajib skema `http/https`, dan menolak host metadata cloud/link-local (`169.254.0.0/16`, `metadata.google.internal`, `0.0.0.0`). `deviceController` memvalidasi `check_url` saat create **dan** update (400 bila terlarang). **RFC1918 privat sengaja tetap diizinkan** — NetWatch memang memantau perangkat jaringan internal; memblokirnya akan merusak fungsi inti.
2. **Upload:** `dokumenRoutes` diberi allow-list MIME (PDF/gambar raster/Office/teks/zip) + pembungkus error → 400 rapi; `svg+xml` dikeluarkan dari filter kop & peta.
3. **PIN:** limiter khusus `pinLimiter` (5 percobaan/15 mnt di prod) pada `/login-pin`; PIN **baru** wajib 6 digit (keyspace 1 juta; login lama 4–6 tetap diterima agar user existing tak terkunci). *Sisa risiko:* login berbasis PIN-saja secara inheren lebih lemah — pertimbangkan username+PIN ke depan.
4. **Role maintenance:** `POST/DELETE /photos` & `PUT /:id/complete` (di maintenanceRoutes & equipmentRoutes) kini `requireRole('admin','koordinator','teknisi')`.
5. **SKP publik:** `signedLaporanBulanan` dipanggil dengan `skp.unit_id` pemilik bukti.

## Diperiksa & AMAN (tanpa aksi)
- **SQL injection:** semua query pakai placeholder `?`; interpolasi hanya nama kolom hardcoded/whitelist (`ORDER BY`, `unitFilter`, INFORMATION_SCHEMA di migrasi) — bukan input user. `escapeLike` benar.
- **Secrets:** prod menolak `JWT_SECRET` lemah & `DB_PASSWORD` kosong; tak ada kredensial hardcoded/ter-log; kunci WA/SiKeren dari env, URL keluar bukan dari input user.
- **JWT/sesi:** HS256 dipin, cookie `httpOnly+secure+sameSite:strict` (prod), user nonaktif/pindah-unit ditolak segera.
- **Eskalasi hak:** `updateUser`/`coordGuard` mencegah koordinator menyentuh admin, memberi role admin, atau memindah user antar unit; `loginAs` khusus admin + audit.
- **Endpoint publik** (verify-tte, ttd, aset/public, rooms/public, skp/public, units/public, public-reports): token acak/HMAC ~88–128 bit, hanya data non-sensitif/ter-publikasi.
- **Unggahan lain** (insiden/inspeksi/aset/absensi/avatar/maintenance): allow-list MIME + nama file server-side (tanpa path traversal).
- **CORS/rate-limit/error handler:** origin tunggal ber-credential, `apiLimiter` seluruh `/api`, error handler tanpa bocor stack.

## Catatan laten (belum eksploitabel, pantau)
- `requirePerm` (`middleware/auth.js`) tidak dipakai route mana pun, sementara koordinator bisa menulis `perms` sembarang → begitu suatu fitur digating `requirePerm`, koordinator bisa memberi izin itu ke dirinya. Bila mulai memakai `requirePerm`, batasi penulisan `perms` ke admin saja.
- Token TTD/tanda-tangan publik bersifat permanen tanpa kedaluwarsa ("pegang link = wewenang"). By-design; pertimbangkan kedaluwarsa/OTP bila diperlukan kepatuhan.
