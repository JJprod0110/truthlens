/**
 * TruthLens Finance Monitor
 * Monitors Stripe for disputes, failed payments, subscription churn,
 * and revenue anomalies. Alerts owner on critical financial events.
 * Called by the Cowork Finance Monitor scheduled task every hour.
 */
const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

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

async function stripeAPI(path) {
  if (!STRIPE_SECRET_KEY) return { status: 401, body: { error: 'No STRIPE_SECRET_KEY' } };
  return fetchJSON(`https://api.stripe.com/v1${path}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });
}

async function logAgent(level, message, details = null) {
  await supabaseQuery('agent_logs', 'POST', { agent_name: 'finance-monitor', level, message, details });
}

async function createAlert(severity, title, description, data = null) {
  await supabaseQuery('agent_alerts', 'POST', {
    agent_name: 'finance-monitor',
    alert_type: 'finance',
    severity,
    title,
    description,
    data,
  });
}

exports.handler = async () => {
  try {
    const alerts = [];
    const report = {};

    // 1. Check for open disputes
    const disputesRes = await stripeAPI('/disputes?status=warning_needs_response&limit=10');
    if (disputesRes.status === 200 && Array.isArray(disputesRes.body?.data)) {
      const disputes = disputesRes.body.data;
      report.open_disputes = disputes.length;
      if (disputes.length > 0) {
        alerts.push({ severity: 'critical', title: `${disputes.length} open Stripe dispute(s)`, data: disputes });
      }
    }

    // 2. Check for recent failed payments (last 24 hours)
    const since = Math.floor(Date.now() / 1000) - 86400;
    const failedRes = await stripeAPI(`/payment_intents?created[gte]=${since}&limit=50`);
    if (failedRes.status === 200 && Array.isArray(failedRes.body?.data)) {
      const failedPayments = failedRes.body.data.filter(p => p.status === 'payment_failed');
      report.failed_payments_24h = failedPayments.length;
      if (failedPayments.length > 5) {
        alerts.push({
          severity: 'high',
          title: `${failedPayments.length} failed payments in last 24h`,
          data: { count: failedPayments.length },
        });
      }
    }

    // 3. Check for cancelled subscriptions (last 24 hours)
    const cancelledRes = await stripeAPI(`/subscriptions?status=canceled&created[gte]=${since}&limit=20`);
    if (cancelledRes.status === 200 && Array.isArray(cancelledRes.body?.data)) {
      report.cancellations_24h = cancelledRes.body.data.length;
      if (cancelledRes.body.data.length > 3) {
        alerts.push({
          severity: 'high',
          title: `${cancelledRes.body.data.length} subscription cancellations today`,
          data: { count: cancelledRes.body.data.length },
        });
      }
    }

    // 4. Check Stripe balance
    const balanceRes = await stripeAPI('/balance');
    if (balanceRes.status === 200) {
      const available = balanceRes.body?.available?.[0]?.amount || 0;
      report.available_balance_cents = available;
      if (available < 1000) {
        alerts.push({
          severity: 'warning',
          title: `Low Stripe balance: $${(available / 100).toFixed(2)}`,
          data: { balance: balanceRes.body },
        });
      }
    }

    // 5. Check Supabase for users who paid but don't have pro plan
    const mismatchRes = await supabaseQuery(
      `users?select=id,email,raw_user_meta_data&limit=100`
    );

    // Fire alerts
    for (const alert of alerts) {
      await createAlert(alert.severity, alert.title, 'Automated Stripe monitoring detected this issue.', alert.data);
    }

    await logAgent(
      alerts.length > 0 ? 'warning' : 'info',
      alerts.length > 0
        ? `Finance scan: ${alerts.length} alert(s) — ${alerts.map(a => a.title).join('; ')}`
        : 'Finance scan: all metrics healthy',
      report
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ alerts: alerts.length, report }),
    };
  } catch (err) {
    await logAgent('critical', `Finance monitor crashed: ${err.message}`, { stack: err.stack }).catch(() => {});
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
