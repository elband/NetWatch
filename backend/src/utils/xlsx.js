// Pembungkus tipis ExcelJS untuk ekspor/impor .xlsx.
// Menggantikan SheetJS (xlsx) yang punya kerentanan prototype-pollution & ReDoS.
import ExcelJS from 'exceljs';

// Ambil nilai sel mentah; tangani objek (hyperlink/richText/formula) → teks.
function cellVal(v) {
  if (v == null) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (v.text != null) return v.text;
    if (v.result != null) return v.result;
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    return String(v);
  }
  return v;
}

// Tulis array-of-arrays jadi buffer .xlsx. colWidths: array lebar kolom (angka).
export async function aoaToBuffer(sheetName, aoa, colWidths) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  for (const row of aoa) ws.addRow(row);
  if (colWidths) colWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// Tulis array-of-objects jadi buffer .xlsx (header = kunci objek pertama).
export async function jsonToBuffer(sheetName, data) {
  const header = data.length ? Object.keys(data[0]) : [];
  const aoa = data.length ? [header, ...data.map((o) => header.map((k) => o[k]))] : [];
  return aoaToBuffer(sheetName, aoa);
}

// Format Date dari sel spreadsheet ke 'YYYY-MM-DD' tanpa pergeseran zona waktu.
// Sel tanggal Excel bersifat date-only & dibaca ExcelJS sebagai UTC tengah malam,
// jadi pakai komponen UTC (bukan lokal) agar tidak geser ±1 hari.
export function xlsxDateToYmd(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return '';
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// Baca buffer .xlsx jadi array-of-arrays (setara sheet_to_json header:1, blankrows:false).
// Nilai sel dikembalikan apa adanya (string/number/Date) — pemanggil yang melakukan koersi.
export async function bufferToAoa(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const colCount = ws.columnCount;
  const out = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const arr = [];
    for (let c = 1; c <= colCount; c++) arr.push(cellVal(row.getCell(c).value));
    if (arr.every((v) => v === '' || v == null)) return; // blankrows:false
    out.push(arr);
  });
  return out;
}
