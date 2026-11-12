const { thDate } = require('./dates');

// rows: ผลจาก readLeaves(), date: 'yyyy-mm-dd'
function buildDailySummary(rows, date) {
  const list = rows.filter((r) => r.start <= date && date <= r.end);
  let text = `📅 สรุปการลาประจำวันที่ ${thDate(date)}\n`;
  if (!list.length) return text + '\nไม่มีผู้ลาวันนี้ 🎉';

  const byType = {};
  list.forEach((r) => { byType[r.type] = (byType[r.type] || 0) + 1; });
  text += `\nรวม ${list.length} คน (` + Object.entries(byType).map(([t, n]) => `${t} ${n}`).join(' | ') + ')\n\n';
  list.forEach((r, i) => {
    const range = r.start === r.end ? '' : ` [${thDate(r.start)}-${thDate(r.end)}]`;
    text += `${i + 1}. ${r.empId} ${r.name} - ลา${r.type}${range}${r.reason && r.reason !== '-' ? ` (${r.reason})` : ''}\n`;
  });
  return text.trim();
}

module.exports = { buildDailySummary };
