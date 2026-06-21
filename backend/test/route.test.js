import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';

// Integrasi auth/RBAC/validasi terhadap app sungguhan (tanpa server berjalan).
// Membuat admin sementara, lalu membersihkannya. Otomatis di-skip bila DB mati.
const app = createApp();
const PIN = '739514';
const USERNAME = '__rtestadmin__';
let dbUp = false;
try { await pool.query('SELECT 1'); dbUp = true; } catch { /* DB down */ }

describe.skipIf(!dbUp)('routes & RBAC (integration)', () => {
  const agent = request.agent(app);
  let createdDeviceId = null;

  beforeAll(async () => {
    await pool.query('DELETE FROM users WHERE username = ?', [USERNAME]);
    const [pw, pin] = await Promise.all([bcrypt.hash('x', 10), bcrypt.hash(PIN, 10)]);
    await pool.query(
      "INSERT INTO users (name,username,email,password_hash,pin_hash,role,roles,perms,active) VALUES ('Route Test',?,?,?,?,'admin',JSON_ARRAY('admin'),JSON_ARRAY(),1)",
      [USERNAME, USERNAME + '@x.local', pw, pin]
    );
  });

  afterAll(async () => {
    if (createdDeviceId) await pool.query('DELETE FROM devices WHERE id = ?', [createdDeviceId]).catch(() => {});
    await pool.query('DELETE FROM users WHERE username = ?', [USERNAME]).catch(() => {});
    await pool.end();
  });

  it('GET /health → 200', () => request(app).get('/health').expect(200));

  it('GET /api/auth/me → 401 tanpa cookie', () => request(app).get('/api/auth/me').expect(401));

  it('login (identifier salah) → 401', () =>
    request(app).post('/api/auth/login').send({ identifier: '__nouser__', password: 'x' }).expect(401));

  it('login-pin admin sementara → 200 + cookie HttpOnly', async () => {
    const res = await agent.post('/api/auth/login-pin').send({ pin: PIN }).expect(200);
    expect(res.body.user.username).toBe(USERNAME);
    expect(String(res.headers['set-cookie'])).toMatch(/netwatch_token=.*HttpOnly/i);
  });

  it('GET /api/users dengan cookie admin → 200 (RBAC lolos)', () => agent.get('/api/users').expect(200));

  it('POST /api/devices IP invalid → 400 (validasi)', () =>
    agent.post('/api/devices').send({ name: 'T', ip: '999.1.1.1', type: 'Switch' }).expect(400));

  it('POST /api/devices valid → 201', async () => {
    const res = await agent.post('/api/devices').send({ name: '__rtest_dev__', ip: '10.99.99.99', type: 'Switch' }).expect(201);
    createdDeviceId = res.body.device?.id;
    expect(createdDeviceId).toBeTruthy();
  });
});
