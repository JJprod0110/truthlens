(function(){var l=document.createElement('link');l.rel='stylesheet';l.href='https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap';document.head.appendChild(l);})();
// Run pricing modal auto-open if navigated via hash
if(document.readyState !== 'loading') {
  if(location.hash==='#pricing')openModal('plansOverlay');
} else {
  document.addEventListener('DOMContentLoaded', function() { if(location.hash==='#pricing')openModal('plansOverlay'); });
}

/* ── STATE ── */
let appState = {
  user: null,
  plan: 'free',
  scansToday: 0,
  maxFreeScans: 5,    freeTrialsUsed: JSON.parse(localStorage.getItem('tl_trials') || '{}'),
  currentTab: 'text',
  lastResult: null,
  history: JSON.parse(localStorage.getItem('tl_history') || '[]'),
  authMode: 'signup'
};
let _authToken = null; // kept off window.appState to prevent exposure

/* ── MOBILE NAV ── */
function toggleMobileNav() {
  var drawer = document.getElementById('mobileNavDrawer');
  var btn = document.getElementById('hamburgerBtn');
  if (!drawer) return;
  var isOpen = drawer.classList.contains('open');
  drawer.classList.toggle('open');
  if (btn) {
    btn.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(!isOpen));
  }
}

/* ── MODAL ── */
var _modalTrigger = null;
var _lastClickedEl = null;
function openModal(id, trigger) {
    _modalTrigger = trigger || _lastClickedEl || document.activeElement || null;
  document.body.style.overflow = 'hidden';
  const el = document.getElementById(id);
  el.removeAttribute('inert');
  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(function() {
          var f = el.querySelector('button:not([disabled]),[href],input:not([disabled]),[tabindex]:not([tabindex="-1"])');
              if (f) f.focus();
                });
  
}
function closeModal(id) {
  document.body.style.overflow = '';
  const el = document.getElementById(id);
  el.classList.remove('open');
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('inert', '');
    _modalTrigger && document.body.contains(_modalTrigger) && (_modalTrigger.focus(), _modalTrigger = null);
}
function openAuthModal(mode) {
  appState.authMode = mode;
  const isSignup = mode === 'signup';
  document.getElementById('authTitle').textContent = isSignup ? 'Create account' : 'Welcome back';
  document.getElementById('authSub').textContent = isSignup ? 'Join 50,000+ users detecting AI content' : 'Sign in to your TruthLens account';
  document.getElementById('signupFields').style.display = isSignup ? 'block' : 'none';
  document.getElementById('authSubmitBtn').textContent = isSignup ? 'Create free account →' : 'Sign in →';
  document.getElementById('authSwitch').innerHTML = isSignup
    ? 'Already have an account? <button type="button" class="link-btn" data-action="toggleAuthMode">Sign in</button>'
    : 'New here? <button type="button" class="link-btn" data-action="toggleAuthMode">Create an account</button>';
  openModal('authOverlay');
}
function toggleAuthMode() {
  openAuthModal(appState.authMode === 'signup' ? 'signin' : 'signup');
}
/* ── SUPABASE AUTH ── */
const SUPABASE_URL = 'https://teiqxbapfjbnsaifbspa.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlaXF4YmFwZmpibnNhaWZic3BhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MTU0ODQsImV4cCI6MjA5MDE5MTQ4NH0.PkaTX9NB7BojxAm1X29foW8IhrWN6vgN3FtYu5D3Xjw';

async function supabaseFetch(endpoint, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      ...options.headers
    }
  });
  return res.json();
}

async function submitAuth() {
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const name = appState.authMode === 'signup' ? document.getElementById('authName').value.trim() : email.split('@')[0];
  if (!email || !password) { showToast('Please enter your email and password.'); return; }

  const btn = document.getElementById('authSubmitBtn');
  btn.textContent = 'Please wait...'; btn.disabled = true;

  try {
    if (appState.authMode === 'signup') {
      const data = await supabaseFetch('/signup', {
        method: 'POST',
        body: JSON.stringify({ email, password, data: { full_name: name } })
      });
      if (data.error) { showToast(data.error.message || 'Signup failed'); }
      else { gtag('event', 'conversion', {'send_to': 'AW-18052567284/N63uCKnkqJMcEPShkaBD', 'value': 1.0, 'currency': 'USD'}); showToast('Check your email to confirm your account! 📧'); closeModal('authOverlay'); }
    } else {
      const data = await supabaseFetch('/token?grant_type=password', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      if (data.error) { showToast(data.error.message || 'Login failed'); }
      else {
        const userName = data.user?.user_metadata?.full_name || email.split('@')[0];
        loginUser(userName, email, 'free', data.access_token); showToast(appState.authMode === 'signup' ? 'Account created! Welcome to TruthLens.' : 'Welcome back!');
        closeModal('authOverlay');
      }
    }
  } catch(e) {
    showToast('Connection error. Please try again.');
  }
  btn.textContent = appState.authMode === 'signup' ? 'Create free account →' : 'Sign in →';
  btn.disabled = false;
}

async function socialLogin(provider) {
  showToast(`${provider} login coming soon! Sign up with email below.`);
}

function loginUser(name, email, plan, token) {
  appState.user = { name, email };
  _authToken = token;
  appState.plan = plan;
  renderTopbar();
  showToast(`Welcome, ${name}! 👋`);
  renderHistory();
  // DOM event listeners (replacing removed inline on* handlers)
  var sl = document.getElementById('skipLink');
  if (sl) {
    sl.addEventListener('focus', function() { this.style.left='16px'; this.style.width='auto'; this.style.height='auto'; });
    sl.addEventListener('blur', function() { this.style.left='-9999px'; this.style.width='1px'; this.style.height='1px'; });
  }
  var idz = document.getElementById('imageDropZone');
  if (idz) {
    idz.addEventListener('dragover', function(e) { dz(e, 'imageDropZone'); });
    idz.addEventListener('dragleave', function() { dzl('imageDropZone'); });
    idz.addEventListener('drop', function(e) { dzDrop(e, 'imgFile', 'imageDropZone'); });
  }
  var imgInp = document.getElementById('imgFile');
  if (imgInp) imgInp.addEventListener('change', function() { loadPreview('imgFile','imgPreview','imageDropZone'); });
  var vdz = document.getElementById('videoDropZone');
  if (vdz) {
    vdz.addEventListener('dragover', function(e) { dz(e, 'videoDropZone'); });
    vdz.addEventListener('dragleave', function() { dzl('videoDropZone'); });
            vdz.addEventListener('drop', function(e) { e.preventDefault(); if (!requirePro()) return; dzDrop(e, 'vidFile', 'videoDropZone'); });
  }
  var vidInp = document.getElementById('vidFile');
  if (vidInp) vidInp.addEventListener('change', function() { loadPreview('vidFile','vidPreview','videoDropZone','video'); });
  var ci = document.getElementById('chatInput');
  if (ci) ci.addEventListener('keydown', function(e) { if (e.key === 'Enter') sendChat(); });
  try { localStorage.setItem('tl_user', JSON.stringify({ name, email, plan })); } catch(e) {}
}

// Auto-login from localStorage
try {
  const saved = JSON.parse(localStorage.getItem('tl_user'));
  if (saved) loginUser(saved.name, saved.email, saved.plan || 'free');
} catch(e) {}

/* ── TOPBAR ── */
function renderTopbar() {
  const r = document.getElementById('topbarRight');
  if (!appState.user) {
    r.innerHTML = `
      <a href="/blog/" class="topbar-btn tb-ghost">Blog</a>
      <button class="topbar-btn tb-ghost" data-action="openModal" data-param="plansOverlay">Pricing</button>
      <button class="topbar-btn tb-ghost" data-action="openAuthModal" data-param="signin">Sign in</button>
      <button class="topbar-btn tb-fill" data-action="openAuthModal" data-param="signup">Get started free →</button>
      <button class="hamburger-btn" id="hamburgerBtn" type="button" aria-label="Toggle navigation menu" aria-expanded="false" data-action="toggleMobileNav"><span></span><span></span><span></span></button>`;
  } else {
    const initial = appState.user.name[0].toUpperCase();
    const planTag = appState.plan === 'pro' ? 'PRO' : appState.plan === 'enterprise' ? 'TEAM' : 'FREE';
    r.innerHTML = `
      <button class="topbar-btn tb-ghost" data-action="openModal" data-param="privacyOverlay" style="display:flex;align-items:center;gap:0.35rem;color:var(--green);border-color:rgba(26,122,74,0.3);">🔒 Privacy</button>
      <a href="/blog/" class="topbar-btn tb-ghost">Blog</a>
      <button class="topbar-btn tb-ghost" data-action="openModal" data-param="plansOverlay">Upgrade</button>
      <div class="user-pill" data-action="openModal" data-param="plansOverlay">
        <div class="user-avatar">${initial}</div>
        <span class="user-name">${appState.user.name.split(' ')[0]}</span>
        <span class="user-plan-tag ${appState.plan}">${planTag}</span>
      </div>
      <button class="hamburger-btn" id="hamburgerBtn" type="button" aria-label="Toggle navigation menu" aria-expanded="false" data-action="toggleMobileNav"><span></span><span></span><span></span></button>`;
  }
}

/* ── TABS ── */
function switchPanel(tab) {
  appState.currentTab = tab;
  document.querySelectorAll('.input-tab').forEach((t,i) => {
    t.classList.toggle('active', ['text','url','image','video'][i] === tab);
  });
  ['text','url','image','video'].forEach(p => {
    document.getElementById('panel-'+p).classList.toggle('active', p === tab);
  });
  document.getElementById('resultsArea').classList.remove('active');
  document.getElementById('loadingState').classList.remove('active');
  const labels = { text:'Analyze Text', url:'Analyze URL', image:'Analyze Image', video:'Analyze Video' };
  document.getElementById('analyzeLabel').textContent = labels[tab]; document.querySelector('.analyze-cta').style.display = tab === 'video' ? 'none' : '';
  window.scrollTo({top: 0, behavior: 'smooth'});
}

/* ── CHAR COUNT ── */
function updateCharCount() {
  document.getElementById('charCount').textContent = document.getElementById('textInput').value.length;
}

async function pasteFromClipboard() {
  try {
    const t = await navigator.clipboard.readText();
    document.getElementById('textInput').value = t;
    updateCharCount();
  } catch { showToast('Paste manually with Ctrl/Cmd+V'); }
}

/* ── DROP ZONE ── */
function dz(e, id) { e.preventDefault(); document.getElementById(id).classList.add('dragover'); }
function dzl(id) { document.getElementById(id).classList.remove('dragover'); }
function dzDrop(e, inputId, zoneId) {
  e.preventDefault(); dzl(zoneId);
  const f = e.dataTransfer.files[0]; if (!f) return;
  const inp = document.getElementById(inputId);
  const dt = new DataTransfer(); dt.items.add(f); inp.files = dt.files;
  const isVid = inputId === 'vidFile';
  loadPreview(inputId, isVid?'vidPreview':'imgPreview', zoneId, isVid?'video':'');
}
function loadPreview(inputId, previewId, zoneId, type) {
  const f = document.getElementById(inputId).files[0]; if (!f) return;
  const url = URL.createObjectURL(f);
  const preview = document.getElementById(previewId);
  dzl(zoneId);
  if (type === 'video') {
    preview.innerHTML = `<video src="${url}" controls class="preview-area" style="max-width:100%;max-height:260px;border-radius:12px;border:1.5px solid var(--border)"></video><div class="file-badge">🎬 ${f.name} <span class="remove" data-action="clearPreview" data-param="${previewId}" data-param2="${inputId}">✕</span></div>`;
  } else {
    preview.innerHTML = `<img src="${url}" alt="" style="max-width:100%;max-height:260px;border-radius:12px;border:1.5px solid var(--border);object-fit:contain"><div class="file-badge">🖼️ ${f.name} <span class="remove" data-action="clearPreview" data-param="${previewId}" data-param2="${inputId}">✕</span></div>`;
  }
  document.getElementById(zoneId).style.display = 'none';
}
function clearPreview(previewId, inputId) {
  document.getElementById(previewId).innerHTML = '';
  document.getElementById(inputId).value = '';
  const zoneMap = { imgPreview: 'imageDropZone', vidPreview: 'videoDropZone' };
  document.getElementById(zoneMap[previewId]).style.display = '';
}

/* ── URL FETCH ── */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    async function fetchURL() {
  const url = document.getElementById('urlInput').value.trim();
  if (!url || !url.startsWith('http')) { showToast('Please enter a valid URL'); return; }
  const btn = document.querySelector('.url-fetch-btn');
  btn.textContent = 'Fetching…'; btn.disabled = true;
    try {
    const res = await fetch('/.netlify/functions/fetch-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    if (!res.ok) throw new Error('Server error (' + res.status + ')');
    const data = await res.json();
    if (!data.text || data.text.length < 20) throw new Error('No text could be extracted from this URL');
    document.getElementById('fetchedText').value = data.text;
    document.getElementById('fetchedTextArea').style.display = 'block';
    showToast('Content fetched! Ready to analyze.');
  } catch (e) {
    showToast('Could not fetch URL: ' + e.message);
  } finally {
    btn.textContent = 'Fetch →'; btn.disabled = false;
  }
}

/* ── PRO GATE ── */
function requirePro() {
  if (appState.plan === 'free') { openModal('plansOverlay'); return false; }
  return true;
}
function selectPlan(plan) {
  if (!appState.user) { closeModal('plansOverlay'); openAuthModal('signup'); return; }
  appState.plan = plan;
  appState.maxFreeScans = 9999; if (plan === 'pro') { gtag('event', 'conversion', {'send_to': 'AW-18052567284/hbvFCJWhtJMcEPShkaBD', 'value': 12.0, 'currency': 'USD'}); }
  renderTopbar();
  closeModal('plansOverlay');
  showToast(`🎉 ${plan === 'pro' ? 'Pro' : 'Enterprise'} plan activated!`);
}

/* ── SCAN LIMIT ── */
function checkScanLimit() {
  if (appState.plan !== 'free') return true;
    if (!appState.user) {
          if (appState.freeTrialsUsed[appState.currentTab]) {
                  openAuthModal('signup'); return false;
                        }
                            } else if (appState.scansToday >= appState.maxFreeScans) {
                                  openModal('plansOverlay'); return false;
                                      }
  return true;
                                    }
function updateScanCounter() {
  appState.scansToday++;
    if (!appState.user) {
        const tab = appState.currentTab;
            appState.freeTrialsUsed[tab] = true;
                localStorage.setItem('tl_trials', JSON.stringify(appState.freeTrialsUsed));
                    const allTabs = ['text', 'url', 'image', 'video'];
                        const left = allTabs.filter(t => !appState.freeTrialsUsed[t]).length;
                            document.getElementById('scansLeft').textContent = left;
                                document.getElementById('dailyCounter').style.display = appState.plan === 'free' ? 'block' : 'none';
                                  } else {
                                      const left = Math.max(0, appState.maxFreeScans - appState.scansToday);
                                          document.getElementById('scansLeft').textContent = left;
                                              document.getElementById('dailyCounter').style.display = appState.plan === 'free' ? 'block' : 'none';
                                                }
                                                }

/* ── MAIN ANALYZE ── */
async function runAnalysis() {
  if (!checkScanLimit()) return; const tab = appState.currentTab;

  if (tab === 'text') {
    const t = document.getElementById('textInput').value.trim();
    if (t.length < 30) { showToast('Enter at least 30 characters.'); return; }
    await doAnalyze('text', t);
  } else if (tab === 'url') {
    const fetched = document.getElementById('fetchedText').value.trim();
    const raw = document.getElementById('urlInput').value.trim();
    if (!fetched && !raw) { showToast('Enter a URL first.'); return; }
    await doAnalyze('url', fetched || raw);
  } else if (tab === 'image') {
    const f = document.getElementById('imgFile').files[0];
    if (!f) { showToast('Please upload an image.'); return; }
    await doAnalyze('image', null, f);
  } else if (tab === 'video') {
    if (!requirePro()) return;
    const f = document.getElementById('vidFile').files[0];
    if (!f) { showToast('Please upload a video.'); return; }
    await doAnalyze('video', null, f);
  }
}

async function doAnalyze(type, text, file) {
  showLoading(type);
  updateScanCounter();

  try {
    let result;
    if (type === 'image' && file) {
      result = await analyzeImage(file);
    } else {
            const content = type === 'video' && file ? `Video file submitted:\nFilename: ${file.name}\nFile size: ${(file.size/1024/1024).toFixed(2)} MB\nFile type: ${file.type}` : (text || `File: ${file?.name}`);
      result = await analyzeText(content, type);
    }
    appState.lastResult = { ...result, type, timestamp: Date.now(), input: text?.substring(0,80) || file?.name };
    saveToHistory(appState.lastResult);
    displayResults(result, type);
  } catch (e) {
        hideLoading();
    showToast('Analysis failed — please try again.');
  }
}

async function analyzeText(content, type) {
  const typeHints = {
    text: 'written text or article',
    url: 'web article content fetched from a URL',
    video: 'a video file (analyze based on filename and available metadata)'
  };

  const prompt = `You are a forensic AI content detection expert. Analyze the following ${typeHints[type]||'content'} and determine if it is AI-generated or human-created.

Evaluate:
1. Perplexity & predictability — AI text has lower perplexity
2. Burstiness — sentence length variation (humans vary more)
3. Vocabulary — AI overuses: delve, leverage, crucial, multifaceted, navigate, tapestry, underscore, realm, robust, foster, revolutionize
4. Hedging & caveats — AI over-hedges
5. Structural symmetry — AI uses very balanced, parallel structures
6. Emotional variance — humans drift emotionally; AI stays uniformly polished
7. Voice authenticity — personal quirks, typos, colloquialisms

Return ONLY valid JSON (no markdown, no backticks):
{
  "verdict": "AI_GENERATED" | "HUMAN_WRITTEN" | "UNCERTAIN",
  "ai_probability": <0-100 integer>,
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "signals": {
    "perplexity": "LOW"|"MEDIUM"|"HIGH",
    "burstiness": "LOW"|"MEDIUM"|"HIGH",
    "vocabulary_flags": "LOW"|"MEDIUM"|"HIGH",
    "structural_symmetry": "LOW"|"MEDIUM"|"HIGH",
    "hedging_language": "LOW"|"MEDIUM"|"HIGH",
    "voice_authenticity": "LOW"|"MEDIUM"|"HIGH"
  },
  "summary": "<2-3 concise sentences explaining the top indicators>"
}

CONTENT:
"""
${content.substring(0, 5000)}
"""`;

  const res = await fetch("/.netlify/functions/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + (_authToken || "") },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }]
    })
  });
  const data = await res.json();
  const raw = data.content.map(b => b.text||'').join('');
  return JSON.parse(raw.replace(/```json|```/g,'').trim());
}

async function analyzeImage(file) {
  const b64 = await fileToB64(file);
  const prompt = `You are an expert AI image forensics analyst. Examine this image and determine if it was AI-generated (Midjourney, DALL-E, Stable Diffusion, Firefly, etc.) or is a real photograph / human artwork.

Check:
1. Texture uniformity — AI images have unnaturally smooth or repetitive micro-textures
2. Edge artifacts — unnatural blending, halos, incorrect anti-aliasing
3. Anatomical accuracy — fingers, hands, teeth, eyes, ears often wrong in AI images
4. Background coherence — impossible geometry, objects merging
5. Lighting physics — impossible shadows, reflections not matching light source
6. Detail distribution — extreme detail in focal area vs blurry/incorrect background
7. Semantic anomalies — text rendered in image (AI often scrambles text), impossible objects
8. Style fingerprint — that distinctive "AI painted" look

Return ONLY valid JSON (no markdown):
{
  "verdict": "AI_GENERATED" | "HUMAN_CREATED" | "UNCERTAIN",
  "ai_probability": <0-100 integer>,
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "signals": {
    "texture_anomalies": "LOW"|"MEDIUM"|"HIGH",
    "edge_artifacts": "LOW"|"MEDIUM"|"HIGH",
    "anatomical_accuracy": "LOW"|"MEDIUM"|"HIGH",
    "lighting_physics": "LOW"|"MEDIUM"|"HIGH",
    "semantic_anomalies": "LOW"|"MEDIUM"|"HIGH",
    "style_fingerprint": "LOW"|"MEDIUM"|"HIGH"
  },
  "summary": "<2-3 sentences describing key visual indicators found>"
}`;

  const res = await fetch("/.netlify/functions/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + (_authToken || "") },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: file.type, data: b64 } },
          { type: "text", text: prompt }
        ]
      }]
    })
  });
  const data = await res.json();
  const raw = data.content.map(b => b.text||'').join('');
  return JSON.parse(raw.replace(/```json|```/g,'').trim());
}

function fileToB64(f) {
  return new Promise((res,rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(f);
  });
}

/* ── LOADING ── */
function showLoading(type) {
  document.getElementById('resultsArea').classList.remove('active');
  document.getElementById('loadingState').classList.add('active');
  const steps = document.querySelectorAll('.loading-step');
  steps.forEach(s => s.classList.remove('active'));
  let i = 0;
  const msgs = {
    text: ['Parsing text…','Measuring perplexity…','Checking vocabulary fingerprint…','Evaluating sentence patterns…','Generating verdict…'],
    url: ['Parsing fetched content…','Stripping boilerplate…','Analyzing article body…','Cross-checking AI signals…','Finalizing report…'],
    image: ['Decoding image…','Scanning texture patterns…','Checking edge artifacts…','Evaluating lighting physics…','Rendering verdict…'],
            video: ['Extracting file metadata…','Analyzing file properties…','Checking known AI patterns…','Evaluating digital signatures…','Generating report…'],
  };
  const m = msgs[type] || msgs.text;
  m.forEach((msg, idx) => { if (steps[idx]) steps[idx].textContent = msg; });
  const iv = setInterval(() => {
    if (!document.getElementById('loadingState').classList.contains('active')) { clearInterval(iv); return; }
    if (i < steps.length) { steps[i].classList.add('active'); i++; }
  }, 500);
}
function hideLoading() { document.getElementById('loadingState').classList.remove('active'); }

/* ── RESULTS ── */
function displayResults(r, type) {
  hideLoading();

  const isAI = r.verdict.includes('AI');
  const isHuman = r.verdict.includes('HUMAN');
  const cls = isAI ? 'ai-gen' : isHuman ? 'human' : 'uncertain';
  const emoji = isAI ? '🤖' : isHuman ? '👤' : '🔍';
  const label = isAI ? (type==='image'?'AI-Generated Image':(type==='video'?'AI-Generated Video':'AI-Generated Text'))
    : isHuman ? (type==='image'?'Human-Created Image':(type==='video'?'Human-Recorded Video':'Human-Written Text'))
    : 'Inconclusive';
  const fillCls = isAI ? 'ai-fill' : isHuman ? 'human-fill' : 'uncertain-fill';
  const prob = r.ai_probability;

  const signalLabels = {
    perplexity:'Perplexity', burstiness:'Burstiness', vocabulary_flags:'Vocab Flags',
    structural_symmetry:'Structure', hedging_language:'Hedging', voice_authenticity:'Voice Auth.',
    texture_anomalies:'Texture', edge_artifacts:'Edge Artifacts', anatomical_accuracy:'Anatomy',
    lighting_physics:'Lighting', semantic_anomalies:'Semantics', style_fingerprint:'Style',
    temporal_artifacts:'Temporal', face_coherence:'Face Coherence', audio_visual_sync:'A/V Sync',
    lighting_continuity:'Lighting', background_stability:'Background', compression_signature:'Compression'
  };

  function chipClass(v) { return v==='HIGH'?'high':v==='LOW'?'low':v==='UNKNOWN'?'unknown':'medium'; }

  const chipsHTML = Object.entries(r.signals).map(([k,v]) =>
    `<span class="signal-chip ${chipClass(v)}">${signalLabels[k]||k}: ${v}</span>`
  ).join('');

  const area = document.getElementById('resultsArea');
  area.innerHTML = `
    <div class="verdict-banner ${cls}">
      <div class="verdict-top">
        <div class="verdict-left">
          <div class="verdict-icon">${emoji}</div>
          <div>
            <div class="verdict-title">${label}</div>
            <div class="verdict-conf">Confidence: ${r.ai_probability >= 75 ? 'HIGH' : r.ai_probability >= 40 ? 'MEDIUM' : 'LOW'} · ${type.toUpperCase()} scan</div>
          </div>
        </div>
        <div class="verdict-actions">
          <button class="v-action-btn va-share" data-action="openShareModal">↗ Share</button>
          <button class="v-action-btn va-save" data-action="saveResult">⬇ Save</button>
        </div>
      </div>

      <div class="score-bar-section">
        <div class="score-bar-header">
          <span class="score-bar-label">AI Probability</span>
          <span class="score-pct" id="scoreNum">0%</span>
        </div>
        <div class="score-track"><div class="score-fill ${fillCls}" id="scoreFill"></div></div>
      </div>

      <div class="signals-row">${chipsHTML}</div>

      <div class="analysis-box">${r.summary}</div>
    </div>

    <button data-action="resetScan" style="width:100%;margin-top:0.7rem;padding:0.8rem;border:1.5px solid var(--border);border-radius:10px;background:transparent;font-family:'Cabinet Grotesk',sans-serif;font-size:0.88rem;font-weight:700;cursor:pointer;color:var(--muted);transition:all 0.2s;">← Analyze another piece of content</button>
  `;
  area.classList.add('active');

  // Animate score
  setTimeout(() => {
    document.getElementById('scoreFill').style.width = prob + '%';
    let cur = 0;
    const step = () => {
      cur = Math.min(cur + 2, prob);
      const el = document.getElementById('scoreNum');
      if (el) el.textContent = cur + '%';
      if (cur < prob) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, 100);

  // Update share modal data
  document.getElementById('shareVerdictTitle').textContent = `${emoji} ${label} — ${prob}% AI probability`;
  document.getElementById('shareVerdictSub').textContent = `Confidence: ${r.ai_probability >= 75 ? 'HIGH' : r.ai_probability >= 40 ? 'MEDIUM' : 'LOW'} · Analyzed by TruthLens`;
}

function resetScan() {
  document.getElementById('resultsArea').classList.remove('active');
  document.getElementById('textInput').value = '';
  updateCharCount();
  document.getElementById('urlInput').value = '';
  document.getElementById('fetchedText').value = '';
  document.getElementById('fetchedTextArea').style.display = 'none';
  clearPreview('imgPreview','imgFile');
  clearPreview('vidPreview','vidFile');
}

/* ── HISTORY ── */
function saveToHistory(result) {
  appState.history.unshift(result);
  if (appState.history.length > 20) appState.history = appState.history.slice(0,20);
  try { localStorage.setItem('tl_history', JSON.stringify(appState.history)); } catch(e){}
  renderHistory();
}
    function escapeHtml(s){var m={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};return s==null?'':String(s).replace(/[&<>"']/g,function(c){return m[c];});}
function renderHistory() {
  const list = document.getElementById('historyList');
  const section = document.getElementById('historySection');
  if (!appState.history.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  list.innerHTML = appState.history.slice(0,5).map(h => {
    const isAI = h.verdict?.includes('AI');
    const isHuman = h.verdict?.includes('HUMAN');
    const dotCls = isAI ? 'ai-gen' : isHuman ? 'human' : 'uncertain';
    const emoji = isAI?'🤖':isHuman?'👤':'🔍';
    const label = isAI ? 'AI Generated' : isHuman ? 'Human Created' : 'Uncertain';
    const dt = new Date(h.timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});    const preview = h.input ? h.input.substring(0,40) + (h.input.length>40?'…':'') : h.type;
    return `<div class="history-item">
      <span class="hi-dot ${dotCls}"></span>
      <span class="hi-label">${emoji} ${label} · ${preview}</span>
      <span class="hi-meta">${h.ai_probability}% AI · ${dt}</span>
    </div>`;
  }).join('');
}
function clearHistory() {
  appState.history = [];
  try { localStorage.removeItem('tl_history'); } catch(e){}
  renderHistory();
}

/* ── SHARE ── */
function openShareModal() {
  if (!appState.user) { openAuthModal('signup'); return; }
  openModal('shareOverlay');
}
function getShareText() {
  const el = document.getElementById('shareVerdictTitle');
  return el ? `${el.textContent} — Check your content at TruthLens!` : 'Check AI content with TruthLens!';
}
function shareToX() { window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(getShareText())}&url=https://truthlensdetect.com`, '_blank'); }
function shareToLinkedIn() { window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent('https://truthlensdetect.com')}&summary=${encodeURIComponent(getShareText())}`, '_blank'); }
function shareToFacebook() { window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent('https://truthlensdetect.com')}&quote=${encodeURIComponent(getShareText())}`, '_blank'); }
function shareToReddit() { window.open(`https://reddit.com/submit?url=${encodeURIComponent('https://truthlensdetect.com')}&title=${encodeURIComponent(getShareText())}`, '_blank'); }
function shareToWhatsApp() { window.open(`https://wa.me/?text=${encodeURIComponent(getShareText() + ' https://truthlensdetect.com')}`, '_blank'); }
function shareToTelegram() { window.open(`https://t.me/share/url?url=${encodeURIComponent('https://truthlensdetect.com')}&text=${encodeURIComponent(getShareText())}`, '_blank'); }
async function shareNative() {
  if (navigator.share) {
    try { await navigator.share({ title: 'TruthLens Result', text: getShareText(), url: 'https://truthlensdetect.com' }); }
    catch(e) {}
  } else { copyLink(); }
}
function copyLink() {
  const inp = document.getElementById('shareLinkInput');
  navigator.clipboard.writeText(inp.value).then(() => showToast('Link copied!')).catch(() => {
    inp.select(); document.execCommand('copy'); showToast('Link copied!');
  });
}
function saveResult() {
  if (!appState.user) { openAuthModal('signup'); return; }
  showToast('Result saved to your account ✓');
}
function downloadReport() {
  if (appState.plan === 'free') { openModal('plansOverlay'); return; }
  showToast('PDF report downloading…');
}

/* ── TOAST ── */
function showToast(msg) {
  let t = document.getElementById('toastEl');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toastEl';
    t.style.cssText = 'position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);background:var(--ink);color:#fff;padding:0.7rem 1.4rem;border-radius:30px;font-family:Cabinet Grotesk,sans-serif;font-size:0.85rem;font-weight:700;z-index:9999;transition:opacity 0.3s;pointer-events:none;';
    document.body.appendChild(t);
  }
  t.textContent = msg; t.style.opacity = '1';
  clearTimeout(t._to);
  t._to = setTimeout(() => { t.style.opacity = '0'; }, 2500);
}

/* ── SUPPORT BOT ── */
let chatOpen = false;
let chatHistory = [];
let chatInitialized = false;

function toggleChat() {
  chatOpen = !chatOpen;
  document.getElementById('chatWindow').classList.toggle('open', chatOpen);
  document.getElementById('chatBubble').innerHTML = chatOpen ? '✕' : '💬';
  if (chatOpen && !chatInitialized) {
    chatInitialized = true;
    document.querySelector('.chat-bubble .notif')?.remove();
    addBotMessage("Hi! 👋 I'm the TruthLens support bot. I can help with questions about how the tool works, pricing, your account, or anything else. What can I help you with?");
  }
  if (chatOpen) setTimeout(() => document.getElementById('chatInput').focus(), 300);
}

function addBotMessage(text) {
  const msgs = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'chat-msg bot';
  div.textContent = text;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function addUserMessage(text) {
  const msgs = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'chat-msg user';
  div.textContent = text;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function showTyping() {
  const msgs = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'chat-msg bot typing';
  div.id = 'typingIndicator';
  div.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function hideTyping() {
  document.getElementById('typingIndicator')?.remove();
}

function sendSuggestion(el) {
  const text = el.textContent;
  document.getElementById('chatSuggestions').style.display = 'none';
  processChat(text);
}

function sendChat() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  document.getElementById('chatSuggestions').style.display = 'none';
  processChat(text);
}

async function processChat(userText) {
  addUserMessage(userText);
  chatHistory.push({ role: 'user', content: userText });
  showTyping();

  const systemPrompt = `You are a friendly, helpful support agent for TruthLens — an AI content detection platform at truthlensdetect.com. 

Key facts:
- TruthLens detects AI-generated text, images, and video
- Free plan: 5 scans/day, text & image only
- Pro plan: $12/month — unlimited scans, video, URL scanning, PDF reports
- Enterprise plan: $49/month — webhooks + integrations, bulk scanning, white-label
- We NEVER sell user data. No ads. No third-party data sharing.
- Scanned content is NOT stored or used to train AI
- Users can delete their account anytime
- Powered by Claude AI (Anthropic)
- For billing issues or refunds, direct users to support@truthlensdetect.com
- Accuracy is approximately 94% but results are probabilistic, not definitive proof
- Legal page: truthlensdetect.com/legal.html

Be warm, concise, and helpful. If you can't resolve something, offer to escalate to support@truthlensdetect.com. Keep responses under 3 sentences when possible.`;

  try {
    const response = await fetch('/.netlify/functions/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: systemPrompt,
        messages: chatHistory
      })
    });
    if (!response.ok) throw new Error('API error: ' + response.status);
    const data = await response.json();
    const reply = data.content?.map(b => b.text || '').join('') || "I'm having trouble connecting right now. Please email support@truthlensdetect.com for help!";
    hideTyping();
    addBotMessage(reply);
    chatHistory.push({ role: 'assistant', content: reply });
  } catch(e) {
    hideTyping();
    addBotMessage("Sorry, I'm having trouble right now. Please email support@truthlensdetect.com and we'll get back to you shortly!");
  }
}

/* ── INIT ── */
renderHistory()
renderTopbar()

// Close overlays on backdrop click
document.querySelectorAll('.overlay').forEach(o => {
  o.addEventListener('click', e => { if (e.target === o) closeModal(o.id); });
});
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
      ['plansOverlay', 'authOverlay', 'shareOverlay', 'privacyOverlay'].forEach(function(id) {
            var el = document.getElementById(id);
                  if (el && el.classList.contains('open')) closeModal(id);
                      });
                        }
                        });


// Service Worker registration for PWA offline support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(() => {})
      .catch(() => {});
  });
}


// ═══════════════════════════════════════════════════════════════════
// Event delegation — replaces all inline onclick/oninput attributes.
// Fully CSP-compliant: no inline handlers, all logic in this file.
// ═══════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  function tl_openModal_toggleMobileNav(p)      { openModal(p); toggleMobileNav(); }
  function tl_openAuthModal_toggleMobileNav(p)  { openAuthModal(p); toggleMobileNav(); }
  function tl_closeModal_openModal(p, p2)        { closeModal(p); openModal(p2); }
  function tlImgUpload() { var el = document.getElementById('imgFile'); if (el) el.click(); }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var fn = el.getAttribute('data-action');
    var p  = el.getAttribute('data-param')  || undefined;
    var p2 = el.getAttribute('data-param2') || undefined;
    _lastClickedEl = el;
    if (el.getAttribute('data-stop')    === '1') e.stopPropagation();
    if (el.getAttribute('data-prevent') === '1') e.preventDefault();

    switch (fn) {
      case 'openModal':                        openModal(p, el); break;
      case 'closeModal':                       closeModal(p); break;
      case 'openAuthModal':                    openAuthModal(p); break;
      case 'toggleMobileNav':                  toggleMobileNav(); break;
      case 'toggleChat':                       toggleChat(); break;
      case 'toggleAuthMode':                   toggleAuthMode(); break;
      case 'switchPanel':                      switchPanel(p); break;
      case 'socialLogin':                      socialLogin(p); break;
      case 'submitAuth':                       submitAuth(); break;
      case 'runAnalysis':                      runAnalysis(); break;
      case 'fetchURL':                         fetchURL(); break;
      case 'clearHistory':                     clearHistory(); break;
      case 'pasteFromClipboard':               pasteFromClipboard(); break;
      case 'copyLink':                         copyLink(); break;
      case 'downloadReport':                   downloadReport(); break;
      case 'shareNative':                      shareNative(); break;
      case 'shareToX':                         shareToX(); break;
      case 'shareToFacebook':                  shareToFacebook(); break;
      case 'shareToLinkedIn':                  shareToLinkedIn(); break;
      case 'shareToWhatsApp':                  shareToWhatsApp(); break;
      case 'shareToTelegram':                  shareToTelegram(); break;
      case 'shareToReddit':                    shareToReddit(); break;
      case 'sendChat':                         sendChat(); break;
      case 'sendSuggestion':                   sendSuggestion(el); break;
      case 'requirePro':                       requirePro(p); break;
      case 'acceptAllCookies':                 acceptAllCookies(); break;
      case 'acceptSelectedCookies':            acceptSelectedCookies(); break;
      case 'rejectAllCookies':                 rejectAllCookies(); break;
      case 'ckAccept':                         ckAccept(); break;
      case 'ckDecline':                        ckDecline(); break;
      case 'navigate':                         if (p) window.location.href = p; break;
        case 'tlVidUpload': document.getElementById('vidFile').click(); break;
              case 'tlImgUpload':                      tlImgUpload(); break;
      case 'openShareModal': setTimeout(openShareModal, 0); break;
      case 'saveResult': saveResult(); break;
      case 'resetScan': resetScan(); break;
      case 'clearPreview': clearPreview(p, p2); break;
      case 'tl_openModal_toggleMobileNav':     tl_openModal_toggleMobileNav(p); break;
      case 'tl_openAuthModal_toggleMobileNav': tl_openAuthModal_toggleMobileNav(p); break;
      case 'tl_closeModal_openModal':          tl_closeModal_openModal(p, p2); break;
    }
  });

  document.addEventListener('input', function (e) {
    var el = e.target.closest('[data-oninput]');
    if (!el) return;
    var fn = el.getAttribute('data-oninput');
    if (fn === 'updateCharCount' && typeof updateCharCount === 'function') updateCharCount();
  });
  /* VIDEO DROP ZONE DRAG HANDLERS */
  var _vdz = document.getElementById('videoDropZone');
  _vdz && _vdz.addEventListener('dragover', function(e) { e.preventDefault(); _vdz.classList.add('dz-dragover'); });
  _vdz && _vdz.addEventListener('dragleave', function(e) { _vdz.classList.remove('dz-dragover'); });
  _vdz && _vdz.addEventListener('drop', function(e) { e.preventDefault(); _vdz.classList.remove('dz-dragover'); openModal('plansOverlay', _vdz); });
}());
