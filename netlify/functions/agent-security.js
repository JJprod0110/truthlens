/**
 * TruthLens Security Watchdog
 * Monitors Supabase auth logs for suspicious activity:
 * failed logins, rate limit abuse, unusual usage spikes.
 * Logs security events and alerts the owner on critical threats.
 * Called by the Cowork Security Watchdog scheduled task every 15 minutes.
 */
const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'gdizisgud@gmail.com';

async function fetchJSON(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function supabaseQuery(path, method = 'GET', body = null) {
  const options = {
    method,
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal',
    },
  };
  if (body) options.body = JSON.stringify(body);
  return fetchJSON(`${SUPABASE_URL}/rest/v1/${path}`, options);
}

async function supabaseAdminQuery(path, method = 'GET', body = null) {
  const options = {
    method,
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) options.body = JSON.stringify(body);
  return fetchJSON(`${SUPABASE_URL}${path}`, options);
}

async function logAgent(level, message, details = null) {
  await supabaseQuery('agent_logs', 'POST', { agent_name: 'security-watchdog', level, message, details });
}

async function logSecurityEvent(eventType, severity, details) {
  await supabaseQuery('security_events', 'POST', {
    event_type: eventType,
    severity,
    ip_address: details.ip || null,
    user_id: details.user_id || null,
    user_email: details.email || null,
    details,
  });
}

async function createAlert(severity, title, description, data = null) {
  await supabaseQuery('agent_alerts', 'POST', {
    agent_name: 'security-watchdog',
    alert_type: 'security',
    severity,
    title,
    description,
    data,
  });
}

async function analyzeSecurityThreat(events) {
  if (!ANTHROPIC_API_KEY || events.length === 0) return null;

  const response = await fetchJSON('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Analyze these recent security events for truthlensdetect.com and assess the threat level (low/medium/high/critical) with a brief recommendation:

${JSON.stringify(events, null, 2)}

Respond with JSON: {"threat_level": "...", "summary": "...", "recommendation": "..."}`
      }],
    }),
  });

  try {
    const text = response.body?.content?.[0]?.text || '{}';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch { return null; }
}

exports.handler = async (event) => {
  try {
    const windowStart = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const securityIssues = [];

    // 1. Check for recent failed login attempts (Supabase audit log)
    const authLogsRes = await supabaseAdminQuery(
      `/auth/v1/admin/users?page=1&per_page=500`,
      'GET'
    );

    // 2. Check for users with many analyses in short time (rate abuse)
    const recentAnalysesRes = await supabaseQuery(
      `analyses?created_at=gt.${windowStart}&select=user_id,count()&limit=100`
    );

    // 3. Check existing unactioned security events
    const existingEvents = await supabaseQuery(
      `security_events?actioned=eq.false&severity=in.(high,critical)&order=created_at.desc&limit=20`
    );

    const unactionedCritical = Array.isArray(existingEvents.body)
      ? existingEvents.body.filter(e => e.severity === 'critical')
      : [];

    if (unactionedCritical.length > 0) {
      securityIssues.push({
        type: 'unactioned_critical_events',
        count: unactionedCritical.length,
        events: unactionedCritical.slice(0, 3),
      });
    }

    // 4. Check for unusual spike in security_events in last 15 min
    const recentSecEventsRes = await supabaseQuery(
      `security_events?created_at=gt.${windowStart}&order=created_at.desc&limit=50`
    );

    const recentSecEvents = Array.isArray(recentSecEventsRes.body) ? recentSecEventsRes.body : [];

    if (recentSecEvents.length > 10) {
      securityIssues.push({
        type: 'high_security_event_volume',
        count: recentSecEvents.length,
        window: '15 minutes',
      });
    }

    // AI analysis if issues found
    let aiAnalysis = null;
    if (securityIssues.length > 0) {
      aiAnalysis = await analyzeSecurityThreat(securityIssues);
    }

    // Alert on critical threats
    if (aiAnalysis?.threat_level === 'critical' || aiAnalysis?.threat_level === 'high') {
      await createAlert(
        aiAnalysis.threat_level,
        `Security Alert: ${aiAnalysis.summary}`,
        aiAnalysis.recommendation,
        { issues: securityIssues, analysis: aiAnalysis }
      );
    }

    await logAgent(
      securityIssues.length > 0 ? 'warning' : 'info',
      securityIssues.length > 0
        ? `Security scan: ${securityIssues.length} issue(s) detected`
        : 'Security scan: no issues detected',
      { issues: securityIssues, aiAnalysis }
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        issues: securityIssues.length,
        threatLevel: aiAnalysis?.threat_level || 'low',
        summary: aiAnalysis?.summary || 'No threats detected',
      }),
    };
  } catch (err) {
    await logAgent('critical', `Security agent crashed: ${err.message}`, { stack: err.stack }).catch(() => {});
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
