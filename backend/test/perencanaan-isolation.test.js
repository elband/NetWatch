import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';

// Isolasi multi-unit untuk Perencanaan Unit: koordinator unit A TIDAK boleh
// melihat / mengubah / menghapus rencana milik unit B. Diuji terhadap app
// sungguhan + DB (di-skip otomatis bila DB mati, mis. lokal tanpa MySQL).
const app = createApp();
let dbUp = false;
try { await pool.query('SELECT 1'); dbUp = true; } catch { /* DB down → skip */ }

const CODE_A = '__ISOA__', CODE_B = '__ISOB__';
const UNAME_A = '__isokoordA__', UNAME_B = '__isokoordB__';
const PIN_A = '901834', PIN_B = '901835';

describe.skipIf(!dbUp)('Perencanaan Unit — isolasi antar unit', () => {
  const agentA = request.agent(app); // koordinator unit A
  const agentB = request.agent(app); // koordinator unit B
  let unitA, unitB, planAId, kpiAId;

  async function cleanup() {
    await pool.query('DELETE FROM unit_plans WHERE judul LIKE ?', ['__iso_plan_%']).catch(() => {});
    await pool.query('DELETE FROM unit_kpi_targets WHERE label LIKE ?', ['__iso_kpi_%']).catch(() => {});
    await pool.query('DELETE FROM users WHERE username IN (?,?)', [UNAME_A, UNAME_B]).catch(() => {});
    await pool.query('DELETE FROM units WHERE code IN (?,?)', [CODE_A, CODE_B]).catch(() => {});
  }

  beforeAll(async () => {
    await cleanup();
    // Dua unit terpisah.
    const [ra] = await pool.query('INSERT INTO units (code,name) VALUES (?,?)', [CODE_A, 'Unit Isolasi A']);
    const [rb] = await pool.query('INSERT INTO units (code,name) VALUES (?,?)', [CODE_B, 'Unit Isolasi B']);
    unitA = ra.insertId; unitB = rb.insertId;
    // Satu koordinator per unit (role koordinator + unit_id terkunci).
    const pw = await bcrypt.hash('x', 10);
    const [pa, pb] = await Promise.all([bcrypt.hash(PIN_A, 10), bcrypt.hash(PIN_B, 10)]);
    const insUser = "INSERT INTO users (name,username,email,password_hash,pin_hash,role,roles,perms,active,unit_id) VALUES (?,?,?,?,?,'koordinator',JSON_ARRAY('koordinator'),JSON_ARRAY(),1,?)";
    await pool.query(insUser, ['Koord A', UNAME_A, UNAME_A + '@x.local', pw, pa, unitA]);
    await pool.query(insUser, ['Koord B', UNAME_B, UNAME_B + '@x.local', pw, pb, unitB]);
    await agentA.post('/api/auth/login-pin').send({ pin: PIN_A }).expect(200);
    await agentB.post('/api/auth/login-pin').send({ pin: PIN_B }).expect(200);
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it('koordinator A membuat rencana → 201, ter-tag unit A', async () => {
    const res = await agentA.post('/api/perencanaan')
      .send({ tahun: 2026, judul: '__iso_plan_A__', kategori: 'pemeliharaan', estimasi_biaya: 1000 })
      .expect(201);
    planAId = res.body.plan?.id;
    expect(planAId).toBeTruthy();
    expect(res.body.plan.unit_id).toBe(unitA);
  });

  it('koordinator B TIDAK melihat rencana unit A di daftar', async () => {
    const res = await agentB.get('/api/perencanaan?tahun=2026').expect(200);
    expect((res.body.plans || []).map((p) => p.id)).not.toContain(planAId);
  });

  it('koordinator A melihat rencananya sendiri', async () => {
    const res = await agentA.get('/api/perencanaan?tahun=2026').expect(200);
    expect((res.body.plans || []).map((p) => p.id)).toContain(planAId);
  });

  it('koordinator B TIDAK bisa mengedit rencana unit A → 404', () =>
    agentB.put(`/api/perencanaan/${planAId}`).send({ judul: 'diretas', kategori: 'lainnya' }).expect(404));

  it('koordinator B TIDAK bisa ubah status rencana unit A → 404', () =>
    agentB.patch(`/api/perencanaan/${planAId}`).send({ status: 'batal' }).expect(404));

  it('koordinator B TIDAK bisa menghapus rencana unit A → 404', () =>
    agentB.delete(`/api/perencanaan/${planAId}`).expect(404));

  it('rencana unit A tetap utuh setelah percobaan lintas unit', async () => {
    const res = await agentA.get('/api/perencanaan?tahun=2026').expect(200);
    const plan = (res.body.plans || []).find((p) => p.id === planAId);
    expect(plan).toBeTruthy();
    expect(plan.judul).toBe('__iso_plan_A__');
  });

  it('koordinator A membuat KPI → 201, ter-tag unit A', async () => {
    const res = await agentA.post('/api/perencanaan/kpi')
      .send({ tahun: 2026, label: '__iso_kpi_A__', satuan: '%', target: 99, arah: 'naik' })
      .expect(201);
    kpiAId = res.body.kpi?.id;
    expect(kpiAId).toBeTruthy();
    expect(res.body.kpi.unit_id).toBe(unitA);
  });

  it('koordinator B TIDAK melihat KPI unit A', async () => {
    const res = await agentB.get('/api/perencanaan/kpi?tahun=2026').expect(200);
    expect((res.body.kpi || []).map((x) => x.id)).not.toContain(kpiAId);
  });

  it('koordinator B TIDAK bisa mengedit KPI unit A → 404', () =>
    agentB.put(`/api/perencanaan/kpi/${kpiAId}`).send({ label: 'diretas' }).expect(404));

  it('koordinator B TIDAK bisa menghapus KPI unit A → 404', () =>
    agentB.delete(`/api/perencanaan/kpi/${kpiAId}`).expect(404));
});
