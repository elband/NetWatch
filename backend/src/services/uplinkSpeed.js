import { pool } from '../db/pool.js';
import { logger } from '../config/logger.js';

// Pantau kecepatan internet REAL dari perangkat uplink (Mikrotik) via SNMP:
// baca ifHCInOctets/ifHCOutOctets pada interface WAN/SFP (uplink_ifindex), lalu
// hitung laju (bps) dari selisih dua sampel. Hasil diambil endpoint NOC.
let snmpModPromise = null;
function loadSnmp() {
  if (!snmpModPromise) snmpModPromise = import('net-snmp').then((m) => m.default || m).catch(() => null);
  return snmpModPromise;
}
const OID_IN = '1.3.6.1.2.1.31.1.1.1.6.';   // ifHCInOctets.<ifindex>  (Counter64)
const OID_OUT = '1.3.6.1.2.1.31.1.1.1.10.'; // ifHCOutOctets.<ifindex> (Counter64)

function toNum(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (Buffer.isBuffer(v)) { try { return Number(v.readBigUInt64BE(Math.max(0, v.length - 8))); } catch { return null; } }
  const nn = Number(v);
  return Number.isFinite(nn) ? nn : null;
}
function snmpGet(session, oids) {
  return new Promise((resolve) => { session.get(oids, (err, vb) => resolve(err ? null : vb)); });
}

// id perangkat -> { in, out, at, rxBps, txBps }
const samples = new Map();
export function getUplinkSpeed(deviceId) {
  const s = samples.get(deviceId);
  return s && s.rxBps != null ? { rxBps: s.rxBps, txBps: s.txBps, at: s.at } : null;
}

async function sampleDevice(snmp, d) {
  let session;
  try {
    session = snmp.createSession(d.ip, d.snmp_community || 'public', { port: d.snmp_port || 161, version: snmp.Version2c, timeout: 2000, retries: 1 });
    const vb = await snmpGet(session, [OID_IN + d.uplink_ifindex, OID_OUT + d.uplink_ifindex]);
    if (!vb || vb.length < 2) return;
    const inOct = toNum(vb[0]?.value), outOct = toNum(vb[1]?.value);
    if (inOct == null || outOct == null) return;
    const now = Date.now();
    const prev = samples.get(d.id);
    let rxBps = prev?.rxBps ?? null, txBps = prev?.txBps ?? null;
    if (prev && prev.at && inOct >= prev.in && outOct >= prev.out) { // abaikan wrap/reset counter
      const dt = (now - prev.at) / 1000;
      if (dt > 0.5) {
        rxBps = Math.round(((inOct - prev.in) * 8) / dt);
        txBps = Math.round(((outOct - prev.out) * 8) / dt);
      }
    }
    samples.set(d.id, { in: inOct, out: outOct, at: now, rxBps, txBps });
  } catch { /* abaikan gangguan SNMP */ }
  finally { try { session?.close(); } catch { /* */ } }
}

let timer = null;
export function startUplinkSpeed(intervalMs = 5000) {
  if (timer) return;
  const tick = async () => {
    try {
      const snmp = await loadSnmp();
      if (!snmp) return;
      const [rows] = await pool.query(
        "SELECT id, ip, snmp_community, snmp_port, uplink_ifindex FROM devices WHERE is_uplink=1 AND snmp_enabled=1 AND uplink_ifindex IS NOT NULL AND ip IS NOT NULL AND ip NOT LIKE 'N/A%'"
      );
      const live = new Set(rows.map((r) => r.id));
      for (const id of [...samples.keys()]) if (!live.has(id)) samples.delete(id);
      await Promise.all(rows.map((d) => sampleDevice(snmp, d)));
    } catch (e) { logger?.warn?.('[uplinkSpeed] ' + e.message); }
  };
  tick();
  timer = setInterval(tick, intervalMs);
}
