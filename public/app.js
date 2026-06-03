/* ── State ───────────────────────────────────────────────────────────────── */
let rankingData = [];
let sortCol     = 'pct';
let sortDir     = 'desc';

/* ── DOM refs ────────────────────────────────────────────────────────────── */
const elLoading      = document.getElementById('loading');
const elEmpty        = document.getElementById('empty-state');
const elTable        = document.getElementById('data-table');
const elBody         = document.getElementById('table-body');
const elAlertErrors  = document.getElementById('alert-errors');
const elRefresh      = document.getElementById('btn-refresh');
const elProgressFill = document.getElementById('progress-fill');
const elHeaderSync   = document.getElementById('header-sync');

/* ── Formatadores ────────────────────────────────────────────────────────── */
const fmtBRL = v =>
  (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const fmtN = v =>
  (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

/* ── Data DD/MM/AAAA → YYYY-MM-DD ───────────────────────────────────────── */
function parseDateBR(str) {
  const m = str.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/* ── Máscara de data ─────────────────────────────────────────────────────── */
/* ── Fetch ───────────────────────────────────────────────────────────────── */
const DATE_FROM = '2026-06-02';

async function loadData() {
  const isoDate = DATE_FROM;

  elRefresh.classList.add('loading');
  elLoading.classList.remove('hidden');
  elEmpty.classList.add('hidden');
  elTable.classList.add('hidden');
  elAlertErrors.classList.add('hidden');

  try {
    const res  = await fetch(`/api/vendas?from=${isoDate}&company=all`);
    const json = await res.json();

    if (!res.ok) { showError(json.error || 'Erro no servidor.'); return; }

    if (json.erros?.length) {
      elAlertErrors.innerHTML = '<strong>Atenção:</strong>' + json.erros.map(e => `<br>• ${e}`).join('');
      elAlertErrors.classList.remove('hidden');
    }

    if (json.sincronizado_em) {
      const d = new Date(json.sincronizado_em);
      elHeaderSync.textContent =
        `A partir de 02/06/2026 · Atualizado em ${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`;
    }

    rankingData = json.ranking || [];

    renderKPIs(json.kpis || {});
    renderRanking();

  } catch (err) {
    showError('Falha ao conectar: ' + err.message);
  } finally {
    elRefresh.classList.remove('loading');
    elLoading.classList.add('hidden');
  }
}

/* ── KPIs ────────────────────────────────────────────────────────────────── */
function renderKPIs(k) {
  setText('kpi-pct-meta',    `${k.pctMeta ?? 0}%`);
  setText('kpi-sub-meta',    `${fmtN(k.atingiramMeta)} de ${fmtN(k.totalPeriodo)} clientes no período`);
  setText('kpi-com-tetra',   fmtN(k.atingiramMeta));
  setText('kpi-sub-periodo', `de ${fmtN(k.totalPeriodo)} no período`);
  setText('kpi-total-qtde',  fmtN(k.totalQtdeTetra));
  setText('kpi-valor-tetra', fmtBRL(k.totalValorTetra));
  elProgressFill.style.width = `${Math.min(k.pctMeta ?? 0, 100)}%`;
}

/* ── Render ranking ──────────────────────────────────────────────────────── */
const medalhas = ['🥇', '🥈', '🥉'];

function renderRanking() {
  let rows = [...rankingData];

  rows.sort((a, b) => {
    let va = a[sortCol] ?? 0;
    let vb = b[sortCol] ?? 0;
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });

  document.querySelectorAll('th.sortable').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.col === sortCol)
      th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
  });


  if (!rows.length) {
    elTable.classList.add('hidden');
    elEmpty.classList.remove('hidden');
    return;
  }

  elEmpty.classList.add('hidden');
  elTable.classList.remove('hidden');

  elBody.innerHTML = rows.map((r, i) => {
    const pos     = i + 1;
    const badge   = pos <= 3
      ? `<span class="rank-medal">${medalhas[i]}</span>`
      : `<span class="rank-num">${pos}</span>`;
    const pctBar  = `
      <div class="rank-pct-wrap">
        <span class="rank-pct-num ${r.pct >= 50 ? 'pct-high' : ''}">${r.pct}%</span>
        <div class="rank-bar"><div class="rank-bar-fill" style="width:${Math.min(r.pct,100)}%"></div></div>
      </div>`;

    return `
      <tr>
        <td class="td-rank">${badge}</td>
        <td class="td-vendedor">${esc(r.rep_nome)}</td>
        <td class="td-num">${fmtN(r.total)}</td>
        <td class="td-num td-meta ${r.meta > 0 ? 'meta-pos' : ''}">${fmtN(r.meta)}</td>
        <td class="td-pct">${pctBar}</td>
      </tr>`;
  }).join('');
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function showError(msg) {
  elLoading.classList.add('hidden');
  elAlertErrors.innerHTML = `<strong>Erro:</strong> ${esc(msg)}`;
  elAlertErrors.classList.remove('hidden');
}

/* ── Eventos ─────────────────────────────────────────────────────────────── */
elRefresh.addEventListener('click', loadData);

// Auto-refresh a cada 30 minutos
setInterval(loadData, 30 * 60 * 1000);


document.querySelectorAll('th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    if (sortCol === th.dataset.col) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortCol = th.dataset.col;
      sortDir = 'desc';
    }
    renderRanking();
  });
});

/* ── Init ────────────────────────────────────────────────────────────────── */
loadData();
