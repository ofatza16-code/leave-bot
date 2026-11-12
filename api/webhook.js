const line = require('@line/bot-sdk');
const { parseLeave, sanitize } = require('../lib/parse');
const { fmt, nowStamp, todayISO, thDate } = require('../lib/dates');
const { readLeaves, appendLeave, findEmployee, bindLineUser, readQuota } = require('../lib/sheets');
const { buildDailySummary } = require('../lib/summary');

const lineClient = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_TOKEN,
});

async function rawBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('ok');
  const body = await rawBody(req);
  const sig = req.headers['x-line-signature'];
  if (!sig || !line.validateSignature(body, process.env.LINE_SECRET, sig)) {
    return res.status(401).end();
  }
  const events = JSON.parse(body.toString()).events || [];
  // ต้องตอบ 200 เสมอ ไม่งั้น LINE จะส่ง event ซ้ำ
  await Promise.allSettled(events.map(handle));
  res.status(200).end();
}

async function handle(ev) {
  try {
    if (ev.type !== 'message' || ev.message.type !== 'text') return;
    if (ev.source.type !== 'group') return;

    const text = ev.message.text.trim();
    const reply = (t) =>
      lineClient.replyMessage({ replyToken: ev.replyToken, messages: [{ type: 'text', text: t }] });

    // ช่วยตอนตั้งค่า: ขอ Group ID (ตอบเฉพาะตอนที่ยังไม่ได้ตั้ง LINE_GROUP_ID)
    if (text === '/groupid' && !process.env.LINE_GROUP_ID) {
      return reply(`Group ID: ${ev.source.groupId}`);
    }
    // รับคำสั่งเฉพาะกลุ่มที่กำหนด
    if (process.env.LINE_GROUP_ID && ev.source.groupId !== process.env.LINE_GROUP_ID) return;

    if (text === 'สรุปวันนี้') {
      return reply(buildDailySummary(await readLeaves(), todayISO()));
    }
    if (!text.startsWith('ลา')) return;

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
      await lineClient.replyMessage({
        replyToken: ev.replyToken,
        messages: [{ type: 'text', text: '⚠️ ระบบขัดข้อง บันทึกไม่สำเร็จ กรุณาลองใหม่หรือแจ้งแอดมิน' }],
      });
    } catch (_) { /* replyToken อาจหมดอายุ */ }
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
