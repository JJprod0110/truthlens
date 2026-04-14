const crypto = require('crypto');

// ─── Stripe signature verification (no SDK needed) ────────────────────────
function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader) throw new Error('Missing Stripe-Signature header');
  const parts = sigHeader.split(',').reduce((acc, part) => {
    const [key, val] = part.trim().split('=');
    if (key === 't') acc.timestamp = val;
    if (key === 'v1') acc.signatures.push(val);
    return acc;
  }, { timestamp: null, signatures: [] });

  if (!parts.timestamp) throw new Error('Missing timestamp');
  if (!parts.signatures.length) throw new Error('Missing v1 signature');

  const age = Math.abs(Date.now() / 1000 - parseInt(parts.timestamp, 10));
  if (age > 300) throw new Error('Webhook timestamp too old (' + age + 's)');

  const expected = crypto
    .createHmac('sha256', secret)
    .update(parts.timestamp + '.' + rawBody, 'utf8')
    .digest('hex');

  if (!parts.signatures.includes(expected)) throw new Error('Signature mismatch');
}

// ─── Stripe helpers ───────────────────────────────────────────────────────
async function getStripeCustomer(customerId) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) { console.warn('STRIPE_SECRET_KEY not set'); return null; }
  const res = await fetch('https://api.stripe.com/v1/customers/' + customerId, {
    headers: { Authorization: 'Bearer ' + key }
  });
  if (!res.ok) { console.error('Stripe customer fetch failed:', res.status); return null; }
  return res.json();
}

// ─── Supabase helpers ─────────────────────────────────────────────────────
async function findUserByEmail(email, supabaseUrl, serviceKey) {
  const res = await fetch(
    supabaseUrl + '/auth/v1/admin/users?email=' + encodeURIComponent(email) + '&per_page=1',
    { headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey } }
  );
  if (!res.ok) {
    console.error('Supabase user lookup failed:', res.status, await res.text());
    return null;
  }
  const data = await res.json();
  return data.users?.[0] || null;
}

async function setUserPlan(userId, plan, existingMeta, supabaseUrl, serviceKey) {
  const merged = Object.assign({}, existingMeta || {}, { plan });
  const res = await fetch(supabaseUrl + '/auth/v1/admin/users/' + userId, {
    method: 'PUT',
    headers: {
      apikey: serviceKey,
      Authorization: 'Bearer ' + serviceKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ data: merged })
  });
  if (!res.ok) throw new Error('Supabase update failed: ' + await res.text());
  console.log('Plan updated: user=' + userId + ' plan=' + plan);
  return res.json();
}

async function updatePlanByEmail(email, plan, supabaseUrl, serviceKey) {
  const user = await findUserByEmail(email, supabaseUrl, serviceKey);
  if (!user) { console.warn('No Supabase user for email:', email); return; }
  await setUserPlan(user.id, plan, user.user_metadata, supabaseUrl, serviceKey);
}

// ─── Main handler ─────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const WH_SECRET    = process.env.STRIPE_WEBHOOK_SECRET;

  if (!SUPABASE_URL || !SERVICE_KEY || !WH_SECRET) {
    console.error('Missing env vars');
    return { statusCode: 500, body: 'Server configuration error' };
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : (event.body || '');

  try {
    verifyStripeSignature(rawBody, event.headers['stripe-signature'], WH_SECRET);
  } catch (err) {
    console.error('Signature error:', err.message);
    return { statusCode: 400, body: 'Webhook signature error: ' + err.message };
  }

  let stripeEvent;
  try { stripeEvent = JSON.parse(rawBody); }
  catch (err) { return { statusCode: 400, body: 'Invalid JSON' }; }

  console.log('Stripe event:', stripeEvent.type, stripeEvent.id);

  try {
    switch (stripeEvent.type) {

      // Payment completed via payment link ─────────────────────────────────
      case 'checkout.session.completed': {
        const session = stripeEvent.data.object;
        if (session.payment_status !== 'paid') break;
        const email = session.customer_details?.email || session.customer_email;
        if (!email) { console.warn('No email in checkout session'); break; }
        await updatePlanByEmail(email, 'pro', SUPABASE_URL, SERVICE_KEY);
        break;
      }

      // Subscription activated or renewed ───────────────────────────────────
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = stripeEvent.data.object;
        if (sub.status !== 'active') break;
        const customer = await getStripeCustomer(sub.customer);
        if (!customer?.email) { console.warn('No email for customer', sub.customer); break; }
        await updatePlanByEmail(customer.email, 'pro', SUPABASE_URL, SERVICE_KEY);
        break;
      }

      // Subscription cancelled ───────────────────────────────────────────────
      case 'customer.subscription.deleted': {
        const sub = stripeEvent.data.object;
        const customer = await getStripeCustomer(sub.customer);
        if (!customer?.email) { console.warn('No email for customer', sub.customer); break; }
        await updatePlanByEmail(customer.email, 'free', SUPABASE_URL, SERVICE_KEY);
        break;
      }

      default:
        console.log('Unhandled event type:', stripeEvent.type);
    }
  } catch (err) {
    console.error('Error processing event:', err);
    return { statusCode: 200, body: JSON.stringify({ received: true, error: err.message }) };
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
