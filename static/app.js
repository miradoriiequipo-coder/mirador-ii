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
  matchVotes: {},
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
  // Scroll al top en móvil
  window.scrollTo(0, 0);
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
  // Limpiar boletín del torneo anterior
  localStorage.removeItem('miradorBulletin');
  const banner = $('bulletin-banner');
  if (banner) { banner.style.display = 'none'; banner.innerHTML = ''; }
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
    if (res.finance_card) {
      const card = document.createElement('div');
      card.style.cssText = 'align-self:flex-start;max-width:95%;width:100%';
      card.innerHTML = renderFinanceCard(res.finance_card);
      msgs.appendChild(card);
      msgs.scrollTop = msgs.scrollHeight;
    }
  } catch(e) {
    addMsg('Error: ' + e.message, false);
  } finally { btn.disabled = false; btn.textContent = '→'; }
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
// ── BOLETÍN ────────────────────────────────────────────────────
function renderBulletinBanner(data) {
  const banner = $('bulletin-banner');
  if (!data || !banner) return;

  const R  = Array.isArray(data.resultados)           ? data.resultados           : [];
  const PR = Array.isArray(data.programacion)          ? data.programacion          : [];
  const VM = Array.isArray(data.valla_menos_vencida)   ? data.valla_menos_vencida   : [];
  const FP = Array.isArray(data.fair_play)             ? data.fair_play             : [];
  const CR = Array.isArray(data.cronograma)            ? data.cronograma            : [];
  const pp = data.proximo_partido_mirador;
  const fase = data.fase_actual || '';

  if (!R.length && !PR.length && !FP.length) return;

  // ─ helpers ─
  const sec = (icon, titulo, contenido) => `
    <div style="border-bottom:1px solid var(--border-light)">
      <div style="background:var(--navy);padding:7px 14px;display:flex;align-items:center;gap:7px">
        <span style="font-size:13px">${icon}</span>
        <span style="font-family:'Oswald',sans-serif;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#fff">${titulo}</span>
      </div>
      <div style="padding:10px 14px">${contenido}</div>
    </div>`;

  const marcador = (local, gl, gv, visitante, resaltado) => {
    const borde = resaltado ? 'border-left:3px solid var(--lime)' : 'border-left:3px solid transparent';
    return `<div style="display:grid;grid-template-columns:1fr 44px 1fr;align-items:center;padding:6px 0;${borde};padding-left:${resaltado?'8px':'0'}">
      <span style="font-size:11px;font-weight:${resaltado?700:400};text-align:right;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${local}</span>
      <span style="font-family:'Oswald',sans-serif;font-size:15px;font-weight:700;color:var(--navy);text-align:center">${gl??'—'} — ${gv??'—'}</span>
      <span style="font-size:11px;font-weight:${resaltado?700:400};color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${visitante}</span>
    </div>`;
  };

  const filaPartido = (local, visitante, hora, resaltado) => {
    const borde = resaltado ? 'border-left:3px solid var(--lime)' : 'border-left:3px solid transparent';
    return `<div style="display:grid;grid-template-columns:1fr 50px 1fr;align-items:center;padding:6px 0;${borde};padding-left:${resaltado?'8px':'0'}">
      <span style="font-size:11px;font-weight:${resaltado?700:400};text-align:right;color:var(--text)">${local}</span>
      <span style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;color:var(--text-faint);text-align:center">${hora||'DOM'}</span>
      <span style="font-size:11px;font-weight:${resaltado?700:400};color:var(--text)">${visitante}</span>
    </div>`;
  };

  let html = `<div style="border-radius:var(--radius-lg);overflow:hidden;border:1.5px solid var(--navy);background:var(--surface)">`;

  // ── CABECERA ──
  const mirador_fp = FP.find(e => e.es_mirador);
  const mirador_vm = VM.find(e => e.es_mirador);
  html += `
    <div style="background:var(--navy);padding:10px 14px;display:flex;align-items:center;justify-content:space-between">
      <div>
        <div style="font-family:'Oswald',sans-serif;font-size:14px;font-weight:700;color:#fff;letter-spacing:0.06em">COPA METROPOLITANA</div>
        <div style="font-size:10px;color:rgba(255,255,255,0.45);margin-top:1px">${fase}${data._fecha?' · '+data._fecha:''}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px">
        ${mirador_fp?.es_ganador ? `<span style="background:var(--lime);color:var(--navy);font-family:'Oswald',sans-serif;font-size:10px;font-weight:700;padding:3px 9px;border-radius:3px">🏆 FAIR PLAY #1</span>` : mirador_fp ? `<span style="font-size:10px;color:var(--lime);background:rgba(193,241,0,0.12);padding:3px 9px;border-radius:3px;font-weight:600">🎖️ FP ${mirador_fp.puesto}° — ${mirador_fp.puntos}pts</span>` : ''}
        ${mirador_vm ? `<span style="font-size:10px;color:rgba(255,255,255,0.5);padding:2px 0">🧤 Valla ${mirador_vm.puesto}° — ${mirador_vm.goles_contra} GC</span>` : ''}
      </div>
    </div>`;

  // ── PRÓXIMO PARTIDO (solo si existe en el boletín actual) ──
  if (pp?.rival && (pp.fecha_str || pp.hora || PR.some(p => p.tiene_mirador))) {
    const rival = pp.es_local ? `MIRADOR II vs ${pp.rival.toUpperCase()}` : `${pp.rival.toUpperCase()} vs MIRADOR II`;
    html += `
      <div style="background:linear-gradient(135deg,#0d2a5e,#1a3f8a);padding:12px 14px;border-top:2px solid var(--lime)">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.15em;color:var(--lime);font-weight:700;margin-bottom:5px">⚽ Nuestro próximo partido</div>
        <div style="font-family:'Oswald',sans-serif;font-size:17px;font-weight:700;color:#fff">${rival}</div>
        <div style="display:flex;gap:14px;margin-top:5px;flex-wrap:wrap">
          ${data.proxima_fecha ? `<span style="font-size:11px;color:rgba(255,255,255,0.7)">📆 ${data.proxima_fecha}</span>` : `<span style="font-size:11px;color:rgba(255,255,255,0.4);font-style:italic">📆 Fecha por confirmar</span>`}
          ${pp.hora ? `<span style="font-size:11px;font-weight:700;color:var(--lime)">⏰ ${pp.hora}</span>` : ''}
          ${pp.campo ? `<span style="font-size:11px;color:rgba(255,255,255,0.6)">📍 ${pp.campo}</span>` : ''}
        </div>
        ${state.isAdmin ? `<div style="margin-top:8px;display:flex;gap:6px">
          <button class="btn btn-secondary" style="font-size:10px;padding:3px 10px" onclick="autoCrearPartidoPDF(${JSON.stringify(pp).replace(/"/g,'&quot;')})">⚡ Crear partido</button>
          <button class="btn btn-secondary" style="font-size:10px;padding:3px 10px" onclick="preCargarPartidoPDF(${JSON.stringify(pp).replace(/"/g,'&quot;')})">✏️ Editar</button>
        </div>` : ''}
      </div>`;
  }

  // ── RESULTADOS ──
  if (R.length) {
    const gruposR = [...new Set(R.map(r => r.grupo))].sort();
    const contenidoR = gruposR.map(g => {
      const filas = R.filter(r => r.grupo === g);
      return `<div style="margin-bottom:8px">
        <div style="font-size:9px;font-weight:700;letter-spacing:0.1em;color:var(--text-faint);text-transform:uppercase;margin-bottom:4px">GRUPO ${g}</div>
        ${filas.map(r => marcador(r.local, r.goles_local, r.goles_visitante, r.visitante, r.tiene_mirador)).join('')}
      </div>`;
    }).join('');
    html += sec('⚽', `Resultados ${data.fecha_juego ? '— '+data.fecha_juego : ''}`, contenidoR);
  }

  // ── PROGRAMACIÓN ──
  if (PR.length) {
    const gruposPR = [...new Set(PR.map(r => r.grupo).filter(g => g && g !== 'null'))].sort();
    const contenidoPR = gruposPR.length ? gruposPR.map(g => {
      const filas = PR.filter(r => r.grupo === g);
      return `<div style="margin-bottom:8px">
        <div style="font-size:9px;font-weight:700;letter-spacing:0.1em;color:var(--text-faint);text-transform:uppercase;margin-bottom:4px">GRUPO ${g}</div>
        ${filas.map(r => filaPartido(r.local, r.visitante, r.hora, r.tiene_mirador)).join('')}
      </div>`;
    }).join('') : PR.map(r => filaPartido(r.local, r.visitante, r.hora, r.tiene_mirador)).join('');
    html += sec('📅', `Programación ${data.proxima_fecha ? '— '+data.proxima_fecha : ''}`, contenidoPR);
  }

  // ── VALLA MENOS VENCIDA ──
  if (VM.length) {
    const filas = VM.map((e,i) => {
      const esM = e.es_mirador;
      return `<div style="display:flex;align-items:center;padding:5px 0;border-bottom:1px solid var(--border-light);${esM?'font-weight:700;':''}">
        <span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:${e.puesto<=3?'var(--navy)':'var(--text-faint)'};width:22px">${e.puesto}°</span>
        <span style="flex:1;font-size:12px;color:${esM?'var(--navy)':'var(--text)'}">${e.equipo}${esM?' ◀':''}</span>
        <span style="font-family:'Oswald',sans-serif;font-size:14px;font-weight:700;color:${e.puesto===1?'var(--navy)':'var(--text-faint)'}">${e.goles_contra}</span>
      </div>`;
    }).join('');
    html += sec('🧤', 'Valla Menos Vencida', `<div>${filas}</div>`);
  }

  // ── FAIR PLAY ──
  if (FP.length) {
    const filas = FP.map(e => {
      const esM = e.es_mirador;
      return `<div style="display:flex;align-items:center;padding:5px 0;border-bottom:1px solid var(--border-light);${esM?'font-weight:700;background:rgba(193,241,0,0.06);margin:0 -14px;padding:5px 14px;':''}">
        <span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:${e.puesto<=3?'var(--navy)':'var(--text-faint)'};width:22px">${e.puesto}°</span>
        <span style="flex:1;font-size:12px;color:${esM?'var(--navy)':'var(--text)'}">${e.equipo}${e.es_ganador?' 🏆':''}</span>
        <span style="font-family:'Oswald',sans-serif;font-size:14px;font-weight:700;color:${esM?'var(--navy)':'var(--text-faint)'}">${e.puntos}</span>
      </div>`;
    }).join('');
    html += sec('🎖️', 'Fair Play — Juego Limpio', `<div>${filas}</div>`);
  }

  // ── CRONOGRAMA ──
  if (CR.length) {
    const hoy = new Date();
    const filas = CR.map(c => `
      <div style="display:flex;gap:10px;padding:5px 0;border-bottom:1px solid var(--border-light);align-items:center">
        <span style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;color:var(--navy);min-width:60px">${c.fecha}</span>
        <span style="font-size:11px;color:var(--text)">${c.evento}</span>
      </div>`).join('');
    html += sec('📆', 'Cronograma', `<div>${filas}</div>`);
  }

  html += `</div>`;
  banner.style.display = 'block';
  banner.innerHTML = html;
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

    // Guardar en localStorage Y en el servidor (para todos los dispositivos)
    if (!data.proximo_partido_mirador?.rival) data.proximo_partido_mirador = null;
    const stored = { ...data, _fecha: new Date().toLocaleDateString('es-CO', {day:'numeric',month:'short'}) };
    localStorage.setItem('miradorBulletin', JSON.stringify(stored));
    // Guardar en servidor para que aparezca en todos los dispositivos
    try {
      await api(`/tournaments/bulletin${tParam()}`, 'POST', stored);
    } catch(e) { /* silencioso — localStorage ya lo tiene */ }
    localStorage.setItem('miradorBulletin', JSON.stringify(stored));

    // Actualizar el inicio con el nuevo boletín
    renderBulletinBanner(stored);
    renderPDFResult(data);

    // Auto-actualizar resultado si el partido existe sin resultado
    const ur = data.ultimo_resultado_mirador;
    if (ur?.rival && state.isAdmin) {
      await autoActualizarResultadoPDF(ur);
    }
    // Auto-crear próximo partido si no existe
    const pp2 = data.proximo_partido_mirador;
    if (pp2?.rival && state.isAdmin) {
      const existe = state.matches.find(m =>
        !m.is_played && (
          m.opponent.toLowerCase().includes(pp2.rival.toLowerCase().split(' ')[0]) ||
          pp2.rival.toLowerCase().includes(m.opponent.toLowerCase().split(' ')[0])
        )
      );
      if (!existe) await autoCrearPartidoPDF(pp2);
      else if (pp2.hora) toast('💡 Partido ya existe. Si no tiene hora, edítalo manualmente.');
    }
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

  const pp  = data.proximo_partido_mirador;
  const ur  = data.ultimo_resultado_mirador;
  const fp  = Array.isArray(data.fair_play) ? data.fair_play.find(e=>e.es_mirador) : null;
  const vmv = Array.isArray(data.valla_menos_vencida) ? data.valla_menos_vencida.find(e=>e.es_mirador) : null;
  const cron= data.cronograma || [];

  // Tarjeta próximo partido
  const cardProx = pp?.rival ? `
    <div style="background:var(--navy);border-radius:var(--radius-lg);padding:16px;margin-bottom:12px;color:var(--on-navy)">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:var(--lime);font-weight:700;margin-bottom:8px">📅 Próximo Partido</div>
      <div style="font-size:17px;font-weight:700;font-family:'Oswald',sans-serif;margin-bottom:6px">${pp.es_local?'MIRADOR II vs '+pp.rival.toUpperCase():pp.rival.toUpperCase()+' vs MIRADOR II'}</div>
      <div style="font-size:13px;opacity:0.8">${pp.fecha_str||''} ${pp.hora?'· '+pp.hora:''}</div>
      ${pp.campo?`<div style="font-size:13px;opacity:0.8">📍 ${pp.campo}</div>`:''}
      ${state.isAdmin?`<button class="btn btn-secondary" style="margin-top:12px;font-size:12px" onclick="preCargarPartidoPDF(${JSON.stringify(pp).replace(/"/g,'&quot;')})">➕ Agregar a la app</button>`:''}
    </div>` : '';

  // Último resultado
  const cardRes = ur?.rival ? `
    <div style="background:${ur.goles_mirador>ur.goles_rival?'#1a4a1a':ur.goles_mirador<ur.goles_rival?'#4a1a1a':'#3a3a1a'};border-radius:var(--radius-lg);padding:14px;margin-bottom:12px;color:#fff">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:${ur.goles_mirador>ur.goles_rival?'#7eff7e':ur.goles_mirador<ur.goles_rival?'#ff7e7e':'#ffe07e'};font-weight:700;margin-bottom:6px">⚽ Último Resultado</div>
      <div style="font-size:22px;font-weight:700;font-family:'Oswald',sans-serif;letter-spacing:0.05em">
        ${ur.es_local?`MIRADOR II ${ur.goles_mirador} — ${ur.goles_rival} ${ur.rival}`:
          `${ur.rival} ${ur.goles_rival} — ${ur.goles_mirador} MIRADOR II`}
      </div>
      <div style="font-size:13px;opacity:0.7;margin-top:4px">${ur.goles_mirador>ur.goles_rival?'✅ VICTORIA':ur.goles_mirador<ur.goles_rival?'❌ DERROTA':'🤝 EMPATE'}</div>
    </div>` : '';

  // Logros
  const logros = [];
  if (fp?.es_ganador) logros.push(`🏆 <strong>FAIR PLAY GANADOR</strong> · ${fp.puntos} puntos`);
  else if (fp?.puntos)  logros.push(`🎖️ Fair Play: puesto ${fp.puesto} · ${fp.puntos} pts`);
  if (vmv?.goles_contra !== undefined) logros.push(`🧤 Valla menos vencida: puesto ${vmv.puesto} · ${vmv.goles_contra} goles en contra`);
  const cardLogros = logros.length ? `
    <div style="background:var(--surface-low);border:1px solid var(--border-light);border-radius:var(--radius-lg);padding:14px;margin-bottom:12px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-faint);font-weight:700;margin-bottom:8px">🌟 Logros del torneo</div>
      ${logros.map(l=>`<div style="font-size:13px;padding:4px 0;border-bottom:1px solid var(--border-light)">${l}</div>`).join('')}
    </div>` : '';

  // Cronograma
  const cardCron = cron.length ? `
    <div style="background:var(--surface-low);border:1px solid var(--border-light);border-radius:var(--radius-lg);padding:14px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-faint);font-weight:700;margin-bottom:8px">📆 Cronograma</div>
      ${cron.map(c=>`<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border-light);font-size:13px"><span style="font-weight:600;color:var(--navy)">${c.fecha}</span><span>${c.evento}</span></div>`).join('')}
    </div>` : '';

  wrap.innerHTML = cardProx + cardRes + cardLogros + cardCron;
}

// Auto-crear partido del PDF si no existe ya
async function autoCrearPartidoPDF(pp) {
  if (!pp?.rival) return;
  // Buscar si ya existe ese partido
  const existe = state.matches.find(m =>
    m.opponent.toLowerCase().includes(pp.rival.toLowerCase().split(' ')[0].toLowerCase()) ||
    pp.rival.toLowerCase().includes(m.opponent.toLowerCase().split(' ')[0].toLowerCase())
  );
  if (existe && !existe.is_played) {
    toast(`Ya existe partido vs ${pp.rival}`, 'warning');
    return;
  }

  // Parsear fecha si la tiene
  const meses = {enero:'01',febrero:'02',marzo:'03',abril:'04',mayo:'05',junio:'06',julio:'07',agosto:'08',septiembre:'09',octubre:'10',noviembre:'11',diciembre:'12'};
  let fecha_iso = null;
  if (pp.fecha_str) {
    const m = pp.fecha_str.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
    if (m) {
      const mes = meses[m[2].toLowerCase()] || '01';
      const hora = (pp.hora||'06:00').replace('AM','').replace('PM','').trim();
      fecha_iso = `${m[3]}-${mes}-${m[1].padStart(2,'0')}T${hora.includes(':')?hora:'06:00'}`;
    }
  }

  try {
    const tq = state.viewingTournament ? `?t=${state.viewingTournament.id}` : '';
    await api(`/matches${tq}`, 'POST', {
      opponent: pp.rival,
      match_date: fecha_iso || new Date().toISOString().slice(0,16),
      location: pp.lugar || '',
      phase: pp.fase || '',
    });
    toast(`✅ Partido vs ${pp.rival} creado${!fecha_iso ? ' (sin fecha aún — se actualizará el jueves)' : ''}`);
    loadHome();
  } catch(e) {
    toast('Error creando partido: ' + e.message, 'error');
  }
}

// Auto-actualizar resultado desde PDF si el partido existe
async function autoActualizarResultadoPDF(ur) {
  if (!ur?.rival) return;
  const match = state.matches.find(m =>
    !m.is_played && (
      m.opponent.toLowerCase().includes(ur.rival.toLowerCase().split(' ')[0]) ||
      ur.rival.toLowerCase().includes(m.opponent.toLowerCase().split(' ')[0])
    )
  );
  if (!match) return; // No hay partido pendiente que actualizar

  try {
    const tq = state.viewingTournament ? `?t=${state.viewingTournament.id}` : '';
    await api(`/matches/${match.id}`, 'PUT', {
      home_score: ur.goles_mirador,
      away_score: ur.goles_rival,
      is_played: true,
    });
    toast(`✅ Resultado vs ${ur.rival} actualizado automáticamente`);
    loadHome();
  } catch(e) {
    // silencioso — no forzar
  }
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
  // Cargar boletín en segundo plano (no bloquea el resto)
  (async () => {
    try {
      const serverBulletin = await api(`/tournaments/bulletin${tParam()}`);
      if (serverBulletin && (Array.isArray(serverBulletin.resultados) || Array.isArray(serverBulletin.fair_play))) {
        localStorage.setItem('miradorBulletin', JSON.stringify(serverBulletin));
        renderBulletinBanner(serverBulletin);
      }
    } catch(e) {
      // Fallback a localStorage
      try {
        const stored = localStorage.getItem('miradorBulletin');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed.resultados) || Array.isArray(parsed.fair_play)) {
            renderBulletinBanner(parsed);
          } else {
            localStorage.removeItem('miradorBulletin');
          }
        }
      } catch(e2) { localStorage.removeItem('miradorBulletin'); }
    }
  })();

  loadHomeGallery();

  try {
    const matches = await api(`/matches${tParam()}`);
    state.matches = matches;
    state.upcomingMatches = matches.filter(m=>!m.is_played).sort((a,b)=>parseLocalDate(b.match_date)-parseLocalDate(a.match_date));
    const played = matches.filter(m=>m.is_played).sort((a,b)=>parseLocalDate(b.match_date)-parseLocalDate(a.match_date));
    state.lastMatch = played[0] || null;

    // Renderizar todo inmediatamente, sin esperar votos
    // Cargar votos del último partido ANTES de renderizar (para que el MVP salga de inmediato)
    state.matchVotes = {};
    if (played.length) {
      try {
        const votes = await api(`/matches/${played[0].id}/votes`);
        if (votes?.length) {
          const top = votes.sort((a,b) => b.vote_count - a.vote_count)[0];
          if (top?.vote_count > 0) state.matchVotes[played[0].id] = top;
        }
      } catch(e) {}
    }

    renderUpcomingSlider();
    renderLastResult();
    renderStandings();
    renderVoteSection();

    // Cargar votos del resto de partidos en segundo plano
    if (played.length > 1) {
      Promise.all(played.slice(1, 5).map(async m => {
        try {
          const votes = await api(`/matches/${m.id}/votes`);
          if (votes?.length) {
            const top = votes.sort((a,b) => b.vote_count - a.vote_count)[0];
            if (top?.vote_count > 0) state.matchVotes[m.id] = top;
          }
        } catch(e) {}
      })).then(() => {
        if ($('result-card-body')) renderResultsSlider();
      });
    }
  } catch(e) { toast('Error: '+e.message,'error'); }
}

// ── SLIDER ────────────────────────────────────────────────────────
function renderUpcomingSlider() {
  const track=$('upcoming-track'), dots=$('slider-dots');
  const now = new Date();
  const upcoming = state.upcomingMatches;

  if (!upcoming.length) {
    track.innerHTML=`<div class="match-card" style="width:100%"><div class="empty"><div class="empty-icon">📅</div><h3>Sin partidos programados</h3>${state.isAdmin&&!isViewingPast()?`<button class="btn btn-primary" style="margin-top:12px" onclick="openAddMatchModal()">+ Agregar partido</button>`:''}</div></div>`;
    dots.innerHTML=''; return;
  }

  // Detectar si es un partido especial
  const phaseConfig = (phase) => {
    const p = (phase||'').toLowerCase();
    if (p.includes('gran final') || p.includes('grand final'))
      return { label:'🏆 LA GRAN FINAL', bg:'linear-gradient(135deg,#7b2d00,#c0392b,#e67e22)', glow:'rgba(230,126,34,0.4)', crown:true };
    if (p.includes('semifinal') || p.includes('semi final'))
      return { label:'⚡ GRAN SEMIFINAL', bg:'linear-gradient(135deg,#0d2a5e,#1565c0,#1a3f8a)', glow:'rgba(21,101,192,0.4)', crown:false };
    if (p.includes('tercer') || p.includes('tercero') || p.includes('mejor tercero') || p.includes('3er'))
      return { label:'🥉 MEJOR TERCERO', bg:'linear-gradient(135deg,#2d4a1e,#388e3c,#1b5e20)', glow:'rgba(56,142,60,0.4)', crown:false };
    if (p.includes('cuartos') || p.includes('cuarto'))
      return { label:'📌 CUARTOS DE FINAL', bg:null, glow:null, crown:false };
    return null;
  };

  track.innerHTML = upcoming.map(m => {
    const isPast = parseLocalDate(m.match_date) < now;
    const cfg = phaseConfig(m.phase);
    const isSpecial = cfg && cfg.bg;

    if (isSpecial) {
      // ── Tarjeta especial para semifinal / final / tercer puesto ──
      return `<div class="match-card" style="width:100%;padding:0;overflow:hidden;border:none;background:transparent">
        <!-- Banner especial -->
        <div style="background:${cfg.bg};padding:14px 20px 12px;text-align:center;position:relative;overflow:hidden">
          <div style="position:absolute;inset:0;background:radial-gradient(ellipse at 50% 0%,${cfg.glow} 0%,transparent 70%)"></div>
          <div style="font-family:'Oswald',sans-serif;font-size:22px;font-weight:700;color:#fff;letter-spacing:0.1em;text-transform:uppercase;position:relative;text-shadow:0 2px 8px rgba(0,0,0,0.4)">${cfg.label}</div>
          ${m.phase ? `<div style="font-size:10px;color:rgba(255,255,255,0.55);margin-top:2px;letter-spacing:0.08em;text-transform:uppercase;position:relative">${m.phase}</div>` : ''}
        </div>
        <!-- Contenido del partido -->
        <div style="background:var(--navy);padding:18px 20px">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
            <div style="flex:1;text-align:center">
              <div style="font-family:'Oswald',sans-serif;font-size:13px;font-weight:700;color:var(--lime);letter-spacing:0.06em">MIRADOR II</div>
            </div>
            <div style="font-family:'Oswald',sans-serif;font-size:18px;font-weight:700;color:rgba(255,255,255,0.3);padding:0 8px">VS</div>
            <div style="flex:1;text-align:center">
              <div style="font-family:'Oswald',sans-serif;font-size:13px;font-weight:700;color:#fff;letter-spacing:0.06em">${m.opponent.toUpperCase()}</div>
            </div>
          </div>
          <div style="border-top:1px solid rgba(255,255,255,0.1);margin-top:14px;padding-top:12px;display:flex;gap:16px;flex-wrap:wrap;justify-content:center">
            <span style="font-size:12px;color:rgba(255,255,255,0.7)">📅 ${fmtShortDate(m.match_date)}</span>
            ${m.location?`<span style="font-size:12px;color:rgba(255,255,255,0.7)">📍 ${m.location}</span>`:''}
            ${isPast?`<span style="font-size:12px;color:#f0c040">⏰ Pendiente resultado</span>`:''}
          </div>
          ${m.notes?`<div style="margin-top:10px;font-size:12px;color:rgba(255,255,255,0.45);text-align:center">${m.notes}</div>`:''}
          <div id="attendance-section-${m.id}" style="margin-top:14px"></div>
          ${state.isAdmin&&!isViewingPast()?`<div style="display:flex;gap:6px;margin-top:14px;justify-content:center">
            <button class="btn btn-secondary" style="font-size:12px" onclick="openResultModal(${m.id})">Registrar resultado</button>
            <button class="btn btn-secondary" style="font-size:12px" onclick="openEditMatchModal(${m.id})">✏️</button>
            <button class="btn btn-danger" style="font-size:12px" onclick="deleteMatch(${m.id})">🗑️</button>
          </div>`:''}
        </div>
      </div>`;
    }

    // ── Tarjeta normal ──
    return `<div class="match-card" style="width:100%">
      ${m.phase?`<div class="match-phase">📌 ${m.phase}</div>`:'<div class="match-phase">📌 Partido</div>'}
      <div class="match-teams">MIRADOR II <span class="match-vs">vs</span> ${m.opponent.toUpperCase()}</div>
      <div class="match-info">
        <span>📅 ${fmtShortDate(m.match_date)}</span>
        ${m.location?`<span>📍 ${m.location}</span>`:''}
        ${isPast?`<span style="color:#7a5200">⏰ Pendiente resultado</span>`:''}
      </div>
      ${m.notes?`<div style="margin-top:10px;font-size:12px;color:var(--text-faint)">${m.notes}</div>`:''}
      <div id="attendance-section-${m.id}" style="margin-top:14px"></div>
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

  // Cargar asistencia para cada partido programado
  upcoming.forEach(m => loadAttendanceSection(m.id));
}

// ── ASISTENCIA ────────────────────────────────────────────────────
async function loadAttendanceSection(matchId) {
  const wrap = $(`attendance-section-${matchId}`);
  if (!wrap) return;
  // Solo mostrar si es admin
  if (!state.isAdmin) return;
  try {
    const data = await api(`/matches/${matchId}/attendance${tParam()}`);
    renderAttendanceSection(wrap, data, matchId);
  } catch(e) { /* silencioso */ }
}

function renderAttendanceSection(wrap, data, matchId) {
  const confirmed = data.players.filter(p => p.status === 'confirmed');

  const chips = confirmed.map(p =>
    `<span style="display:inline-flex;align-items:center;gap:3px;background:var(--navy);border:1px solid var(--navy);border-radius:20px;padding:3px 10px;font-size:11px;font-weight:600;color:#fff">
      <span style="font-family:'JetBrains Mono',monospace;font-size:10px;opacity:0.7">${p.player_number}</span> ${p.full_name.split(' ')[0]}
    </span>`
  ).join('');

  wrap.innerHTML = `
    <div style="border-top:1px solid var(--border-light);padding-top:12px;margin-top:4px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:12px;font-weight:700;color:var(--navy)">👥 Asistencia</span>
          <span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--navy);font-weight:700">${confirmed.length}/${data.total}</span>
        </div>
        <button onclick="openAttendanceModal(${matchId})"
          style="font-size:11px;padding:5px 12px;background:var(--navy);color:#fff;border:1px solid var(--navy);border-radius:20px;cursor:pointer;font-weight:600">
          ✏️ Registrar
        </button>
      </div>
      ${confirmed.length
        ? `<div style="display:flex;flex-wrap:wrap;gap:4px">${chips}</div>`
        : '<div style="font-size:11px;color:rgba(255,255,255,0.35);font-style:italic">Sin asistencia registrada</div>'}
    </div>`;
}

function openAttendanceModal(matchId) {
  let modal = $('modal-attendance');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-attendance';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal" style="max-width:420px">
        <div class="modal-header">
          <h3>👥 Registrar asistencia</h3>
          <button class="modal-close" onclick="closeModal('modal-attendance')">×</button>
        </div>
        <div class="modal-body" id="attendance-modal-body">
          <div class="loading-wrap"><div class="spinner"></div></div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) closeModal('modal-attendance'); });
  }
  showModal('modal-attendance');
  renderAttendanceModalBody(matchId);
}

async function renderAttendanceModalBody(matchId) {
  const body = $('attendance-modal-body');
  if (!body) return;

  let data;
  try {
    data = await api(`/matches/${matchId}/attendance${tParam()}`);
  } catch(e) {
    body.innerHTML = `<div style="color:var(--red);padding:12px">Error: ${e.message}</div>`;
    return;
  }

  const confirmed = new Set(data.players.filter(p => p.status === 'confirmed').map(p => p.player_id));

  body.innerHTML = `
    <div style="font-size:13px;color:var(--text-faint);margin-bottom:14px">
      Marca quién asistió al partido. Solo el admin puede hacer esto.
    </div>
    <div style="display:flex;gap:8px;margin-bottom:14px">
      <button onclick="markAllAttendance(${matchId}, true)"
        style="flex:1;padding:8px;background:rgba(193,241,0,0.1);border:1px solid var(--lime);border-radius:8px;color:var(--navy);font-weight:700;font-size:12px;cursor:pointer">✅ Marcar todos</button>
      <button onclick="markAllAttendance(${matchId}, false)"
        style="flex:1;padding:8px;background:var(--surface-low);border:1px solid var(--border);border-radius:8px;color:var(--text-faint);font-size:12px;cursor:pointer">⬜ Limpiar todo</button>
    </div>
    <div id="attendance-checklist" style="display:flex;flex-direction:column;gap:6px;max-height:360px;overflow-y:auto">
      ${data.players.map(p => `
        <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border-light);border-radius:8px;cursor:pointer;background:${confirmed.has(p.player_id)?'rgba(193,241,0,0.06)':'var(--surface-low)'}">
          <input type="checkbox" data-player="${p.player_id}" ${confirmed.has(p.player_id)?'checked':''}
            style="width:18px;height:18px;cursor:pointer;accent-color:var(--navy)"/>
          <span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text-faint);min-width:22px">${p.player_number}</span>
          <span style="font-size:13px;font-weight:600;color:var(--navy)">${p.full_name}</span>
        </label>`).join('')}
    </div>
    <div style="margin-top:14px;display:flex;gap:8px">
      <button onclick="saveAttendance(${matchId})"
        style="flex:1;padding:10px;background:var(--navy);color:#fff;border:none;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer">💾 Guardar asistencia</button>
      <button onclick="closeModal('modal-attendance')"
        style="padding:10px 16px;background:var(--surface-low);border:1px solid var(--border);border-radius:8px;font-size:13px;cursor:pointer">Cancelar</button>
    </div>`;
}

function markAllAttendance(matchId, check) {
  document.querySelectorAll('#attendance-checklist input[type=checkbox]').forEach(cb => {
    cb.checked = check;
  });
}

async function saveAttendance(matchId) {
  const checkboxes = document.querySelectorAll('#attendance-checklist input[type=checkbox]');
  const btn = document.querySelector('#attendance-modal-body button[onclick^="saveAttendance"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

  try {
    // Guardar cada jugador
    const promises = Array.from(checkboxes).map(cb => {
      const playerId = +cb.dataset.player;
      const status = cb.checked ? 'confirmed' : 'declined';
      return api(`/matches/${matchId}/attendance`, 'POST', { player_id: playerId, status });
    });
    await Promise.all(promises);
    toast('✅ Asistencia guardada');
    closeModal('modal-attendance');
    loadAttendanceSection(matchId);
  } catch(e) {
    toast(e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '💾 Guardar asistencia'; }
  }
}

function renderAttendanceSection(wrap, data, matchId) {
  const confirmed = data.players.filter(p => p.status === 'confirmed');
  const total = data.total;

  // Chips de nombres confirmados (texto blanco sobre fondo oscuro)
  const chips = confirmed.map(p =>
    `<span style="display:inline-flex;align-items:center;gap:3px;background:var(--navy);border:1px solid var(--navy);border-radius:20px;padding:3px 10px;font-size:11px;font-weight:600;color:#fff">
      <span style="font-family:'JetBrains Mono',monospace;font-size:10px;opacity:0.7">${p.player_number}</span> ${p.full_name.split(' ')[0]}
    </span>`
  ).join('');

  wrap.innerHTML = `
    <div style="border-top:1px solid var(--border-light);padding-top:12px;margin-top:4px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:12px;font-weight:700;color:var(--navy)">👥 Asistencia</span>
          <span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--navy);font-weight:700">${confirmed.length}/${total}</span>
          ${data.declined>0?`<span style="font-size:10px;color:rgba(255,100,100,0.8)">· ${data.declined} no van</span>`:''}
        </div>
        ${state.isAdmin ? `<button onclick="openAttendanceModal(${matchId})"
          style="font-size:11px;padding:5px 12px;background:var(--navy);color:#fff;border:1px solid var(--navy);border-radius:20px;cursor:pointer;font-weight:600">
          ✏️ Registrar
        </button>` : ''}
      </div>
      ${confirmed.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px">${chips}</div>` : '<div style="font-size:11px;color:rgba(255,255,255,0.35);font-style:italic">Sin asistencia registrada</div>'}
    </div>`;
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

    // MVP del partido (si hay votos cargados)
    const mvp = state.matchVotes?.[m.id];
    const mvpHtml = mvp ? `
      <div style="margin-top:10px;background:rgba(193,241,0,0.1);border:1px solid rgba(193,241,0,0.3);border-radius:8px;padding:8px 12px;display:flex;align-items:center;gap:8px">
        <span style="font-size:18px">⭐</span>
        <div>
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--lime);font-weight:700">MVP del partido</div>
          <div style="font-size:14px;font-weight:700;color:#fff">${mvp.player_name}</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.5)">${mvp.vote_count} voto${mvp.vote_count!==1?'s':''}</div>
        </div>
      </div>` : '';

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
      ${mvpHtml}
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
  // ── Tabla del grupo desde el boletín (si existe) ──
  let grupoHtml = '';
  try {
    const bull = JSON.parse(localStorage.getItem('miradorBulletin') || 'null');
    if (!bull) throw new Error('no bulletin');

    // Nuevo formato: tablas_grupo (array de grupos)
    // Viejo formato: grupo.equipos (solo el grupo de Mirador)
    const tablas = Array.isArray(bull.tablas_grupo) ? bull.tablas_grupo
      : bull.grupo?.equipos ? [{ nombre: bull.grupo.nombre || 'Grupo', equipos: bull.grupo.equipos }]
      : [];

    if (tablas.length) {
      grupoHtml = tablas.map(gr => {
        if (!gr.equipos?.length) return '';
        return `
          <div style="margin-bottom:16px">
            <div style="font-family:'Oswald',sans-serif;font-size:13px;font-weight:700;color:var(--navy);text-transform:uppercase;margin-bottom:10px;letter-spacing:0.04em">📊 ${gr.nombre||'Grupo'} — Posiciones</div>
            <table style="width:100%;border-collapse:collapse;font-size:13px">
              <thead>
                <tr style="background:var(--navy);color:var(--on-navy)">
                  <th style="padding:8px 6px;text-align:left;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;font-weight:600">#</th>
                  <th style="padding:8px 8px;text-align:left;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;font-weight:600">Equipo</th>
                  <th style="padding:8px 6px;text-align:center;font-size:10px;font-weight:600">PJ</th>
                  <th style="padding:8px 6px;text-align:center;font-size:10px;font-weight:600">PG</th>
                  <th style="padding:8px 6px;text-align:center;font-size:10px;font-weight:600">PE</th>
                  <th style="padding:8px 6px;text-align:center;font-size:10px;font-weight:600">PP</th>
                  <th style="padding:8px 6px;text-align:center;font-size:10px;font-weight:600">GF</th>
                  <th style="padding:8px 6px;text-align:center;font-size:10px;font-weight:600">GC</th>
                  <th style="padding:8px 6px;text-align:center;font-size:10px;font-weight:600;background:var(--lime);color:var(--navy)">Pts</th>
                </tr>
              </thead>
              <tbody>
                ${gr.equipos.map((e, i) => {
                  const esM = (e.equipo||'').toUpperCase().includes('MIRADOR') || e.es_mirador;
                  const pts = e.puntos ?? ((e.pg??0)*3 + (e.pe??0));
                  const bgRow = esM ? 'background:rgba(193,241,0,0.08)' : i%2===0 ? '' : 'background:var(--surface-low)';
                  return `<tr style="border-bottom:1px solid var(--border-light);${bgRow}">
                    <td style="padding:9px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text-faint)">${e.puesto??i+1}°</td>
                    <td style="padding:9px 8px;${esM?'font-weight:700;color:var(--navy)':''}">
                      ${e.equipo}${esM?` <span style="font-size:10px;background:var(--lime);color:var(--navy);padding:1px 5px;border-radius:3px;font-weight:700">TÚ</span>`:''}
                    </td>
                    <td style="text-align:center;padding:9px 6px;font-family:'JetBrains Mono',monospace">${e.pj??0}</td>
                    <td style="text-align:center;padding:9px 6px;font-family:'JetBrains Mono',monospace;color:${(e.pg??0)>0?'var(--green)':'var(--text-faint)'}">${e.pg??0}</td>
                    <td style="text-align:center;padding:9px 6px;font-family:'JetBrains Mono',monospace;color:var(--text-faint)">${e.pe??0}</td>
                    <td style="text-align:center;padding:9px 6px;font-family:'JetBrains Mono',monospace;color:${(e.pp??0)>0?'var(--red)':'var(--text-faint)'}">${e.pp??0}</td>
                    <td style="text-align:center;padding:9px 6px;font-family:'JetBrains Mono',monospace">${e.gf??'—'}</td>
                    <td style="text-align:center;padding:9px 6px;font-family:'JetBrains Mono',monospace">${e.gc??'—'}</td>
                    <td style="text-align:center;padding:9px 6px;font-family:'Oswald',sans-serif;font-size:18px;font-weight:700;color:var(--navy)">${pts}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>`;
      }).join('');
      if (bull._fecha) grupoHtml += `<div style="font-size:10px;color:var(--text-faint);margin-top:4px;text-align:right">Fuente: Boletín del ${bull._fecha}</div>`;
    }
  } catch(e) {}

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
    ${grupoHtml ? `<div style="padding:16px 20px;border-top:1px solid var(--border-light)">${grupoHtml}</div>` : ''}
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
    // Cargar stats de asistencia en segundo plano
    try {
      const stats = await api(`/matches/attendance/player-stats${tParam()}`);
      const statsMap = {};
      stats.forEach(s => { statsMap[s.player_id] = s; });
      state.players = players.map(p => ({ ...p, attendance_stats: statsMap[p.id] || null }));
    } catch(e) {}
    renderPlayersGrid(state.players);
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
        ${p.attendance_stats ? `<div style="font-size:11px;color:var(--text-faint);margin-top:4px">👥 ${p.attendance_stats.confirmed} partidos confirmados <span style="color:${p.attendance_stats.pct>=70?'var(--green)':p.attendance_stats.pct>=40?'#7a5200':'var(--red)'};font-weight:700">(${p.attendance_stats.pct}%)</span></div>` : ''}      </div>
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

function openPinModal(playerId, nombre) {
  const player = state.players.find(p => p.id === playerId);
  const currentPin = player?.attendance_pin || '';

  // Crear modal dinámico si no existe
  let modal = $('modal-pin');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-pin';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal" style="max-width:340px">
        <div class="modal-header">
          <h3 id="pin-modal-title">PIN de asistencia</h3>
          <button class="modal-close" onclick="closeModal('modal-pin')">×</button>
        </div>
        <div class="modal-body">
          <p id="pin-modal-desc" style="font-size:13px;color:var(--text-faint);margin-bottom:14px"></p>
          <label class="form-label">PIN (mínimo 3 caracteres)</label>
          <input id="pin-modal-input" class="form-input" type="text" maxlength="10"
            placeholder="Ej: número de camiseta" style="font-family:'JetBrains Mono',monospace;letter-spacing:0.1em"/>
          <div id="pin-modal-error" class="form-error"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="closeModal('modal-pin')">Cancelar</button>
          <button class="btn btn-primary" id="btn-save-pin">Guardar PIN</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) closeModal('modal-pin'); });
  }

  $('pin-modal-title').textContent = `🔑 PIN de ${nombre}`;
  $('pin-modal-desc').textContent = currentPin
    ? `PIN actual: ${'•'.repeat(currentPin.length)} — Escribe uno nuevo para cambiarlo`
    : 'Asigna un PIN que el jugador usará para confirmar asistencia. Compárteselo por privado.';
  $('pin-modal-input').value = '';
  clearError('pin-modal-error');

  const btn = $('btn-save-pin');
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.addEventListener('click', () => savePlayerPin(playerId));
  $('pin-modal-input').addEventListener('keydown', e => { if (e.key === 'Enter') savePlayerPin(playerId); });

  showModal('modal-pin');
  setTimeout(() => $('pin-modal-input')?.focus(), 100);
}

async function savePlayerPin(playerId) {
  const pin = $('pin-modal-input').value.trim();
  if (!pin) { showError('pin-modal-error', 'El PIN no puede estar vacío'); return; }
  try {
    const res = await api(`/players/${playerId}/pin`, 'PATCH', { pin });
    toast(res.message);
    closeModal('modal-pin');
    state.players = [];
    loadPlayers();
  } catch(e) { showError('pin-modal-error', e.message); }
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
    renderFinancesTableExcel(finances, configs);
  } catch(e){ toast('Error: '+e.message,'error'); }
}

function renderFinancesTableExcel(finances, configs) {
  const wrap = $('payments-table-wrap');
  if (!wrap) return;

  const arbs = configs.arbitrajes || [];
  const canEdit = state.isAdmin && !isViewingPast();

  // Cabecera con botones de acción
  let html = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
      <div style="font-family:'Oswald',sans-serif;font-size:16px;font-weight:700;color:var(--navy);text-transform:uppercase;letter-spacing:0.04em">📊 Cuentas del torneo</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${canEdit ? `<button onclick="openQuickPayModal()" class="btn btn-primary" style="font-size:12px">💸 Registrar pago</button>` : ''}
        <button onclick="exportarExcel()" class="btn btn-secondary" style="font-size:12px">📥 Exportar Excel</button>
      </div>
    </div>
    <div style="overflow-x:auto;border-radius:var(--radius-lg);border:1px solid var(--border-light)">
      <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:700px">
        <thead>
          <tr style="background:var(--navy);color:#fff">
            <th style="padding:8px 6px;text-align:center;font-size:10px;white-space:nowrap">#</th>
            <th style="padding:8px 10px;text-align:left;font-size:10px">Nombre</th>
            <th style="padding:8px 6px;text-align:center;font-size:10px;background:rgba(193,241,0,0.15)" colspan="2">Inscripción</th>
            ${arbs.map((a,i) => `<th style="padding:8px 6px;text-align:center;font-size:10px;white-space:nowrap">P${i+1}</th>`).join('')}
            <th style="padding:8px 6px;text-align:center;font-size:10px;background:rgba(193,241,0,0.1)" colspan="2">Arbitraje</th>
            <th style="padding:8px 6px;text-align:center;font-size:10px;background:rgba(193,241,0,0.2)">Total</th>
            ${canEdit ? `<th style="padding:8px 6px;text-align:center;font-size:10px"></th>` : ''}
          </tr>
          <tr style="background:rgba(13,33,55,0.85);color:rgba(255,255,255,0.7)">
            <th></th><th></th>
            <th style="padding:5px 6px;text-align:center;font-size:9px">Abono</th>
            <th style="padding:5px 6px;text-align:center;font-size:9px">Debe</th>
            ${arbs.map(a => `<th style="padding:5px 6px;text-align:center;font-size:9px">${fmt(a.amount_per_player)}</th>`).join('')}
            <th style="padding:5px 6px;text-align:center;font-size:9px">Abono</th>
            <th style="padding:5px 6px;text-align:center;font-size:9px">Debe</th>
            <th style="padding:5px 6px;text-align:center;font-size:9px">Abonado</th>
            ${canEdit ? `<th></th>` : ''}
          </tr>
        </thead>
        <tbody>`;

  let sumAbonoInsc=0, sumDebeInsc=0, sumAbonoArb=0, sumDebeArb=0, sumTotal=0;

  finances.forEach((p, i) => {
    const abonoInsc = p.pago_inscripcion ?? 0;
    const debeInsc  = Math.max(0, (p.deuda_inscripcion ?? 0) - abonoInsc);
    const abonoArb  = p.pago_arbitraje ?? 0;
    const debeArb   = Math.max(0, (p.deuda_arbitraje ?? 0) - abonoArb);
    const total     = abonoInsc + abonoArb;
    const alDia     = p.saldo_pendiente <= 0;
    const bg        = i%2===0 ? '' : 'background:var(--surface-low)';

    sumAbonoInsc+=abonoInsc; sumDebeInsc+=debeInsc;
    sumAbonoArb+=abonoArb; sumDebeArb+=debeArb; sumTotal+=total;

    html += `<tr style="border-bottom:1px solid var(--border-light);${bg}${p.status==='inactivo'?';opacity:0.5':''}">
      <td style="padding:8px 6px;text-align:center;font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text-faint)">${p.player_number}</td>
      <td style="padding:8px 10px;font-weight:600;color:var(--navy)">${p.player_name}</td>
      <td style="padding:8px 6px;text-align:right;color:var(--green);font-family:'JetBrains Mono',monospace">${fmt(abonoInsc)}</td>
      <td style="padding:8px 6px;text-align:right;color:${debeInsc>0?'var(--red)':'var(--text-faint)'};font-family:'JetBrains Mono',monospace">${debeInsc>0?fmt(debeInsc):'✓'}</td>
      ${arbs.map(a => `<td style="padding:8px 6px;text-align:center;font-size:11px;color:var(--text-faint)">✓</td>`).join('')}
      <td style="padding:8px 6px;text-align:right;color:var(--green);font-family:'JetBrains Mono',monospace">${fmt(abonoArb)}</td>
      <td style="padding:8px 6px;text-align:right;color:${debeArb>0?'var(--red)':'var(--text-faint)'};font-family:'JetBrains Mono',monospace">${debeArb>0?fmt(debeArb):'✓'}</td>
      <td style="padding:8px 6px;text-align:right;font-weight:700;font-family:'JetBrains Mono',monospace;color:var(--navy)">${fmt(total)}</td>
      ${canEdit ? `<td style="padding:8px 6px;text-align:center">
        <button onclick="openQuickPayModal(${p.player_id})" style="font-size:10px;padding:3px 8px;background:var(--lime);color:var(--navy);border:none;border-radius:4px;cursor:pointer;font-weight:700">+</button>
        <button onclick="togglePlayerHistory(${p.player_id})" style="font-size:10px;padding:3px 8px;background:var(--surface-low);border:1px solid var(--border);border-radius:4px;cursor:pointer;margin-left:2px">≡</button>
      </td>` : ''}
    </tr>
    <tr class="payment-detail-row" id="detail-${p.player_id}" style="display:none">
      <td colspan="${6 + arbs.length + (canEdit?3:2)}">
        <div class="payment-detail-inner" id="history-content-${p.player_id}">
          <div style="text-align:center;padding:20px;color:var(--text-faint)">Cargando historial...</div>
        </div>
      </td>
    </tr>`;
  });

  // Fila de totales
  html += `</tbody>
    <tfoot>
      <tr style="background:var(--navy);color:#fff;font-weight:700">
        <td colspan="2" style="padding:8px 10px;font-family:'Oswald',sans-serif;letter-spacing:0.05em">TOTALES</td>
        <td style="padding:8px 6px;text-align:right;font-family:'JetBrains Mono',monospace">${fmt(sumAbonoInsc)}</td>
        <td style="padding:8px 6px;text-align:right;font-family:'JetBrains Mono',monospace;color:${sumDebeInsc>0?'#ff9999':'#99ff99'}">${fmt(sumDebeInsc)}</td>
        ${arbs.map(() => `<td></td>`).join('')}
        <td style="padding:8px 6px;text-align:right;font-family:'JetBrains Mono',monospace">${fmt(sumAbonoArb)}</td>
        <td style="padding:8px 6px;text-align:right;font-family:'JetBrains Mono',monospace;color:${sumDebeArb>0?'#ff9999':'#99ff99'}">${fmt(sumDebeArb)}</td>
        <td style="padding:8px 6px;text-align:right;font-family:'JetBrains Mono',monospace;color:var(--lime)">${fmt(sumTotal)}</td>
        ${canEdit ? `<td></td>` : ''}
      </tr>
    </tfoot>
  </table></div>`;

  wrap.innerHTML = html;
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
      <td><button class="btn-expand" onclick="togglePlayerHistory(${p.player_id})">Ver historial</button></td>
    </tr>
    <tr class="payment-detail-row" id="detail-${p.player_id}" style="display:none">
      <td colspan="6">
        <div class="payment-detail-inner" id="history-content-${p.player_id}">
          <div style="text-align:center;padding:20px;color:var(--text-faint)">Cargando historial...</div>
        </div>
      </td>
    </tr>`;
  }).join('');
}

async function togglePlayerHistory(playerId) {
  const row = $(`detail-${playerId}`);
  const isOpen = row.style.display !== 'none';
  // Cerrar todos
  document.querySelectorAll('.payment-detail-row').forEach(r => r.style.display='none');
  if (isOpen) return;
  row.style.display = '';
  await loadPlayerHistory(playerId);
}

async function loadPlayerHistory(playerId) {
  const wrap = $(`history-content-${playerId}`);
  try {
    const tq = state.viewingTournament ? `?t=${state.viewingTournament.id}` : '';
    const data = await api(`/finances/player/${playerId}/history${tq}`);
    renderPlayerHistory(wrap, data, playerId);
  } catch(e) {
    wrap.innerHTML = `<div style="color:var(--red);padding:12px">Error: ${e.message}</div>`;
  }
}

function renderPlayerHistory(wrap, data, playerId) {
  const r = data.resumen;
  const movs = data.movimientos || [];
  const isAdmin = state.isAdmin && !isViewingPast();

  // Separar deudas y pagos por tipo
  const deudaInsc = movs.filter(m => m.tipo === 'deuda' && (m.concepto||'').toLowerCase().includes('inscri'));
  const deudaArb  = movs.filter(m => m.tipo === 'deuda' && (m.concepto||'').toLowerCase().includes('arb'));
  const pagosInsc = movs.filter(m => m.tipo !== 'deuda' && (m.concepto||'').toLowerCase().includes('inscri'));
  const pagosArb  = movs.filter(m => m.tipo !== 'deuda' && (m.concepto||'').toLowerCase().includes('arb'));
  const pagosOtros= movs.filter(m => m.tipo !== 'deuda' && !((m.concepto||'').toLowerCase().includes('inscri') || (m.concepto||'').toLowerCase().includes('arb')));

  const totalDeudaInsc = deudaInsc.reduce((s,m) => s + m.monto, 0);
  const totalDeudaArb  = deudaArb.reduce((s,m) => s + m.monto, 0);
  const totalPagInsc   = pagosInsc.reduce((s,m) => s + Math.abs(m.monto), 0);
  const totalPagArb    = pagosArb.reduce((s,m) => s + Math.abs(m.monto), 0);
  const totalPagOtros  = pagosOtros.reduce((s,m) => s + Math.abs(m.monto), 0);

  const tarjeta = (label, deuda, pagado, color) => {
    const debe = Math.max(0, deuda - pagado);
    const pct = deuda > 0 ? Math.min(100, Math.round(pagado/deuda*100)) : 100;
    return `<div style="background:var(--surface-low);border-radius:8px;padding:10px 12px;flex:1;min-width:140px">
      <div style="font-size:10px;color:var(--text-faint);font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px">${label}</div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
        <span style="font-size:11px;color:var(--green)">Abono: ${fmt(pagado)}</span>
        <span style="font-size:11px;color:${debe>0?'var(--red)':'var(--green)'}">${debe>0?'Debe: '+fmt(debe):'✅ Al día'}</span>
      </div>
      <div style="background:var(--border-light);border-radius:4px;height:6px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${color};border-radius:4px"></div>
      </div>
      <div style="font-size:9px;color:var(--text-faint);margin-top:3px">Total: ${fmt(deuda)}</div>
    </div>`;
  };

  const resumenHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
      ${totalDeudaInsc > 0 ? tarjeta('Inscripción', totalDeudaInsc, totalPagInsc, 'var(--navy)') : ''}
      ${totalDeudaArb > 0 ? tarjeta('Arbitrajes', totalDeudaArb, totalPagArb, '#1565c0') : ''}
      <div style="background:rgba(193,241,0,0.08);border:1px solid rgba(193,241,0,0.3);border-radius:8px;padding:10px 12px;flex:1;min-width:140px">
        <div style="font-size:10px;color:var(--text-faint);font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px">Total pagado</div>
        <div style="font-family:'Oswald',sans-serif;font-size:20px;font-weight:700;color:var(--navy)">${fmt(r.total_pagado)}</div>
        <div style="font-size:11px;color:${r.saldo_pendiente<=0?'var(--green)':'var(--red)'}">
          ${r.saldo_pendiente<=0?'✅ Paz y salvo':'Pendiente: '+fmt(r.saldo_pendiente)}
        </div>
      </div>
    </div>`;

  // Tabla de movimientos agrupada por tipo
  const filasMov = (lista, titulo, colorTipo) => {
    if (!lista.length) return '';
    return `
      <div style="margin-bottom:12px">
        <div style="font-size:11px;font-weight:700;color:${colorTipo};margin-bottom:6px;padding:4px 8px;background:${colorTipo}15;border-radius:4px;border-left:3px solid ${colorTipo}">${titulo}</div>
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <thead><tr style="background:var(--surface-low)">
            <th style="padding:5px 8px;text-align:left;color:var(--text-faint);font-weight:600">Fecha</th>
            <th style="padding:5px 8px;text-align:left;color:var(--text-faint);font-weight:600">Concepto</th>
            <th style="padding:5px 8px;text-align:right;color:var(--text-faint);font-weight:600">Monto</th>
          </tr></thead>
          <tbody>
            ${lista.map((m,i) => {
              const esDeuda = m.tipo === 'deuda';
              const color = esDeuda ? 'var(--red)' : 'var(--green)';
              const signo = esDeuda ? '+' : '–';
              return `<tr style="border-bottom:1px solid var(--border-light);background:${i%2===0?'':'var(--surface-low)'}">
                <td style="padding:5px 8px;font-family:monospace;font-size:10px">${m.fecha}</td>
                <td style="padding:5px 8px">${m.concepto||'—'}</td>
                <td style="padding:5px 8px;text-align:right;font-weight:700;color:${color}">${signo} ${fmt(Math.abs(m.monto))}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  };

  const movsHTML = `
    <div style="font-weight:700;font-size:13px;margin-bottom:8px;color:var(--navy)">📋 Movimientos</div>
    ${filasMov([...deudaInsc,...pagosInsc], '💰 Inscripción', 'var(--navy)')}
    ${filasMov([...deudaArb,...pagosArb], '⚽ Arbitrajes', '#1565c0')}
    ${filasMov(pagosOtros, '📝 Abonos generales', '#2e7d32')}
    ${!movs.length ? '<div style="color:var(--text-faint);font-size:13px;padding:8px 0">Sin movimientos registrados</div>' : ''}`;

  const ajusteHTML = '';  // El pago se registra desde "💸 Registrar pago"

  wrap.innerHTML = resumenHTML + movsHTML + ajusteHTML;
}


async function saveAdjustment(playerId) {
  const concepto = $(`adj-concepto-${playerId}`)?.value?.trim();
  const monto    = parseFloat($(`adj-monto-${playerId}`)?.value || '0');
  const fecha    = $(`adj-fecha-${playerId}`)?.value;
  const tipo     = $(`adj-tipo-${playerId}`)?.value;

  if (!concepto) { toast('Escribe un concepto', 'warning'); return; }
  if (!monto || monto <= 0) { toast('El monto debe ser mayor a 0', 'warning'); return; }

  try {
    const tq = state.viewingTournament ? `?t=${state.viewingTournament.id}` : '';
    const res = await api(`/finances/adjustment${tq}`, 'POST', {
      player_id: playerId, concepto, monto, fecha, tipo,
    });
    toast(res.message);
    await loadPlayerHistory(playerId);
    loadPayments();
  } catch(e) { toast(e.message, 'error'); }
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

// ── PAGO RÁPIDO ───────────────────────────────────────────────────
async function openQuickPayModal(preselectedPlayerId = null) {
  // Siempre cargar configs frescos para tener los partidos actualizados
  try {
    const [configs, players] = await Promise.all([
      api(`/finances/configs${tParam()}`),
      state.players?.length ? Promise.resolve(state.players) : api(`/players${tParam()}${tParam()?'&':'?'}include_inactive=false`),
    ]);
    state.configs = configs;
    if (!state.players?.length) state.players = players;
  } catch(e) { toast('Error cargando configuración', 'error'); return; }
  let modal = $('modal-quick-pay');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-quick-pay';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal" style="max-width:400px">
        <div class="modal-header">
          <h3>💸 Registrar pago</h3>
          <button class="modal-close" onclick="closeModal('modal-quick-pay')">×</button>
        </div>
        <div class="modal-body">
          <div style="margin-bottom:12px">
            <label class="form-label">Jugador *</label>
            <select id="qp-player" class="form-input"></select>
          </div>
          <div style="margin-bottom:12px">
            <label class="form-label">¿Para qué es el pago? *</label>
            <select id="qp-concepto" class="form-input"></select>
            <div id="qp-saldo-hint" style="font-size:11px;margin-top:4px"></div>
          </div>
          <div style="margin-bottom:12px">
            <label class="form-label">Monto *</label>
            <input id="qp-monto" type="number" class="form-input" placeholder="Ej: 50000"/>
          </div>
          <div style="margin-bottom:12px">
            <label class="form-label">Fecha</label>
            <input id="qp-fecha" type="date" class="form-input"/>
          </div>
          <div style="margin-bottom:12px">
            <label class="form-label">Notas (opcional)</label>
            <input id="qp-notas" type="text" class="form-input" placeholder="Ej: Transferencia bancaria"/>
          </div>
          <div id="qp-error" class="form-error"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="closeModal('modal-quick-pay')">Cancelar</button>
          <button class="btn btn-primary" onclick="saveQuickPay()">💾 Guardar pago</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) closeModal('modal-quick-pay'); });
  }

  // Llenar jugadores
  const playerSel = $('qp-player');
  playerSel.innerHTML = state.players
    .filter(p => p.is_active)
    .map(p => `<option value="${p.id}" ${p.id===preselectedPlayerId?'selected':''}>${p.player_number} — ${p.full_name}</option>`)
    .join('');

  // Llenar conceptos
  const conceptoSel = $('qp-concepto');
  const arbs = state.configs?.arbitrajes || [];
  const insc = state.configs?.inscripciones?.[0];
  const opts = [];
  if (insc) {
    opts.push(`<option value="inscripcion|">💰 Inscripción — ${fmt(insc.amount_per_player)} c/u</option>`);
  } else {
    opts.push(`<option value="inscripcion|">💰 Inscripción</option>`);
  }
  if (arbs.length) {
    arbs.forEach((a, i) => {
      const label = a.fase || `Partido ${i+1}`;
      opts.push(`<option value="arbitraje|${a.fase}">⚽ Arbitraje — ${label} (${fmt(a.amount_per_player)} c/u)</option>`);
    });
  } else {
    // Si no hay fases configuradas, mostrar partidos genéricos
    for (let i = 1; i <= 6; i++) {
      opts.push(`<option value="arbitraje|Partido ${i}">⚽ Arbitraje — Partido ${i}</option>`);
    }
  }
  opts.push(`<option value="ajuste|">📝 Abono general</option>`);
  conceptoSel.innerHTML = opts.join('');

  // Mostrar saldo disponible al cambiar jugador o concepto
  const actualizarSaldo = () => {
    const pid = +$('qp-player')?.value;
    const [t2] = ($('qp-concepto')?.value || '').split('|');
    const j = state.finances?.find(f => f.player_id === pid);
    const hint = $('qp-saldo-hint');
    if (!hint || !j) return;
    if (t2 === 'inscripcion') {
      const disp = Math.max(0, (j.deuda_inscripcion||0) - (j.pago_inscripcion||0));
      hint.textContent = disp > 0 ? `💡 Queda por pagar: ${fmt(disp)}` : '✅ Inscripción completa';
      hint.style.color = disp > 0 ? 'var(--text-faint)' : 'var(--green)';
    } else if (t2 === 'arbitraje') {
      const disp = Math.max(0, (j.deuda_arbitraje||0) - (j.pago_arbitraje||0));
      hint.textContent = disp > 0 ? `💡 Queda por pagar: ${fmt(disp)}` : '✅ Arbitrajes completos';
      hint.style.color = disp > 0 ? 'var(--text-faint)' : 'var(--green)';
    } else {
      hint.textContent = '';
    }
  };
  $('qp-player')?.addEventListener('change', actualizarSaldo);
  $('qp-concepto')?.addEventListener('change', actualizarSaldo);

  // Fecha de hoy
  $('qp-fecha').value = new Date().toISOString().split('T')[0];
  $('qp-monto').value = '';
  $('qp-notas').value = '';
  clearError('qp-error');
  showModal('modal-quick-pay');
  setTimeout(() => $('qp-monto')?.focus(), 100);
}

async function saveQuickPay() {
  const playerId = +$('qp-player').value;
  const conceptoVal = $('qp-concepto').value || '';
  const [tipo, fase] = conceptoVal.split('|');
  const monto = parseFloat($('qp-monto').value || '0');
  const fecha = $('qp-fecha').value;
  const notas = $('qp-notas').value.trim();

  if (!playerId || !monto || monto <= 0) { showError('qp-error', 'Jugador y monto son obligatorios'); return; }

  // ── Validación: no sobrepagar ──
  const jugador = state.finances?.find(f => f.player_id === playerId);
  if (jugador) {
    if (tipo === 'inscripcion') {
      const deuda = jugador.deuda_inscripcion || 0;
      const pagado = jugador.pago_inscripcion || 0;
      const disponible = deuda - pagado;
      if (disponible <= 0) {
        showError('qp-error', `✅ ${jugador.player_name} ya tiene la inscripción pagada completa`);
        return;
      }
      if (monto > disponible) {
        showError('qp-error', `⚠️ Solo quedan ${fmt(disponible)} por pagar de inscripción. No puedes ingresar ${fmt(monto)}`);
        return;
      }
    } else if (tipo === 'arbitraje') {
      const deuda = jugador.deuda_arbitraje || 0;
      const pagado = jugador.pago_arbitraje || 0;
      const disponible = deuda - pagado;
      if (disponible <= 0) {
        showError('qp-error', `✅ ${jugador.player_name} ya tiene los arbitrajes pagados completos`);
        return;
      }
      if (monto > disponible) {
        showError('qp-error', `⚠️ Solo quedan ${fmt(disponible)} por pagar de arbitrajes. No puedes ingresar ${fmt(monto)}`);
        return;
      }
    }
  }

  try {
    const tq = tParam();
    if (tipo === 'inscripcion' || tipo === 'arbitraje') {
      await api(`/finances/payment${tq}`, 'POST', {
        player_id: playerId,
        payment_type: tipo,
        phase: fase || null,
        amount: monto,
        notes: notas || (tipo === 'inscripcion' ? 'Abono inscripción' : `Abono arbitraje${fase ? ' — ' + fase : ''}`),
      });
    } else {
      await api(`/finances/adjustment${tq}`, 'POST', {
        player_id: playerId,
        concepto: notas || 'Abono general',
        monto,
        fecha,
        tipo: 'pago',
      });
    }
    toast('✅ Pago registrado');
    closeModal('modal-quick-pay');
    loadPayments();
  } catch(e) { showError('qp-error', e.message); }
}

async function exportarExcel() {
  try {
    const tq = tParam();
    const res = await fetch(`/api/finances/export-excel${tq}`, {
      headers: state.token ? { 'Authorization': `Bearer ${state.token}` } : {},
    });
    if (!res.ok) { toast('Error exportando', 'error'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'cuentas_mirador_ii.xlsx';
    a.click(); URL.revokeObjectURL(url);
    toast('✅ Excel descargado');
  } catch(e) { toast(e.message, 'error'); }
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
// matchVotes stores top voter per match { matchId: {player_name, vote_count} }


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

// ── Tarjeta visual de finanzas de jugador ────────────────────────
function renderFinanceCard(fc) {
  const pct_insc = fc.deuda_inscripcion > 0 ? Math.min(100, Math.round(fc.pago_inscripcion/fc.deuda_inscripcion*100)) : 100;
  const pct_arb  = fc.deuda_arbitraje  > 0 ? Math.min(100, Math.round(fc.pago_arbitraje /fc.deuda_arbitraje *100)) : 100;
  const alDia = fc.saldo_pendiente <= 0;

  const barHtml = (label, pagado, deuda, pct, color) => {
    const debe = Math.max(0, deuda - pagado);
    return `<div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px">
        <span style="font-weight:600;color:rgba(255,255,255,0.8)">${label}</span>
        <span style="color:${debe>0?'#ff9e9e':'#9effc0'}">${debe>0?'Debe '+fmt(debe):'✅ Al día'}</span>
      </div>
      <div style="background:rgba(255,255,255,0.1);border-radius:4px;height:6px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${color};border-radius:4px;transition:width 0.4s"></div>
      </div>
      <div style="font-size:10px;color:rgba(255,255,255,0.45);margin-top:2px">${fmt(pagado)} abonado de ${fmt(deuda)}</div>
    </div>`;
  };

  const histHtml = fc.historial?.length ? `
    <div style="border-top:1px solid rgba(255,255,255,0.1);margin-top:12px;padding-top:10px">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:rgba(255,255,255,0.45);margin-bottom:6px">Últimos movimientos</div>
      ${fc.historial.map(h => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:11px">
          <span style="color:rgba(255,255,255,0.6)">${h.fecha} · ${h.concepto}</span>
          <span style="color:#9effc0;font-weight:700">+ ${fmt(h.monto)}</span>
        </div>`).join('')}
    </div>` : '';

  return `<div style="background:var(--navy);border-radius:12px;padding:14px;border:1px solid rgba(193,241,0,0.2);margin-top:4px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div>
        <div style="font-family:'Oswald',sans-serif;font-size:16px;font-weight:700;color:#fff">${fc.player_name}</div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:rgba(255,255,255,0.4)">Camiseta #${fc.player_number}</div>
      </div>
      <div style="text-align:right">
        <div style="font-family:'Oswald',sans-serif;font-size:22px;font-weight:700;color:${alDia?'var(--lime)':'#ff9e9e'}">${fmt(fc.pago_total)}</div>
        <div style="font-size:10px;color:rgba(255,255,255,0.4)">total abonado</div>
      </div>
    </div>
    ${fc.deuda_inscripcion > 0 ? barHtml('💰 Inscripción', fc.pago_inscripcion, fc.deuda_inscripcion, pct_insc, 'var(--lime)') : ''}
    ${fc.deuda_arbitraje  > 0 ? barHtml('⚽ Arbitrajes',  fc.pago_arbitraje,  fc.deuda_arbitraje,  pct_arb,  '#60a5fa') : ''}
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,0.05);margin-top:8px">
      <span style="font-size:12px;color:rgba(255,255,255,0.6)">Saldo pendiente</span>
      <span style="font-family:'Oswald',sans-serif;font-size:18px;font-weight:700;color:${alDia?'var(--lime)':'#ff9e9e'}">${alDia?'✅ Paz y salvo':fmt(fc.saldo_pendiente)}</span>
    </div>
    ${histHtml}
  </div>`;
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
    if (res.finance_card) {
      const msgs = $('chat-messages');
      const card = document.createElement('div');
      card.style.cssText = 'align-self:flex-start;max-width:95%;width:100%';
      card.innerHTML = renderFinanceCard(res.finance_card);
      msgs.appendChild(card);
      msgs.scrollTop = msgs.scrollHeight;
    }
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
    if (aiFileData.length) aiFileData._resumen = data.resumen || {};

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
  const resumen = aiFileData._resumen || {};
  const totalAbonado = jugadores.reduce((s,j) => s + (j.total_abonado||0), 0);
  const nuevos = jugadores.filter(j => j.es_nuevo_en_app).length;
  const existentes = jugadores.length - nuevos;

  // Recopilar todos los conceptos únicos para hacer columnas
  const conceptosSet = new Set();
  jugadores.forEach(j => (j.abonos||[]).forEach(a => conceptosSet.add(a.concepto)));
  const conceptos = Array.from(conceptosSet);

  const fila = (j, esRetirado) => {
    const bg = esRetirado ? '#fff8f0' : '';
    const abonoMap = {};
    (j.abonos||[]).forEach(a => { abonoMap[a.concepto] = a; });

    return `<tr style="border-bottom:1px solid var(--border-light);background:${bg}">
      <td style="padding:5px 8px;font-family:'JetBrains Mono',monospace;font-weight:700;color:var(--navy)">${j.numero||'—'}</td>
      <td style="padding:5px 8px;font-weight:600;font-size:12px">
        ${j.nombre}
        ${j.es_nuevo_en_app ? '<span style="font-size:10px;background:var(--lime);color:var(--navy);padding:1px 5px;border-radius:3px;margin-left:4px;font-weight:700">NUEVO</span>' : ''}
        ${j.tipo==='antiguo' ? '<span style="font-size:10px;background:rgba(0,0,0,0.06);color:var(--text-faint);padding:1px 5px;border-radius:3px;margin-left:4px">antiguo</span>' : ''}
      </td>
      ${conceptos.map(c => {
        const ab = abonoMap[c];
        if (!ab) return `<td style="padding:5px 8px;text-align:right;color:var(--text-faint)">—</td>`;
        const color = ab.abono > 0 ? 'var(--green)' : ab.monto_total > 0 ? 'var(--red)' : 'var(--text-faint)';
        return `<td style="padding:5px 8px;text-align:right;font-size:11px;color:${color};font-weight:600">${ab.abono>0?fmt(ab.abono):ab.monto_total>0?`Debe ${fmt(ab.monto_total)}`:'—'}</td>`;
      }).join('')}
      <td style="padding:5px 8px;text-align:right;font-weight:700;color:var(--navy);font-size:12px">${fmt(j.total_abonado||0)}</td>
    </tr>`;
  };

  $('file-preview-title').textContent = `📋 ${jugadores.length} jugadores — "${filename}"`;
  $('file-preview-table').innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap">
      <div style="background:rgba(193,241,0,0.1);border:1px solid var(--lime);border-radius:8px;padding:10px 14px;flex:1;min-width:120px">
        <div style="font-size:11px;color:var(--text-faint)">Total abonado</div>
        <div style="font-size:18px;font-weight:700;color:var(--navy)">${fmt(totalAbonado)}</div>
      </div>
      <div style="background:var(--surface-low);border-radius:8px;padding:10px 14px;flex:1;min-width:120px">
        <div style="font-size:11px;color:var(--text-faint)">Jugadores nuevos</div>
        <div style="font-size:18px;font-weight:700;color:var(--navy)">${nuevos}</div>
      </div>
      <div style="background:var(--surface-low);border-radius:8px;padding:10px 14px;flex:1;min-width:120px">
        <div style="font-size:11px;color:var(--text-faint)">Ya en la app</div>
        <div style="font-size:18px;font-weight:700;color:var(--navy)">${existentes}</div>
      </div>
    </div>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:var(--navy);color:#fff">
          <th style="padding:7px 8px;text-align:left">#</th>
          <th style="padding:7px 8px;text-align:left">Nombre</th>
          ${conceptos.map(c => `<th style="padding:7px 8px;text-align:right;font-size:10px;white-space:nowrap">${c}</th>`).join('')}
          <th style="padding:7px 8px;text-align:right">Total Abonado</th>
        </tr></thead>
        <tbody>
          ${jugadores.map(j => fila(j, false)).join('')}
          ${retirados.length ? `<tr><td colspan="${2+conceptos.length+1}" style="padding:6px 8px;background:#fff3cd;font-size:11px;color:#856404;font-weight:600">⚠️ Retirados / expulsados</td></tr>${retirados.map(j=>fila(j,true)).join('')}` : ''}
        </tbody>
      </table>
    </div>
    ${retirados.length ? `<label style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:13px;cursor:pointer">
      <input type="checkbox" id="chk-include-retirados"> Importar también jugadores retirados
    </label>` : ''}
    <label style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:13px;cursor:pointer;background:#fff3cd;padding:8px 10px;border-radius:6px;border:1px solid #f0c040">
      <input type="checkbox" id="chk-limpiar-primero">
      <span>⚠️ <strong>Importación limpia</strong> — borra todos los jugadores del torneo actual y los crea de cero</span>
    </label>`;
  $('file-preview').style.display = 'block';
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
      const chkLimpiar = $('chk-limpiar-primero');
      const incluirRet = chk ? chk.checked : false;
      const limpiarPrimero = chkLimpiar ? chkLimpiar.checked : false;
      res = await api(`/ai/import-finances${tq}`, 'POST', {
        jugadores: aiFileData,
        retirados: aiFileDataRetirados || [],
        incluir_retirados: incluirRet,
        limpiar_primero: limpiarPrimero,
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
    setTimeout(() => { loadPlayers(); loadPayments(); }, 500);
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

  // Bottom nav (mobile)
  document.querySelectorAll('.bottom-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });

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