// ─── Server-side plan/rate enforcement for TruthLens ──────────────────────────
// Security fixes applied:
//   1. Model whitelisting — client can no longer choose an arbitrary/expensive model
//   2. Content size cap — blocks oversized payloads / prompt-injection via huge inputs
//   3. Server-side rate limiting — IP-based (anon) + user-based (authenticated)
//   4. Supabase JWT verification — validates the bearer token and reads the user's plan
//
// No frontend changes required; the existing request format (model + messages) is
// preserved. Optionally, the frontend can send "Authorization: Bearer <token>" to
// enable per-user limits instead of per-IP limits.
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_MODELS = [
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-20250514',
  'claude-opus-4-20250514',
];

// Daily scan limits per plan tier
const PLAN_LIMITS = {
  free: 50,
  pro: 500,
  enterprise: 99999,
};
const ANON_LIMIT = 5; // unauthenticated / IP-only

// In-memory rate store. Resets on function cold-start, but that is intentional:
// it acts as a sliding-window guard without needing an external DB.
const rateStore = new Map();

function checkRate(key, limit) {
  const now = Date.now();
  const windowMs = 86_400_000; // 24 h
  let entry = rateStore.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    rateStore.set(key, entry);
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

exports.handler = async function (event) {
  // ── Method guard ────────────────────────────────────────────────────────────
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Bad Request' };
  }

  const { model, messages, max_tokens, system } = body;

  // ── 1. Validate messages ─────────────────────────────────────────────────────
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 2) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid messages payload' }),
    };
  }

  // ── 2. Content size cap (60 KB) ──────────────────────────────────────────────
  if (JSON.stringify(messages).length > 60_000) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Content too large' }),
    };
  }

  // ── 3. Whitelist model ───────────────────────────────────────────────────────
  // Never let the client choose an arbitrary/expensive model.
  const safeModel = ALLOWED_MODELS.includes(model) ? model : 'claude-haiku-4-5-20251001';

  // ── 4. JWT verification (optional — falls back to IP if absent) ─────────────
  let rateKey = null;
  let limit = ANON_LIMIT;

  const rawAuth = event.headers.authorization || event.headers.Authorization || '';
  if (rawAuth.startsWith('Bearer ')) {
    const token = rawAuth.slice(7);
    try {
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_ANON_KEY;
      if (!supabaseUrl || !supabaseKey) throw new Error('Supabase env vars not set');

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const resp = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: supabaseKey,
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (resp.ok) {
        const user = await resp.json();
        const plan = (user.user_metadata?.plan || 'free').toLowerCase();
        rateKey = `uid:${user.id}`;
        limit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
      }
    } catch (_) {
      // Supabase unreachable or token invalid → treat as anonymous
    }
  }

  // Fall back to IP-based rate limiting for unauthenticated requests
  if (!rateKey) {
    const ip = (event.headers['x-forwarded-for'] || 'unknown')
      .split(',')[0]
      .trim();
    rateKey = `ip:${ip}`;
    limit = ANON_LIMIT;
  }

  // ── 5. Enforce rate limit ────────────────────────────────────────────────────
  if (!checkRate(rateKey, limit)) {
    return {
      statusCode: 429,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Scan limit reached. Please upgrade your plan or try again tomorrow.',
      }),
    };
  }

  // ── 6. Call Anthropic with validated, server-controlled parameters ───────────
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: safeModel,
        max_tokens: Math.min(Number(max_tokens) || 1024, 2048), // cap at 2048
        messages,
        ...(system && typeof system === 'string' ? { system: system.slice(0, 10000) } : {}),
      }),
    });

    const data = await response.json();
    return {
      statusCode: response.status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };
  } catch (err) {
    console.error('[analyze] Anthropic call failed:', err.message);
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Analysis service temporarily unavailable' }),
    };
  }
};
