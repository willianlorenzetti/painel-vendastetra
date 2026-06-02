/* ── State ───────────────────────────────────────────────────────────────── */
let allData       = [];
let sortCol       = 'qtde_tetra';
let sortDir       = 'desc';
let activeCompany = 'all';
let searchText    = '';

/* ── DOM refs ────────────────────────────────────────────────────────────── */
const elLoading      = document.getElementById('loading');
const elEmpty        = document.getElementById('empty-state');
const elTable        = document.getElementById('data-table');
const elBody         = document.getElementById('table-body');
const elCount        = document.getElementById('table-count');
const elAlertErrors  = document.getElementById('alert-errors');
const elSearch       = document.getElementById('search-input');
const elRefresh      = document.getElementById('btn-refresh');
const elDateInput    = document.getElementById('input-date');
const elProgressFill = document.getElementById('progress-fill');
const elHeaderSync   = document.getElementById('header-sync');

/* ── Formatadores ────────────────────────────────────────────────────────── */
const fmtBRL = v =>
  (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const fmtQty = v =>
  (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/* ── Data: DD/MM/AAAA → YYYY-MM-DD ──────────────────────────────────────── */
function parseDateBR(str) {
  const m = str.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/* ── Máscara automática no input de data ─────────────────────────────────── */
elDateInput.addEventListener('input', e => {
  let v = e.target.value.replace(/\D/g, '').slice(0, 8);
  if (v.length > 4) v = v.slice(0,2) + '/' + v.slice(2,4) + '/' + v.slice(4);
  else if (v.length > 2) v = v.slice(0,2) + '/' + v.slice(2);
  e.target.value = v;
});

/* ── Fetch ───────────────────────────────────────────────────────────────── */
async function loadData() {
  const isoDate = parseDateBR(elDateInput.value);
  if (!isoDate) {
    showError('Data inválida. Use o formato DD/MM/AAAA (ex: 01/06/2026).');
    return;
  }

  elRefresh.classList.add('loading');
  elLoading.classList.remove('hidden');
  elEmpty.classList.add('hidden');
  elTable.classList.add('hidden');
  elAlertErrors.classList.add('hidden');

  const url = `/api/vendas?from=${isoDate}&company=${activeCompany}`;

  try {
    const res  = await fetch(url);
    const json = await res.json();

    if (!res.ok) {
      showError(json.error || 'Erro desconhecido no servidor.');
      return;
    }

    if (json.erros && json.erros.length) {
      elAlertErrors.innerHTML =
        '<strong>Atenção:</strong>' + json.erros.map(e => `<br>• ${e}`).join('');
      elAlertErrors.classList.remove('hidden');
    }

    if (json.sincronizado_em) {
      const d = new Date(json.sincronizado_em);
      elHeaderSync.textContent =
        `Atualizado em ${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'})}`;
    }

    allData = json.clientes || [];
    renderKPIs(json.kpis || {});
    renderTable();

  } catch (err) {
    showError('Falha ao conectar com o servidor: ' + err.message);
  } finally {
    elRefresh.classList.remove('loading');
    elLoading.classList.add('hidden');
  }
}

/* ── KPIs ────────────────────────────────────────────────────────────────── */
function renderKPIs(k) {
  setText('kpi-pct-meta',    `${k.pctMeta ?? 0}%`);
  setText('kpi-sub-meta',    `${fmtQty(k.atingiramMeta)} de ${fmtQty(k.totalPeriodo)} clientes no período`);
  setText('kpi-com-tetra',   fmtQty(k.comTetra));
  setText('kpi-sub-periodo', `${fmtQty(k.totalPeriodo)} total no período`);
  setText('kpi-total-qtde',  fmtQty(k.totalQtdeTetra));
  setText('kpi-valor-tetra', fmtBRL(k.totalValorTetra));
  elProgressFill.style.width = `${Math.min(k.pctMeta ?? 0, 100)}%`;
}

/* ── Tabela ──────────────────────────────────────────────────────────────── */
function renderTable() {
  let rows = [...allData];

  if (searchText) {
    const q = searchText.toLowerCase();
    rows = rows.filter(r =>
      (r.cli_nome  || '').toLowerCase().includes(q) ||
      (r.rep_nome  || '').toLowerCase().includes(q) ||
      String(r.cli_codigo || '').toLowerCase().includes(q)
    );
  }

  rows.sort((a, b) => {
    let va = a[sortCol] ?? '';
    let vb = b[sortCol] ?? '';
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

  elCount.textContent = `${rows.length} cliente${rows.length !== 1 ? 's' : ''}`;

  if (!rows.length) {
    elTable.classList.add('hidden');
    elEmpty.classList.remove('hidden');
    return;
  }

  elEmpty.classList.add('hidden');
  elTable.classList.remove('hidden');

  elBody.innerHTML = rows.map(r => {
    const metaClass = r.qtde_tetra >= 10 ? 'qty-meta' : 'qty-abaixo';
    return `
      <tr>
        <td>${esc(r.rep_nome)}</td>
        <td class="td-codigo">${esc(r.cli_codigo)}</td>
        <td>${esc(r.cli_nome)}</td>
        <td class="td-right ${metaClass}">${fmtQty(r.qtde_tetra)}</td>
        <td class="td-right">${fmtBRL(r.valor_tetra)}</td>
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

document.getElementById('tab-company').addEventListener('click', e => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  document.querySelectorAll('#tab-company .tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  activeCompany = btn.dataset.value;
  loadData();
});

let dateTimer;
elDateInput.addEventListener('change', () => {
  clearTimeout(dateTimer);
  dateTimer = setTimeout(loadData, 500);
});

elSearch.addEventListener('input', e => {
  searchText = e.target.value.trim();
  renderTable();
});

document.querySelectorAll('th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    if (sortCol === th.dataset.col) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortCol = th.dataset.col;
      sortDir = (th.dataset.col === 'qtde_tetra' || th.dataset.col === 'valor_tetra') ? 'desc' : 'asc';
    }
    renderTable();
  });
});

/* ── Init ────────────────────────────────────────────────────────────────── */
loadData();
