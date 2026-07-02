// Scoping multi-unit. Role `admin` = Super Admin lintas unit; role lain terkunci
// pada unit_id miliknya sendiri (diambil segar dari DB oleh requireAuth).
// Pasang SETELAH requireAuth: req.unitId = unit efektif request ini
// (null = semua unit, hanya mungkin untuk admin).

export function isAdminUser(user) {
  const roles = user?.roles?.length ? user.roles : (user?.role ? [user.role] : []);
  return roles.includes('admin');
}

export function unitScope(req, res, next) {
  if (isAdminUser(req.user)) {
    // Admin boleh memilih unit via header X-Unit-Id (dikirim unit switcher frontend)
    // atau query ?unit_id=. Kosong/invalid = semua unit.
    const raw = req.headers['x-unit-id'] ?? req.query.unit_id;
    const n = Number(raw);
    req.unitId = raw !== undefined && raw !== '' && Number.isInteger(n) && n > 0 ? n : null;
    return next();
  }
  // Non-admin: paksa ke unit sendiri — input klien diabaikan.
  if (!req.user?.unit_id) {
    return res.status(403).json({ error: 'Akun Anda belum terdaftar pada unit mana pun. Hubungi super admin.' });
  }
  req.unitId = req.user.unit_id;
  next();
}

// Helper penyusun filter SQL. Pakai di list & detail:
//   const uf = unitFilter(req.unitId, 'd.unit_id');
//   `SELECT ... WHERE 1=1 ${uf.clause}` dengan params [...uf.params]
export function unitFilter(unitId, column = 'unit_id') {
  if (unitId == null) return { clause: '', params: [] };
  return { clause: ` AND ${column} = ?`, params: [unitId] };
}

// Filter untuk tabel master global (locations, device_types, documents, wa_log):
// baris ber-unit NULL = milik bersama, tetap terlihat oleh semua unit.
export function unitFilterShared(unitId, column = 'unit_id') {
  if (unitId == null) return { clause: '', params: [] };
  return { clause: ` AND (${column} IS NULL OR ${column} = ?)`, params: [unitId] };
}

// Cek kepemilikan unit pada baris tunggal (endpoint by-id / mutasi — cegah IDOR antar unit).
// Baris ber-unit NULL (data global) dianggap boleh diakses.
export function rowInUnit(row, unitId) {
  if (unitId == null) return true;
  return row?.unit_id == null || Number(row.unit_id) === Number(unitId);
}

// Unit untuk baris BARU (INSERT): unit efektif request; admin dalam mode "Semua Unit"
// harus memilih unit lewat body.unit_id. Null = penulisan harus ditolak (400) oleh route.
export function insertUnitId(req) {
  if (req.unitId != null) return req.unitId;
  const n = Number(req.body?.unit_id);
  return Number.isInteger(n) && n > 0 ? n : null;
}
