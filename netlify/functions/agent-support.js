/**
 * TruthLens Support Agent
 * Reads open support_tickets from Supabase, generates AI responses via Claude,
 * sends email replies via Resend, and resolves tickets automatically.
 * Called every 10 minutes by the Cowork Support Agent scheduled task.
 */
const https = require('https');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

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
  await db('agent_logs', 'POST', { agent_name: 'support-agent', level, message, details });
}

async function generateReply(ticket) {
  if (!ANTHROPIC_API_KEY) return null;
  const r = await fetchJSON('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001', max_tokens: 600,
      system: `You are TruthLens customer support for truthlensdetect.com — an AI-powered media authenticity detector. Plans: Free (50/mo), Pro (500/mo), Enterprise (unlimited). Be helpful, warm, professional. Sign off as "TruthLens Support Team".`,
      messages: [{ role: 'user', content: `Reply to this support ticket:\nSubject: ${ticket.subject || 'Support Request'}\nFrom: ${ticket.customer_name || 'Customer'}\nMessage: ${ticket.message}\n\nWrite just the email body.` }]
    })
  });
  return r.body?.content?.[0]?.text || null;
}

async function sendEmail(to, subject, text) {
  if (!RESEND_API_KEY || !to) return false;
  const r = await fetchJSON('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'TruthLens Support <support@truthlensdetect.com>', to: [to], subject, text })
  });
  return r.status < 300;
}

exports.handler = async () => {
  try {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const res = await db(`support_tickets?status=eq.open&created_at=lt.${cutoff}&order=created_at.asc&limit=10`);
    const tickets = Array.isArray(res.body) ? res.body : [];

    if (tickets.length === 0) {
      await log('info', 'No open tickets to process');
      return { statusCode: 200, body: JSON.stringify({ processed: 0 }) };
    }

    let processed = 0, escalated = 0;
    for (const ticket of tickets) {
      await db(`support_tickets?id=eq.${ticket.id}`, 'PATCH', { status: 'in_progress' });
      const reply = await generateReply(ticket);
      if (!reply) {
        await db(`support_tickets?id=eq.${ticket.id}`, 'PATCH', { status: 'escalated', agent_notes: 'AI failed — needs manual review' });
        escalated++; continue;
      }
      const sent = await sendEmail(ticket.customer_email, `Re: ${ticket.subject || 'Your Support Request'}`, reply);
      await db(`support_tickets?id=eq.${ticket.id}`, 'PATCH', {
        status: 'resolved', ai_response: reply,
        agent_notes: sent ? 'AI reply sent via email' : 'AI reply generated (no email — check RESEND_API_KEY)',
        resolved_at: new Date().toISOString()
      });
      processed++;
    }

    if (escalated > 2) {
      await db('agent_alerts', 'POST', { agent_name: 'support-agent', alert_type: 'support', severity: 'high', title: `${escalated} tickets need manual review`, description: 'Support agent could not auto-resolve these tickets.', data: { escalated, processed } });
    }
    await log('info', `Support: ${processed} resolved, ${escalated} escalated`, { processed, escalated });
    return { statusCode: 200, body: JSON.stringify({ processed, escalated }) };
  } catch (err) {
    await log('critical', `Support agent crashed: ${err.message}`).catch(() => {});
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
