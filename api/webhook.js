const crypto = require('crypto');

// ---------- ตัวช่วยพื้นฐาน (ไม่พึ่งไฟล์อื่น เพื่อให้ Verify ผ่านได้เสมอ) ----------
const REQUIRED = ['LINE_TOKEN', 'LINE_SECRET', 'GOOGLE_CLIENT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'SHEET_ID'];
const missingEnv = () => REQUIRED.filter((k) => !process.env[k] || !String(process.env[k]).trim());

// โหลดไฟล์ใน lib/ ตอนใช้งานจริงเท่านั้น ถ้าขาดจะรู้จาก log แทนที่จะพังทั้งระบบ
function loadLibs() {
  return {
    parse: require('../lib/parse'),
    dates: require('../lib/dates'),
    sheets: require('../lib/sheets'),
    summary: require('../lib/summary'),
  };
}

async function rawBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  let buf = Buffer.concat(chunks);
  if (!buf.length) {
    try {
      if (req.body) buf = Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    } catch (_) { /* ไม่มี body */ }
  }
  return buf;
}

function validSignature(body, secret, signature) {
  const mac = Buffer.from(crypto.createHmac('sha256', secret).update(body).digest('base64'));
  const given = Buffer.from(String(signature || ''));
  return mac.length === given.length && crypto.timingSafeEqual(mac, given);
}

async function lineReply(replyToken, text) {
  const r = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.LINE_TOKEN}` },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
  });
  if (!r.ok) console.error('LINE reply failed', r.status, await r.text());
}

// ---------- ตัวรับ Webhook ----------
async function handler(req, res) {
  try {
    // เปิดในเบราว์เซอร์: ตรวจสถานะระบบ (แสดงเฉพาะชื่อตัวแปร ไม่แสดงค่า)
    if (req.method !== 'POST') {
      const miss = missingEnv();
      let libs = 'ok';
      try { loadLibs(); } catch (e) { libs = 'ERROR ' + String(e.message).split('\n')[0]; }
      return res.status(200).send(`ok | ตัวแปรที่ขาด: ${miss.length ? miss.join(', ') : 'ไม่มี'} | ไฟล์ lib: ${libs}`);
    }

    const body = await rawBody(req);
    let events = [];
    try { events = JSON.parse(body.toString() || '{}').events || []; } catch (_) { /* ไม่ใช่ JSON */ }

    // ปุ่ม Verify ของ LINE ส่ง events ว่างมา: ตอบ 200 ได้เลย
    if (!events.length) return res.status(200).send('ok');

    const secret = process.env.LINE_SECRET;
    if (!secret) {
      console.error('MISSING ENV: LINE_SECRET (ตั้งใน Vercel > Settings > Environment Variables แล้ว Redeploy)');
      return res.status(500).send('missing LINE_SECRET');
    }
    if (!validSignature(body, secret, req.headers['x-line-signature'])) {
      console.error('Invalid signature: LINE_SECRET ใน Vercel ไม่ตรงกับ Channel secret ของไลน์');
      return res.status(401).end();
    }

    // ต้องตอบ 200 เสมอเมื่อลายเซ็นถูก ไม่งั้น LINE จะส่งซ้ำ
    await Promise.allSettled(events.map(handle));
    return res.status(200).end();
  } catch (err) {
    console.error('webhook error', err);
    return res.status(500).send('error');
  }
}

async function handle(ev) {
  try {
    if (ev.type !== 'message' || ev.message.type !== 'text') return;
    if (ev.source.type !== 'group') return;

    const text = ev.message.text.trim();
    const reply = (t) => lineReply(ev.replyToken, t);

    // ช่วยตอนตั้งค่า: ขอ Group ID (ตอบเฉพาะตอนที่ยังไม่ได้ตั้ง LINE_GROUP_ID)
    if (text === '/groupid' && !process.env.LINE_GROUP_ID) {
      return reply(`Group ID: ${ev.source.groupId}`);
    }
    // รับคำสั่งเฉพาะกลุ่มที่กำหนด
    if (process.env.LINE_GROUP_ID && ev.source.groupId !== process.env.LINE_GROUP_ID) return;

    if (text !== 'สรุปวันนี้' && !text.startsWith('ลา')) return;

    const { parse, dates, sheets, summary } = loadLibs();
    const { fmt, nowStamp, todayISO, thDate } = dates;
    const { parseLeave, sanitize } = parse;
    const { readLeaves, appendLeave, findEmployee, bindLineUser, readQuota } = sheets;

    if (text === 'สรุปวันนี้') {
      return reply(summary.buildDailySummary(await readLeaves(), todayISO()));
    }

    const leave = parseLeave(text);
    if (leave.error === 'format') {
      return reply(
        'รูปแบบไม่ถูกต้อง ❌\nพิมพ์ตามนี้:\nลา <รหัส> <ชื่อ> <ประเภท> <วันที่> เหตุผล <ข้อความ>\n\n' +
        'ตัวอย่าง:\nลา EMP001 สมชาย ใจดี ป่วย 12/11 เหตุผล ไข้หวัด\n' +
        'ลา EMP001 สมชาย ใจดี กิจ 14/11-15/11 เหตุผล ธุระ\n\nประเภท: ป่วย / กิจ / พักร้อน'
      );
    }
    if (leave.error === 'date') {
      return reply('วันที่ไม่ถูกต้อง ❌ (ตรวจวันที่ที่ไม่มีจริง, วันสิ้นสุดก่อนวันเริ่ม, หรือเกิน 60 วัน)');
    }

    const emp = await findEmployee(leave.empId);
    if (!emp) return reply(`ไม่พบรหัสพนักงาน ${leave.empId} ❌\nกรุณาตรวจสอบรหัสอีกครั้ง`);

    // ผูกรหัสพนักงานกับบัญชีไลน์ (เปิดด้วย BIND_LINE_USER=true)
    if (process.env.BIND_LINE_USER === 'true') {
      if (emp.lineUserId && emp.lineUserId !== ev.source.userId) {
        return reply(`รหัส ${emp.id} ผูกกับบัญชีไลน์อื่นแล้ว ❌\nติดต่อแอดมินหากต้องการเปลี่ยน`);
      }
      if (!emp.lineUserId) await bindLineUser(emp.row, ev.source.userId);
    }

    const rows = await readLeaves();
    if (rows.some((r) => r.msgId === ev.message.id)) return; // event ซ้ำ ไม่บันทึกซ้ำ

    const start = fmt(leave.start);
    const end = fmt(leave.end);
    await appendLeave({
      stamp: nowStamp(),
      userId: ev.source.userId,
      empId: emp.id,
      name: emp.name,
      type: leave.type,
      start, end,
      days: leave.days,
      reason: sanitize(leave.reason),
      msgId: ev.message.id,
    });

    const quota = await readQuota();
    const year = start.slice(0, 4);
    const used =
      rows
        .filter((r) => r.empId === emp.id && r.type === leave.type && r.start.startsWith(year))
        .reduce((s, r) => s + r.days, 0) + leave.days;
    const limit = quota[leave.type];
    const left = limit - used;

    return reply(
`✅ บันทึกการลาเรียบร้อย
🆔 ${emp.id}
👤 ${emp.name}
📋 ลา${leave.type}
📅 ${thDate(start)}${leave.days > 1 ? ' ถึง ' + thDate(end) : ''} (${leave.days} วัน)
📝 ${leave.reason}
📊 ใช้ลา${leave.type}แล้ว ${used}/${limit} วัน (เหลือ ${left})${left < 0 ? '\n⚠️ เกินโควตา' : ''}`
    );
  } catch (err) {
    console.error('handle error', err);
    try {
      await lineReply(ev.replyToken, '⚠️ ระบบขัดข้อง บันทึกไม่สำเร็จ กรุณาลองใหม่หรือแจ้งแอดมิน');
    } catch (_) { /* replyToken อาจหมดอายุ */ }
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
