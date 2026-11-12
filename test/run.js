const assert = require('assert');
const { parseLeave, sanitize } = require('../lib/parse');
const { buildDailySummary } = require('../lib/summary');
const { toISO } = require('../lib/dates');

let r = parseLeave('ลา EMP001 สมชาย ใจดี ป่วย 12/11/2026 เหตุผล ไข้หวัด');
assert.strictEqual(r.empId, 'EMP001');
assert.strictEqual(r.typedName, 'สมชาย ใจดี');
assert.strictEqual(r.type, 'ป่วย');
assert.strictEqual(r.days, 1);
assert.strictEqual(r.reason, 'ไข้หวัด');

r = parseLeave('ลา emp014 สมหญิง กิจ 14/11/2026-16/11/2026 เหตุผล ธุระ');
assert.strictEqual(r.empId, 'EMP014');
assert.strictEqual(r.days, 3);

r = parseLeave('ลา   EMP007   วิชัย   พักร้อน   20/11/2569-22/11/2569');
assert.strictEqual(r.days, 3);
assert.strictEqual(r.reason, '-');
assert.strictEqual(r.start.toISOString().slice(0, 10), '2026-11-20');

assert.strictEqual(parseLeave('ลา ป่วย 12/11').error, 'format');
assert.strictEqual(parseLeave('ลา EMP001 สมชาย ลาออก 12/11').error, 'format');
assert.strictEqual(parseLeave('ลา EMP001 สมชาย ป่วย 31/02/2026').error, 'date');
assert.strictEqual(parseLeave('ลา EMP001 สมชาย ป่วย 15/11/2026-14/11/2026').error, 'date');
assert.strictEqual(parseLeave('ลา EMP001 สมชาย ป่วย 01/01/2026-31/12/2026').error, 'date');

assert.strictEqual(sanitize('=HYPERLINK("x")'), "'=HYPERLINK(\"x\")");
assert.strictEqual(sanitize('ไข้หวัด'), 'ไข้หวัด');

assert.strictEqual(toISO(46338), '2026-11-12');
assert.strictEqual(toISO('2026-11-12'), '2026-11-12');
assert.strictEqual(toISO(''), '');

const rows = [
  { empId: 'EMP001', name: 'สมชาย ใจดี', type: 'ป่วย', start: '2026-11-11', end: '2026-11-12', days: 2, reason: 'ไข้' },
  { empId: 'EMP014', name: 'สมหญิง', type: 'กิจ', start: '2026-11-11', end: '2026-11-11', days: 1, reason: '-' },
  { empId: 'EMP007', name: 'วิชัย', type: 'พักร้อน', start: '2026-11-20', end: '2026-11-22', days: 3, reason: '-' },
];
const s = buildDailySummary(rows, '2026-11-11');
assert.ok(s.includes('รวม 2 คน'));
assert.ok(s.includes('EMP001') && s.includes('EMP014') && !s.includes('EMP007'));
assert.ok(buildDailySummary(rows, '2026-12-01').includes('ไม่มีผู้ลาวันนี้'));

console.log('ALL TESTS PASSED');
