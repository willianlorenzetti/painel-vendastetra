/* app.js — ES5 puro: compatível com browsers antigos e novos */

var rankingData  = [];
var sortCol      = 'pct';
var sortDir      = 'desc';
var DATE_FROM    = '2026-06-02';

var elLoading     = document.getElementById('loading');
var elEmpty       = document.getElementById('empty-state');
var elTable       = document.getElementById('data-table');
var elBody        = document.getElementById('table-body');
var elAlertErrors = document.getElementById('alert-errors');
var elRefresh     = document.getElementById('btn-refresh');
var elProgressFill= document.getElementById('progress-fill');
var elHeaderSync  = document.getElementById('header-sync');

/* ── Formatadores ─────────────────────────────────────────────────────────── */
function fmtBRL(v) {
  v = v || 0;
  try { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  catch(e) { return 'R$ ' + v.toFixed(2).replace('.', ','); }
}

function fmtN(v) {
  v = v || 0;
  try { return v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
  catch(e) { return String(Math.round(v)); }
}

/* ── Fetch via XHR (sem depender da API fetch) ────────────────────────────── */
function loadData() {
  elRefresh.classList.add('loading');
  elLoading.classList.remove('hidden');
  elEmpty.classList.add('hidden');
  elTable.classList.add('hidden');
  elAlertErrors.classList.add('hidden');

  var xhr = new XMLHttpRequest();
  xhr.open('GET', '/api/vendas?from=' + DATE_FROM + '&company=all', true);

  xhr.onreadystatechange = function() {
    if (xhr.readyState !== 4) return;

    elRefresh.classList.remove('loading');
    elLoading.classList.add('hidden');

    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        var json = JSON.parse(xhr.responseText);

        if (json.erros && json.erros.length) {
          var msgs = '';
          for (var i = 0; i < json.erros.length; i++) msgs += '<br>• ' + json.erros[i];
          elAlertErrors.innerHTML = '<strong>Atenção:</strong>' + msgs;
          elAlertErrors.classList.remove('hidden');
        }

        if (json.sincronizado_em) {
          var d = new Date(json.sincronizado_em);
          elHeaderSync.textContent =
            'A partir de 02/06/2026 · Atualizado em ' +
            d.toLocaleDateString('pt-BR') + ' às ' +
            d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        }

        rankingData = json.ranking || [];
        renderKPIs(json.kpis || {});
        renderRanking();

      } catch(e) {
        showError('Erro ao processar resposta: ' + e.message);
      }
    } else {
      showError('Erro no servidor (status ' + xhr.status + ')');
    }
  };

  xhr.onerror = function() {
    elRefresh.classList.remove('loading');
    elLoading.classList.add('hidden');
    showError('Falha ao conectar com o servidor.');
  };

  xhr.send();
}

/* ── KPIs ─────────────────────────────────────────────────────────────────── */
function renderKPIs(k) {
  var pct = k.pctMeta || 0;
  setText('kpi-pct-meta',    pct + '%');
  setText('kpi-sub-meta',    fmtN(k.atingiramMeta) + ' de ' + fmtN(k.totalPeriodo) + ' clientes no período');
  setText('kpi-com-tetra',   fmtN(k.atingiramMeta));
  setText('kpi-sub-periodo', 'de ' + fmtN(k.totalPeriodo) + ' no período');
  setText('kpi-total-qtde',  fmtN(k.totalQtdeTetra));
  elProgressFill.style.width = Math.min(pct, 100) + '%';
}

/* ── Ranking ──────────────────────────────────────────────────────────────── */
var medalhas = ['🥇', '🥈', '🥉']; // 🥇🥈🥉

function renderRanking() {
  var rows = rankingData.slice();

  rows.sort(function(a, b) {
    var va = (a[sortCol] !== null && a[sortCol] !== undefined) ? a[sortCol] : 0;
    var vb = (b[sortCol] !== null && b[sortCol] !== undefined) ? b[sortCol] : 0;
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });

  var ths = document.querySelectorAll('th.sortable');
  for (var h = 0; h < ths.length; h++) {
    ths[h].classList.remove('sort-asc', 'sort-desc');
    if (ths[h].getAttribute('data-col') === sortCol) {
      ths[h].classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  }

  if (!rows.length) {
    elTable.classList.add('hidden');
    elEmpty.classList.remove('hidden');
    return;
  }

  elEmpty.classList.add('hidden');
  elTable.classList.remove('hidden');

  var html = '';
  for (var i = 0; i < rows.length; i++) {
    var r   = rows[i];
    var pos = i + 1;
    var badge = pos <= 3
      ? '<span class="rank-medal">' + medalhas[i] + '</span>'
      : '<span class="rank-num">'   + pos + '</span>';

    var pctBar =
      '<div class="rank-pct-wrap">' +
        '<span class="rank-pct-num' + (r.pct >= 50 ? ' pct-high' : '') + '">' + r.pct + '%</span>' +
        '<div class="rank-bar">' +
          '<div class="rank-bar-fill" style="width:' + Math.min(r.pct, 100) + '%"></div>' +
        '</div>' +
      '</div>';

    html +=
      '<tr>' +
        '<td class="td-rank">' + badge + '</td>' +
        '<td class="td-vendedor">' + esc(r.rep_nome) + '</td>' +
        '<td class="td-num">' + fmtN(r.total) + '</td>' +
        '<td class="td-num td-meta' + (r.meta > 0 ? ' meta-pos' : '') + '">' + fmtN(r.meta) + '</td>' +
        '<td class="td-pct">' + pctBar + '</td>' +
      '</tr>';
  }
  elBody.innerHTML = html;
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */
function setText(id, val) {
  var el = document.getElementById(id);
  if (el) el.textContent = val;
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function showError(msg) {
  elLoading.classList.add('hidden');
  elAlertErrors.innerHTML = '<strong>Erro:</strong> ' + esc(msg);
  elAlertErrors.classList.remove('hidden');
}

/* ── Eventos ──────────────────────────────────────────────────────────────── */
elRefresh.addEventListener('click', loadData);

(function() {
  var ths = document.querySelectorAll('th.sortable');
  for (var i = 0; i < ths.length; i++) {
    (function(th) {
      th.addEventListener('click', function() {
        var col = th.getAttribute('data-col');
        if (sortCol === col) {
          sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          sortCol = col;
          sortDir = 'desc';
        }
        renderRanking();
      });
    })(ths[i]);
  }
})();

setInterval(loadData, 1800000);

loadData();
