const https = require('https');

// In-memory rate limiter (per instance, best-effort)
const rateLimitMap = new Map();
const RATE_LIMIT = 20; // requests
const RATE_WINDOW = 60 * 1000; // 1 minute in ms

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_WINDOW) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return false;
  }
  if (entry.count >= RATE_LIMIT) return true;
  entry.count++;
  rateLimitMap.set(ip, entry);
  return false;
}

// Returns true if hostname resolves to a private/internal address (SSRF risk)
function isPrivateHostname(hostname) {
  // Strip IPv6 brackets so [::1] and ::1 are both caught
  const h = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  return (
    // IPv4 private / loopback / link-local ranges
    /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.|0\.0\.0\.0)/.test(h) ||
    // IPv6 loopback
    h === '::1' ||
    // IPv6-mapped IPv4 private ranges
    /^::ffff:(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.|0\.0\.0\.0)/i.test(h) ||
    // Link-local IPv6 fe80::/10
    /^fe[89ab][0-9a-f]:/i.test(h) ||
    // Unique-local IPv6 fc00::/7
    /^f[cd][0-9a-f]{2}:/i.test(h)
  );
}

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': 'https://truthlensdetect.com',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Rate limiting
  const clientIp = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
  if (isRateLimited(clientIp)) {
    return {
      statusCode: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
      body: JSON.stringify({ error: 'Too many requests. Please try again later.' }),
    };
  }

  // Parse body - return 400 for malformed JSON
  let url;
  try {
    const body = JSON.parse(event.body);
    url = body.url;
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  // HTTPS-only: reject plain HTTP and other schemes
  if (!url || !url.startsWith('https://')) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Only HTTPS URLs are allowed' }) };
  }

  // Validate URL structure - return 400 for malformed input, not 500
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid URL' }) };
  }

  // Block private/internal URLs before the first request
  if (isPrivateHostname(parsedUrl.hostname)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Private URLs not allowed' }) };
  }

  try {
    const text = await fetchUrl(url);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': 'https://truthlensdetect.com',
      },
      body: JSON.stringify({ text }),
    };
  } catch {
    // Never expose raw Node.js error messages to clients
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to fetch URL' }),
    };
  }
};

function fetchUrl(url, redirectCount = 0) {
  if (redirectCount > 3) return Promise.reject(new Error('Too many redirects'));
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TruthLens/1.0)',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        timeout: 8000,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = res.headers.location;
          // Re-validate redirect destination to prevent SSRF via open redirects
          if (!redirectUrl.startsWith('https://')) {
            return reject(new Error('Redirect to non-HTTPS URL blocked'));
          }
          try {
            const redirectParsed = new URL(redirectUrl);
            if (isPrivateHostname(redirectParsed.hostname)) {
              return reject(new Error('Redirect to private URL blocked'));
            }
          } catch {
            return reject(new Error('Invalid redirect URL'));
          }
          return resolve(fetchUrl(redirectUrl, redirectCount + 1));
        }
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
          if (data.length > 500000) req.destroy();
        });
        res.on('end', () => {
          const text = data
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 10000);
          resolve(text);
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}
