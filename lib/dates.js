const TZ = 'Asia/Bangkok';

const todayISO = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
const nowStamp = () => new Date().toLocaleString('sv-SE', { timeZone: TZ });
const currentYear = () => Number(todayISO().slice(0, 4));

// "12/11" , "12/11/2026" , "12/11/2569" , "12/11/26"  ->  Date (UTC) หรือ null ถ้าวันที่ไม่มีจริง
function parseDate(s, defaultYear) {
  const [d, m, y] = s.split('/').map(Number);
  let year = y || defaultYear;
  if (year < 100) year += 2000;
  if (year > 2400) year -= 543; // พ.ศ. -> ค.ศ.
  const dt = new Date(Date.UTC(year, m - 1, d));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

const daysBetween = (a, b) => Math.round((b - a) / 86400000) + 1;
const fmt = (d) => d.toISOString().slice(0, 10);

// ค่าจากชีตอาจเป็น serial number (UNFORMATTED_VALUE) หรือข้อความ yyyy-mm-dd
function toISO(v) {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v === 'number') {
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
}

// yyyy-mm-dd -> dd/mm/yyyy
const thDate = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

module.exports = { todayISO, nowStamp, currentYear, parseDate, daysBetween, fmt, toISO, thDate };
