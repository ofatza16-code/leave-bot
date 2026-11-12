const crypto = require('crypto');
const { google } = require('googleapis');
const { toISO } = require('./dates');

// แปลง GOOGLE_PRIVATE_KEY ให้เป็น PEM ที่ถูกต้อง ไม่ว่าจะวางมาในรูปแบบไหน:
// มี \n เป็นตัวอักษร / ขึ้นบรรทัดใหม่จริง / มีเครื่องหมายคำพูดครอบ / เว้นวรรคแทนบรรทัดใหม่
function normalizePrivateKey(raw) {
  let k = String(raw || '').trim().replace(/^['"]+|['"]+$/g, '');
  const m = k.match(/-----BEGIN ([A-Z ]*PRIVATE KEY)-----([\s\S]*?)-----END \1-----/);
  if (!m) return k.replace(/\\n/g, '\n');
  const body = m[2].replace(/\\+[rn]/g, '').replace(/[\s\\]/g, '');
  const lines = body.match(/.{1,64}/g) || [];
  return `-----BEGIN ${m[1]}-----\n${lines.join('\n')}\n-----END ${m[1]}-----\n`;
}

// ใช้ตรวจในหน้า /api/webhook: คืนค่า 'ok' หรือข้อความอธิบายปัญหา
function checkKey() {
  const raw = process.env.GOOGLE_PRIVATE_KEY;
  if (!raw || !raw.trim()) return 'ไม่มีค่า';
  if (!/BEGIN [A-Z ]*PRIVATE KEY/.test(raw)) return 'ไม่พบ -----BEGIN PRIVATE KEY----- (วางไม่ครบ)';
  if (!/END [A-Z ]*PRIVATE KEY/.test(raw)) return 'ไม่พบ -----END PRIVATE KEY----- (วางไม่ครบ)';
  try {
    crypto.createPrivateKey(normalizePrivateKey(raw));
    return 'ok';
  } catch (e) {
    return 'ผิดรูปแบบ/ข้อความขาดหาย ให้คัดลอก private_key จากไฟล์ JSON มาใหม่ทั้งก้อน';
  }
}

let cached;
function sheets() {
  if (!cached) {
    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_CLIENT_EMAIL,
      key: normalizePrivateKey(process.env.GOOGLE_PRIVATE_KEY),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    cached = google.sheets({ version: 'v4', auth });
  }
  return cached;
}
const ID = () => process.env.SHEET_ID;

// Leaves: A เวลาบันทึก | B LineUserId | C รหัส | D ชื่อ | E ประเภท | F วันเริ่ม | G วันสิ้นสุด | H จำนวนวัน | I เหตุผล | J MessageId
async function readLeaves() {
  const r = await sheets().spreadsheets.values.get({
    spreadsheetId: ID(),
    range: 'Leaves!A2:J',
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  return (r.data.values || [])
    .map((v) => ({
      userId: v[1] || '',
      empId: String(v[2] || '').trim().toUpperCase(),
      name: v[3] || '',
      type: v[4] || '',
      start: toISO(v[5]),
      end: toISO(v[6]),
      days: Number(v[7] || 0),
      reason: v[8] || '',
      msgId: String(v[9] || ''),
    }))
    .filter((x) => x.empId && x.start);
}

async function appendLeave(x) {
  await sheets().spreadsheets.values.append({
    spreadsheetId: ID(),
    range: 'Leaves!A:J',
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[
        x.stamp, x.userId, x.empId, x.name, x.type,
        x.start, x.end, x.days, x.reason,
        "'" + x.msgId, // บังคับเป็นข้อความ กันเลขยาวถูกปัดค่า
      ]],
    },
  });
}

// Employees: A รหัส | B ชื่อ-นามสกุล | C แผนก | D LineUserId (บอทเติมให้ถ้าเปิด BIND_LINE_USER)
async function findEmployee(empId) {
  const r = await sheets().spreadsheets.values.get({
    spreadsheetId: ID(),
    range: 'Employees!A2:D',
  });
  const rows = r.data.values || [];
  const i = rows.findIndex((v) => String(v[0] || '').trim().toUpperCase() === empId);
  if (i < 0) return null;
  const v = rows[i];
  return {
    id: String(v[0]).trim().toUpperCase(),
    name: v[1] || '',
    dept: v[2] || '',
    lineUserId: v[3] || '',
    row: i + 2,
  };
}

async function bindLineUser(row, userId) {
  await sheets().spreadsheets.values.update({
    spreadsheetId: ID(),
    range: `Employees!D${row}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[userId]] },
  });
}

// Quota: A ประเภท | B โควตา/ปี
async function readQuota() {
  const fallback = { 'ป่วย': 30, 'กิจ': 3, 'พักร้อน': 6 };
  try {
    const r = await sheets().spreadsheets.values.get({ spreadsheetId: ID(), range: 'Quota!A2:B' });
    const q = {};
    (r.data.values || []).forEach((v) => { if (v[0] && v[1] !== undefined) q[String(v[0]).trim()] = Number(v[1]); });
    return { ...fallback, ...q };
  } catch (e) {
    return fallback;
  }
}

module.exports = { normalizePrivateKey, checkKey, readLeaves, appendLeave, findEmployee, bindLineUser, readQuota };
