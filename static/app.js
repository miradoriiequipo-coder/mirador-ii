// ══════════════════════════════════════════════════════════════════
//  MIRADOR II FC — app.js v4
// ══════════════════════════════════════════════════════════════════

const API = '';

const state = {
  token:      localStorage.getItem('mirador_token') || null,
  isAdmin:    localStorage.getItem('mirador_admin') === 'true',
  players:    [],
  matches:    [],
  finances:   [],
  configs:    { inscripciones: [], arbitrajes: [] },
  votes:      {},
  hasVoted:   JSON.parse(localStorage.getItem('mirador_voted') || '{}'),
  sliderIdx:  0,
  upcomingMatches: [],
  lastMatch:  null,
  tournaments:       [],
  activeTournament:  null,
  viewingTournament: null,
};

// ── Utilidades ────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const fmt = n => new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(n);

// FIX ZONA HORARIA: tratar fechas del servidor como hora local (no UTC)
const parseLocalDate = iso => {
  if (!iso) return new Date();
  // Si viene con T y sin Z, agregar Z para forzar UTC, luego ajustar
  // Mejor: parsear manualmente para evitar conversión de zona horaria
  const s = iso.replace('T', ' ').replace('Z', '').split('.')[0];
  const [datePart, timePart] = s.split(' ');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi, se] = (timePart || '00:00:00').split(':').map(Number);
  return new Date(y, mo - 1, d, h, mi, se || 0);
};

const fmtDate = iso => parseLocalDate(iso).toLocaleDateString('es-CO',{weekday:'long',day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'});
const fmtShortDate = iso => {
  const d = parseLocalDate(iso);
  return d.toLocaleDateString('es-CO',{day:'numeric',month:'short'})+' '+d.toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'});
};

const tParam = () => state.viewingTournament ? `?t=${state.viewingTournament.id}` : '';
const isViewingPast = () => state.viewingTournament && !state.viewingTournament.is_active;

function toast(msg, type='success') {
  const el = document.createElement('div');
  el.className=`toast ${type}`; el.textContent=msg;
  $('toast-container').appendChild(el);
  setTimeout(()=>el.remove(),3800);
}
function showModal(id)  { $(id).classList.add('open');  document.body.style.overflow='hidden'; }
function closeModal(id) { $(id).classList.remove('open'); document.body.style.overflow=''; }
function showError(id,msg){ const el=$(id); el.textContent=msg; el.classList.add('show'); }
function clearError(id)   { const el=$(id); el.textContent=''; el.classList.remove('show'); }

// Modal de confirmación — reemplaza todos los confirm() del navegador
function confirmar(opciones, callback) {
  $('confirm-icon').textContent  = opciones.icon   || '⚠️';
  $('confirm-title').textContent = opciones.titulo  || '¿Estás seguro?';
  $('confirm-msg').textContent   = opciones.msg     || '';
  showModal('modal-confirm');
  const btnYes = $('confirm-yes');
  const btnNo  = $('confirm-no');
  const newYes = btnYes.cloneNode(true);
  const newNo  = btnNo.cloneNode(true);
  btnYes.parentNode.replaceChild(newYes, btnYes);
  btnNo.parentNode.replaceChild(newNo,  btnNo);
  newYes.addEventListener('click', () => { closeModal('modal-confirm'); callback(true);  });
  newNo.addEventListener('click',  () => { closeModal('modal-confirm'); callback(false); });
}

async function api(path, method='GET', body=null) {
  const opts={method,headers:{'Content-Type':'application/json'}};
  if (state.token) opts.headers['Authorization']=`Bearer ${state.token}`;
  if (body) opts.body=JSON.stringify(body);
  const res = await fetch(`${API}/api${path}`, opts);
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.detail||'Error del servidor');
  return data;
}

// ── Router ────────────────────────────────────────────────────────
function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('[data-page]').forEach(a=>a.classList.remove('active'));
  $(`page-${page}`).classList.add('active');
  document.querySelectorAll(`[data-page="${page}"]`).forEach(a=>a.classList.add('active'));
  $('mobile-menu').classList.remove('open');
  if (page==='home')     loadHome();
  if (page==='players')  loadPlayers();
  if (page==='payments') loadPayments();
  if (page==='gallery')  loadGallery();
  if (page==='ai')       loadAI();
}

// ── Auth ──────────────────────────────────────────────────────────
function setAuth(token,isAdmin) {
  state.token=token; state.isAdmin=isAdmin;
  state.players=[]; state.matches=[];
  localStorage.setItem('mirador_token',token);
  localStorage.setItem('mirador_admin',isAdmin);
  updateAuthUI();
  const activePage = document.querySelector('.page.active')?.id?.replace('page-','') || 'home';
  navigateTo(activePage);
}
function logout() {
  state.token=null; state.isAdmin=false;
  state.players=[]; state.matches=[];
  localStorage.removeItem('mirador_token');
  localStorage.removeItem('mirador_admin');
  updateAuthUI();
  toast('Sesión cerrada','warning');
  const activePage = document.querySelector('.page.active')?.id?.replace('page-','') || 'home';
  navigateTo(activePage);
}
function updateAuthUI() {
  const adminBar=$('admin-bar');
  const btnLogin=$('btn-login');
  const btnLoginM=$('btn-login-mobile');
  if (state.isAdmin) {
    adminBar.classList.add('show');
    btnLogin.textContent='Cerrar sesión'; btnLogin.classList.add('logged');
    if(btnLoginM){btnLoginM.textContent='Cerrar sesión';btnLoginM.classList.add('logged');}
  } else {
    adminBar.classList.remove('show');
    btnLogin.textContent='Iniciar sesión'; btnLogin.classList.remove('logged');
    if(btnLoginM){btnLoginM.textContent='Iniciar sesión';btnLoginM.classList.remove('logged');}
  }
  document.querySelectorAll('.admin-only').forEach(el=>{
    el.style.display = (state.isAdmin && !isViewingPast()) ? '' : 'none';
  });
  renderTournamentSelector();
}

// ── TORNEOS ───────────────────────────────────────────────────────
async function loadTournaments() {
  try {
    const [all, active] = await Promise.all([api('/tournaments'), api('/tournaments/active')]);
    state.tournaments = all;
    state.activeTournament = active;
    if (!state.viewingTournament) state.viewingTournament = active;
    renderTournamentSelector();
    renderTournamentBanner();
  } catch(e) { console.error('Error cargando torneos:', e); }
}

function renderTournamentSelector() {
  const wrap = $('tournament-selector-wrap');
  if (!wrap) return;
  const tournaments = state.tournaments;
  if (!tournaments.length) {
    wrap.innerHTML = state.isAdmin
      ? `<button class="btn btn-primary" style="font-size:12px" onclick="showModal('modal-tournament')">⚽ Crear primer torneo</button>`
      : `<span style="color:var(--text-faint);font-size:13px">Sin torneos</span>`;
    return;
  }
  const current = state.viewingTournament;
  const options = tournaments.map(t =>
    `<option value="${t.id}" ${current && t.id===current.id?'selected':''}>
      ${t.is_active?'🟢':'📁'} ${t.name}${t.season?' · '+t.season:''}
    </option>`
  ).join('');
  wrap.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px">
      <select class="form-input" id="tournament-select" style="font-size:13px;padding:6px 10px;max-width:220px" onchange="switchTournament(this.value)">
        ${options}
      </select>
      ${state.isAdmin?`<button class="btn btn-primary" style="font-size:12px;padding:6px 12px;white-space:nowrap" onclick="showModal('modal-tournament')">+ Nuevo torneo</button>`:''}
    </div>`;
}

function renderTournamentBanner() {
  const banner = $('tournament-banner');
  if (!banner) return;
  if (isViewingPast()) {
    banner.style.display = 'block';
    banner.innerHTML = `📁 Viendo torneo archivado: <strong>${state.viewingTournament.name}</strong>
      ${state.viewingTournament.season?'· '+state.viewingTournament.season:''} — Solo lectura
      ${state.activeTournament?`<button onclick="switchTournament(${state.activeTournament.id})" style="margin-left:12px;background:var(--navy);color:#fff;border:none;border-radius:4px;padding:4px 10px;font-size:12px;font-weight:700;cursor:pointer">Ir al torneo activo</button>`:''}`;
  } else {
    banner.style.display = 'none';
  }
}

async function switchTournament(id) {
  const t = state.tournaments.find(x => x.id === +id);
  if (!t) return;
  state.viewingTournament = t;
  state.players = []; state.matches = [];
  renderTournamentBanner();
  updateAuthUI();
  const activePage = document.querySelector('.page.active')?.id?.replace('page-','') || 'home';
  navigateTo(activePage);
}

async function createTournament() {
  const name = $('t-name').value.trim();
  if (!name) { showError('t-error','El nombre es obligatorio'); return; }
  try {
    const t = await api('/tournaments','POST',{name, season:$('t-season').value.trim(), description:$('t-description').value.trim()});
    toast(`¡Torneo "${t.name}" creado!`);
    state.viewingTournament = t;
    closeModal('modal-tournament');
    await loadTournaments();
    navigateTo('home');
  } catch(e) { showError('t-error',e.message); }
}

// ── HOME MINI CHAT ────────────────────────────────────────────────
async function sendHomeChat() {
  const input = $('home-chat-input');
  const q = input.value.trim();
  if (!q) return;
  const msgs = $('home-chat-messages');
  const addMsg = (text, isUser) => {
    const d = document.createElement('div');
    d.style.cssText = `background:${isUser?'var(--lime)':'var(--navy)'};color:${isUser?'var(--navy)':'var(--on-navy)'};border-radius:${isUser?'10px 10px 2px 10px':'10px 10px 10px 2px'};padding:9px 13px;font-size:13px;max-width:85%;align-self:${isUser?'flex-end':'flex-start'}`;
    d.textContent = text;
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
  };
  addMsg(q, true);
  input.value = '';
  const btn = $('btn-home-chat-send');
  btn.disabled = true; btn.textContent = '...';
  try {
    const tq = state.viewingTournament ? `?t=${state.viewingTournament.id}` : '';
    const res = await api(`/ai/chat${tq}`, 'POST', { question: q });
    addMsg(res.answer, false);
  } catch(e) {
    addMsg('Error: ' + e.message, false);
  } finally { btn.disabled = false; btn.textContent = 'Enviar'; }
}

function homeQuickChat(q) {
  $('home-chat-input').value = q;
  sendHomeChat();
}

// ── GALLERY PREVIEW ON HOME ──────────────────────────────────────
async function loadHomeGallery() {
  try {
    const tq = state.viewingTournament ? `?t=${state.viewingTournament.id}` : '';
    const photos = await api(`/gallery${tq}`);
    if (!photos || !photos.length) return;
    const section = $('home-gallery-section');
    const grid    = $('home-gallery-grid');
    section.style.display = 'block';
    const last3 = photos.slice(0, 3);
    grid.innerHTML = last3.map(p => `
      <div style="position:relative;aspect-ratio:1;overflow:hidden;border-radius:var(--radius-lg);cursor:pointer" onclick="navigateTo('gallery')">
        <img src="${p.url}" alt="${p.caption||''}" style="width:100%;height:100%;object-fit:cover;transition:transform 0.2s" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'"/>
        ${p.caption?`<div style="position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,rgba(0,0,0,0.7));color:#fff;font-size:11px;padding:20px 8px 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.caption}</div>`:''}
      </div>`).join('');
  } catch(e) { /* silencioso si no hay fotos */ }
}

// ── BULLETIN BANNER ──────────────────────────────────────────────
function renderBulletinBanner(data) {
  const banner = $('bulletin-banner');
  if (!data || !banner) return;
  const items = [];
  if (data.fair_play?.es_ganador) {
    items.push(`🏆 <strong>¡FAIR PLAY GANADOR!</strong> ${data.fair_play.puntos} pts`);
  } else if (data.fair_play?.posicion <= 3) {
    items.push(`🎖️ Top ${data.fair_play.posicion} Fair Play · ${data.fair_play.puntos} pts`);
  }
  if (data.valla_menos_vencida?.posicion <= 3) {
    items.push(`🧤 Top ${data.valla_menos_vencida.posicion} Valla Menos Vencida · ${data.valla_menos_vencida.goles_contra} goles en contra`);
  }
  if (data.proximo_partido?.rival) {
    const pp = data.proximo_partido;
    items.push(`📅 Próximo: ${pp.es_local?'MIRADOR II vs '+pp.rival:pp.rival+' vs MIRADOR II'} · ${pp.hora} · ${pp.lugar||''}`);
  }
  if (!items.length) return;

  const colors = ['#1a3a6e','#1e4a8a','#0f2d5a'];
  banner.style.display = 'block';
  banner.innerHTML = `
    <div style="background:var(--navy);border-radius:var(--radius-lg);overflow:hidden;margin-bottom:4px">
      <div style="background:var(--lime);padding:6px 16px;font-family:'Oswald',sans-serif;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--navy)">
        📋 Boletín ${data._fecha||'del torneo'}
      </div>
      <div style="display:flex;flex-direction:column;gap:0">
        ${items.map((item,i)=>`<div style="padding:10px 16px;font-size:13px;color:var(--on-navy);background:${colors[i%colors.length]};border-top:1px solid rgba(255,255,255,0.08)">${item}</div>`).join('')}
      </div>
    </div>`;
}

// ── PDF TOURNAMENT READER ────────────────────────────────────────
async function handleTournamentPDF(input) {
  const file = input.files[0];
  if (!file) return;
  $('pdf-loading').style.display = 'block';
  $('pdf-result').style.display = 'none';
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch('/api/ai/read-tournament-pdf', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}` },
      body: formData,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || 'Error');
    const data = json.data;
    // Guardar en localStorage para el banner del inicio
    const stored = { ...data, _fecha: new Date().toLocaleDateString('es-CO', {day:'numeric',month:'short'}) };
    localStorage.setItem('miradorBulletin', JSON.stringify(stored));
    renderBulletinBanner(stored);
    renderPDFResult(data);
  } catch(e) {
    toast(e.message, 'error');
  } finally {
    $('pdf-loading').style.display = 'none';
    input.value = '';
  }
}

function renderPDFResult(data) {
  const wrap = $('pdf-result');
  wrap.style.display = 'block';

  const pp  = data.proximo_partido;
  const ur  = data.ultimo_resultado;
  const fp  = data.fair_play;
  const vmv = data.valla_menos_vencida;
  const gr  = data.grupo;
  const cron= data.cronograma || [];

  // Tarjeta próximo partido
  const cardProx = pp?.rival ? `
    <div style="background:var(--navy);border-radius:var(--radius-lg);padding:16px;margin-bottom:12px;color:var(--on-navy)">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:var(--lime);font-weight:700;margin-bottom:8px">📅 Próximo Partido</div>
      <div style="font-size:17px;font-weight:700;font-family:'Oswald',sans-serif;margin-bottom:6px">${pp.es_local?'MIRADOR II vs '+pp.rival.toUpperCase():pp.rival.toUpperCase()+' vs MIRADOR II'}</div>
      <div style="font-size:13px;opacity:0.8">${pp.fecha_str||''} · ${pp.hora||''}</div>
      <div style="font-size:13px;opacity:0.8">📍 ${pp.lugar||''}</div>
      <div style="font-size:12px;opacity:0.6;margin-top:4px">📌 ${pp.fase||''}</div>
      ${state.isAdmin?`<button class="btn btn-secondary" style="margin-top:12px;font-size:12px" onclick="preCargarPartidoPDF(${JSON.stringify(pp).replace(/"/g,'&quot;')})">➕ Agregar a la app</button>`:''}
    </div>` : '';

  // Último resultado
  const cardRes = ur?.rival ? `
    <div style="background:${ur.goles_mirador>ur.goles_rival?'#1a4a1a':ur.goles_mirador<ur.goles_rival?'#4a1a1a':'#3a3a1a'};border-radius:var(--radius-lg);padding:14px;margin-bottom:12px;color:#fff">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:${ur.goles_mirador>ur.goles_rival?'#7eff7e':ur.goles_mirador<ur.goles_rival?'#ff7e7e':'#ffe07e'};font-weight:700;margin-bottom:6px">⚽ Último Resultado · ${ur.fecha_str||''}</div>
      <div style="font-size:22px;font-weight:700;font-family:'Oswald',sans-serif;letter-spacing:0.05em">
        ${ur.es_local?`MIRADOR II ${ur.goles_mirador} — ${ur.goles_rival} ${ur.rival}`:
          `${ur.rival} ${ur.goles_rival} — ${ur.goles_mirador} MIRADOR II`}
      </div>
      <div style="font-size:13px;opacity:0.7;margin-top:4px">${ur.goles_mirador>ur.goles_rival?'✅ VICTORIA':ur.goles_mirador<ur.goles_rival?'❌ DERROTA':'🤝 EMPATE'}</div>
      ${state.isAdmin?`<button class="btn btn-secondary" style="margin-top:10px;font-size:12px" onclick="preCargarResultadoPDF(${JSON.stringify(ur).replace(/"/g,'&quot;')})">✏️ Actualizar en la app</button>`:''}
    </div>` : '';

  // Logros
  const logros = [];
  if (fp?.es_ganador) logros.push(`🏆 <strong>FAIR PLAY GANADOR</strong> · ${fp.puntos} puntos`);
  else if (fp?.puntos)  logros.push(`🎖️ Fair Play: puesto ${fp.posicion} · ${fp.puntos} pts`);
  if (vmv?.goles_contra) logros.push(`🧤 Valla menos vencida: puesto ${vmv.posicion} · ${vmv.goles_contra} goles en contra`);
  const cardLogros = logros.length ? `
    <div style="background:var(--surface-low);border:1px solid var(--border-light);border-radius:var(--radius-lg);padding:14px;margin-bottom:12px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-faint);font-weight:700;margin-bottom:8px">🌟 Logros del torneo</div>
      ${logros.map(l=>`<div style="font-size:13px;padding:4px 0;border-bottom:1px solid var(--border-light)">${l}</div>`).join('')}
    </div>` : '';

  // Grupo
  const cardGrupo = gr?.equipos ? `
    <div style="background:var(--surface-low);border:1px solid var(--border-light);border-radius:var(--radius-lg);padding:14px;margin-bottom:12px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-faint);font-weight:700;margin-bottom:8px">${gr.nombre||'Grupo'}</div>
      ${gr.equipos.map(e=>`
        <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border-light);${e.equipo.includes('MIRADOR')? 'font-weight:700;color:var(--navy)':'' }">
          <span style="font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;min-width:20px">${e.puesto}°</span>
          <span style="font-size:13px">${e.equipo}${e.equipo.includes('MIRADOR')?' 👈':''}</span>
        </div>`).join('')}
    </div>` : '';

  // Cronograma
  const cardCron = cron.length ? `
    <div style="background:var(--surface-low);border:1px solid var(--border-light);border-radius:var(--radius-lg);padding:14px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-faint);font-weight:700;margin-bottom:8px">📆 Cronograma</div>
      ${cron.map(c=>`<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border-light);font-size:13px"><span style="font-weight:600;color:var(--navy)">${c.fecha}</span><span>${c.evento}</span></div>`).join('')}
    </div>` : '';

  wrap.innerHTML = cardProx + cardRes + cardLogros + cardGrupo + cardCron;
}

// Pre-cargar partido del PDF en el modal de partidos
function preCargarPartidoPDF(pp) {
  openAddMatchModal();
  setTimeout(() => {
    $('m-opponent').value = pp.rival || '';
    $('m-location').value  = pp.lugar || '';
    $('m-phase').value     = pp.fase || '';
    // Intentar parsear la fecha
    if (pp.fecha_str) {
      const meses = {enero:'01',febrero:'02',marzo:'03',abril:'04',mayo:'05',junio:'06',julio:'07',agosto:'08',septiembre:'09',octubre:'10',noviembre:'11',diciembre:'12'};
      const m = pp.fecha_str.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
      if (m) {
        const mes = meses[m[2].toLowerCase()] || '01';
        const hora = (pp.hora||'06:00').replace('AM','').replace('PM','').trim();
        $('m-date').value = `${m[3]}-${mes}-${m[1].padStart(2,'0')}T${hora.includes(':')?hora:'06:00'}`;
      }
    }
    toast('Datos del partido cargados — revisa y guarda', 'warning');
  }, 300);
}

// Pre-cargar resultado del PDF para buscarlo y actualizarlo
async function preCargarResultadoPDF(ur) {
  // Buscar el partido por rival
  const match = state.matches.find(m => m.opponent.toLowerCase().includes(ur.rival.toLowerCase().split(' ')[0]) || ur.rival.toLowerCase().includes(m.opponent.toLowerCase().split(' ')[0]));
  if (match) {
    openResultModal(match.id);
    setTimeout(() => {
      $('r-home').value = ur.goles_mirador || 0;
      $('r-away').value = ur.goles_rival   || 0;
      toast('Resultado cargado — agrega goleadores y guarda', 'warning');
    }, 300);
  } else {
    toast('Partido no encontrado en la app. Agrégalo primero.', 'warning');
  }
}
async function loadHome() {
  if (!state.viewingTournament) {
    $('upcoming-track').innerHTML = `<div class="match-card" style="min-width:300px"><div class="empty"><div class="empty-icon">⚽</div><h3>Sin torneo activo</h3>${state.isAdmin?`<button class="btn btn-primary" style="margin-top:12px" onclick="showModal('modal-tournament')">+ Crear torneo</button>`:''}</div></div>`;
    $('last-result-wrap').innerHTML = ''; $('vote-section').innerHTML = '';
    return;
  }
  // Cargar boletín del localStorage
  try {
    const stored = localStorage.getItem('miradorBulletin');
    if (stored) renderBulletinBanner(JSON.parse(stored));
  } catch(e) {}
  // Cargar galería preview
  loadHomeGallery();
  try {
    const matches = await api(`/matches${tParam()}`);
    state.matches = matches;
    state.upcomingMatches = matches.filter(m=>!m.is_played).sort((a,b)=>parseLocalDate(b.match_date)-parseLocalDate(a.match_date));
    const played = matches.filter(m=>m.is_played).sort((a,b)=>parseLocalDate(b.match_date)-parseLocalDate(a.match_date));
    state.lastMatch = played[0] || null;
    renderUpcomingSlider();
    renderLastResult();
    renderStandings();
    await renderVoteSection();
  } catch(e) { toast('Error: '+e.message,'error'); }
}

// ── SLIDER ────────────────────────────────────────────────────────
function renderUpcomingSlider() {
  const track=$('upcoming-track'), dots=$('slider-dots');
  const now = new Date();
  const upcoming = state.upcomingMatches;
  if (!upcoming.length) {
    track.innerHTML=`<div class="match-card" style="min-width:300px"><div class="empty"><div class="empty-icon">📅</div><h3>Sin partidos programados</h3>${state.isAdmin&&!isViewingPast()?`<button class="btn btn-primary" style="margin-top:12px" onclick="openAddMatchModal()">+ Agregar partido</button>`:''}</div></div>`;
    dots.innerHTML=''; return;
  }
  track.innerHTML = upcoming.map(m => {
    const isPast = parseLocalDate(m.match_date) < now;
    return `<div class="match-card">
      ${m.phase?`<div class="match-phase">📌 ${m.phase}</div>`:'<div class="match-phase">📌 Partido</div>'}
      <div class="match-teams">MIRADOR II <span class="match-vs">vs</span> ${m.opponent.toUpperCase()}</div>
      <div class="match-info">
        <span>📅 ${fmtShortDate(m.match_date)}</span>
        ${m.location?`<span>📍 ${m.location}</span>`:''}
        ${isPast?`<span style="color:#7a5200">⏰ Pendiente resultado</span>`:''}
      </div>
      ${m.notes?`<div style="margin-top:10px;font-size:12px;color:var(--text-faint)">${m.notes}</div>`:''}
      ${state.isAdmin&&!isViewingPast()?`<div style="display:flex;gap:6px;margin-top:14px">
        <button class="btn btn-secondary" style="font-size:12px" onclick="openResultModal(${m.id})">Registrar resultado</button>
        <button class="btn btn-secondary" style="font-size:12px" onclick="openEditMatchModal(${m.id})">✏️</button>
        <button class="btn btn-danger" style="font-size:12px" onclick="deleteMatch(${m.id})">🗑️</button>
      </div>`:''}
    </div>`;
  }).join('');
  dots.innerHTML = upcoming.map((_,i)=>`<button class="slider-dot ${i===0?'active':''}" data-idx="${i}"></button>`).join('');
  dots.querySelectorAll('.slider-dot').forEach(btn=>btn.addEventListener('click',()=>goSlide(+btn.dataset.idx)));
  state.sliderIdx=0;
  if (state.isAdmin&&!isViewingPast()) {
    const extra=document.createElement('div');
    extra.className='match-card';
    extra.style.cssText='display:flex;align-items:center;justify-content:center;cursor:pointer;border-style:dashed';
    extra.innerHTML=`<div style="text-align:center;color:var(--text-faint)"><div style="font-size:32px">+</div><div style="font-size:13px;font-weight:700">Agregar Partido</div></div>`;
    extra.onclick=openAddMatchModal;
    track.appendChild(extra);
  }
}

function goSlide(idx) {
  const track=$('upcoming-track'), items=track.querySelectorAll('.match-card');
  const n=state.upcomingMatches.length; if(!n)return;
  idx=Math.max(0,Math.min(idx,n-1)); state.sliderIdx=idx;
  track.style.transform=`translateX(-${idx*(items[0].offsetWidth+16)}px)`;
  document.querySelectorAll('.slider-dot').forEach((d,i)=>d.classList.toggle('active',i===idx));
}

// ── RESULTADOS ANTERIORES (SLIDER) ───────────────────────────────
function renderResultsSlider() {
  const wrap = $('last-result-wrap');
  const played = state.matches.filter(m => m.is_played)
                              .sort((a,b) => parseLocalDate(b.match_date) - parseLocalDate(a.match_date));

  if (!played.length) {
    wrap.innerHTML = `<div class="result-card"><div class="empty"><div class="empty-icon">🏆</div><h3>Sin resultados aún</h3></div></div>`;
    return;
  }

  state.resultIdx = 0;

  const buildCard = (m) => {
    const homeW = m.home_score > m.away_score, awayW = m.away_score > m.home_score;
    const scorerMap = {}, assistMap = {};
    (m.goals || []).forEach(g => {
      scorerMap[g.player_name] = (scorerMap[g.player_name] || 0) + g.count;
      if (g.assist_player_name) assistMap[g.assist_player_name] = (assistMap[g.assist_player_name] || 0) + 1;
    });
    const scorerChips = Object.entries(scorerMap).map(([n,c]) =>
      `<span class="scorer-chip"><span class="num">${c}</span> ${n} ⚽</span>`).join('');
    const assistChips = Object.entries(assistMap).map(([n,c]) =>
      `<span class="scorer-chip" style="background:rgba(255,255,255,0.08);color:#f0e68c"><span class="num" style="background:#b8a800;color:#000">${c}</span> ${n} 🅰️</span>`).join('');
    return `
      <div class="result-label">🏁 ${m.phase || 'Partido'} · ${fmtShortDate(m.match_date)}</div>
      <div class="result-scoreboard">
        <div class="result-team">
          <div class="result-team-name">MIRADOR II</div>
          <div class="result-score ${homeW?'win':awayW?'lose':''}">${m.home_score ?? '—'}</div>
        </div>
        <div class="result-divider">:</div>
        <div class="result-team">
          <div class="result-team-name">${m.opponent.toUpperCase()}</div>
          <div class="result-score ${awayW?'win':homeW?'lose':''}">${m.away_score ?? '—'}</div>
        </div>
      </div>
      ${m.location ? `<div style="text-align:center;color:rgba(255,255,255,0.45);font-size:12px;margin-bottom:10px">📍 ${m.location}</div>` : ''}
      ${scorerChips ? `<div><div class="form-label" style="margin-bottom:6px;color:rgba(255,255,255,0.5)">Goles</div><div class="scorers-list">${scorerChips}</div></div>` : ''}
      ${assistChips ? `<div style="margin-top:8px"><div class="form-label" style="margin-bottom:6px;color:rgba(255,255,255,0.5)">Asistencias</div><div class="scorers-list">${assistChips}</div></div>` : ''}
      ${state.isAdmin && !isViewingPast() ? `<div style="display:flex;gap:8px;margin-top:14px">
        <button class="btn btn-secondary" onclick="openResultModal(${m.id})">✏️ Editar</button>
        <button class="btn btn-danger" onclick="deleteMatch(${m.id})">🗑️</button>
      </div>` : ''}`;
  };

  const updateCard = (idx) => {
    state.resultIdx = idx;
    const m = played[idx];
    $('result-card-body').innerHTML = buildCard(m);
    $('result-counter').textContent = `${idx + 1} / ${played.length}`;
    $('btn-result-prev').disabled = idx === 0;
    $('btn-result-next').disabled = idx === played.length - 1;
  };

  wrap.innerHTML = `
    <div class="result-card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <button id="btn-result-prev" class="slider-nav" style="font-size:18px">‹</button>
        <span id="result-counter" style="font-family:'JetBrains Mono',monospace;font-size:11px;color:rgba(255,255,255,0.5)"></span>
        <button id="btn-result-next" class="slider-nav" style="font-size:18px">›</button>
      </div>
      <div id="result-card-body"></div>
    </div>`;

  updateCard(0);
  $('btn-result-prev').addEventListener('click', () => { if (state.resultIdx > 0) updateCard(state.resultIdx - 1); });
  $('btn-result-next').addEventListener('click', () => { if (state.resultIdx < played.length - 1) updateCard(state.resultIdx + 1); });
}

// Mantener alias para compatibilidad
function renderLastResult() { renderResultsSlider(); }

// ── ESTADÍSTICAS ──────────────────────────────────────────────────
function renderStandings() {
  const wrap = $('standings-wrap');
  if (!wrap) return;
  const allPlayed = state.matches.filter(m => m.is_played);
  if (!allPlayed.length) {
    wrap.innerHTML = `<div class="empty" style="padding:20px"><div class="empty-icon">📊</div><h3>Sin partidos jugados aún</h3></div>`;
    return;
  }
  const phases = [...new Set(allPlayed.map(m => m.phase || 'Sin fase'))];
  const selectedPhase = wrap.dataset.phase || 'all';
  const matches = selectedPhase==='all' ? allPlayed : allPlayed.filter(m=>(m.phase||'Sin fase')===selectedPhase);
  let g=0,e=0,p=0,gf=0,gc=0;
  matches.forEach(m=>{ gf+=m.home_score||0; gc+=m.away_score||0;
    if(m.home_score>m.away_score)g++; else if(m.home_score===m.away_score)e++; else p++; });
  const pts=g*3+e, pj=matches.length;
  const stats=[
    {label:'PJ',value:pj,hint:'Jugados'},{label:'G',value:g,hint:'Ganados'},
    {label:'E',value:e,hint:'Empatados'},{label:'P',value:p,hint:'Perdidos'},
    {label:'GF',value:gf,hint:'A favor'},{label:'GC',value:gc,hint:'En contra'},
    {label:'DG',value:(gf-gc>=0?'+':'')+(gf-gc),hint:'Diferencia'},
    {label:'PTS',value:pts,hint:'Puntos',highlight:true},
  ];
  const phaseButtons=[{key:'all',label:'Todo el torneo'},...phases.map(ph=>({key:ph,label:ph}))].map(btn=>`
    <button onclick="setStandingsPhase('${btn.key}')"
      style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;padding:5px 12px;border-radius:4px;border:1px solid ${selectedPhase===btn.key?'var(--navy)':'var(--border)'};background:${selectedPhase===btn.key?'var(--navy)':'var(--surface)'};color:${selectedPhase===btn.key?'var(--on-navy)':'var(--text-faint)'};cursor:pointer">
      ${btn.label}
    </button>`).join('');
  wrap.innerHTML=`<div class="card" style="overflow:hidden;padding:0">
    <div style="padding:16px 20px;border-bottom:1px solid var(--border-light)">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <div style="width:40px;height:40px;background:var(--navy);border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Oswald',sans-serif;font-size:16px;font-weight:700;color:var(--lime)">M2</div>
        <div>
          <div style="font-family:'Oswald',sans-serif;font-size:18px;font-weight:700;color:var(--navy);letter-spacing:0.04em;text-transform:uppercase">MIRADOR II</div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-faint)">${state.viewingTournament?.name||'Torneo actual'}</div>
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">${phaseButtons}</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(8,1fr);text-align:center">
      ${stats.map(s=>`<div style="padding:14px 4px;${s.highlight?'background:rgba(193,241,0,0.08);':''}border-right:1px solid var(--border-light)">
        <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--text-faint);font-weight:500;letter-spacing:0.08em;text-transform:uppercase">${s.label}</div>
        <div style="font-family:'Oswald',sans-serif;font-size:26px;font-weight:700;line-height:1.1;color:${s.highlight?'var(--lime-text)':'var(--navy)'}">${s.value}</div>
        <div style="font-size:9px;color:var(--text-faint)">${s.hint}</div>
      </div>`).join('')}
    </div>
    <div style="padding:12px 20px;display:flex;gap:6px;flex-wrap:wrap;border-top:1px solid var(--border-light)">
      ${matches.map(m=>{ const win=m.home_score>m.away_score,draw=m.home_score===m.away_score;
        const color=win?'var(--navy)':draw?'#7a5200':'var(--red)';
        const bg=win?'var(--lime)':draw?'#fff8e1':'var(--red-bg)';
        return `<div title="${m.opponent} ${m.home_score}-${m.away_score}" style="width:30px;height:30px;border-radius:50%;background:${bg};display:flex;align-items:center;justify-content:center;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;color:${color}">${win?'G':draw?'E':'P'}</div>`;
      }).join('')}
      ${!matches.length?`<span style="font-size:12px;color:var(--text-faint)">Sin partidos en esta fase</span>`:''}
    </div>
  </div>`;
}

function setStandingsPhase(phase) {
  const wrap=$('standings-wrap'); if(!wrap)return;
  wrap.dataset.phase=phase; renderStandings();
}

// ── MVP VOTING ────────────────────────────────────────────────────
async function renderVoteSection() {
  const wrap=$('vote-section'), m=state.lastMatch;
  if (!m) { wrap.innerHTML=`<div class="card" style="text-align:center;padding:30px;color:var(--text-faint)">No hay partidos jugados aún.</div>`; return; }
  let voteResults=[]; try { voteResults=await api(`/matches/${m.id}/votes`); } catch(e){}
  const alreadyVoted=!!state.hasVoted[m.id];
  const totalVotes=voteResults.reduce((s,v)=>s+v.vote_count,0);
  const voteMap={}; voteResults.forEach(v=>{voteMap[v.player_id]=v;});
  const players=state.players.length?state.players:await api(`/players${tParam()}`).then(p=>{state.players=p;return p;});
  if (!players.length) { wrap.innerHTML=`<div class="card" style="padding:20px;color:var(--text-faint)">Sin jugadores registrados.</div>`; return; }
  const cards=players.filter(p=>p.is_active).map(p=>{
    const vd=voteMap[p.id],pct=vd?vd.percentage:0,cnt=vd?vd.vote_count:0;
    return `<div class="vote-card ${alreadyVoted?'voted-card':''}" data-player="${p.id}">
      <div class="vote-jersey">${p.player_number}</div>
      <div class="vote-name">${p.full_name.split(' ').slice(0,2).join(' ')}</div>
      ${alreadyVoted?`<div class="vote-bar-wrap"><div class="vote-bar" style="width:${pct}%"></div></div><div class="vote-pct">${cnt} voto${cnt!==1?'s':''} · ${pct}%</div>`:''}
    </div>`;
  }).join('');
  wrap.innerHTML=`<div class="card">
    <div style="margin-bottom:16px">
      <div style="font-weight:700;color:var(--navy)">⭐ ¿Quién fue el mejor vs ${m.opponent}?</div>
      <div style="font-size:13px;color:var(--text-faint);margin-top:4px">${totalVotes} voto${totalVotes!==1?'s':''} registrado${totalVotes!==1?'s':''}</div>
    </div>
    <div class="vote-grid" id="vote-grid">${cards}</div>
    ${!alreadyVoted?`<button class="btn-vote" id="btn-cast-vote" disabled>Votar por el MVP ⭐</button><div class="vote-notice">Selecciona un jugador para votar</div>`
    :`<div class="vote-notice" style="margin-top:16px;color:var(--green)">✅ Ya votaste en este partido</div>`}
  </div>`;
  let selectedPlayer=null;
  if (!alreadyVoted) {
    document.querySelectorAll('.vote-card').forEach(card=>{
      card.addEventListener('click',()=>{
        document.querySelectorAll('.vote-card').forEach(c=>c.classList.remove('selected'));
        card.classList.add('selected'); selectedPlayer=+card.dataset.player;
        const btn=$('btn-cast-vote'); if(btn)btn.disabled=false;
      });
    });
    const btn=$('btn-cast-vote');
    if(btn)btn.addEventListener('click',async()=>{
      if(!selectedPlayer)return;
      btn.disabled=true; btn.textContent='Votando...';
      try {
        const res=await api(`/matches/${m.id}/votes`,'POST',{player_id:selectedPlayer});
        toast(res.message||'¡Voto registrado!');
        state.hasVoted[m.id]=true;
        localStorage.setItem('mirador_voted',JSON.stringify(state.hasVoted));
        await renderVoteSection();
      } catch(e) { toast(e.message,'error'); btn.disabled=false; btn.textContent='Votar por el MVP ⭐'; }
    });
  }
}

// ── PLAYERS ───────────────────────────────────────────────────────
async function loadPlayers() {
  const grid=$('players-grid');
  grid.innerHTML='<div class="loading-wrap"><div class="spinner"></div></div>';
  const addBtn=$('btn-add-player');
  if(addBtn) addBtn.style.display=(state.isAdmin&&!isViewingPast())?'inline-flex':'none';
  if (!state.viewingTournament) {
    grid.innerHTML=`<div class="empty" style="grid-column:1/-1"><div class="empty-icon">⚽</div><h3>Selecciona o crea un torneo</h3></div>`;
    return;
  }
  try {
    // Admins ven todos (activos + lesionados); público solo activos
    const url = state.isAdmin ? `/players${tParam()}&include_inactive=true`.replace('?','?').replace('&','&') : `/players${tParam()}`;
    const players = await api(state.isAdmin ? `/players${tParam()}${tParam()?'&':'?'}include_inactive=true` : `/players${tParam()}`);
    state.players = players;
    renderPlayersGrid(players);
  } catch(e) { grid.innerHTML=`<div class="empty"><div class="empty-icon">❌</div><h3>${e.message}</h3></div>`; }
}

function renderPlayersGrid(players) {
  const grid=$('players-grid');
  if (!players.length) {
    grid.innerHTML=`<div class="empty" style="grid-column:1/-1"><div class="empty-icon">👥</div><h3>Sin jugadores</h3>
    ${state.isAdmin&&!isViewingPast()?`<button class="btn btn-primary" style="margin-top:12px" onclick="openAddPlayerModal()">+ Agregar jugador</button>`:''}</div>`;
    return;
  }
  const statusBadge = s => {
    if (s==='lesionado') return `<span style="font-family:'JetBrains Mono',monospace;font-size:9px;background:#fff8e1;color:#7a5200;border:1px solid #f0c040;border-radius:3px;padding:2px 6px;font-weight:600">🟡 LESIONADO</span>`;
    if (s==='inactivo')  return `<span style="font-family:'JetBrains Mono',monospace;font-size:9px;background:#ffeaea;color:#a32d2d;border:1px solid #f5c1c1;border-radius:3px;padding:2px 6px;font-weight:600">🔴 INACTIVO</span>`;
    return '';
  };
  grid.innerHTML=players.map(p=>`
    <div class="player-card" style="${p.status==='inactivo'?'opacity:0.55':''}${p.status==='lesionado'?'border-color:#f0c040;border-width:2px':''}">
      <div class="player-jersey">${p.player_number}</div>
      <div class="player-info">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <div class="player-name">${p.full_name}</div>
          ${statusBadge(p.status||'activo')}
        </div>
        ${p.phone?`<div class="player-meta">📞 ${p.phone}</div>`:''}
        ${p.health_info?`<div class="player-health">🏥 ${p.health_info}</div>`:''}
        ${state.isAdmin&&p.id_number?`<div class="player-id">🪪 CC: ${p.id_number}</div>`:''}
      </div>
      ${state.isAdmin&&!isViewingPast()?`
        <div class="player-actions" style="flex-direction:column;align-items:flex-end;gap:6px">
          <div style="display:flex;gap:4px">
            <button class="btn-icon" onclick="openEditPlayerModal(${p.id})" title="Editar">✏️</button>
          </div>
          <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">
            ${p.status!=='lesionado'&&p.status!=='inactivo'?`<button onclick="changePlayerStatus(${p.id},'lesionado')" style="font-size:10px;padding:3px 8px;background:#fff8e1;border:1px solid #f0c040;border-radius:3px;cursor:pointer;color:#7a5200;font-weight:600">🟡 Lesión</button>`:''}
            ${p.status==='lesionado'?`<button onclick="changePlayerStatus(${p.id},'activo')" style="font-size:10px;padding:3px 8px;background:#eaf3de;border:1px solid #97c459;border-radius:3px;cursor:pointer;color:#3b6d11;font-weight:600">✅ Recuperado</button>`:''}
            ${p.status!=='inactivo'?`<button onclick="changePlayerStatus(${p.id},'inactivo')" style="font-size:10px;padding:3px 8px;background:#ffeaea;border:1px solid #f5c1c1;border-radius:3px;cursor:pointer;color:#a32d2d;font-weight:600">🚫 Inactivar</button>`:''}
            ${p.status==='inactivo'?`<button onclick="changePlayerStatus(${p.id},'activo')" style="font-size:10px;padding:3px 8px;background:#eaf3de;border:1px solid #97c459;border-radius:3px;cursor:pointer;color:#3b6d11;font-weight:600">✅ Reactivar</button>`:''}
          </div>
        </div>`:''}
    </div>`).join('');
}

function openAddPlayerModal() {
  $('modal-player-title').textContent='Agregar Jugador';
  $('player-edit-id').value='';
  ['p-idnumber','p-number','p-name','p-phone','p-health'].forEach(id=>$(id).value='');
  const isNewChk = $('p-is-new'); if(isNewChk) isNewChk.checked=false;
  const newFields = $('p-new-fields'); if(newFields) newFields.style.display='none';
  clearError('player-error'); showModal('modal-player');
}

function openEditPlayerModal(id) {
  const p=state.players.find(x=>x.id===id); if(!p)return;
  $('modal-player-title').textContent='Editar Jugador';
  $('player-edit-id').value=id;
  $('p-idnumber').value=p.id_number||''; $('p-number').value=p.player_number;
  $('p-name').value=p.full_name; $('p-phone').value=p.phone||''; $('p-health').value=p.health_info||'';
  const isNewChk=$('p-is-new'); if(isNewChk)isNewChk.checked=false;
  const newFields=$('p-new-fields'); if(newFields)newFields.style.display='none';
  clearError('player-error'); showModal('modal-player');
}

function changePlayerStatus(id, status) {
  const config = {
    lesionado: {icon:'🟡', titulo:'¿Jugador lesionado?',     msg:'No recibirá nuevas deudas pero sigue en la plantilla. Sus pagos se conservan.'},
    inactivo:  {icon:'🔴', titulo:'¿Inactivar jugador?',     msg:'Saldrá del equipo activo. No recibirá nuevas deudas. Sus pagos se conservan.'},
    activo:    {icon:'✅', titulo:'¿Reactivar jugador?',     msg:'Volverá a estar activo y recibirá nuevas deudas a partir de ahora.'},
  };
  confirmar(config[status], async ok => {
    if(!ok)return;
    try{const res=await api(`/players/${id}/status`,'PATCH',{status});toast(res.message);state.players=[];loadPlayers();}
    catch(e){toast(e.message,'error');}
  });
}

function deletePlayer(id, name) {
  confirmar({icon:'🚫', titulo:'¿Inactivar jugador?', msg:`${name} quedará inactivo y no aparecerá en el equipo activo. Sus datos se conservan.`}, async ok => {
    if(!ok)return; try{await api(`/players/${id}`,'DELETE');toast(`${name} desactivado`);loadPlayers();}catch(e){toast(e.message,'error');}
  });
}

// ── PAYMENTS ──────────────────────────────────────────────────────
async function loadPayments() {
  const addBtn=$('btn-add-payment');
  if(addBtn) addBtn.style.display=(state.isAdmin&&!isViewingPast())?'inline-flex':'none';
  if (!state.viewingTournament) return;
  try {
    const [finances,configs,players]=await Promise.all([
      api(`/finances/summary${tParam()}`),
      api(`/finances/configs${tParam()}`),
      api(state.isAdmin?`/players${tParam()}${tParam()?'&':'?'}include_inactive=true`:`/players${tParam()}`),
    ]);
    state.finances=finances; state.configs=configs; state.players=players;
    renderPaymentsSummaryCards(finances);
    renderConfigsSection(configs);
    renderFinancesTable(finances);
  } catch(e){ toast('Error: '+e.message,'error'); }
}

function renderPaymentsSummaryCards(finances) {
  const wrap=$('payments-summary');
  const totalDeuda=finances.reduce((s,p)=>s+p.deuda_total,0);
  const totalPagado=finances.reduce((s,p)=>s+p.pagado_total,0);
  const totalPend=finances.reduce((s,p)=>s+p.saldo_pendiente,0);
  const alDia=finances.filter(p=>p.saldo_pendiente<=0&&p.deuda_total>0).length;
  wrap.innerHTML=`
    <div class="card" style="text-align:center"><div style="font-size:11px;color:var(--text-faint);font-weight:700;letter-spacing:1px;text-transform:uppercase;font-family:'JetBrains Mono',monospace">Recaudado</div><div style="font-family:'Oswald',sans-serif;font-size:28px;color:var(--green);margin-top:4px">${fmt(totalPagado)}</div></div>
    <div class="card" style="text-align:center"><div style="font-size:11px;color:var(--text-faint);font-weight:700;letter-spacing:1px;text-transform:uppercase;font-family:'JetBrains Mono',monospace">Deuda Total</div><div style="font-family:'Oswald',sans-serif;font-size:28px;color:var(--navy);margin-top:4px">${fmt(totalDeuda)}</div></div>
    <div class="card" style="text-align:center"><div style="font-size:11px;color:var(--text-faint);font-weight:700;letter-spacing:1px;text-transform:uppercase;font-family:'JetBrains Mono',monospace">Pendiente</div><div style="font-family:'Oswald',sans-serif;font-size:28px;color:var(--red);margin-top:4px">${fmt(totalPend)}</div></div>
    <div class="card" style="text-align:center"><div style="font-size:11px;color:var(--text-faint);font-weight:700;letter-spacing:1px;text-transform:uppercase;font-family:'JetBrains Mono',monospace">Al día</div><div style="font-family:'Oswald',sans-serif;font-size:28px;color:var(--navy);margin-top:4px">${alDia}/${finances.length}</div></div>`;
}

function renderConfigsSection(configs) {
  const wrap=$('configs-section'); if(!wrap)return;
  const canEdit=state.isAdmin&&!isViewingPast();
  const inscCards=configs.inscripciones.map(c=>`
    <div class="card" style="padding:14px;display:flex;justify-content:space-between;align-items:center;gap:12px">
      <div>
        <div style="font-weight:700;color:var(--navy)">Inscripción — ${fmt(c.total_amount)} total</div>
        <div style="font-size:13px;color:var(--text-muted)">${c.num_players} jugadores activos · <strong style="color:var(--green)">${fmt(c.amount_per_player)} c/u</strong></div>
        ${c.total_matches?`<div style="font-size:12px;color:var(--text-faint)">${c.total_matches} partidos totales del torneo</div>`:''}
        ${c.notes?`<div style="font-size:12px;color:var(--text-faint)">${c.notes}</div>`:''}
      </div>
      ${canEdit?`<button class="btn btn-danger" style="font-size:12px;white-space:nowrap" onclick="deleteInscripcionConfig(${c.id})">🗑️</button>`:''}
    </div>`).join('')||'<div style="color:var(--text-faint);font-size:13px">Sin configuración</div>';
  const arbCards=configs.arbitrajes.map(a=>`
    <div class="card" style="padding:14px;display:flex;justify-content:space-between;align-items:center;gap:12px">
      <div>
        <div style="font-weight:700;color:var(--navy)">${a.fase}</div>
        <div style="font-size:13px;color:var(--text-muted)">${a.num_games} partidos × ${fmt(a.price_per_game)} = ${fmt(a.total_phase)}</div>
        <div style="font-size:13px;color:var(--text-muted)">${a.num_players} jugadores activos · <strong style="color:#3b6d11">${fmt(a.amount_per_player)} c/u</strong></div>
      </div>
      ${canEdit?`<button class="btn btn-danger" style="font-size:12px;white-space:nowrap" onclick="deleteArbitrajePhase(${a.id})">🗑️</button>`:''}
    </div>`).join('')||'<div style="color:var(--text-faint);font-size:13px">Sin fases configuradas</div>';
  wrap.innerHTML=`
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px">
      <div>
        <div style="font-family:'Oswald',sans-serif;font-size:18px;color:var(--green);margin-bottom:10px;letter-spacing:1px;text-transform:uppercase">💰 Inscripción
          ${canEdit?`<button class="btn btn-primary" style="font-size:11px;margin-left:8px;padding:4px 10px" onclick="showModal('modal-inscripcion')">+ Configurar</button>`:''}
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">${inscCards}</div>
      </div>
      <div>
        <div style="font-family:'Oswald',sans-serif;font-size:18px;color:var(--navy);margin-bottom:10px;letter-spacing:1px;text-transform:uppercase">🏟️ Arbitrajes
          ${canEdit?`<button class="btn btn-primary" style="font-size:11px;margin-left:8px;padding:4px 10px" onclick="showModal('modal-arbitraje')">+ Fase</button>`:''}
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">${arbCards}</div>
      </div>
    </div>`;
}

function renderFinancesTable(finances) {
  const body=$('payments-body');
  if (!finances.length) {
    body.innerHTML=`<tr><td colspan="6"><div class="empty"><div class="empty-icon">💰</div><h3>Sin jugadores</h3></div></td></tr>`; return;
  }
  const statusIcon = s => s==='lesionado'?'🟡 ':s==='inactivo'?'🔴 ':'';
  body.innerHTML=finances.map(p=>{
    const pct=p.deuda_total>0?Math.min(100,Math.round(p.pagado_total/p.deuda_total*100)):100;
    const color=p.saldo_pendiente<=0?'var(--green)':p.saldo_pendiente<p.deuda_total?'#7a5200':'var(--red)';
    const estado=p.saldo_pendiente<=0?'✅ Al día':`Debe ${fmt(p.saldo_pendiente)}`;
    return `<tr style="${p.status==='inactivo'?'opacity:0.6':''}">
      <td class="jersey">${p.player_number}</td>
      <td style="font-weight:700">${statusIcon(p.status)}${p.player_name}</td>
      <td>${fmt(p.deuda_total)}</td>
      <td style="color:var(--green)">${fmt(p.pagado_total)}</td>
      <td><div style="display:flex;align-items:center;gap:8px">
        <div style="flex:1;background:var(--border-light);border-radius:4px;height:8px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:${color};border-radius:4px"></div>
        </div>
        <span style="font-size:12px;color:${color};font-weight:700;white-space:nowrap">${estado}</span>
      </div></td>
      <td><button class="btn-expand" onclick="togglePaymentDetail(${p.player_id})">Ver detalle</button></td>
    </tr>
    <tr class="payment-detail-row" id="detail-${p.player_id}" style="display:none">
      <td colspan="6"><div class="payment-detail-inner">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div>
            <div class="form-label" style="margin-bottom:8px">Deudas asignadas
              ${state.isAdmin&&!isViewingPast()&&p.status!=='inactivo'?`<button onclick="openDeudaManualModal(${p.player_id})" style="font-size:10px;padding:2px 8px;margin-left:8px;background:var(--navy);color:#fff;border:none;border-radius:3px;cursor:pointer">+ Deuda</button>`:''}
            </div>
            ${p.deudas.length?p.deudas.map(d=>`
              <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;padding:4px 0;border-bottom:1px solid var(--border-light)">
                <div><span class="payment-badge ${d.tipo}">${d.tipo}</span>${d.fase?`<span style="color:var(--text-faint);margin-left:6px">${d.fase}</span>`:''}
                  <div style="color:var(--text-faint);font-size:11px">${d.concepto||''}</div></div>
                <div style="display:flex;align-items:center;gap:6px">
                  <strong style="color:var(--navy)">${fmt(d.monto)}</strong>
                  ${state.isAdmin&&!isViewingPast()?`<button onclick="deleteDeuda(${d.id})" style="font-size:11px;padding:1px 6px;background:var(--red-bg);color:var(--red);border:none;border-radius:3px;cursor:pointer">×</button>`:''}
                </div>
              </div>`).join(''):'<div style="color:var(--text-faint);font-size:13px">Sin deudas</div>'}
          </div>
          <div>
            <div class="form-label" style="margin-bottom:8px">Pagos realizados</div>
            ${p.payments.length?p.payments.map(pay=>`
              <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;padding:4px 0;border-bottom:1px solid var(--border-light)">
                <div><span class="payment-badge ${pay.tipo}">${pay.tipo}</span>${pay.fase?`<span style="color:var(--text-faint);margin-left:6px">${pay.fase}</span>`:''}${pay.notas?`<span style="color:var(--text-faint);margin-left:6px">${pay.notas}</span>`:''}</div>
                <div style="display:flex;align-items:center;gap:6px">
                  <strong style="color:var(--green)">${fmt(pay.monto)}</strong>
                  ${state.isAdmin&&!isViewingPast()?`<button onclick="deletePayment(${pay.id})" style="font-size:11px;padding:1px 6px;background:var(--red-bg);color:var(--red);border:none;border-radius:3px;cursor:pointer">×</button>`:''}
                </div>
              </div>`).join(''):'<div style="color:var(--text-faint);font-size:13px">Sin pagos</div>'}
            ${state.isAdmin&&!isViewingPast()?`<button class="btn btn-primary" style="margin-top:10px;font-size:12px" onclick="openAddPaymentModal(${p.player_id})">+ Registrar pago</button>`:''}
          </div>
        </div>
      </div></td>
    </tr>`;
  }).join('');
}

function togglePaymentDetail(id){ const r=$(`detail-${id}`); r.style.display=r.style.display==='none'?'':'none'; }

function deletePayment(id) {
  confirmar({icon:'🗑️', titulo:'¿Eliminar pago?', msg:'Este pago se eliminará y el saldo del jugador se actualizará.'}, async ok => {
    if(!ok)return; try{await api(`/finances/payment/${id}`,'DELETE');toast('Pago eliminado');loadPayments();}catch(e){toast(e.message,'error');}
  });
}
function deleteDeuda(id) {
  confirmar({icon:'🗑️', titulo:'¿Eliminar deuda?', msg:'Esta deuda se eliminará y el saldo del jugador se actualizará.'}, async ok => {
    if(!ok)return; try{await api(`/finances/deuda/${id}`,'DELETE');toast('Deuda eliminada');loadPayments();}catch(e){toast(e.message,'error');}
  });
}
function deleteInscripcionConfig(id) {
  confirmar({icon:'🗑️', titulo:'¿Eliminar inscripción?', msg:'Se eliminarán la configuración y todas las deudas de inscripción asignadas.'}, async ok => {
    if(!ok)return; try{await api(`/finances/inscripcion-config/${id}`,'DELETE');toast('Configuración eliminada');loadPayments();}catch(e){toast(e.message,'error');}
  });
}
function deleteArbitrajePhase(id) {
  confirmar({icon:'🗑️', titulo:'¿Eliminar fase?', msg:'Se eliminarán la fase y todas las deudas de arbitraje asignadas.'}, async ok => {
    if(!ok)return; try{await api(`/finances/arbitraje-phase/${id}`,'DELETE');toast('Fase eliminada');loadPayments();}catch(e){toast(e.message,'error');}
  });
}

function openAddPaymentModal(preselectedPlayerId=null){
  const sel=$('pay-player');
  sel.innerHTML=state.players.map(p=>`<option value="${p.id}" ${p.id===preselectedPlayerId?'selected':''}>${p.player_number} - ${p.full_name}${p.status!=='activo'?' ('+p.status+')':''}</option>`).join('');
  $('pay-amount').value=''; $('pay-notes').value=''; clearError('payment-error'); showModal('modal-payment');
}

function openDeudaManualModal(preselectedPlayerId=null){
  const sel=$('deuda-player');
  if(sel) sel.innerHTML=state.players.map(p=>`<option value="${p.id}" ${p.id===preselectedPlayerId?'selected':''}>${p.player_number} - ${p.full_name}</option>`).join('');
  const monto=$('deuda-monto'); if(monto)monto.value='';
  const concepto=$('deuda-concepto'); if(concepto)concepto.value='';
  clearError('deuda-error');
  showModal('modal-deuda-manual');
}

async function saveDeudaManual(){
  const body={
    player_id:+$('deuda-player').value,
    monto:+$('deuda-monto').value,
    concepto:$('deuda-concepto').value.trim(),
    tipo:$('deuda-tipo').value,
    fase:$('deuda-fase').value||null,
  };
  if(!body.player_id||!body.monto){showError('deuda-error','Jugador y monto son obligatorios.');return;}
  try{
    const res=await api(`/finances/deuda-manual${tParam()}`,'POST',body);
    toast(res.message); closeModal('modal-deuda-manual'); loadPayments();
  }catch(e){showError('deuda-error',e.message);}
}

// ── MATCH MODALS ──────────────────────────────────────────────────
function openAddMatchModal(){
  $('modal-match-title').textContent='Agregar Partido'; $('match-edit-id').value='';
  ['m-opponent','m-location','m-notes'].forEach(id=>$(id).value='');
  $('m-date').value=''; $('m-phase').value='';
  clearError('match-error'); showModal('modal-match');
}
function openEditMatchModal(id){
  const m=state.matches.find(x=>x.id===id); if(!m)return;
  $('modal-match-title').textContent='Editar Partido'; $('match-edit-id').value=id;
  $('m-opponent').value=m.opponent;
  // FIX ZONA HORARIA: mostrar la hora correcta al editar
  $('m-date').value=m.match_date.slice(0,16);
  $('m-phase').value=m.phase||''; $('m-location').value=m.location||''; $('m-notes').value=m.notes||'';
  clearError('match-error'); showModal('modal-match');
}
function deleteMatch(id) {
  const m=state.matches.find(x=>x.id===id);
  confirmar({icon:'🗑️', titulo:'¿Eliminar partido?', msg:`Se eliminará el partido vs ${m?.opponent||''} permanentemente.`}, async ok => {
    if(!ok)return; try{await api(`/matches/${id}`,'DELETE');toast('Partido eliminado');loadHome();}catch(e){toast(e.message,'error');}
  });
}
function openResultModal(matchId){
  const m=state.matches.find(x=>x.id===matchId); if(!m)return;
  $('result-match-id').value=matchId; $('r-home').value=m.home_score??0; $('r-away').value=m.away_score??0;
  clearError('result-error'); renderGoalRows(m.goals||[]); showModal('modal-result');
}
function renderGoalRows(goals=[]){ const c=$('goals-list'); c.innerHTML=''; goals.forEach(g=>addGoalRow(g.player_id,g.count,g.assist_player_id,g.id)); }
function addGoalRow(playerId='',count=1,assistId='',existingGoalId=''){
  const row=document.createElement('div'); row.style.cssText='display:flex;gap:8px;align-items:center;flex-wrap:wrap'; row.dataset.goalId=existingGoalId;
  const activePlayers = state.players.filter(p=>p.is_active||p.status==='lesionado');
  const playerOpts=activePlayers.map(p=>`<option value="${p.id}" ${p.id==playerId?'selected':''}>${p.player_number} ${p.full_name.split(' ')[0]}</option>`).join('');
  const assistOpts=`<option value="">Sin asistencia</option>`+activePlayers.map(p=>`<option value="${p.id}" ${p.id==assistId?'selected':''}>${p.player_number} ${p.full_name.split(' ')[0]}</option>`).join('');
  row.innerHTML=`<select class="form-input goal-player" style="flex:1;min-width:120px"><option value="">Goleador</option>${playerOpts}</select><input type="number" class="form-input goal-count" min="1" max="10" value="${count}" style="width:60px"/><select class="form-input goal-assist" style="flex:1;min-width:120px">${assistOpts}</select><button type="button" class="btn btn-danger" style="padding:6px 10px" onclick="this.parentElement.remove()">×</button>`;
  $('goals-list').appendChild(row);
}

// ── SAVE HANDLERS ─────────────────────────────────────────────────
async function savePlayer(){
  const editId=$('player-edit-id').value;
  const isNew=$('p-is-new')?.checked||false;
  const body={
    id_number:$('p-idnumber').value.trim(),
    full_name:$('p-name').value.trim(),
    player_number:+$('p-number').value,
    phone:$('p-phone').value.trim()||null,
    health_info:$('p-health').value.trim()||null,
    is_new_player:isNew,
    joined_at_match:isNew?(+($('p-joined-match')?.value)||null):null,
  };
  if(!body.id_number||!body.full_name||!body.player_number){showError('player-error','Cédula, nombre y número son obligatorios.');return;}
  try{
    if(editId){await api(`/players/${editId}`,'PUT',body);toast('Jugador actualizado');}
    else{
      await api(`/players${tParam()}`,'POST',body);
      toast(isNew?'Jugador nuevo agregado con deuda proporcional':'Jugador añadido');
    }
    closeModal('modal-player'); loadPlayers();
  }catch(e){showError('player-error',e.message);}
}

async function saveMatch(){
  const editId=$('match-edit-id').value, dateVal=$('m-date').value;
  if(!$('m-opponent').value.trim()||!dateVal){showError('match-error','Rival y fecha son obligatorios.');return;}
  // FIX ZONA HORARIA: enviar fecha como string local sin convertir a UTC
  const body={
    opponent:$('m-opponent').value.trim(),
    match_date:dateVal,   // "2024-05-20T15:00" — sin convertir a UTC
    phase:$('m-phase').value||null,
    location:$('m-location').value.trim()||null,
    notes:$('m-notes').value.trim()||null,
  };
  try{
    if(editId){await api(`/matches/${editId}`,'PUT',body);toast('Partido actualizado');}
    else{await api(`/matches${tParam()}`,'POST',body);toast('Partido añadido');}
    closeModal('modal-match'); loadHome();
  }catch(e){showError('match-error',e.message);}
}

async function saveResult(){
  const matchId=+$('result-match-id').value;
  try{
    await api(`/matches/${matchId}`,'PUT',{is_played:true,home_score:+$('r-home').value,away_score:+$('r-away').value});
    const currentMatch=await api(`/matches/${matchId}`);
    for(const g of currentMatch.goals){await api(`/goals/${g.id}`,'DELETE');}
    const rows=$('goals-list').querySelectorAll('div[data-goal-id]');
    for(const row of rows){
      const playerId=row.querySelector('.goal-player').value; if(!playerId)continue;
      await api(`/matches/${matchId}/goals`,'POST',{player_id:+playerId,count:+row.querySelector('.goal-count').value,assist_player_id:row.querySelector('.goal-assist').value?+row.querySelector('.goal-assist').value:null});
    }
    toast('Resultado registrado'); closeModal('modal-result'); loadHome();
  }catch(e){showError('result-error',e.message);}
}

async function savePayment(){
  const body={player_id:+$('pay-player').value,payment_type:$('pay-type').value,phase:$('pay-phase').value||null,amount:+$('pay-amount').value,notes:$('pay-notes').value.trim()||null};
  if(!body.player_id||!body.amount){showError('payment-error','Jugador y monto son obligatorios.');return;}
  try{await api(`/finances/payment${tParam()}`,'POST',body);toast('Pago registrado');closeModal('modal-payment');loadPayments();}
  catch(e){showError('payment-error',e.message);}
}

async function saveInscripcionConfig(){
  const body={total_amount:+$('insc-total').value,total_matches:+($('insc-matches')?.value||0)||null,notes:$('insc-notes').value.trim()};
  if(!body.total_amount){showError('insc-error','El monto es obligatorio.');return;}
  try{
    const res=await api(`/finances/inscripcion-config${tParam()}`,'POST',body);
    toast(res.message); closeModal('modal-inscripcion'); loadPayments();
  }catch(e){showError('insc-error',e.message);}
}

async function saveArbitrajePhase(){
  const body={fase:$('arb-fase').value.trim(),num_games:+$('arb-games').value,price_per_game:+$('arb-price').value,notes:$('arb-notes').value.trim()};
  if(!body.fase||!body.num_games||!body.price_per_game){showError('arb-error','Fase, partidos y precio son obligatorios.');return;}
  try{
    const res=await api(`/finances/arbitraje-phase${tParam()}`,'POST',body);
    toast(res.message+(res.excluded_note?' — '+res.excluded_note:''));
    closeModal('modal-arbitraje'); loadPayments();
  }catch(e){showError('arb-error',e.message);}
}

function updateArbPreview(){
  const games=+($('arb-games')?.value||0),price=+($('arb-price')?.value||0);
  const players=state.players.filter(p=>p.status==='activo');
  const prev=$('arb-preview'); if(!prev)return;
  if(games>0&&price>0&&players.length>0){
    const total=games*price;
    prev.textContent=`Total: ${fmt(total)} ÷ ${players.length} jugadores activos = ${fmt(Math.round(total/players.length))} c/u`;
    prev.style.color='var(--green)';
  } else { prev.textContent=''; }
}

// ── GALERÍA ───────────────────────────────────────────────────────
async function loadGallery() {
  const grid = $('gallery-grid');
  const btn = $('btn-upload-photo');
  if (btn) btn.style.display = (state.isAdmin && !isViewingPast()) ? 'inline-flex' : 'none';
  grid.innerHTML = '<div class="loading-wrap"><div class="spinner"></div></div>';
  try {
    const photos = await api(`/gallery${tParam()}`);
    if (!photos.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1">
        <div class="empty-icon">📸</div><h3>Sin fotos aún</h3>
        ${state.isAdmin ? `<button class="btn btn-primary" style="margin-top:12px" onclick="$('photo-file').click()">+ Subir primera foto</button>` : ''}
      </div>`;
      return;
    }
    grid.innerHTML = photos.map(p => `
      <div style="position:relative;border-radius:var(--radius-lg);overflow:hidden;aspect-ratio:1;background:var(--surface-mid)">
        <img src="${p.url}" alt="${p.caption||''}" style="width:100%;height:100%;object-fit:cover;cursor:pointer" onclick="openPhotoModal('${p.url}','${p.caption||''}')"/>
        ${p.caption ? `<div style="position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,rgba(0,0,0,0.7));color:#fff;font-size:11px;padding:8px 8px 6px;line-height:1.3">${p.caption}</div>` : ''}
        ${state.isAdmin && !isViewingPast() ? `<button onclick="deletePhoto(${p.id})" style="position:absolute;top:6px;right:6px;background:rgba(186,26,26,0.85);color:#fff;border:none;border-radius:50%;width:26px;height:26px;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center">×</button>` : ''}
      </div>`).join('');
  } catch(e) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="empty-icon">❌</div><h3>${e.message}</h3></div>`;
  }
}

function openPhotoModal(url, caption) {
  $('photo-modal-img').src = url;
  $('photo-modal-caption').textContent = caption;
  showModal('modal-photo-view');
}

async function uploadPhoto() {
  const fileInput = $('photo-file');
  const caption = $('photo-caption').value.trim();
  if (!fileInput.files[0]) { toast('Selecciona una foto', 'warning'); return; }
  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  formData.append('caption', caption);
  const btn = $('btn-confirm-upload');
  btn.disabled = true; btn.textContent = 'Subiendo...';
  try {
    const tq = state.viewingTournament ? `?t=${state.viewingTournament.id}` : '';
    const res = await fetch(`/api/gallery${tq}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}` },
      body: formData,
    });
    let data;
    try { data = await res.json(); } catch(e) {
      throw new Error('Error en el servidor al subir la foto. Revisa que Supabase Storage esté configurado y la consola del servidor para más detalles.');
    }
    if (!res.ok) throw new Error(data.detail || 'Error subiendo foto');
    toast('¡Foto subida!');
    closeModal('modal-upload-photo');
    fileInput.value = ''; $('photo-caption').value = '';
    loadGallery();
    loadHomeGallery();
  } catch(e) { toast(e.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Subir foto'; }
}

function deletePhoto(id) {
  confirmar({ icon:'🗑️', titulo:'¿Eliminar foto?', msg:'Esta foto se eliminará permanentemente.' }, async ok => {
    if (!ok) return;
    try { await api(`/gallery/${id}`, 'DELETE'); toast('Foto eliminada'); loadGallery(); }
    catch(e) { toast(e.message, 'error'); }
  });
}

// ── INTELIGENCIA ARTIFICIAL ───────────────────────────────────────
let aiFileData = null;
let aiFileDataRetirados = [];
// resultIdx tracks current position in the results slider


async function loadAI() {
  // Mostrar/ocultar secciones admin
  document.querySelectorAll('#page-ai .admin-only').forEach(el => {
    el.style.display = state.isAdmin ? '' : 'none';
  });
  // Cargar partidos jugados para la crónica
  if (state.isAdmin && state.matches.length) {
    const played = state.matches.filter(m => m.is_played);
    const sel = $('chronicle-match');
    if (sel) {
      sel.innerHTML = '<option value="">Seleccionar partido...</option>' +
        played.map(m => `<option value="${m.id}">${m.opponent} — ${fmtShortDate(m.match_date)} (${m.home_score}-${m.away_score})</option>`).join('');
    }
  }
  // Mensaje de bienvenida en el chat
  const msgs = $('chat-messages');
  if (msgs && !msgs.children.length) {
    addChatMessage('bot', '¡Hola! Soy el asistente de Mirador II FC 🟢⚽ Pregúntame lo que quieras sobre el equipo, partidos, dineros o jugadores.');
  }
}

function addChatMessage(role, text) {
  const msgs = $('chat-messages');
  const div = document.createElement('div');
  div.style.cssText = `max-width:85%;padding:10px 14px;border-radius:${role==='user'?'12px 12px 4px 12px':'12px 12px 12px 4px'};font-size:14px;line-height:1.5;${role==='user'?'background:var(--navy);color:#fff;align-self:flex-end':'background:var(--surface-low);color:var(--text);align-self:flex-start;border:1px solid var(--border-light)'}`;
  div.textContent = text;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

async function sendChat() {
  const input = $('chat-input');
  const question = input.value.trim();
  if (!question) return;
  addChatMessage('user', question);
  input.value = '';
  const btn = $('btn-chat-send');
  btn.disabled = true; btn.textContent = '...';
  try {
    const res = await api(`/ai/chat${tParam()}`, 'POST', { question });
    addChatMessage('bot', res.answer);
  } catch(e) {
    addChatMessage('bot', '❌ Error: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Enviar';
  }
}

function quickChat(q) {
  $('chat-input').value = q;
  sendChat();
}

async function generateChronicle() {
  const matchId = $('chronicle-match').value;
  if (!matchId) { toast('Selecciona un partido', 'warning'); return; }
  const btn = $('btn-generate-chronicle');
  btn.disabled = true; btn.textContent = '✨ Generando...';
  try {
    const res = await api(`/ai/chronicle/${matchId}`, 'POST');
    $('chronicle-text').textContent = res.chronicle;
    $('chronicle-result').style.display = 'block';
    toast('¡Crónica generada!');
  } catch(e) { toast(e.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = '✨ Generar crónica'; }
}

function copyChronicle() {
  const text = $('chronicle-text').textContent;
  navigator.clipboard.writeText(text).then(() => toast('¡Copiado al portapapeles!'));
}

async function handleFileSelect(input) {
  const file = input.files[0];
  if (!file) return;
  $('file-loading').style.display = 'block';
  $('file-preview').style.display = 'none';
  const formData = new FormData();
  formData.append('file', file);
  const tq = state.viewingTournament ? `?t=${state.viewingTournament.id}` : '';
  try {
    const res = await fetch(`/api/ai/read-file${tq}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}` },
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Error procesando archivo');

    // Guardar ambos grupos
    aiFileData = data.jugadores || [];
    aiFileDataRetirados = data.retirados || [];
    const formato = data.formato || 'simple';

    if (formato === 'excel_mirador') {
      renderFilePreviewCompleto(aiFileData, aiFileDataRetirados, file.name);
    } else {
      renderFilePreviewSimple(aiFileData, file.name);
    }
  } catch(e) {
    toast(e.message, 'error');
  } finally {
    $('file-loading').style.display = 'none';
  }
}

function _fmtConcepto(blk) {
  if (!blk) return '<td style="padding:5px 8px;text-align:right;font-size:11px;color:#999">-</td>';
  const debe = blk.debe || 0;
  const color = debe > 0 ? '#c0392b' : '#27ae60';
  const label = debe > 0 ? fmt(debe) : '✓ Al día';
  return `<td style="padding:5px 8px;text-align:right;font-size:12px;font-weight:600;color:${color}">${label}</td>`;
}

function renderFilePreviewCompleto(jugadores, retirados, filename) {
  const totalDebe = jugadores.reduce((s,j) => s + (j.total_debe||0), 0);
  const totalAbono = jugadores.reduce((s,j) => s + (j.total_abono||0), 0);

  const filas = (list, esRetirado) => list.map((j,i) => {
    const bg = esRetirado ? '#fff8f0' : (i%2===0 ? 'var(--surface-low)' : '');
    const d = j.total_debe || 0;
    return `<tr style="border-bottom:1px solid var(--border-light);background:${bg}">
      <td style="padding:5px 8px;font-family:'JetBrains Mono',monospace;font-weight:700;color:var(--navy)">${j.numero||'-'}</td>
      <td style="padding:5px 8px;font-weight:600;font-size:12px">${j.nombre}${esRetirado?' <span style="font-size:10px;color:#e67e22;background:#fff3cd;padding:1px 4px;border-radius:3px">Ret.</span>':''}</td>
      ${_fmtConcepto(j.inscripcion)}
      ${_fmtConcepto(j.arb_f1)}
      ${_fmtConcepto(j.arb_f2)}
      ${_fmtConcepto(j.arb_f3)}
      <td style="padding:5px 8px;text-align:right;font-weight:700;font-size:12px;color:${d>0?'#c0392b':'#27ae60'}">${d>0?fmt(d):'✓ Paz y Salvo'}</td>
    </tr>`;
  }).join('');

  $('file-preview-title').textContent = `📋 ${jugadores.length} activos + ${retirados.length} retirados — "${filename}"`;
  $('file-preview-table').innerHTML = `
    <div style="overflow-x:auto">
      <div style="display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap">
        <div style="background:var(--surface-low);border-radius:8px;padding:10px 16px;flex:1;min-width:140px">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px">Total abonado</div>
          <div style="font-size:16px;font-weight:700;color:var(--green)">${fmt(totalAbono)}</div>
        </div>
        <div style="background:var(--surface-low);border-radius:8px;padding:10px 16px;flex:1;min-width:140px">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px">Total pendiente</div>
          <div style="font-size:16px;font-weight:700;color:var(--red)">${fmt(totalDebe)}</div>
        </div>
        <div style="background:var(--surface-low);border-radius:8px;padding:10px 16px;flex:1;min-width:140px">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px">Al día</div>
          <div style="font-size:16px;font-weight:700;color:var(--navy)">${jugadores.filter(j=>(j.total_debe||0)===0).length} / ${jugadores.length}</div>
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:var(--navy);color:#fff">
            <th style="padding:7px 8px;text-align:left">#</th>
            <th style="padding:7px 8px;text-align:left">Nombre</th>
            <th style="padding:7px 8px;text-align:right">Inscripción</th>
            <th style="padding:7px 8px;text-align:right">Arb F1</th>
            <th style="padding:7px 8px;text-align:right">Arb F2</th>
            <th style="padding:7px 8px;text-align:right">Arb F3</th>
            <th style="padding:7px 8px;text-align:right">Total Debe</th>
          </tr>
        </thead>
        <tbody>
          ${filas(jugadores, false)}
          ${retirados.length ? `<tr><td colspan="7" style="padding:6px 8px;background:#fff3cd;font-size:11px;color:#856404;font-weight:600">⚠️ Jugadores retirados / expulsados</td></tr>${filas(retirados, true)}` : ''}
        </tbody>
      </table>
      ${retirados.length ? `<label style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:13px;cursor:pointer">
        <input type="checkbox" id="chk-include-retirados"> Importar también jugadores retirados
      </label>` : ''}
    </div>`;
  $('file-preview').style.display = 'block';
  // Actualizar botón para usar import-finances
  const btn = $('btn-import-players');
  if (btn) { btn.dataset.modo = 'finances'; btn.textContent = '✅ Importar todo a la app'; }
}

function renderFilePreviewSimple(jugadores, filename) {
  $('file-preview-title').textContent = `📋 ${jugadores.length} jugadores encontrados en "${filename}"`;
  $('file-preview-table').innerHTML = `
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:var(--navy);color:#fff">
          <th style="padding:8px;text-align:left">#</th>
          <th style="padding:8px;text-align:left">Nombre</th>
          <th style="padding:8px;text-align:right">Deuda</th>
          <th style="padding:8px;text-align:right">Pagado</th>
          <th style="padding:8px;text-align:right">Pendiente</th>
        </tr></thead>
        <tbody>${jugadores.map((j,i) => `
          <tr style="border-bottom:1px solid var(--border-light);${i%2===0?'background:var(--surface-low)':''}">
            <td style="padding:8px;font-family:'JetBrains Mono',monospace;font-weight:700;color:var(--navy)">${j.numero}</td>
            <td style="padding:8px;font-weight:600">${j.nombre}</td>
            <td style="padding:8px;text-align:right;color:var(--red)">${fmt(j.deuda_total||0)}</td>
            <td style="padding:8px;text-align:right;color:var(--green)">${fmt(j.pagado||0)}</td>
            <td style="padding:8px;text-align:right;font-weight:700">${fmt((j.deuda_total||0)-(j.pagado||0))}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  $('file-preview').style.display = 'block';
  const btn = $('btn-import-players');
  if (btn) { btn.dataset.modo = 'simple'; btn.textContent = '✅ Importar a la app'; }
}

async function importPlayers() {
  if (!aiFileData) return;
  const btn = $('btn-import-players');
  const modo = btn.dataset.modo || 'simple';
  btn.disabled = true; btn.textContent = 'Importando...';
  try {
    const tq = state.viewingTournament ? `?t=${state.viewingTournament.id}` : '';
    let res;
    if (modo === 'finances') {
      const chk = $('chk-include-retirados');
      const incluirRet = chk ? chk.checked : false;
      res = await api(`/ai/import-finances${tq}`, 'POST', {
        jugadores: aiFileData,
        retirados: aiFileDataRetirados || [],
        incluir_retirados: incluirRet,
      });
    } else {
      res = await api(`/ai/import-players${tq}`, 'POST', { jugadores: aiFileData });
    }
    toast(res.message);
    if (res.errores && res.errores.length) toast(`Advertencias: ${res.errores.join(', ')}`, 'warning');
    $('file-preview').style.display = 'none';
    $('file-input').value = '';
    aiFileData = null; aiFileDataRetirados = [];
    state.players = [];
  } catch(e) { toast(e.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = '✅ Importar a la app'; }
}

async function doLogin(){
  clearError('login-error');
  try{
    const data=await api('/auth/login','POST',{username:$('login-user').value.trim(),password:$('login-pass').value});
    setAuth(data.access_token,data.is_admin);
    closeModal('modal-login'); toast('¡Bienvenido, admin!');
  }catch(e){showError('login-error',e.message);}
}

// ── INIT ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  updateAuthUI();
  await loadTournaments();

  document.querySelectorAll('[data-page]').forEach(link=>{
    link.addEventListener('click',e=>{e.preventDefault();navigateTo(link.dataset.page);});
  });

  const handleLoginBtn=()=>{
    if(state.isAdmin){logout();return;}
    $('login-user').value='';$('login-pass').value='';clearError('login-error');showModal('modal-login');
  };
  $('btn-login').addEventListener('click',handleLoginBtn);
  const mob=$('btn-login-mobile'); if(mob)mob.addEventListener('click',handleLoginBtn);
  $('hamburger').addEventListener('click',()=>$('mobile-menu').classList.toggle('open'));

  document.querySelectorAll('[data-close]').forEach(btn=>btn.addEventListener('click',()=>closeModal(btn.dataset.close)));
  document.querySelectorAll('.modal-overlay').forEach(overlay=>overlay.addEventListener('click',e=>{if(e.target===overlay)closeModal(overlay.id);}));

  $('prev-match').addEventListener('click',()=>goSlide(state.sliderIdx-1));
  $('next-match').addEventListener('click',()=>goSlide(state.sliderIdx+1));
  $('btn-add-player').addEventListener('click',openAddPlayerModal);
  $('btn-save-player').addEventListener('click',savePlayer);
  $('btn-save-match').addEventListener('click',saveMatch);
  $('btn-save-result').addEventListener('click',saveResult);
  $('btn-add-goal-row').addEventListener('click',()=>addGoalRow());
  $('btn-do-login').addEventListener('click',doLogin);
  $('login-pass').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});

  const btnAddPay=$('btn-add-payment');
  if(btnAddPay)btnAddPay.addEventListener('click',()=>{if(!state.players.length){toast('Carga jugadores primero','warning');return;}openAddPaymentModal();});
  const btnSavePay=$('btn-save-payment'); if(btnSavePay)btnSavePay.addEventListener('click',savePayment);
  const btnSaveInsc=$('btn-save-inscripcion'); if(btnSaveInsc)btnSaveInsc.addEventListener('click',saveInscripcionConfig);
  const btnSaveArb=$('btn-save-arbitraje'); if(btnSaveArb)btnSaveArb.addEventListener('click',saveArbitrajePhase);
  const btnSaveTorneo=$('btn-save-tournament'); if(btnSaveTorneo)btnSaveTorneo.addEventListener('click',createTournament);
  const btnSaveDeuda=$('btn-save-deuda-manual'); if(btnSaveDeuda)btnSaveDeuda.addEventListener('click',saveDeudaManual);

  // Galería
  const btnUploadPhoto=$('btn-upload-photo');
  if(btnUploadPhoto)btnUploadPhoto.addEventListener('click',()=>showModal('modal-upload-photo'));
  const btnConfirmUpload=$('btn-confirm-upload');
  if(btnConfirmUpload)btnConfirmUpload.addEventListener('click',uploadPhoto);

  // IA - Chat
  const btnChatSend=$('btn-chat-send');
  if(btnChatSend)btnChatSend.addEventListener('click',sendChat);
  const chatInput=$('chat-input');
  if(chatInput)chatInput.addEventListener('keydown',e=>{if(e.key==='Enter')sendChat();});

  // Home - Mini chat
  const btnHomeChatSend=$('btn-home-chat-send');
  if(btnHomeChatSend)btnHomeChatSend.addEventListener('click',sendHomeChat);
  const homeChatInput=$('home-chat-input');
  if(homeChatInput)homeChatInput.addEventListener('keydown',e=>{if(e.key==='Enter')sendHomeChat();});

  // IA - Crónica
  const btnChronicle=$('btn-generate-chronicle');
  if(btnChronicle)btnChronicle.addEventListener('click',generateChronicle);

  // IA - Importar
  const btnImport=$('btn-import-players');
  if(btnImport)btnImport.addEventListener('click',importPlayers);

  ['arb-games','arb-price'].forEach(id=>{const el=$(id);if(el)el.addEventListener('input',updateArbPreview);});

  // Toggle jugador nuevo
  const isNewChk=$('p-is-new');
  if(isNewChk)isNewChk.addEventListener('change',()=>{
    const fields=$('p-new-fields');
    if(fields)fields.style.display=isNewChk.checked?'block':'none';
  });

  loadHome();
});