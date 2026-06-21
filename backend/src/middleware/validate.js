// Middleware validasi body request berbasis skema Zod.
// Sukses → req.body diganti dengan data tervalidasi/terkoersi (unknown keys
// tetap dipertahankan via .passthrough() di skema). Gagal → 400 pesan ringkas.
export function validateBody(schema) {
  return (req, res, next) => {
    const r = schema.safeParse(req.body ?? {});
    if (!r.success) {
      const msg = r.error.issues.map((i) => `${i.path.join('.') || 'field'}: ${i.message}`).join('; ');
      return res.status(400).json({ error: 'Validasi gagal — ' + msg });
    }
    req.body = r.data;
    next();
  };
}
