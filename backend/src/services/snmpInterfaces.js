// Deteksi daftar interface perangkat via SNMP — dipakai form Perangkat untuk memilih
// ifIndex uplink WAN tanpa menebak angka. Walk kolom-kolom tabel interface (IF-MIB):
//   ifName / ifDescr (nama), ifAlias (komentar), ifOperStatus (up/down), ifHighSpeed (Mbps link).
// net-snmp di-import dinamis agar backend tetap jalan walau modul belum terpasang.
let snmpModPromise = null;
function loadSnmp() {
  if (!snmpModPromise) snmpModPromise = import('net-snmp').then((m) => m.default || m).catch(() => null);
  return snmpModPromise;
}

const OID = {
  sysDescr: '1.3.6.1.2.1.1.1.0',
  ifDescr: '1.3.6.1.2.1.2.2.1.2',
  ifOperStatus: '1.3.6.1.2.1.2.2.1.8',
  ifName: '1.3.6.1.2.1.31.1.1.1.1',
  ifAlias: '1.3.6.1.2.1.31.1.1.1.18',
  ifHighSpeed: '1.3.6.1.2.1.31.1.1.1.15',
};

// OCTET STRING datang sebagai Buffer; simpan hanya karakter ASCII cetak (buang kontrol/hi-byte) lalu trim.
const asStr = (v) => (Buffer.isBuffer(v) ? v.toString('utf8') : v == null ? '' : String(v)).replace(/[^\x20-\x7e]/g, '').trim();
// ifIndex = komponen terakhir OID (kolom instance tunggal).
const lastIndex = (oid) => Number(String(oid).split('.').pop());

// Walk satu kolom tabel -> Map<ifIndex, value>. Selalu resolve (partial pun tak apa).
function walkColumn(snmp, session, base) {
  return new Promise((resolve) => {
    const out = new Map();
    try {
      session.subtree(
        base,
        (vb) => { for (const v of vb) { if (!snmp.isVarbindError?.(v)) out.set(lastIndex(v.oid), v.value); } },
        () => resolve(out)
      );
    } catch { resolve(out); }
  });
}

// Ambil daftar interface { ifIndex, name, alias, up, mbps } dari perangkat via SNMP v2c.
// Lempar Error dgn pesan jelas bila SNMP tidak merespons.
export async function listSnmpInterfaces({ ip, community = 'public', port = 161 }) {
  const snmp = await loadSnmp();
  if (!snmp) throw new Error('Modul SNMP tidak tersedia di server.');
  let session;
  try {
    session = snmp.createSession(ip, community || 'public', { port: Number(port) || 161, version: snmp.Version2c, timeout: 2000, retries: 1 });

    // Cek cepat SNMP hidup (sysDescr) dulu — hindari beberapa kali timeout bila host mati.
    const alive = await new Promise((resolve) => {
      try { session.get([OID.sysDescr], (err, vb) => resolve(!err && !!vb?.length && !snmp.isVarbindError?.(vb[0]))); }
      catch { resolve(false); }
    });
    if (!alive) throw new Error('SNMP tidak merespons - cek SNMP enabled, community, izin IP & firewall UDP 161.');

    // Perangkat terjangkau -> walk kolom secara berurutan (aman & cukup cepat).
    const names = await walkColumn(snmp, session, OID.ifName);
    const descrs = await walkColumn(snmp, session, OID.ifDescr);
    const aliases = await walkColumn(snmp, session, OID.ifAlias);
    const oper = await walkColumn(snmp, session, OID.ifOperStatus);
    const speed = await walkColumn(snmp, session, OID.ifHighSpeed);

    const idx = new Set([...names.keys(), ...descrs.keys(), ...oper.keys()]);
    return [...idx]
      .filter((i) => Number.isFinite(i))
      .map((i) => ({
        ifIndex: i,
        name: asStr(names.get(i)) || asStr(descrs.get(i)) || `if${i}`,
        alias: asStr(aliases.get(i)) || null,
        up: Number(oper.get(i)) === 1,
        mbps: Number(speed.get(i)) || null,
      }))
      .sort((a, b) => a.ifIndex - b.ifIndex);
  } finally {
    try { session?.close(); } catch { /* */ }
  }
}
