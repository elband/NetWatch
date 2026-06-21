import { describe, it } from 'vitest';
import request from 'supertest';

// Smoke test integrasi terhadap server yang berjalan. Otomatis di-skip bila
// server tidak aktif (mis. di CI tanpa server) agar `vitest run` tetap hijau.
const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:4000';
let up = false;
try { const r = await fetch(BASE + '/health'); up = r.ok; } catch { /* server mati */ }

describe.skipIf(!up)('API smoke (server berjalan)', () => {
  it('GET /health → 200', () => request(BASE).get('/health').expect(200));
  it('GET /api/auth/me → 401 tanpa cookie', () => request(BASE).get('/api/auth/me').expect(401));
  it('POST /api/devices → 401 tanpa auth', () => request(BASE).post('/api/devices').send({}).expect(401));
  it('GET /api/settings/tz-migration/status → 401 tanpa auth', () => request(BASE).get('/api/settings/tz-migration/status').expect(401));
});
