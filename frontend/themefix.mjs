import fs from 'fs';
import path from 'path';

const ROOT = 'src';
const EXCLUDE = new Set([
  'src/pages/LaporPublik.tsx', 'src/pages/Ttd.tsx', 'src/pages/TtdPelaksana.tsx',
  'src/pages/VerifyTte.tsx', 'src/pages/Login.tsx',
]);
// Sinyal "biarkan putih": baris dengan latar gelap/berwarna atau opacity-variant.
const KEEP = /bg-\[#|bg-black|bg-white|bg-gradient|from-[a-z[]|to-\[|to-[a-z]|bg-(accent|success|danger|warn|accent2|sky|blue|green|red|emerald|indigo|teal|amber|rose|cyan|violet|orange|purple|pink|slate|gray|zinc|neutral|stone|yellow|lime)|text-white\//;
const TOKEN = /text-white(?!\/)/g;
const apply = process.argv.includes('--apply');

function norm(p) { return p.split(path.sep).join('/'); }
function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = norm(path.join(dir, e.name));
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.tsx')) acc.push(p);
  }
  return acc;
}

let total = 0; const report = {};
for (const f of walk(ROOT)) {
  if (EXCLUDE.has(f)) continue;
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  let changed = 0; const hits = [];
  const out = lines.map((ln, i) => {
    if (!/text-white(?!\/)/.test(ln)) return ln;
    if (KEEP.test(ln)) return ln;
    const nl = ln.replace(TOKEN, 'text-text');
    if (nl !== ln) { changed++; hits.push((i + 1) + ': ' + ln.trim().slice(0, 100)); }
    return nl;
  });
  if (changed) { report[f] = { changed, hits }; total += changed; if (apply) fs.writeFileSync(f, out.join('\n')); }
}
for (const [f, r] of Object.entries(report)) {
  console.log('\n### ' + f + '  (' + r.changed + ')');
  r.hits.forEach((h) => console.log('   ' + h));
}
console.log('\nTOTAL baris diubah: ' + total + ' di ' + Object.keys(report).length + ' file. ' + (apply ? '(APPLIED)' : '(dry-run)'));
