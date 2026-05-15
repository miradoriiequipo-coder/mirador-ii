// ══════════════════════════════════════════════════════════════════
//  MIRADOR II FC — app.js v3 (sistema de torneos)
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
  // Torneos
  tournaments:       [],
  activeTournament:  null,   // el torneo activo real (backend)
  viewingTournament: null,   // el que estamos viendo (puede ser pasado)
};

// ── Utilidades ────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const fmt = n => new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(n);
const fmtDate = iso => new Date(iso).toLocaleDateString('es-CO',{weekday:'long',day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'});
const fmtShortDate = iso => {
  const d = new Date(iso);
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

// ── TOURNAMENT SYSTEM ─────────────────────────────────────────────
async function loadTournaments() {
  try {
    const [all, active] = await Promise.all([
      api('/tournaments'),
      api('/tournaments/active'),
    ]);
    state.tournaments = all;
    state.activeTournament = active;
    if (!state.viewingTournament) {
      state.viewingTournament = active;
    }
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
      : `<span style="color:var(--muted);font-size:13px">Sin torneos</span>`;
    return;
  }

  const current = state.viewingTournament;
  const options = tournaments.map(t =>
    `<option value="${t.id}" ${current && t.id===current.id ? 'selected':''}>
      ${t.is_active ? '🟢' : '📁'} ${t.name}${t.season ? ' · '+t.season : ''}
    </option>`
  ).join('');

  wrap.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px">
      <select class="form-input" id="tournament-select" style="font-size:13px;padding:6px 10px;max-width:220px" onchange="switchTournament(this.value)">
        ${options}
      </select>
      ${state.isAdmin ? `<button class="btn btn-primary" style="font-size:12px;padding:6px 12px;white-space:nowrap" onclick="showModal('modal-tournament')">+ Nuevo torneo</button>` : ''}
    </div>`;
}

function renderTournamentBanner() {
  const banner = $('tournament-banner');
  if (!banner) return;
  if (isViewingPast()) {
    banner.style.display = 'block';
    banner.innerHTML = `
      📁 Viendo torneo archivado: <strong>${state.viewingTournament.name}</strong>
      ${state.viewingTournament.season ? '· '+state.viewingTournament.season : ''}
      — Solo lectura
      ${state.activeTournament ? `<button onclick="switchTournament(${state.activeTournament.id})" style="margin-left:12px;background:var(--green);color:#000;border:none;border-radius:6px;padding:4px 10px;font-size:12px;font-weight:700;cursor:pointer">Ir al torneo activo</button>` : ''}`;
  } else {
    banner.style.display = 'none';
  }
}

async function switchTournament(id) {
  const t = state.tournaments.find(x => x.id === +id);
  if (!t) return;
  state.viewingTournament = t;
  state.players = [];
  state.matches = [];
  renderTournamentBanner();
  updateAuthUI();
  // Recargar la página actual
  const activePage = document.querySelector('.page.active')?.id?.replace('page-','') || 'home';
  navigateTo(activePage);
}

async function createTournament() {
  const name = $('t-name').value.trim();
  const season = $('t-season').value.trim();
  const description = $('t-description').value.trim();
  if (!name) { showError('t-error','El nombre es obligatorio'); return; }
  try {
    const t = await api('/tournaments','POST',{name,season,description});
    toast(`¡Torneo "${t.name}" creado!`);
    state.viewingTournament = t;
    closeModal('modal-tournament');
    await loadTournaments();
    navigateTo('home');
  } catch(e) { showError('t-error',e.message); }
}

// ── HOME PAGE ─────────────────────────────────────────────────────
async function loadHome() {
  if (!state.viewingTournament) {
    $('upcoming-track').innerHTML = `<div class="match-card" style="min-width:300px"><div class="empty"><div class="empty-icon">⚽</div><h3>Sin torneo activo</h3>${state.isAdmin?`<button class="btn btn-primary" style="margin-top:12px" onclick="showModal('modal-tournament')">+ Crear torneo</button>`:''}</div></div>`;
    $('last-result-wrap').innerHTML = '';
    $('vote-section').innerHTML = '';
    return;
  }
  try {
    const matches = await api(`/matches${tParam()}`);
    state.matches = matches;
    state.upcomingMatches = matches
      .filter(m => !m.is_played)
      .sort((a,b) => new Date(b.match_date) - new Date(a.match_date));
    const played = matches.filter(m => m.is_played).sort((a,b) => new Date(b.match_date) - new Date(a.match_date));
    state.lastMatch = played[0] || null;
    renderUpcomingSlider();
    renderLastResult();
    renderStandings();
    await renderVoteSection();
  } catch(e) { toast('Error: '+e.message,'error'); }
}

function renderUpcomingSlider() {
  const track=$('upcoming-track'), dots=$('slider-dots');
  const now = new Date();
  const upcoming = state.upcomingMatches;
  if (!upcoming.length) {
    track.innerHTML=`<div class="match-card" style="min-width:300px"><div class="empty"><div class="empty-icon">📅</div><h3>Sin partidos programados</h3>${state.isAdmin&&!isViewingPast()?`<button class="btn btn-primary" style="margin-top:12px" onclick="openAddMatchModal()">+ Agregar partido</button>`:''}</div></div>`;
    dots.innerHTML=''; return;
  }
  track.innerHTML = upcoming.map(m => {
    const isPast = new Date(m.match_date) < now;
    return `<div class="match-card">
      ${m.phase?`<div class="match-phase">📌 ${m.phase}</div>`:'<div class="match-phase">📌 Partido</div>'}
      <div class="match-teams">MIRADOR II <span class="match-vs">vs</span> ${m.opponent.toUpperCase()}</div>
      <div class="match-info">
        <span>📅 ${fmtShortDate(m.match_date)}</span>
        ${m.location?`<span>📍 ${m.location}</span>`:''}
        ${isPast?`<span style="color:var(--gold)">⏰ Pendiente resultado</span>`:''}
      </div>
      ${m.notes?`<div style="margin-top:10px;font-size:12px;color:var(--muted)">${m.notes}</div>`:''}
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
    extra.innerHTML=`<div style="text-align:center;color:var(--muted)"><div style="font-size:32px">+</div><div style="font-size:13px;font-weight:700">Agregar Partido</div></div>`;
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

function renderLastResult() {
  const wrap=$('last-result-wrap'), m=state.lastMatch;
  if (!m) { wrap.innerHTML=`<div class="result-card"><div class="empty"><div class="empty-icon">🏆</div><h3>Sin resultados aún</h3></div></div>`; return; }
  const homeW=m.home_score>m.away_score, awayW=m.away_score>m.home_score;
  const scorerMap={}, assistMap={};
  (m.goals||[]).forEach(g=>{
    scorerMap[g.player_name]=(scorerMap[g.player_name]||0)+g.count;
    if(g.assist_player_name) assistMap[g.assist_player_name]=(assistMap[g.assist_player_name]||0)+1;
  });
  const scorerChips=Object.entries(scorerMap).map(([n,c])=>`<span class="scorer-chip"><span class="num">${c}</span> ${n} ⚽</span>`).join('');
  const assistChips=Object.entries(assistMap).map(([n,c])=>`<span class="scorer-chip" style="background:rgba(245,158,11,0.15);color:var(--gold)"><span class="num" style="background:var(--gold)">${c}</span> ${n} 🅰️</span>`).join('');
  wrap.innerHTML=`<div class="result-card">
    <div class="result-label">🏁 ÚLTIMO PARTIDO · ${m.phase||'Partido'}</div>
    <div class="result-scoreboard">
      <div class="result-team"><div class="result-team-name">MIRADOR II</div><div class="result-score ${homeW?'win':awayW?'lose':''}">${m.home_score??'—'}</div></div>
      <div class="result-divider">:</div>
      <div class="result-team"><div class="result-team-name">${m.opponent.toUpperCase()}</div><div class="result-score ${awayW?'win':homeW?'lose':''}">${m.away_score??'—'}</div></div>
    </div>
    <div style="text-align:center;color:var(--muted);font-size:13px;margin-bottom:12px">📅 ${fmtDate(m.match_date)}${m.location?' · 📍 '+m.location:''}</div>
    ${scorerChips?`<div><div class="form-label" style="margin-bottom:8px">Goles</div><div class="scorers-list">${scorerChips}</div></div>`:''}
    ${assistChips?`<div style="margin-top:10px"><div class="form-label" style="margin-bottom:8px">Asistencias</div><div class="scorers-list">${assistChips}</div></div>`:''}
    ${state.isAdmin&&!isViewingPast()?`<div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn btn-secondary" onclick="openResultModal(${m.id})">✏️ Editar resultado</button>
      <button class="btn btn-danger" onclick="deleteMatch(${m.id})">🗑️</button>
    </div>`:''}
  </div>`;
}

function renderStandings() {
  const wrap = $('standings-wrap');
  if (!wrap) return;

  const allPlayed = state.matches.filter(m => m.is_played);
  if (!allPlayed.length) {
    wrap.innerHTML = `<div class="empty" style="padding:20px"><div class="empty-icon">📊</div><h3>Sin partidos jugados aún</h3></div>`;
    return;
  }

  // Obtener fases disponibles
  const phases = [...new Set(allPlayed.map(m => m.phase || 'Sin fase'))];
  const selectedPhase = wrap.dataset.phase || 'all';

  const matches = selectedPhase === 'all'
    ? allPlayed
    : allPlayed.filter(m => (m.phase || 'Sin fase') === selectedPhase);

  let g=0, e=0, p=0, gf=0, gc=0;
  matches.forEach(m => {
    gf += m.home_score || 0;
    gc += m.away_score || 0;
    if (m.home_score > m.away_score) g++;
    else if (m.home_score === m.away_score) e++;
    else p++;
  });
  const pts = g*3 + e;
  const pj = matches.length;

  const stats = [
    {label:'PJ', value:pj,  hint:'Jugados'},
    {label:'G',  value:g,   hint:'Ganados'},
    {label:'E',  value:e,   hint:'Empatados'},
    {label:'P',  value:p,   hint:'Perdidos'},
    {label:'GF', value:gf,  hint:'Goles a favor'},
    {label:'GC', value:gc,  hint:'Goles en contra'},
    {label:'DG', value:(gf-gc>=0?'+':'')+(gf-gc), hint:'Diferencia'},
    {label:'PTS',value:pts,  hint:'Puntos', highlight:true},
  ];

  const phaseButtons = [
    {key:'all', label:'Todo el torneo'},
    ...phases.map(ph => ({key: ph, label: ph}))
  ].map(btn => `
    <button onclick="setStandingsPhase('${btn.key}')"
      style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:500;
             letter-spacing:0.06em;text-transform:uppercase;padding:5px 12px;
             border-radius:4px;border:1px solid ${selectedPhase===btn.key?'var(--navy)':'var(--border)'};
             background:${selectedPhase===btn.key?'var(--navy)':'var(--surface)'};
             color:${selectedPhase===btn.key?'var(--on-navy)':'var(--text-faint)'};
             cursor:pointer">
      ${btn.label}
    </button>`).join('');

  wrap.innerHTML = `
    <div class="card" style="overflow:hidden;padding:0">
      <div style="padding:16px 20px;border-bottom:1px solid var(--border-light)">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
          <div style="width:40px;height:40px;background:var(--navy);border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Oswald',sans-serif;font-size:16px;font-weight:700;color:var(--lime)">M2</div>
          <div>
            <div style="font-family:'Oswald',sans-serif;font-size:18px;font-weight:700;color:var(--navy);letter-spacing:0.04em;text-transform:uppercase">MIRADOR II</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-faint)">${state.viewingTournament?.name || 'Torneo actual'}</div>
          </div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">${phaseButtons}</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(8,1fr);text-align:center">
        ${stats.map(s=>`
          <div style="padding:14px 4px;${s.highlight?'background:rgba(193,241,0,0.08);':''}border-right:1px solid var(--border-light)">
            <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--text-faint);font-weight:500;letter-spacing:0.08em;text-transform:uppercase">${s.label}</div>
            <div style="font-family:'Oswald',sans-serif;font-size:26px;font-weight:700;line-height:1.1;color:${s.highlight?'var(--lime-text)':'var(--navy)'}">${s.value}</div>
            <div style="font-size:9px;color:var(--text-faint)">${s.hint}</div>
          </div>`).join('')}
      </div>
      <div style="padding:12px 20px;display:flex;gap:6px;flex-wrap:wrap;border-top:1px solid var(--border-light)">
        ${matches.map(m=>{
          const win=m.home_score>m.away_score, draw=m.home_score===m.away_score;
          const color=win?'var(--navy)':draw?'#7a5200':'var(--red)';
          const bg=win?'var(--lime)':draw?'#fff8e1':'var(--red-bg)';
          const letra=win?'G':draw?'E':'P';
          return `<div title="${m.opponent} ${m.home_score}-${m.away_score}" style="width:30px;height:30px;border-radius:50%;background:${bg};display:flex;align-items:center;justify-content:center;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;color:${color};border:1px solid ${win?'var(--lime-dim)':draw?'#f0c040':'#f5c1c1'}" title="${m.opponent} ${m.home_score}-${m.away_score}">${letra}</div>`;
        }).join('')}
        ${matches.length===0?`<span style="font-size:12px;color:var(--text-faint)">Sin partidos en esta fase</span>`:''}
      </div>
    </div>`;
}

function setStandingsPhase(phase) {
  const wrap = $('standings-wrap');
  if (!wrap) return;
  wrap.dataset.phase = phase;
  renderStandings();
}

async function renderVoteSection() {
  const wrap=$('vote-section'), m=state.lastMatch;
  if (!m) { wrap.innerHTML=`<div class="card" style="text-align:center;padding:30px;color:var(--muted)">No hay partidos jugados aún.</div>`; return; }
  let voteResults=[]; try { voteResults=await api(`/matches/${m.id}/votes`); } catch(e){}
  const alreadyVoted=!!state.hasVoted[m.id];
  const totalVotes=voteResults.reduce((s,v)=>s+v.vote_count,0);
  const voteMap={}; voteResults.forEach(v=>{voteMap[v.player_id]=v;});
  const players=state.players.length?state.players:await api(`/players${tParam()}`).then(p=>{state.players=p;return p;});
  if (!players.length) { wrap.innerHTML=`<div class="card" style="padding:20px;color:var(--muted)">Sin jugadores registrados.</div>`; return; }
  const cards=players.filter(p=>p.is_active).map(p=>{
    const vd=voteMap[p.id], pct=vd?vd.percentage:0, cnt=vd?vd.vote_count:0;
    return `<div class="vote-card ${alreadyVoted?'voted-card':''}" data-player="${p.id}">
      <div class="vote-jersey">${p.player_number}</div>
      <div class="vote-name">${p.full_name.split(' ').slice(0,2).join(' ')}</div>
      ${alreadyVoted?`<div class="vote-bar-wrap"><div class="vote-bar" style="width:${pct}%"></div></div><div class="vote-pct">${cnt} voto${cnt!==1?'s':''} · ${pct}%</div>`:''}
    </div>`;
  }).join('');
  wrap.innerHTML=`<div class="card">
    <div style="margin-bottom:16px"><div style="font-weight:700;color:var(--white)">⭐ ¿Quién fue el mejor vs ${m.opponent}?</div>
    <div style="font-size:13px;color:var(--muted);margin-top:4px">${totalVotes} voto${totalVotes!==1?'s':''} registrado${totalVotes!==1?'s':''}</div></div>
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
    const players=await api(`/players${tParam()}`);
    state.players=players; renderPlayersGrid(players);
  } catch(e) { grid.innerHTML=`<div class="empty"><div class="empty-icon">❌</div><h3>${e.message}</h3></div>`; }
}

function renderPlayersGrid(players) {
  const grid=$('players-grid');
  if (!players.length) {
    grid.innerHTML=`<div class="empty" style="grid-column:1/-1"><div class="empty-icon">👥</div><h3>Sin jugadores</h3>
    ${state.isAdmin&&!isViewingPast()?`<button class="btn btn-primary" style="margin-top:12px" onclick="openAddPlayerModal()">+ Agregar jugador</button>`:''}</div>`;
    return;
  }
  grid.innerHTML=players.map(p=>`
    <div class="player-card">
      <div class="player-jersey">${p.player_number}</div>
      <div class="player-info">
        <div class="player-name">${p.full_name}</div>
        ${p.phone?`<div class="player-meta"><span>📞 ${p.phone}</span></div>`:''}
        ${p.health_info?`<div class="player-health">🏥 ${p.health_info}</div>`:''}
        ${state.isAdmin&&p.id_number?`<div class="player-id">🪪 CC: ${p.id_number}</div>`:''}
      </div>
      ${state.isAdmin&&!isViewingPast()?`<div class="player-actions">
        <button class="btn-icon" onclick="openEditPlayerModal(${p.id})">✏️</button>
        <button class="btn-icon danger" onclick="deletePlayer(${p.id},'${p.full_name.replace(/'/g,"\\'")}')">🗑️</button>
      </div>`:''}
    </div>`).join('');
}

function openAddPlayerModal() {
  $('modal-player-title').textContent='Agregar Jugador';
  $('player-edit-id').value='';
  ['p-idnumber','p-number','p-name','p-phone','p-health'].forEach(id=>$(id).value='');
  clearError('player-error'); showModal('modal-player');
}
function openEditPlayerModal(id) {
  const p=state.players.find(x=>x.id===id); if(!p)return;
  $('modal-player-title').textContent='Editar Jugador';
  $('player-edit-id').value=id;
  $('p-idnumber').value=p.id_number||''; $('p-number').value=p.player_number;
  $('p-name').value=p.full_name; $('p-phone').value=p.phone||''; $('p-health').value=p.health_info||'';
  clearError('player-error'); showModal('modal-player');
}
async function deletePlayer(id,name) {
  if(!confirm(`¿Desactivar a ${name}?`))return;
  try { await api(`/players/${id}`,'DELETE'); toast(`${name} desactivado`); loadPlayers(); }
  catch(e){ toast(e.message,'error'); }
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
      api(`/players${tParam()}`),
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
  const alDia=finances.filter(p=>p.saldo_pendiente<=0).length;
  wrap.innerHTML=`
    <div class="card" style="text-align:center"><div style="font-size:11px;color:var(--muted);font-weight:700;letter-spacing:1px;text-transform:uppercase">Recaudado</div><div style="font-family:'Bebas Neue',sans-serif;font-size:28px;color:var(--green);margin-top:4px">${fmt(totalPagado)}</div></div>
    <div class="card" style="text-align:center"><div style="font-size:11px;color:var(--muted);font-weight:700;letter-spacing:1px;text-transform:uppercase">Deuda Total</div><div style="font-family:'Bebas Neue',sans-serif;font-size:28px;color:var(--white);margin-top:4px">${fmt(totalDeuda)}</div></div>
    <div class="card" style="text-align:center"><div style="font-size:11px;color:var(--muted);font-weight:700;letter-spacing:1px;text-transform:uppercase">Pendiente</div><div style="font-family:'Bebas Neue',sans-serif;font-size:28px;color:var(--red);margin-top:4px">${fmt(totalPend)}</div></div>
    <div class="card" style="text-align:center"><div style="font-size:11px;color:var(--muted);font-weight:700;letter-spacing:1px;text-transform:uppercase">Al día</div><div style="font-family:'Bebas Neue',sans-serif;font-size:28px;color:var(--white);margin-top:4px">${alDia}/${finances.length}</div></div>`;
}

function renderConfigsSection(configs) {
  const wrap=$('configs-section'); if(!wrap)return;
  const canEdit=state.isAdmin&&!isViewingPast();
  const inscCards=configs.inscripciones.map(c=>`
    <div class="card" style="padding:14px;display:flex;justify-content:space-between;align-items:center;gap:12px">
      <div>
        <div style="font-weight:700;color:var(--white)">Inscripción — ${fmt(c.total_amount)} total</div>
        <div style="font-size:13px;color:var(--muted)">${c.num_players} jugadores · <strong style="color:var(--green)">${fmt(c.amount_per_player)} c/u</strong></div>
        ${c.notes?`<div style="font-size:12px;color:var(--muted)">${c.notes}</div>`:''}
      </div>
      ${canEdit?`<button class="btn btn-danger" style="font-size:12px;white-space:nowrap" onclick="deleteInscripcionConfig(${c.id})">🗑️ Eliminar</button>`:''}
    </div>`).join('')||'<div style="color:var(--muted);font-size:13px">Sin configuración</div>';
  const arbCards=configs.arbitrajes.map(a=>`
    <div class="card" style="padding:14px;display:flex;justify-content:space-between;align-items:center;gap:12px">
      <div>
        <div style="font-weight:700;color:var(--white)">${a.fase}</div>
        <div style="font-size:13px;color:var(--muted)">${a.num_games} partidos × ${fmt(a.price_per_game)} = ${fmt(a.total_phase)}</div>
        <div style="font-size:13px;color:var(--muted)">${a.num_players} jugadores · <strong style="color:var(--gold)">${fmt(a.amount_per_player)} c/u</strong></div>
      </div>
      ${canEdit?`<button class="btn btn-danger" style="font-size:12px;white-space:nowrap" onclick="deleteArbitrajePhase(${a.id})">🗑️ Eliminar</button>`:''}
    </div>`).join('')||'<div style="color:var(--muted);font-size:13px">Sin fases configuradas</div>';
  wrap.innerHTML=`
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px">
      <div>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;color:var(--green);margin-bottom:10px;letter-spacing:1px">💰 INSCRIPCIÓN
          ${canEdit?`<button class="btn btn-primary" style="font-size:11px;margin-left:8px;padding:4px 10px" onclick="showModal('modal-inscripcion')">+ Configurar</button>`:''}
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">${inscCards}</div>
      </div>
      <div>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;color:var(--gold);margin-bottom:10px;letter-spacing:1px">🏟️ ARBITRAJES
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
  body.innerHTML=finances.map(p=>{
    const pct=p.deuda_total>0?Math.min(100,Math.round(p.pagado_total/p.deuda_total*100)):100;
    const color=p.saldo_pendiente<=0?'var(--green)':p.saldo_pendiente<p.deuda_total?'var(--gold)':'var(--red)';
    const estado=p.saldo_pendiente<=0?'✅ Al día':`Debe ${fmt(p.saldo_pendiente)}`;
    return `<tr>
      <td class="jersey">${p.player_number}</td>
      <td style="font-weight:700">${p.player_name}</td>
      <td>${fmt(p.deuda_total)}</td>
      <td style="color:var(--green)">${fmt(p.pagado_total)}</td>
      <td><div style="display:flex;align-items:center;gap:8px">
        <div style="flex:1;background:var(--surface);border-radius:4px;height:8px;overflow:hidden">
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
            <div class="form-label" style="margin-bottom:8px;color:var(--muted)">Deudas asignadas</div>
            ${p.deudas.length?p.deudas.map(d=>`
              <div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;border-bottom:1px solid var(--border)">
                <div><span class="payment-badge ${d.tipo}">${d.tipo}</span>${d.fase?`<span style="color:var(--muted);margin-left:6px">${d.fase}</span>`:''}
                  <div style="color:var(--muted);font-size:11px">${d.concepto||''}</div></div>
                <strong style="color:var(--white)">${fmt(d.monto)}</strong>
              </div>`).join(''):'<div style="color:var(--muted);font-size:13px">Sin deudas</div>'}
          </div>
          <div>
            <div class="form-label" style="margin-bottom:8px;color:var(--muted)">Pagos realizados</div>
            ${p.payments.length?p.payments.map(pay=>`
              <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;padding:4px 0;border-bottom:1px solid var(--border)">
                <div><span class="payment-badge ${pay.tipo}">${pay.tipo}</span>${pay.fase?`<span style="color:var(--muted);margin-left:6px">${pay.fase}</span>`:''}${pay.notas?`<span style="color:var(--muted);margin-left:6px">${pay.notas}</span>`:''}</div>
                <div style="display:flex;align-items:center;gap:8px">
                  <strong style="color:var(--green)">${fmt(pay.monto)}</strong>
                  ${state.isAdmin&&!isViewingPast()?`<button class="btn-icon danger" style="padding:2px 6px;font-size:11px" onclick="deletePayment(${pay.id})">×</button>`:''}
                </div>
              </div>`).join(''):'<div style="color:var(--muted);font-size:13px">Sin pagos</div>'}
            ${state.isAdmin&&!isViewingPast()?`<button class="btn btn-primary" style="margin-top:10px;font-size:12px" onclick="openAddPaymentModal(${p.player_id})">+ Registrar pago</button>`:''}
          </div>
        </div>
      </div></td>
    </tr>`;
  }).join('');
}

function togglePaymentDetail(id){ const r=$(`detail-${id}`); r.style.display=r.style.display==='none'?'':'none'; }
async function deletePayment(id){ if(!confirm('¿Eliminar pago?'))return; try{await api(`/finances/payment/${id}`,'DELETE');toast('Pago eliminado');loadPayments();}catch(e){toast(e.message,'error');} }
async function deleteInscripcionConfig(id){ if(!confirm('¿Eliminar configuración y deudas?'))return; try{await api(`/finances/inscripcion-config/${id}`,'DELETE');toast('Configuración eliminada');loadPayments();}catch(e){toast(e.message,'error');} }
async function deleteArbitrajePhase(id){ if(!confirm('¿Eliminar fase y deudas?'))return; try{await api(`/finances/arbitraje-phase/${id}`,'DELETE');toast('Fase eliminada');loadPayments();}catch(e){toast(e.message,'error');} }
function openAddPaymentModal(preselectedPlayerId=null){
  const sel=$('pay-player');
  sel.innerHTML=state.players.filter(p=>p.is_active).map(p=>`<option value="${p.id}" ${p.id===preselectedPlayerId?'selected':''}>${p.player_number} - ${p.full_name}</option>`).join('');
  $('pay-amount').value=''; $('pay-notes').value=''; clearError('payment-error'); showModal('modal-payment');
}

// ── MATCH MODALS ──────────────────────────────────────────────────
function openAddMatchModal(){ $('modal-match-title').textContent='Agregar Partido'; $('match-edit-id').value=''; ['m-opponent','m-location','m-notes'].forEach(id=>$(id).value=''); $('m-date').value=''; $('m-phase').value=''; clearError('match-error'); showModal('modal-match'); }
function openEditMatchModal(id){ const m=state.matches.find(x=>x.id===id); if(!m)return; $('modal-match-title').textContent='Editar Partido'; $('match-edit-id').value=id; $('m-opponent').value=m.opponent; $('m-date').value=m.match_date.slice(0,16); $('m-phase').value=m.phase||''; $('m-location').value=m.location||''; $('m-notes').value=m.notes||''; clearError('match-error'); showModal('modal-match'); }
async function deleteMatch(id){ const m=state.matches.find(x=>x.id===id); if(!confirm(`¿Eliminar partido vs ${m?.opponent||id}?`))return; try{await api(`/matches/${id}`,'DELETE');toast('Partido eliminado');loadHome();}catch(e){toast(e.message,'error');} }
function openResultModal(matchId){ const m=state.matches.find(x=>x.id===matchId); if(!m)return; $('result-match-id').value=matchId; $('r-home').value=m.home_score??0; $('r-away').value=m.away_score??0; clearError('result-error'); renderGoalRows(m.goals||[]); showModal('modal-result'); }
function renderGoalRows(goals=[]){ const c=$('goals-list'); c.innerHTML=''; goals.forEach(g=>addGoalRow(g.player_id,g.count,g.assist_player_id,g.id)); }
function addGoalRow(playerId='',count=1,assistId='',existingGoalId=''){
  const row=document.createElement('div'); row.style.cssText='display:flex;gap:8px;align-items:center;flex-wrap:wrap'; row.dataset.goalId=existingGoalId;
  const playerOpts=state.players.filter(p=>p.is_active).map(p=>`<option value="${p.id}" ${p.id==playerId?'selected':''}>${p.player_number} ${p.full_name.split(' ')[0]}</option>`).join('');
  const assistOpts=`<option value="">Sin asistencia</option>`+state.players.filter(p=>p.is_active).map(p=>`<option value="${p.id}" ${p.id==assistId?'selected':''}>${p.player_number} ${p.full_name.split(' ')[0]}</option>`).join('');
  row.innerHTML=`<select class="form-input goal-player" style="flex:1;min-width:120px"><option value="">Goleador</option>${playerOpts}</select><input type="number" class="form-input goal-count" min="1" max="10" value="${count}" style="width:60px"/><select class="form-input goal-assist" style="flex:1;min-width:120px">${assistOpts}</select><button type="button" class="btn btn-danger" style="padding:6px 10px" onclick="this.parentElement.remove()">×</button>`;
  $('goals-list').appendChild(row);
}

// ── SAVE HANDLERS ─────────────────────────────────────────────────
async function savePlayer(){
  const editId=$('player-edit-id').value;
  const body={id_number:$('p-idnumber').value.trim(),full_name:$('p-name').value.trim(),player_number:+$('p-number').value,phone:$('p-phone').value.trim()||null,health_info:$('p-health').value.trim()||null};
  if(!body.id_number||!body.full_name||!body.player_number){showError('player-error','Cédula, nombre y número son obligatorios.');return;}
  try{
    if(editId){await api(`/players/${editId}`,'PUT',body);toast('Jugador actualizado');}
    else{await api(`/players${tParam()}`,'POST',body);toast('Jugador añadido');}
    closeModal('modal-player'); loadPlayers();
  }catch(e){showError('player-error',e.message);}
}

async function saveMatch(){
  const editId=$('match-edit-id').value, dateVal=$('m-date').value;
  if(!$('m-opponent').value.trim()||!dateVal){showError('match-error','Rival y fecha son obligatorios.');return;}
  const body={opponent:$('m-opponent').value.trim(),match_date:new Date(dateVal).toISOString(),phase:$('m-phase').value||null,location:$('m-location').value.trim()||null,notes:$('m-notes').value.trim()||null};
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
      const playerId=row.querySelector('.goal-player').value;
      if(!playerId)continue;
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
  const body={total_amount:+$('insc-total').value,notes:$('insc-notes').value.trim()};
  if(!body.total_amount){showError('insc-error','El monto es obligatorio.');return;}
  try{const res=await api(`/finances/inscripcion-config${tParam()}`,'POST',body);toast(res.message);closeModal('modal-inscripcion');loadPayments();}
  catch(e){showError('insc-error',e.message);}
}

async function saveArbitrajePhase(){
  const body={fase:$('arb-fase').value.trim(),num_games:+$('arb-games').value,price_per_game:+$('arb-price').value,notes:$('arb-notes').value.trim()};
  if(!body.fase||!body.num_games||!body.price_per_game){showError('arb-error','Fase, partidos y precio son obligatorios.');return;}
  try{const res=await api(`/finances/arbitraje-phase${tParam()}`,'POST',body);toast(res.message);closeModal('modal-arbitraje');loadPayments();}
  catch(e){showError('arb-error',e.message);}
}

function updateArbPreview(){
  const games=+($('arb-games')?.value||0),price=+($('arb-price')?.value||0);
  const players=state.players.filter(p=>p.is_active);
  const prev=$('arb-preview'); if(!prev)return;
  if(games>0&&price>0&&players.length>0){const total=games*price;prev.textContent=`Total: ${fmt(total)} ÷ ${players.length} jugadores = ${fmt(Math.round(total/players.length))} c/u`;prev.style.color='var(--gold)';}
  else{prev.textContent='';}
}

async function doLogin(){
  clearError('login-error');
  try{const data=await api('/auth/login','POST',{username:$('login-user').value.trim(),password:$('login-pass').value});setAuth(data.access_token,data.is_admin);closeModal('modal-login');toast('¡Bienvenido, admin!');navigateTo('home');}
  catch(e){showError('login-error',e.message);}
}

// ── INIT ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  updateAuthUI();
  await loadTournaments();

  document.querySelectorAll('[data-page]').forEach(link=>{
    link.addEventListener('click',e=>{e.preventDefault();navigateTo(link.dataset.page);});
  });

  const handleLoginBtn=()=>{if(state.isAdmin){logout();return;}$('login-user').value='';$('login-pass').value='';clearError('login-error');showModal('modal-login');};
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
  const btnAddPay=$('btn-add-payment'); if(btnAddPay)btnAddPay.addEventListener('click',()=>{if(!state.players.length){toast('Carga jugadores primero','warning');return;}openAddPaymentModal();});
  const btnSavePay=$('btn-save-payment'); if(btnSavePay)btnSavePay.addEventListener('click',savePayment);
  const btnSaveInsc=$('btn-save-inscripcion'); if(btnSaveInsc)btnSaveInsc.addEventListener('click',saveInscripcionConfig);
  const btnSaveArb=$('btn-save-arbitraje'); if(btnSaveArb)btnSaveArb.addEventListener('click',saveArbitrajePhase);
  const btnSaveTorneo=$('btn-save-tournament'); if(btnSaveTorneo)btnSaveTorneo.addEventListener('click',createTournament);
  ['arb-games','arb-price'].forEach(id=>{const el=$(id);if(el)el.addEventListener('input',updateArbPreview);});
  loadHome();
});