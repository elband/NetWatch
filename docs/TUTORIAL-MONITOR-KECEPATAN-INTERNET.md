# Tutorial: Monitor Kecepatan Internet (Total Trafik) via SNMP

Panduan menampilkan **kecepatan internet real-time** (↓ download / ↑ upload Mbps yang
sedang berjalan) di panel **INTERNET / UPLINK** Wallboard NOC — termasuk kasus di mana
Mikrotik utama ber-IP publik dan **tidak bisa di-SNMP langsung**.

---

## 1. Konsep singkat

NetWatch membaca kecepatan dari counter interface uplink Mikrotik via **SNMP**
(`ifHCInOctets` / `ifHCOutOctets`), diambil tiap 5 detik lalu dihitung selisihnya jadi
laju bps. Karena **semua** trafik internet melewati **satu jalur uplink**, memantau satu
interface itu = **total trafik seluruh unit** yang sedang berjalan.

### Kenapa butuh "SNMP Host"

Contoh topologi (bandara):

```
ISP ──(SFP)──> Mikrotik UTAMA ─────> Mikrotik SUB ─────> Server NetWatch + LAN
              IP publik 103.210.122.2   pengalamatan IP    192.168.50.165
                                        10.10.30.254        (di balik Sub)
```

- **Status "Internet UP"** paling benar di-ping ke **Mikrotik Utama (IP publik)** — kalau
  ISP putus, IP ini mati.
- **SNMP kecepatan** tidak bisa ke Utama: server berada di balik Sub yang meng-NAT, jadi
  Utama melihat sumber query bukan `192.168.50.165` dan menolaknya. Tapi trafik yang sama
  bisa dibaca dari **Mikrotik Sub** yang sejalur & mudah dijangkau di LAN.

Solusinya: satu perangkat "Mikrotik Utama" dengan **IP tetap publik** (untuk ping status),
tapi **SNMP Host** diarahkan ke **Sub** (untuk baca kecepatan). Field `SNMP Host` memisahkan
alamat *ping* dari alamat *SNMP*.

> Ganti semua IP contoh di bawah sesuai jaringan Anda.

---

## 2. Langkah di NetWatch

**Perangkat → Edit "Mikrotik Utama"**

1. **IP**: biarkan `103.210.122.2` (IP publik — ini yang di-ping untuk status internet).
2. Centang **📊 Aktifkan SNMP**.
   - **SNMP Community**: `public`
   - **SNMP Port**: `161`
   - **SNMP Host (opsional)**: **`10.10.30.254`** ← IP LAN Mikrotik **Sub**.
3. Centang **🌐 Sumber Internet / Uplink (Mikrotik)** (satu per unit).
4. **ifIndex** diisi lewat tombol Deteksi Interface (Langkah 4). Jangan tebak manual.
5. Klik **Simpan** (boleh disimpan dulu sebelum deteksi interface).

> Ping/status tetap ke IP perangkat (`103.210.122.2`). Semua query SNMP (kecepatan, CPU/RAM,
> Deteksi Interface) otomatis diarahkan ke **SNMP Host** (`10.10.30.254`).

---

## 3. Langkah di Mikrotik SUB (`10.10.30.254`)

Aktifkan SNMP dan izinkan hanya server NetWatch (`192.168.50.165`).

```routeros
# 1. Aktifkan service SNMP
/snmp set enabled=yes

# 2. Community read-only, dikunci ke IP server NetWatch (JANGAN pakai tanda < >)
/snmp community set [find default=yes] name=public addresses=192.168.50.165/32

# 3. (bila chain input ketat) izinkan SNMP UDP 161 dari server — taruh di atas rule drop
/ip firewall filter add chain=input protocol=udp dst-port=161 \
    src-address=192.168.50.165 action=accept comment="SNMP NetWatch" place-before=0
```

Cek hasil:

```routeros
/snmp print
/snmp community print
```

`enabled: yes` dan community `public` beralamat `192.168.50.165/32` = beres.

---

## 4. Deteksi Interface & pilih ifIndex

> **Penting:** jalankan dari **server NetWatch (`192.168.50.165`)** — itu satu-satunya IP
> yang diizinkan community. Kalau dijalankan dari laptop/PC lain, Mikrotik menolak dan muncul
> "SNMP tidak merespons".

1. **Perangkat → Edit "Mikrotik Utama"** → klik **🔎 Deteksi Interface**.
2. Muncul daftar interface Mikrotik **Sub** (nama · status up/down · link Mbps).
3. Pilih **port Sub yang mengarah ke Mikrotik Utama** (jalur ke internet). Kalau ragu, lihat
   komentar/nama interface atau yang link-speed & trafiknya paling tinggi.
4. **Simpan.**

---

## 5. Verifikasi

- Buka **Wallboard NOC** (`/noc?unit=KODE&key=TOKEN`) → panel **INTERNET / UPLINK**.
- Sekitar 10 detik setelah tersimpan, angka berubah dari **"1 ms"** menjadi
  **↓ X Mbps · ↑ Y Mbps** (bergerak mengikuti trafik).
- Status **INTERNET UP/DOWN** tetap mengikuti **ping ke Mikrotik Utama** (IP publik).

---

## 6. Troubleshooting

| Gejala | Penyebab | Solusi |
|---|---|---|
| **"SNMP tidak merespons"** saat Deteksi | Dijalankan dari mesin selain `192.168.50.165` | Jalankan dari server NetWatch; community dikunci ke `.165` |
| **"SNMP tidak merespons"** dari server pun | Firewall Sub blokir UDP 161, atau SNMP belum enabled | Terapkan rule firewall di Langkah 3; cek `/snmp print` |
| **"invalid value for argument address"** di RouterOS | Ikut mengetik tanda `<` `>` dari placeholder | Ketik IP tanpa kurung siku: `addresses=192.168.50.165/32` |
| Interface muncul tapi **Mbps tetap 0** | ifIndex salah (bukan port ke Utama), atau interface idle | Deteksi ulang, pilih port yang benar ke Mikrotik Utama |
| Angka muncul lalu **hilang** | Perangkat tak lagi `is_uplink` / SNMP dimatikan | Pastikan centang Uplink + Aktifkan SNMP tetap aktif |

---

## 7. Catatan teknis

- **Sumber data**: `ifHCInOctets` (`1.3.6.1.2.1.31.1.1.1.6.<ifIndex>`) &
  `ifHCOutOctets` (`.10.<ifIndex>`), Counter64. Laju = selisih dua sampel dibagi selang waktu.
- **Interval sampling**: 5 detik (`startUplinkSpeed`).
- **Aturan `SNMP Host`**: kalau diisi, **semua** query SNMP perangkat itu (kecepatan, CPU/RAM,
  Deteksi Interface) memakai `snmp_host`; kalau kosong, memakai `ip` perangkat. Ping/health-check
  tetap ke `ip`.
- **Alternatif**: kalau Mikrotik Utama memang bisa di-SNMP langsung (mis. server satu segmen &
  community mengizinkan sumbernya), kosongkan **SNMP Host** — SNMP langsung ke IP perangkat.
