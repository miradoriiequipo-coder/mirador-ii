// ══════════════════════════════════════════════════════════════════
//  MIRADOR II FC — app.js
// ══════════════════════════════════════════════════════════════════

const API = '';   // Vacío = mismo origen; o pon 'https://tu-api.onrender.com'

// ── Estado ────────────────────────────────────────────────────────
const state = {
  token:    localStorage.getItem('mirador_token') || null,
  isAdmin:  localStorage.getItem('mirador_admin') === 'true',
  players:  [],
  matches:  [],
  payments: [],
  votes:    {},             // { matchId: [ ...results ] }
  hasVoted: JSON.parse(localStorage.getItem('mirador_voted') || '{}'),
  sliderIdx: 0,
  upcomingMatches: [],
  lastMatch: null,
};

// ── Utilidades ────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const fmt = n => new Intl.NumberFormat('es-CO', { style:'currency', currency:'COP', maximumFractionDigits:0 }).format(n);
const fmtDate = iso => {
  const d = new Date(iso);
  return d.toLocaleDateString('es-CO', { weekday:'long', day:'numeric', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' });
};
const fmtShortDate = iso => {
  const d = new Date(iso);
  return d.toLocaleDateString('es-CO', { day:'numeric', month:'short' }) + ' ' + d.toLocaleTimeString('es-CO', { hour:'2-digit', minute:'2-digit' });
};

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

function showModal(id)  { $(id).classList.add('open');  document.body.style.overflow = 'hidden'; }
function closeModal(id) { $(id).classList.remove('open'); document.body.style.overflow = ''; }
function showError(id, msg) { const el = $(id); el.textContent = msg; el.classList.add('show'); }
function clearError(id)     { const el = $(id); el.textContent = ''; el.classList.remove('show'); }

// ── API Helper ────────────────────────────────────────────────────
async function api(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (state.token) opts.headers['Authorization'] = `Bearer ${state.token}`;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}/api${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || 'Error del servidor');
  return data;
}

// ── Router ────────────────────────────────────────────────────────
function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('[data-page]').forEach(a => a.classList.remove('active'));
  $(`page-${page}`).classList.add('active');
  document.querySelectorAll(`[data-page="${page}"]`).forEach(a => a.classList.add('active'));
  $('mobile-menu').classList.remove('open');

  if (page === 'home')     loadHome();
  if (page === 'players')  loadPlayers();
  if (page === 'payments') loadPayments();
}

// ── Auth ──────────────────────────────────────────────────────────
function setAuth(token, isAdmin) {
  state.token   = token;
  state.isAdmin = isAdmin;
  localStorage.setItem('mirador_token', token);
  localStorage.setItem('mirador_admin', isAdmin);
  updateAuthUI();
}

function logout() {
  state.token = null;
  state.isAdmin = false;
  localStorage.removeItem('mirador_token');
  localStorage.removeItem('mirador_admin');
  updateAuthUI();
  toast('Sesión cerrada', 'warning');
  navigateTo('home');
}

function updateAuthUI() {
  const adminBar  = $('admin-bar');
  const btnLogin  = $('btn-login');
  const btnLoginM = $('btn-login-mobile');

  if (state.isAdmin) {
    adminBar.classList.add('show');
    btnLogin.textContent  = 'Cerrar sesión';
    btnLogin.classList.add('logged');
    if (btnLoginM) { btnLoginM.textContent = 'Cerrar sesión'; btnLoginM.classList.add('logged'); }
  } else {
    adminBar.classList.remove('show');
    btnLogin.textContent = 'Iniciar sesión';
    btnLogin.classList.remove('logged');
    if (btnLoginM) { btnLoginM.textContent = 'Iniciar sesión'; btnLoginM.classList.remove('logged'); }
  }

  // Mostrar/ocultar controles de admin
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = state.isAdmin ? '' : 'none';
  });
}

// ── HOME PAGE ─────────────────────────────────────────────────────
async function loadHome() {
  try {
    const matches = await api('/matches');
    state.matches = matches;
    const now = new Date();
    state.upcomingMatches = matches
      .filter(m => !m.is_played && new Date(m.match_date) > now)
      .sort((a,b) => new Date(a.match_date) - new Date(b.match_date));
    const played = matches
      .filter(m => m.is_played)
      .sort((a,b) => new Date(b.match_date) - new Date(a.match_date));
    state.lastMatch = played[0] || null;

    renderUpcomingSlider();
    renderLastResult();
    await renderVoteSection();
  } catch(e) {
    toast('Error cargando datos: ' + e.message, 'error');
  }
}

// ── Slider ────────────────────────────────────────────────────────
function renderUpcomingSlider() {
  const track = $('upcoming-track');
  const dots  = $('slider-dots');
  const upcoming = state.upcomingMatches;

  if (!upcoming.length) {
    track.innerHTML = `
      <div class="match-card" style="min-width:300px">
        <div class="empty-icon">📅</div>
        <div class="empty"><h3>Sin partidos programados</h3>
          <p>El administrador aún no ha añadido partidos.</p>
          ${state.isAdmin ? `<button class="btn btn-primary" style="margin-top:12px" onclick="openAddMatchModal()">+ Agregar partido</button>` : ''}
        </div>
      </div>`;
    dots.innerHTML = '';
    return;
  }

  track.innerHTML = upcoming.map((m, i) => `
    <div class="match-card">
      ${m.phase ? `<div class="match-phase">📌 ${m.phase}</div>` : '<div class="match-phase">📌 Partido</div>'}
      <div class="match-teams">
        MIRADOR II <span class="match-vs">vs</span> ${m.opponent.toUpperCase()}
      </div>
      <div class="match-info">
        <span>📅 ${fmtShortDate(m.match_date)}</span>
        ${m.location ? `<span>📍 ${m.location}</span>` : ''}
      </div>
      ${m.notes ? `<div style="margin-top:10px;font-size:12px;color:var(--muted)">${m.notes}</div>` : ''}
      ${state.isAdmin ? `
        <div style="display:flex;gap:6px;margin-top:14px">
          <button class="btn btn-secondary" style="font-size:12px" onclick="openResultModal(${m.id})">Registrar resultado</button>
          <button class="btn btn-secondary" style="font-size:12px" onclick="openEditMatchModal(${m.id})">✏️</button>
          <button class="btn btn-danger" style="font-size:12px" onclick="deleteMatch(${m.id})">🗑️</button>
        </div>` : ''}
    </div>
  `).join('');

  dots.innerHTML = upcoming.map((_, i) => `
    <button class="slider-dot ${i===0?'active':''}" data-idx="${i}"></button>
  `).join('');

  dots.querySelectorAll('.slider-dot').forEach(btn => {
    btn.addEventListener('click', () => goSlide(+btn.dataset.idx));
  });

  state.sliderIdx = 0;
  // Add button at end if admin
  if (state.isAdmin) {
    const extra = document.createElement('div');
    extra.className = 'match-card';
    extra.style.cssText = 'display:flex;align-items:center;justify-content:center;cursor:pointer;border-style:dashed';
    extra.innerHTML = `<div style="text-align:center;color:var(--muted)"><div style="font-size:32px">+</div><div style="font-size:13px;font-weight:700">Agregar Partido</div></div>`;
    extra.onclick = openAddMatchModal;
    track.appendChild(extra);
  }
}

function goSlide(idx) {
  const track = $('upcoming-track');
  const items = track.querySelectorAll('.match-card');
  const n = state.upcomingMatches.length;
  if (!n) return;
  idx = Math.max(0, Math.min(idx, n - 1));
  state.sliderIdx = idx;
  const cardW = items[0].offsetWidth + 16;
  track.style.transform = `translateX(-${idx * cardW}px)`;
  document.querySelectorAll('.slider-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
}

// ── Last Result ───────────────────────────────────────────────────
function renderLastResult() {
  const wrap = $('last-result-wrap');
  const m = state.lastMatch;

  if (!m) {
    wrap.innerHTML = `
      <div class="result-card">
        <div class="empty"><div class="empty-icon">🏆</div>
          <h3>Sin resultados aún</h3>
          <p>El primer partido marcará el comienzo de la historia.</p>
        </div>
      </div>`;
    return;
  }

  const homeW = m.home_score > m.away_score;
  const awayW = m.away_score > m.home_score;

  const scorers = m.goals || [];
  const scorerMap = {};
  scorers.forEach(g => {
    if (!scorerMap[g.player_name]) scorerMap[g.player_name] = 0;
    scorerMap[g.player_name] += g.count;
  });

  const scorerChips = Object.entries(scorerMap).map(([name, n]) => `
    <span class="scorer-chip"><span class="num">${n}</span> ${name} ⚽</span>
  `).join('');

  const assistMap = {};
  scorers.filter(g=>g.assist_player_name).forEach(g => {
    assistMap[g.assist_player_name] = (assistMap[g.assist_player_name]||0) + 1;
  });
  const assistChips = Object.entries(assistMap).map(([name,n]) =>
    `<span class="scorer-chip" style="background:rgba(245,158,11,0.15);color:var(--gold)"><span class="num" style="background:var(--gold)">${n}</span> ${name} 🅰️</span>`
  ).join('');

  wrap.innerHTML = `
    <div class="result-card">
      <div class="result-label">🏁 ÚLTIMO PARTIDO · ${m.phase || 'Partido'}</div>
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
      <div style="text-align:center;color:var(--muted);font-size:13px;margin-bottom:12px">
        📅 ${fmtDate(m.match_date)} ${m.location ? '· 📍 ' + m.location : ''}
      </div>
      ${scorerChips ? `<div><div class="form-label" style="margin-bottom:8px">Goles</div><div class="scorers-list">${scorerChips}</div></div>` : ''}
      ${assistChips ? `<div style="margin-top:10px"><div class="form-label" style="margin-bottom:8px">Asistencias</div><div class="scorers-list">${assistChips}</div></div>` : ''}
      ${state.isAdmin ? `
        <div style="display:flex;gap:8px;margin-top:16px">
          <button class="btn btn-secondary" onclick="openResultModal(${m.id})">✏️ Editar resultado</button>
          <button class="btn btn-danger" onclick="deleteMatch(${m.id})">🗑️ Eliminar</button>
        </div>` : ''}
    </div>`;
}

// ── MVP Voting ────────────────────────────────────────────────────
async function renderVoteSection() {
  const wrap = $('vote-section');
  const m = state.lastMatch;

  if (!m) {
    wrap.innerHTML = `<div class="card" style="text-align:center;padding:30px;color:var(--muted)">No hay partidos jugados aún para votar.</div>`;
    return;
  }

  // Cargar votos
  let voteResults = [];
  try { voteResults = await api(`/matches/${m.id}/votes`); } catch(e) {}
  state.votes[m.id] = voteResults;

  const alreadyVoted = !!state.hasVoted[m.id];
  const totalVotes = voteResults.reduce((s, v) => s + v.vote_count, 0);

  const voteMap = {};
  voteResults.forEach(v => { voteMap[v.player_id] = v; });

  const players = state.players.length ? state.players :
    await api('/players').then(p => { state.players = p; return p; });

  if (!players.length) {
    wrap.innerHTML = `<div class="card" style="padding:20px;color:var(--muted)">Sin jugadores registrados.</div>`;
    return;
  }

  const cards = players.filter(p => p.is_active).map(p => {
    const vd = voteMap[p.id];
    const pct = vd ? vd.percentage : 0;
    const cnt = vd ? vd.vote_count : 0;
    return `
      <div class="vote-card ${alreadyVoted ? 'voted-card' : ''}" data-player="${p.id}">
        <div class="vote-jersey">${p.player_number}</div>
        <div class="vote-name">${p.full_name.split(' ').slice(0,2).join(' ')}</div>
        ${alreadyVoted ? `
          <div class="vote-bar-wrap"><div class="vote-bar" style="width:${pct}%"></div></div>
          <div class="vote-pct">${cnt} voto${cnt!==1?'s':''} · ${pct}%</div>
        ` : ''}
      </div>`;
  }).join('');

  wrap.innerHTML = `
    <div class="card">
      <div style="margin-bottom:16px">
        <div style="font-weight:700;color:var(--white)">⭐ ¿Quién fue el mejor vs ${m.opponent}?</div>
        <div style="font-size:13px;color:var(--muted);margin-top:4px">${totalVotes} voto${totalVotes!==1?'s':''} registrado${totalVotes!==1?'s':''}</div>
      </div>
      <div class="vote-grid" id="vote-grid">${cards}</div>
      ${!alreadyVoted ? `
        <button class="btn-vote" id="btn-cast-vote" disabled>Votar por el MVP ⭐</button>
        <div class="vote-notice">Selecciona un jugador para votar · Un voto por partido</div>
      ` : `
        <div class="vote-notice" style="margin-top:16px;color:var(--green)">✅ Ya votaste en este partido</div>
      `}
    </div>`;

  // Eventos de selección
  let selectedPlayer = null;
  if (!alreadyVoted) {
    document.querySelectorAll('.vote-card').forEach(card => {
      card.addEventListener('click', () => {
        document.querySelectorAll('.vote-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedPlayer = +card.dataset.player;
        const btn = $('btn-cast-vote');
        if (btn) btn.disabled = false;
      });
    });

    const btn = $('btn-cast-vote');
    if (btn) btn.addEventListener('click', async () => {
      if (!selectedPlayer) return;
      btn.disabled = true; btn.textContent = 'Votando...';
      try {
        const res = await api(`/matches/${m.id}/votes`, 'POST', { player_id: selectedPlayer });
        toast(res.message || '¡Voto registrado!');
        state.hasVoted[m.id] = true;
        localStorage.setItem('mirador_voted', JSON.stringify(state.hasVoted));
        await renderVoteSection();
      } catch(e) {
        toast(e.message, 'error');
        btn.disabled = false; btn.textContent = 'Votar por el MVP ⭐';
      }
    });
  }
}

// ── PLAYERS PAGE ──────────────────────────────────────────────────
async function loadPlayers() {
  const grid = $('players-grid');
  grid.innerHTML = '<div class="loading-wrap"><div class="spinner"></div></div>';
  const addBtn = $('btn-add-player');
  if (addBtn) addBtn.style.display = state.isAdmin ? 'inline-flex' : 'none';

  try {
    const players = await api('/players');
    state.players = players;
    renderPlayersGrid(players);
  } catch(e) {
    grid.innerHTML = `<div class="empty"><div class="empty-icon">❌</div><h3>Error cargando jugadores</h3><p>${e.message}</p></div>`;
  }
}

function renderPlayersGrid(players) {
  const grid = $('players-grid');
  if (!players.length) {
    grid.innerHTML = `
      <div class="empty" style="grid-column:1/-1">
        <div class="empty-icon">👥</div>
        <h3>Sin jugadores</h3>
        <p>El equipo está esperando sus integrantes.</p>
        ${state.isAdmin ? `<button class="btn btn-primary" style="margin-top:12px" onclick="openAddPlayerModal()">+ Agregar jugador</button>` : ''}
      </div>`;
    return;
  }
  grid.innerHTML = players.map(p => `
    <div class="player-card">
      <div class="player-jersey">${p.player_number}</div>
      <div class="player-info">
        <div class="player-name">${p.full_name}</div>
        ${p.phone ? `<div class="player-meta"><span>📞 ${p.phone}</span></div>` : ''}
        ${p.health_info ? `<div class="player-health">🏥 ${p.health_info}</div>` : ''}
        ${state.isAdmin && p.id_number ? `<div class="player-id">🪪 CC: ${p.id_number}</div>` : ''}
      </div>
      ${state.isAdmin ? `
        <div class="player-actions">
          <button class="btn-icon" onclick="openEditPlayerModal(${p.id})" title="Editar">✏️</button>
          <button class="btn-icon danger" onclick="deletePlayer(${p.id},'${p.full_name.replace(/'/g,"\\'")}')">🗑️</button>
        </div>` : ''}
    </div>
  `).join('');
}

function openAddPlayerModal() {
  $('modal-player-title').textContent = 'Agregar Jugador';
  $('player-edit-id').value = '';
  ['p-idnumber','p-number','p-name','p-phone','p-health'].forEach(id => $(id).value = '');
  clearError('player-error');
  showModal('modal-player');
}

function openEditPlayerModal(id) {
  const p = state.players.find(x => x.id === id);
  if (!p) return;
  $('modal-player-title').textContent = 'Editar Jugador';
  $('player-edit-id').value = id;
  $('p-idnumber').value = p.id_number || '';
  $('p-number').value = p.player_number;
  $('p-name').value = p.full_name;
  $('p-phone').value = p.phone || '';
  $('p-health').value = p.health_info || '';
  clearError('player-error');
  showModal('modal-player');
}

async function deletePlayer(id, name) {
  if (!confirm(`¿Desactivar al jugador ${name}?`)) return;
  try {
    await api(`/players/${id}`, 'DELETE');
    toast(`${name} desactivado`);
    loadPlayers();
  } catch(e) { toast(e.message, 'error'); }
}

// ── PAYMENTS PAGE ─────────────────────────────────────────────────
async function loadPayments() {
  const body = $('payments-body');
  body.innerHTML = `<tr><td colspan="6"><div class="loading-wrap"><div class="spinner"></div></div></td></tr>`;
  const addBtn = $('btn-add-payment');
  if (addBtn) addBtn.style.display = state.isAdmin ? 'inline-flex' : 'none';

  try {
    const [payments, players] = await Promise.all([api('/payments'), api('/players')]);
    state.payments = payments;
    state.players  = players;
    renderPaymentsTable(payments);
    renderPaymentsSummary(payments);
  } catch(e) {
    body.innerHTML = `<tr><td colspan="6" style="color:var(--red);padding:20px">${e.message}</td></tr>`;
  }
}

function renderPaymentsSummary(payments) {
  const wrap = $('payments-summary');
  const totalInsc  = payments.reduce((s,p) => s + p.inscripcion_total, 0);
  const totalArb   = payments.reduce((s,p) => s + p.arbitraje_total, 0);
  const totalAll   = totalInsc + totalArb;
  const jugsPagaron = payments.filter(p => p.total > 0).length;

  wrap.innerHTML = `
    <div class="card" style="text-align:center">
      <div style="font-size:11px;color:var(--muted);font-weight:700;letter-spacing:1px;text-transform:uppercase">Total Recaudado</div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:28px;color:var(--white);margin-top:4px">${fmt(totalAll)}</div>
    </div>
    <div class="card" style="text-align:center">
      <div style="font-size:11px;color:var(--muted);font-weight:700;letter-spacing:1px;text-transform:uppercase">Inscripciones</div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:28px;color:var(--green);margin-top:4px">${fmt(totalInsc)}</div>
    </div>
    <div class="card" style="text-align:center">
      <div style="font-size:11px;color:var(--muted);font-weight:700;letter-spacing:1px;text-transform:uppercase">Arbitrajes</div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:28px;color:var(--gold);margin-top:4px">${fmt(totalArb)}</div>
    </div>
    <div class="card" style="text-align:center">
      <div style="font-size:11px;color:var(--muted);font-weight:700;letter-spacing:1px;text-transform:uppercase">Jugadores con pago</div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:28px;color:var(--white);margin-top:4px">${jugsPagaron} / ${payments.length}</div>
    </div>`;
}

function renderPaymentsTable(payments) {
  const body = $('payments-body');
  if (!payments.length) {
    body.innerHTML = `<tr><td colspan="6"><div class="empty"><div class="empty-icon">💰</div><h3>Sin registros de pagos</h3></div></td></tr>`;
    return;
  }
  body.innerHTML = payments.map(p => `
    <tr>
      <td class="jersey">${p.player_number}</td>
      <td style="font-weight:700">${p.player_name}</td>
      <td class="${p.inscripcion_total>0?'amount-positive':'amount-zero'}">${fmt(p.inscripcion_total)}</td>
      <td class="${p.arbitraje_total>0?'amount-positive':'amount-zero'}">${fmt(p.arbitraje_total)}</td>
      <td style="font-weight:800;color:var(--white)">${fmt(p.total)}</td>
      <td>
        <button class="btn-expand" onclick="togglePaymentDetail(${p.player_id})">
          ${p.payments.length} pago${p.payments.length!==1?'s':''}
        </button>
      </td>
    </tr>
    <tr class="payment-detail-row" id="detail-${p.player_id}" style="display:none">
      <td colspan="6">
        <div class="payment-detail-inner">
          ${p.payments.length === 0 ? '<em style="color:var(--muted)">Sin pagos registrados</em>' : `
            <div class="payment-items">
              ${p.payments.map(pay => `
                <div class="payment-item">
                  <span class="payment-badge ${pay.payment_type}">${pay.payment_type}</span>
                  ${pay.phase ? `<span class="payment-phase">${pay.phase}</span>` : ''}
                  <span style="font-weight:700;color:var(--green)">${fmt(pay.amount)}</span>
                  ${pay.notes ? `<span style="color:var(--muted)">${pay.notes}</span>` : ''}
                  <span style="color:var(--muted);font-size:11px">${new Date(pay.created_at).toLocaleDateString('es-CO')}</span>
                  ${state.isAdmin ? `<button class="btn-icon danger" style="padding:3px 6px;font-size:12px" onclick="deletePayment(${pay.id})">×</button>` : ''}
                </div>`).join('')}
            </div>`}
          ${state.isAdmin ? `<button class="btn btn-secondary" style="margin-top:10px;font-size:12px" onclick="openAddPaymentModal(${p.player_id})">+ Agregar pago</button>` : ''}
        </div>
      </td>
    </tr>
  `).join('');
}

function togglePaymentDetail(playerId) {
  const row = $(`detail-${playerId}`);
  row.style.display = row.style.display === 'none' ? '' : 'none';
}

async function deletePayment(id) {
  if (!confirm('¿Eliminar este pago?')) return;
  try {
    await api(`/payments/${id}`, 'DELETE');
    toast('Pago eliminado');
    loadPayments();
  } catch(e) { toast(e.message, 'error'); }
}

function openAddPaymentModal(preselectedPlayerId = null) {
  const sel = $('pay-player');
  sel.innerHTML = state.players.filter(p=>p.is_active).map(p =>
    `<option value="${p.id}" ${p.id===preselectedPlayerId?'selected':''}>${p.player_number} - ${p.full_name}</option>`
  ).join('');
  $('pay-amount').value = '';
  $('pay-notes').value  = '';
  clearError('payment-error');
  showModal('modal-payment');
}

// ── MATCH MODALS (Admin) ──────────────────────────────────────────
function openAddMatchModal() {
  $('modal-match-title').textContent = 'Agregar Partido';
  $('match-edit-id').value = '';
  ['m-opponent','m-location','m-notes'].forEach(id => $(id).value = '');
  $('m-date').value = '';
  $('m-phase').value = '';
  clearError('match-error');
  showModal('modal-match');
}

function openEditMatchModal(id) {
  const m = state.matches.find(x => x.id === id);
  if (!m) return;
  $('modal-match-title').textContent = 'Editar Partido';
  $('match-edit-id').value = id;
  $('m-opponent').value = m.opponent;
  $('m-date').value = m.match_date.slice(0,16);
  $('m-phase').value = m.phase || '';
  $('m-location').value = m.location || '';
  $('m-notes').value = m.notes || '';
  clearError('match-error');
  showModal('modal-match');
}

async function deleteMatch(id) {
  const m = state.matches.find(x => x.id === id);
  if (!confirm(`¿Eliminar el partido vs ${m?.opponent || id}?`)) return;
  try {
    await api(`/matches/${id}`, 'DELETE');
    toast('Partido eliminado');
    loadHome();
  } catch(e) { toast(e.message, 'error'); }
}

// ── RESULT MODAL ──────────────────────────────────────────────────
function openResultModal(matchId) {
  const m = state.matches.find(x => x.id === matchId);
  if (!m) return;
  $('result-match-id').value = matchId;
  $('r-home').value = m.home_score ?? 0;
  $('r-away').value = m.away_score ?? 0;
  clearError('result-error');
  renderGoalRows(m.goals || []);
  showModal('modal-result');
}

function renderGoalRows(goals = []) {
  const container = $('goals-list');
  container.innerHTML = '';
  goals.forEach(g => addGoalRow(g.player_id, g.count, g.assist_player_id, g.id));
}

function addGoalRow(playerId = '', count = 1, assistId = '', existingGoalId = '') {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap';
  row.dataset.goalId = existingGoalId;
  const playerOpts = state.players.filter(p=>p.is_active).map(p =>
    `<option value="${p.id}" ${p.id==playerId?'selected':''}>${p.player_number} ${p.full_name.split(' ')[0]}</option>`
  ).join('');
  const assistOpts = `<option value="">Sin asistencia</option>` + state.players.filter(p=>p.is_active).map(p =>
    `<option value="${p.id}" ${p.id==assistId?'selected':''}>${p.player_number} ${p.full_name.split(' ')[0]}</option>`
  ).join('');
  row.innerHTML = `
    <select class="form-input goal-player" style="flex:1;min-width:120px"><option value="">Goleador</option>${playerOpts}</select>
    <input type="number" class="form-input goal-count" min="1" max="10" value="${count}" style="width:60px"/>
    <select class="form-input goal-assist" style="flex:1;min-width:120px">${assistOpts}</select>
    <button type="button" class="btn btn-danger" style="padding:6px 10px" onclick="this.parentElement.remove()">×</button>`;
  $('goals-list').appendChild(row);
}

// ── SAVE HANDLERS ─────────────────────────────────────────────────
async function savePlayer() {
  const editId = $('player-edit-id').value;
  const body = {
    id_number:    $('p-idnumber').value.trim(),
    full_name:    $('p-name').value.trim(),
    player_number: +$('p-number').value,
    phone:        $('p-phone').value.trim() || null,
    health_info:  $('p-health').value.trim() || null,
  };
  if (!body.id_number || !body.full_name || !body.player_number) {
    showError('player-error', 'Cédula, nombre y número son obligatorios.'); return;
  }
  try {
    if (editId) { await api(`/players/${editId}`, 'PUT', body); toast('Jugador actualizado'); }
    else        { await api('/players', 'POST', body); toast('Jugador añadido'); }
    closeModal('modal-player');
    loadPlayers();
  } catch(e) { showError('player-error', e.message); }
}

async function saveMatch() {
  const editId = $('match-edit-id').value;
  const dateVal = $('m-date').value;
  if (!$('m-opponent').value.trim() || !dateVal) {
    showError('match-error', 'Rival y fecha son obligatorios.'); return;
  }
  const body = {
    opponent:   $('m-opponent').value.trim(),
    match_date: new Date(dateVal).toISOString(),
    phase:      $('m-phase').value || null,
    location:   $('m-location').value.trim() || null,
    notes:      $('m-notes').value.trim() || null,
  };
  try {
    if (editId) { await api(`/matches/${editId}`, 'PUT', body); toast('Partido actualizado'); }
    else        { await api('/matches', 'POST', body); toast('Partido añadido'); }
    closeModal('modal-match');
    loadHome();
  } catch(e) { showError('match-error', e.message); }
}

async function saveResult() {
  const matchId = +$('result-match-id').value;
  const homeScore = +$('r-home').value;
  const awayScore = +$('r-away').value;

  try {
    // Actualizar resultado
    await api(`/matches/${matchId}`, 'PUT', {
      is_played: true, home_score: homeScore, away_score: awayScore
    });

    // Borrar goles anteriores (reload match to get goal ids)
    const currentMatch = await api(`/matches/${matchId}`);
    for (const g of currentMatch.goals) {
      await api(`/goals/${g.id}`, 'DELETE');
    }

    // Agregar nuevos goles
    const rows = $('goals-list').querySelectorAll('div[data-goal-id]');
    for (const row of rows) {
      const playerId  = row.querySelector('.goal-player').value;
      const count     = +row.querySelector('.goal-count').value;
      const assistId  = row.querySelector('.goal-assist').value || null;
      if (!playerId) continue;
      await api(`/matches/${matchId}/goals`, 'POST', {
        player_id: +playerId, count, assist_player_id: assistId ? +assistId : null
      });
    }

    toast('Resultado registrado');
    closeModal('modal-result');
    loadHome();
  } catch(e) { showError('result-error', e.message); }
}

async function savePayment() {
  const body = {
    player_id:    +$('pay-player').value,
    payment_type: $('pay-type').value,
    phase:        $('pay-phase').value || null,
    amount:       +$('pay-amount').value,
    notes:        $('pay-notes').value.trim() || null,
  };
  if (!body.player_id || !body.amount) {
    showError('payment-error', 'Jugador y monto son obligatorios.'); return;
  }
  try {
    await api('/payments', 'POST', body);
    toast('Pago registrado');
    closeModal('modal-payment');
    loadPayments();
  } catch(e) { showError('payment-error', e.message); }
}

async function doLogin() {
  const username = $('login-user').value.trim();
  const password = $('login-pass').value;
  clearError('login-error');
  try {
    const data = await api('/auth/login', 'POST', { username, password });
    setAuth(data.access_token, data.is_admin);
    closeModal('modal-login');
    toast('¡Bienvenido, admin!');
    navigateTo('home');
  } catch(e) { showError('login-error', e.message); }
}

// ── EVENT LISTENERS ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  updateAuthUI();

  // Nav
  document.querySelectorAll('[data-page]').forEach(link => {
    link.addEventListener('click', e => { e.preventDefault(); navigateTo(link.dataset.page); });
  });

  // Login buttons
  const handleLoginBtn = () => {
    if (state.isAdmin) { logout(); return; }
    $('login-user').value = ''; $('login-pass').value = '';
    clearError('login-error');
    showModal('modal-login');
  };
  $('btn-login').addEventListener('click', handleLoginBtn);
  const mob = $('btn-login-mobile');
  if (mob) mob.addEventListener('click', handleLoginBtn);

  // Hamburger
  $('hamburger').addEventListener('click', () => {
    $('mobile-menu').classList.toggle('open');
  });

  // Modal close buttons
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(overlay.id); });
  });

  // Slider
  $('prev-match').addEventListener('click', () => goSlide(state.sliderIdx - 1));
  $('next-match').addEventListener('click', () => goSlide(state.sliderIdx + 1));

  // Admin controls
  $('btn-add-player').addEventListener('click', openAddPlayerModal);
  $('btn-add-payment').addEventListener('click', () => {
    if (!state.players.length) { toast('Carga primero los jugadores', 'warning'); return; }
    openAddPaymentModal();
  });
  $('btn-save-player').addEventListener('click', savePlayer);
  $('btn-save-match').addEventListener('click', saveMatch);
  $('btn-save-result').addEventListener('click', saveResult);
  $('btn-save-payment').addEventListener('click', savePayment);
  $('btn-add-goal-row').addEventListener('click', () => addGoalRow());
  $('btn-do-login').addEventListener('click', doLogin);

  // Enter on login
  $('login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

  // Init
  loadHome();
});
