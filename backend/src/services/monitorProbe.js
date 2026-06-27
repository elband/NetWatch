import ping from 'ping';
import net from 'net';
import { logger } from '../config/logger.js';

// =============================================================================
// monitorProbe — lapisan pemantauan perangkat.
// Selain ICMP ping (default), mendukung health-check TCP & HTTP serta
// pengayaan metrik CPU/memori/uptime via SNMP (opsional, per-perangkat).
// Semua probe dirancang "fail-soft": error apa pun → dianggap tidak hidup,
// tidak pernah melempar ke pemanggil (pingService).
// =============================================================================

// --- ICMP ping ---------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Probe ICMP yang tahan paket-hilang. Perangkat wireless (AP/klien) kerap men-drop
// paket ICMP pertama (ARP resolve / power-save), sehingga probe 1-paket bisa salah
// menyatakan offline walau perangkat hidup & balas ping manual. Strategi:
//  • Jalur cepat: 1 paket. Perangkat sehat biasanya langsung membalas → cepat.
//  • Bila tampak mati, coba ulang beberapa kali (jeda singkat untuk ARP) sebelum
//    benar-benar menyimpulkan offline. Hanya perangkat yang tampak mati yang kena
//    biaya retry, jadi sweep untuk perangkat sehat tetap ringan.
const PING_ATTEMPTS = 3;
async function probePing(ip) {
  for (let attempt = 0; attempt < PING_ATTEMPTS; attempt++) {
    try {
      const r = await ping.promise.probe(ip, { timeout: 2 });
      if (r.alive) return { alive: true, avgMs: parseFloat(r.time) || 0 };
    } catch { /* anggap percobaan ini gagal, lanjut retry */ }
    if (attempt < PING_ATTEMPTS - 1) await sleep(250);
  }
  return { alive: false, avgMs: 0 };
}

// --- TCP connect (cek port service hidup, mis. 443/22/3306) ------------------
function probeTcp(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const start = Date.now();
    const sock = new net.Socket();
    let done = false;
    const finish = (alive) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch { /* abaikan */ }
      resolve({ alive, avgMs: alive ? Date.now() - start : 0 });
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    try { sock.connect(port, host); } catch { finish(false); }
  });
}

// --- HTTP(S) check (service layer 7 sehat bila status < 400) -----------------
async function probeHttp(url, timeoutMs = 4000) {
  const start = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    return { alive: res.status < 400, avgMs: Date.now() - start };
  } catch {
    return { alive: false, avgMs: 0 };
  } finally {
    clearTimeout(t);
  }
}

// --- SNMP (opsional) ---------------------------------------------------------
// net-snmp di-import dinamis agar backend tetap jalan walau modul belum ada.
let snmpModPromise = null;
function loadSnmp() {
  if (!snmpModPromise) {
    snmpModPromise = import('net-snmp').then((m) => m.default || m).catch(() => null);
  }
  return snmpModPromise;
}

// OID standar (generik). CPU: hrProcessorLoad (rata-rata core).
// Memori: UCD-SNMP memTotalReal/memAvailReal. Uptime: sysUpTime.
const OID = {
  sysUpTime: '1.3.6.1.2.1.1.3.0',
  hrProcessorLoad: '1.3.6.1.2.1.25.3.3.1.2',
  memTotalReal: '1.3.6.1.4.1.2021.4.5.0',
  memAvailReal: '1.3.6.1.4.1.2021.4.6.0',
};

function snmpGet(session, oids) {
  return new Promise((resolve) => {
    session.get(oids, (err, varbinds) => {
      if (err) return resolve(null);
      resolve(varbinds);
    });
  });
}

function snmpSubtree(session, oid) {
  return new Promise((resolve) => {
    const vals = [];
    session.subtree(
      oid,
      (vb) => { for (const v of vb) if (typeof v.value === 'number') vals.push(v.value); },
      (err) => resolve(err ? null : vals)
    );
  });
}

// Ambil CPU%/mem%/uptime via SNMP. Mengembalikan {cpu,mem} angka 0-100 atau null.
async function probeSnmp(device) {
  const snmp = await loadSnmp();
  if (!snmp) return { cpu: null, mem: null };
  let session;
  try {
    session = snmp.createSession(device.ip, device.snmp_community || 'public', {
      port: device.snmp_port || 161,
      version: snmp.Version2c,
      timeout: 2000,
      retries: 1,
    });

    let cpu = null;
    const loads = await snmpSubtree(session, OID.hrProcessorLoad);
    if (loads && loads.length) {
      cpu = Math.round(loads.reduce((a, b) => a + b, 0) / loads.length);
    }

    let mem = null;
    const vb = await snmpGet(session, [OID.memTotalReal, OID.memAvailReal]);
    if (vb && vb.length === 2 && !snmp.isVarbindError(vb[0]) && !snmp.isVarbindError(vb[1])) {
      const total = Number(vb[0].value);
      const avail = Number(vb[1].value);
      if (total > 0) mem = Math.round(((total - avail) / total) * 100);
    }
    return { cpu, mem };
  } catch (e) {
    logger.debug?.(`[snmp] gagal untuk ${device.ip}: ${e?.message || e}`);
    return { cpu: null, mem: null };
  } finally {
    try { session?.close(); } catch { /* abaikan */ }
  }
}

// =============================================================================
// probeDevice — entri tunggal yang dipakai pingService.
// Memilih metode reachability sesuai check_type, lalu (bila aktif) memperkaya
// dengan CPU/mem SNMP riil. cpu/mem null = tidak diketahui (SNMP mati/gagal).
// =============================================================================
export async function probeDevice(device) {
  let reach;
  switch (device.check_type) {
    case 'tcp':
      reach = device.check_port ? await probeTcp(device.ip, device.check_port) : await probePing(device.ip);
      break;
    case 'http':
      reach = device.check_url ? await probeHttp(device.check_url) : await probePing(device.ip);
      break;
    default:
      reach = await probePing(device.ip);
  }

  let cpu = null;
  let mem = null;
  if (reach.alive && device.snmp_enabled) {
    const s = await probeSnmp(device);
    cpu = s.cpu;
    mem = s.mem;
  }
  return { alive: reach.alive, avgMs: reach.avgMs, cpu, mem };
}
