-- One-off: konversi posisi lama (map_x/map_y = persen pada gambar peta) menjadi
-- koordinat GPS perkiraan, agar pin lokasi langsung muncul di PETA LIVE tanpa
-- harus menaruh ulang satu per satu.
--
-- Jalankan SEKALI di server:
--   mysql -u <user> -p netwatch_erp < backend/src/db/oneoff-location-latlng.sql
--
-- Posisi hasil konversi bersifat PERKIRAAN (relatif sesuai gambar lama). Rapikan
-- lewat: Kelola -> pilih lokasi -> klik di peta. Hanya mengisi lokasi yang BELUM
-- punya lat/lng, jadi aman diulang dan tidak menimpa pin yang sudah ditaruh manual.
--
-- ====== Anchor & skala bandara (SESUAIKAN bila pin meleset) ======
--   @cy,@cx = titik tengah bandara (lat,lng). Default: area APT Pranoto, Samarinda
--             (diambil dari koordinat perangkat lama yang sudah ada di DB).
--   @sx     = lebar cakupan gambar dalam derajat BUJUR  (lng span, ~0.022 ≈ 2.4 km)
--   @sy     = tinggi cakupan gambar dalam derajat LINTANG (lat span, ~0.013 ≈ 1.4 km)
SET @cy := -0.371000;   -- center latitude
SET @cx := 117.257000;  -- center longitude
SET @sx := 0.022000;    -- lng span
SET @sy := 0.013000;    -- lat span

UPDATE locations
   SET lat = @cy + (0.5 - map_y / 100) * @sy,
       lng = @cx + (map_x / 100 - 0.5) * @sx
 WHERE map_x IS NOT NULL AND map_y IS NOT NULL
   AND lat IS NULL AND lng IS NULL;

-- Cek hasil:
SELECT id, name, map_x, map_y, lat, lng FROM locations ORDER BY sort_order, id;
