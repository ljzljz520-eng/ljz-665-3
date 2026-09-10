/**
 * 极简 CSV 解析 / 序列化（支持引号转义、中文、表头映射）。
 */

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCsv(headers, rows) {
  const lines = [headers.map((h) => csvEscape(h.label)).join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(h.get(row))).join(','));
  }
  return '﻿' + lines.join('\r\n');
}

/**
 * 解析 CSV 文本，返回对象数组。
 * 自动去 BOM；首行为表头。
 */
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  const nonEmpty = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  if (nonEmpty.length === 0) return [];

  const headers = nonEmpty[0].map((h) => String(h).trim());
  return nonEmpty.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (r[i] ?? '').trim(); });
    return obj;
  });
}

module.exports = { toCsv, parseCsv, csvEscape };
