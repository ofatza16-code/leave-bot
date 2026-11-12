const { parseDate, daysBetween, currentYear } = require('./dates');

const DATE = '\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?';
// ลา <รหัส> <ชื่อ> <ประเภท> <วันที่[-วันที่]> [เหตุผล <ข้อความ>]
const RE = new RegExp(
  `^ลา\\s+(\\S+)\\s+(.+?)\\s+(ป่วย|กิจ|พักร้อน)\\s+(${DATE})(?:\\s*-\\s*(${DATE}))?(?:\\s+เหตุผล\\s+(.+))?$`
);

const MAX_DAYS = 60;

// คืนค่า: { empId, typedName, type, start, end, days, reason } | { error: 'format' | 'date' }
function parseLeave(text) {
  const m = String(text).trim().replace(/\s+/g, ' ').match(RE);
  if (!m) return { error: 'format' };
  const year = currentYear();
  const start = parseDate(m[4], year);
  const end = m[5] ? parseDate(m[5], year) : start;
  if (!start || !end || end < start) return { error: 'date' };
  const days = daysBetween(start, end);
  if (days > MAX_DAYS) return { error: 'date' };
  return {
    empId: m[1].toUpperCase(),
    typedName: m[2].trim(),
    type: m[3],
    start, end, days,
    reason: (m[6] || '-').trim(),
  };
}

// กันข้อความที่ขึ้นต้นด้วย = + - @ ถูกตีเป็นสูตรในชีต
const sanitize = (s) => (/^[=+\-@]/.test(s) ? "'" + s : s);

module.exports = { parseLeave, sanitize, MAX_DAYS };
