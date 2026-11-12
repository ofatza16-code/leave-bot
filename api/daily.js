const line = require('@line/bot-sdk');
const { readLeaves } = require('../lib/sheets');
const { todayISO } = require('../lib/dates');
const { buildDailySummary } = require('../lib/summary');

const lineClient = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_TOKEN,
});

module.exports = async (req, res) => {
  // Vercel Cron ส่ง Authorization: Bearer <CRON_SECRET> ให้เองเมื่อตั้งตัวแปรนี้
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end();
  }
  try {
    const text = buildDailySummary(await readLeaves(), todayISO());
    await lineClient.pushMessage({
      to: process.env.LINE_GROUP_ID,
      messages: [{ type: 'text', text }],
    });
    res.status(200).send('sent');
  } catch (err) {
    console.error('daily error', err);
    res.status(500).send('error');
  }
};
