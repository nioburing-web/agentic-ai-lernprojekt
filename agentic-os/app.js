let allSkills = [];
let filteredSkills = [];
let activeSkill = null;
let runLog = [];

async function init() {
  await Promise.all([loadSkills(), loadData()]);
  tickClock();
  setInterval(tickClock, 1000);
}

function tickClock() {
  const t = new Date().toLocaleTimeString('de-DE', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  document.getElementById('clock').textContent = t;
}

async function loadSkills() {
  const res = await fetch('skills.json');
  allSkills = await res.json();
  filteredSkills = [...allSkills];
  renderSkillList();
  renderDomains();
}

async function loadData() {
  const res = await fetch('data.json');
  const d = await res.json();
  runLog = d.runs || [];
  renderRunLog();
  document.getElementById('statTotal').textContent  = d.stats.total_runs;
  document.getElementById('statToday').textContent  = d.stats.today;
  document.getElementById('statActive').textContent = d.stats.active;
}

function renderSkillList() {
  const el = document.getElementById('skillList');
  el.innerHTML = filteredSkills.map((s, i) => `
    <div class="skill-row" data-idx="${i}" onclick="selectSkill(${i})">
      <div class="skill-row-name">${s.name}</div>
      <div class="skill-row-tag">${s.domain}</div>
    </div>
  `).join('');
}

function renderDomains() {
  const domains = [...new Set(allSkills.map(s => s.domain))];
  document.getElementById('domainList').innerHTML = domains.map(d => `
    <div class="domain-row" onclick="filterDomain(this, '${d}')">${d}</div>
  `).join('');
}

function filterDomain(el, domain) {
  document.querySelectorAll('.domain-row').forEach(r => r.classList.remove('active'));
  el.classList.add('active');
  filteredSkills = allSkills.filter(s => s.domain === domain);
  renderSkillList();
}

function selectSkill(idx) {
  activeSkill = filteredSkills[idx];

  document.querySelectorAll('.skill-row').forEach(r => r.classList.remove('active'));
  document.querySelector(`[data-idx="${idx}"]`).classList.add('active');

  // show run panel, hide empty state
  document.getElementById('emptyState').style.display = 'none';
  const panel = document.getElementById('runPanel');
  panel.style.display = 'block';

  document.getElementById('rpName').textContent   = activeSkill.name;
  document.getElementById('rpDomain').textContent = activeSkill.domain;
  document.getElementById('rpDesc').textContent   = activeSkill.beschreibung;
  document.getElementById('runMsg').textContent   = '';
  document.getElementById('runMsg').className     = 'run-msg';
  document.getElementById('promptBox').value      = '';
  document.getElementById('footerSkill').textContent = `SKILL: ${activeSkill.name}`;
}

function renderRunLog() {
  const el = document.getElementById('logEntries');
  if (!runLog.length) {
    el.innerHTML = '<div class="log-empty">Noch keine Runs</div>';
    return;
  }
  el.innerHTML = runLog.map(r => `
    <div class="log-entry">
      <div class="log-dot ${r.status}"></div>
      <div class="log-skill">${r.skill}</div>
      <div class="log-pid">PID ${r.pid}</div>
      <div class="log-time">${r.time}</div>
    </div>
  `).join('');
}

async function runAgent() {
  if (!activeSkill) return;
  const prompt = document.getElementById('promptBox').value.trim();
  if (!prompt) {
    setMsg('⚠ Bitte Prompt eingeben', '');
    return;
  }

  const btn = document.getElementById('runBtn');
  btn.disabled = true;
  setMsg('● Startet Agent…', '');

  const fullPrompt = `[Skill: ${activeSkill.name}] ${prompt}`;

  try {
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: fullPrompt }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const entry = {
      pid: data.pid,
      skill: activeSkill.name,
      status: 'running',
      time: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
    };
    runLog.unshift(entry);
    renderRunLog();

    setMsg(`✓ Gestartet — PID ${data.pid}`, 'ok');
    document.getElementById('footerPid').textContent = `PID ${data.pid}`;

    // update active stat
    const activeEl = document.getElementById('statActive');
    activeEl.textContent = parseInt(activeEl.textContent || '0') + 1;

  } catch (err) {
    setMsg(`✗ Fehler: ${err.message}`, 'err');
  } finally {
    btn.disabled = false;
  }
}

function setMsg(text, cls) {
  const el = document.getElementById('runMsg');
  el.textContent = text;
  el.className = 'run-msg' + (cls ? ' ' + cls : '');
}

init();
