/**
 * TruthLens Master Orchestrator
 * Reads all agent_alerts from Supabase, compiles a status report,
 * and emails the owner when critical issues are unacknowledged.
 * Called every 30 minutes by the Cowork Master Orchestrator scheduled task.
 */
const https = require('https');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'gdizisgud@gmail.com';

async function fetchJSON(url, opts = {}) {
  return new Promise((res, rej) => {
    const req = https.request(url, opts, (r) => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { res({ status: r.statusCode, body: JSON.parse(d) }); } catch { res({ status: r.statusCode, body: d }); } });
    });
    req.on('error', rej); if (opts.body) req.write(opts.body); req.end();
  });
}
async function db(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', 'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal' } };
  if (body) opts.body = JSON.stringify(body);
  return fetchJSON(`${SUPABASE_URL}/rest/v1/${path}`, opts);
}
async function log(level, message, details = null) {
  await db('agent_logs', 'POST', { agent_name: 'master-orchestrator', level, message, details });
}

exports.handler = async () => {
  try {
    const alertsRes = await db('agent_alerts?acknowledged=eq.false&order=created_at.desc&limit=50');
    const alerts = Array.isArray(alertsRes.body) ? alertsRes.body : [];
    const logsRes = await db('agent_logs?order=created_at.desc&limit=20');
    const recentLogs = Array.isArray(logsRes.body) ? logsRes.body : [];

    // AI summary
    let summary = `${alerts.length} unacknowledged alert(s).`;
    if (ANTHROPIC_API_KEY) {
      const r = await fetchJSON('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 200,
          messages: [{ role: 'user', content: `In 2 sentences, summarize the health of truthlensdetect.com based on: ALERTS: ${JSON.stringify(alerts.slice(0,3))} LOGS: ${JSON.stringify(recentLogs.slice(0,3))}` }] })
      });
      summary = r.body?.content?.[0]?.text || summary;
    }

    // Email critical unnotified alerts
    const toEmail = alerts.filter(a => !a.email_sent && (a.severity === 'critical' || a.severity === 'high'));
    if (toEmail.length > 0 && RESEND_API_KEY) {
      const emailBody = `TruthLens Agent Report - ${new Date().toISOString()}\n\n${toEmail.map(a => `[${a.severity.toUpperCase()}] ${a.agent_name}: ${a.title}\n${a.description}\n`).join('\n')}\n\nReview: https://supabase.com/dashboard/project/teiqxbapfjbnsaifbspa/editor\n\n— TruthLens Agent System`;
      await fetchJSON('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'TruthLens Agents <agents@truthlensdetect.com>', to: [OWNER_EMAIL], subject: `${toEmail.length > 0 && toEmail[0].severity === 'critical' ? '🚨' : '⚠️'} TruthLens: ${toEmail.length} alert(s) need attention`, text: emailBody })
      });
      for (const a of toEmail) await db(`agent_alerts?id=eq.${a.id}`, 'PATCH', { email_sent: true });
    }

    await log(alerts.length > 0 ? 'warning' : 'info', `Orchestrator: ${summary}`, { alerts: alerts.length, emailed: toEmail.length });
    return { statusCode: 200, body: JSON.stringify({ status: alerts.length === 0 ? 'healthy' : 'alerts', alerts: alerts.length, emailed: toEmail.length, summary }) };
  } catch (err) {
    await log('critical', `Orchestrator crashed: ${err.message}`).catch(() => {});
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
