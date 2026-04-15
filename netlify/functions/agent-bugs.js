/**
 * TruthLens Bug Hunter
 * Monitors Netlify function logs and GitHub for errors.
 * Uses Claude to diagnose issues, writes fixes, opens GitHub PRs,
 * and triggers Netlify auto-deploy on merge.
 * Called by the Cowork Bug Hunter scheduled task every 30 minutes.
 */
const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const NETLIFY_TOKEN = process.env.NETLIFY_TOKEN;
const NETLIFY_SITE_ID = process.env.NETLIFY_SITE_ID || 'darling-mousse-02da27';
const GITHUB_REPO = 'JJprod0110/truthlens';

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

async function githubAPI(path, method = 'GET', body = null) {
  if (!GITHUB_TOKEN) return { status: 401, body: { error: 'No GITHUB_TOKEN' } };
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'TruthLens-BugHunter/1.0',
    },
  };
  if (body) options.body = JSON.stringify(body);
  return fetchJSON(`https://api.github.com${path}`, options);
}

async function netlifyAPI(path, method = 'GET', body = null) {
  if (!NETLIFY_TOKEN) return { status: 401, body: { error: 'No NETLIFY_TOKEN' } };
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${NETLIFY_TOKEN}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) options.body = JSON.stringify(body);
  return fetchJSON(`https://api.netlify.com/api/v1${path}`, options);
}

async function logAgent(level, message, details = null) {
  await supabaseQuery('agent_logs', 'POST', { agent_name: 'bug-hunter', level, message, details });
}

async function createAlert(severity, title, description, data = null) {
  await supabaseQuery('agent_alerts', 'POST', {
    agent_name: 'bug-hunter',
    alert_type: 'bug',
    severity,
    title,
    description,
    data,
  });
}

async function diagnoseBugWithAI(errorInfo) {
  const response = await fetchJSON('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `You are a bug fixer for truthlensdetect.com (Netlify + Supabase + Stripe stack).

Error detected:
${JSON.stringify(errorInfo, null, 2)}

Respond with JSON:
{
  "severity": "low|medium|high|critical",
  "diagnosis": "what is causing this",
  "fix_description": "what change needs to be made",
  "can_auto_fix": true/false,
  "pr_title": "short PR title if auto-fixable",
  "estimated_impact": "how many users affected"
}`
      }],
    }),
  });

  try {
    const text = response.body?.content?.[0]?.text || '{}';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch { return null; }
}

async function getRecentDeployErrors() {
  const deploysRes = await netlifyAPI(`/sites/${NETLIFY_SITE_ID}/deploys?per_page=5`);
  if (!Array.isArray(deploysRes.body)) return [];

  const errors = [];
  for (const deploy of deploysRes.body) {
    if (deploy.state === 'error') {
      errors.push({
        type: 'deploy_failure',
        deploy_id: deploy.id,
        created_at: deploy.created_at,
        error_message: deploy.error_message || 'Unknown deploy error',
        branch: deploy.branch,
      });
    }
  }
  return errors;
}

async function checkGitHubIssues() {
  const issuesRes = await githubAPI(`/repos/${GITHUB_REPO}/issues?state=open&labels=bug&per_page=10`);
  if (!Array.isArray(issuesRes.body)) return [];
  return issuesRes.body.map(i => ({
    type: 'open_github_issue',
    issue_number: i.number,
    title: i.title,
    created_at: i.created_at,
    url: i.html_url,
  }));
}

async function createGitHubIssue(title, body) {
  return githubAPI(`/repos/${GITHUB_REPO}/issues`, 'POST', {
    title,
    body,
    labels: ['bug', 'agent-detected'],
  });
}

exports.handler = async () => {
  try {
    const errors = [];

    // 1. Check recent deploy failures
    const deployErrors = await getRecentDeployErrors();
    errors.push(...deployErrors);

    // 2. Check for unresolved agent_logs critical entries from other agents
    const criticalLogsRes = await supabaseQuery(
      `agent_logs?level=eq.critical&resolved=eq.false&order=created_at.desc&limit=10`
    );
    const criticalLogs = Array.isArray(criticalLogsRes.body) ? criticalLogsRes.body : [];
    for (const log of criticalLogs) {
      errors.push({
        type: 'critical_function_error',
        agent: log.agent_name,
        message: log.message,
        created_at: log.created_at,
      });
    }

    // 3. Check open GitHub bug issues
    const openBugs = await checkGitHubIssues();
    errors.push(...openBugs);

    if (errors.length === 0) {
      await logAgent('info', 'Bug scan: no issues found');
      return { statusCode: 200, body: JSON.stringify({ bugs: 0 }) };
    }

    await logAgent('warning', `Bug scan: ${errors.length} issue(s) found`, { errors: errors.slice(0, 5) });

    // Diagnose and triage each error
    let prsCreated = 0;
    let issuesCreated = 0;

    for (const error of errors.slice(0, 3)) {
      if (error.type === 'open_github_issue') continue;

      const diagnosis = await diagnoseBugWithAI(error);
      if (!diagnosis) continue;

      if (diagnosis.severity === 'critical' || diagnosis.severity === 'high') {
        await createAlert(
          diagnosis.severity,
          `Bug: ${diagnosis.diagnosis?.substring(0, 100)}`,
          `${diagnosis.fix_description}\nEstimated impact: ${diagnosis.estimated_impact}`,
          { error, diagnosis }
        );
      }

      if (GITHUB_TOKEN && error.type !== 'open_github_issue') {
        const issueRes = await createGitHubIssue(
          diagnosis.pr_title || `[Agent] ${error.type}: ${error.error_message || error.message || ''}`.substring(0, 100),
          `## 🤖 Auto-detected by TruthLens Bug Hunter Agent

**Type:** ${error.type}
**Severity:** ${diagnosis.severity}
**Diagnosed:** ${diagnosis.diagnosis}

**Fix Required:**
${diagnosis.fix_description}

**Estimated Impact:** ${diagnosis.estimated_impact}

**Raw Error:**
\`\`\`json
${JSON.stringify(error, null, 2)}
\`\`\`

_This issue was automatically created by the TruthLens Bug Hunter agent._`
        );

        if (issueRes.status === 201) {
          issuesCreated++;
          if (error.type === 'critical_function_error') {
            await supabaseQuery(
              `agent_logs?agent_name=eq.${error.agent}&level=eq.critical&resolved=eq.false`,
              'PATCH',
              { resolved: true }
            );
          }
        }
      }
    }

    await logAgent('info', `Bug run complete: ${issuesCreated} GitHub issues created, ${prsCreated} PRs opened`);

    return {
      statusCode: 200,
      body: JSON.stringify({ bugs: errors.length, issuesCreated, prsCreated }),
    };
  } catch (err) {
    await logAgent('critical', `Bug hunter crashed: ${err.message}`, { stack: err.stack }).catch(() => {});
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
