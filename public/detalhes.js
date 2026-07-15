/* detalhes.js — ES5 puro: compatível com browsers antigos e novos */

var DATE_FROM = '2026-07-14';
var DATE_TO   = '2026-07-17';

var vendedoresData = [];
var pedidosData     = [];

var vendSortCol = 'pct';
var vendSortDir = 'desc';

var vendedoraAberta = ''; // rep_nome da linha expandida (accordion), vazio = nenhuma

var elAlertErrors  = document.getElementById('alert-errors');
var elHeaderSync   = document.getElementById('header-sync');
var elRefresh      = document.getElementById('btn-refresh');

var elVendLoading  = document.getElementById('vend-loading');
var elVendTable    = document.getElementById('vend-table');
var elVendBody     = document.getElementById('vend-body');

/* ── Formatadores ─────────────────────────────────────────────────────────── */
function fmtBRL(v) {
  v = v || 0;
  try { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  catch(e) { return 'R$ ' + v.toFixed(2).replace('.', ','); }
}

function fmtData(v) {
  if (!v) return '—';
  var d = new Date(v);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('pt-BR');
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function showError(msg) {
  elAlertErrors.innerHTML = '<strong>Erro:</strong> ' + esc(msg);
  elAlertErrors.classList.remove('hidden');
}

/* ── Fetch ────────────────────────────────────────────────────────────────── */
function loadData() {
  elRefresh.classList.add('loading');
  elVendLoading.classList.remove('hidden');
  elVendTable.classList.add('hidden');
  elAlertErrors.classList.add('hidden');

  var xhr = new XMLHttpRequest();
  xhr.open('GET', '/api/detalhes?from=' + DATE_FROM + '&to=' + DATE_TO + '&company=all', true);

  xhr.onreadystatechange = function() {
    if (xhr.readyState !== 4) return;

    elRefresh.classList.remove('loading');
    elVendLoading.classList.add('hidden');

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
            'Campanha 14/07/2026 a 17/07/2026 · Atualizado em ' +
            d.toLocaleDateString('pt-BR') + ' às ' +
            d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        }

        vendedoresData = json.vendedores || [];
        pedidosData     = json.pedidos     || [];

        renderVendedores();

      } catch(e) {
        showError('Erro ao processar resposta: ' + e.message);
      }
    } else {
      showError('Erro no servidor (status ' + xhr.status + ')');
    }
  };

  xhr.onerror = function() {
    elRefresh.classList.remove('loading');
    elVendLoading.classList.add('hidden');
    showError('Falha ao conectar com o servidor.');
  };

  xhr.send();
}

/* ── Pedidos de uma vendedora (regra "Outras Chaves" já aplicada no servidor) */
/* Um pedido pode ter várias linhas (uma por produto/chave) — agrupa por pedido e soma o valor. */
function pedidosDe(nome) {
  var porPedido = {};
  var itens = pedidosData.filter(function(p) { return p.rep_nome === nome; });

  for (var i = 0; i < itens.length; i++) {
    var p   = itens[i];
    var key = p.emp + '|' + p.pdv_numero;
    if (!porPedido[key]) {
      porPedido[key] = { emp: p.emp, pdv_numero: p.pdv_numero, pdv_data: p.pdv_data, valortotal: 0 };
    }
    porPedido[key].valortotal += p.valortotal || 0;
  }

  return Object.keys(porPedido)
    .map(function(k) { return porPedido[k]; })
    .sort(function(a, b) { return new Date(b.pdv_data) - new Date(a.pdv_data); });
}

function htmlPedidosExpandido(nome) {
  var lista = pedidosDe(nome);
  if (!lista.length) {
    return '<div class="pedidos-expand-empty">Nenhum pedido de Outras Chaves encontrado.</div>';
  }

  var html = '<table class="mini-table"><thead><tr>' +
    '<th>Pedido</th><th>Data</th><th>Empresa</th><th class="th-right">Valor</th>' +
    '</tr></thead><tbody>';

  for (var i = 0; i < lista.length; i++) {
    var p = lista[i];
    html +=
      '<tr>' +
        '<td>' + esc(p.pdv_numero) + '</td>' +
        '<td>' + fmtData(p.pdv_data) + '</td>' +
        '<td>' + esc(p.emp) + '</td>' +
        '<td class="td-right">' + fmtBRL(p.valortotal) + '</td>' +
      '</tr>';
  }

  html += '</tbody></table>';
  return html;
}

/* ── Tabela: Meta x Vendido por vendedora (com accordion de pedidos) ──────── */
function renderVendedores() {
  var rows = vendedoresData.slice();

  rows.sort(function(a, b) {
    var va = (a[vendSortCol] !== null && a[vendSortCol] !== undefined) ? a[vendSortCol] : 0;
    var vb = (b[vendSortCol] !== null && b[vendSortCol] !== undefined) ? b[vendSortCol] : 0;
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return vendSortDir === 'asc' ? -1 : 1;
    if (va > vb) return vendSortDir === 'asc' ?  1 : -1;
    return 0;
  });

  var html = '';
  for (var i = 0; i < rows.length; i++) {
    var r    = rows[i];
    var pos  = i + 1;
    var aberta = vendedoraAberta && vendedoraAberta === r.rep_nome;

    html +=
      '<tr class="row-click' + (aberta ? ' row-selected' : '') + '" data-vendedor="' + esc(r.rep_nome) + '" title="Ver pedidos de ' + esc(r.rep_nome) + '">' +
        '<td class="td-rank">' + pos + '</td>' +
        '<td class="td-vendedor">' + esc(r.rep_nome) + '</td>' +
        '<td class="td-num">' + fmtBRL(r.meta) + '</td>' +
        '<td class="td-num td-meta' + (r.pct >= 100 ? ' meta-pos' : '') + '">' + fmtBRL(r.vendido) + '</td>' +
        '<td class="td-num">' + r.pct + '%</td>' +
      '</tr>';

    if (aberta) {
      html +=
        '<tr class="expand-row">' +
          '<td colspan="5"><div class="pedidos-expand">' + htmlPedidosExpandido(r.rep_nome) + '</div></td>' +
        '</tr>';
    }
  }
  elVendBody.innerHTML = html;
  elVendTable.classList.remove('hidden');

  var trs = elVendBody.querySelectorAll('tr[data-vendedor]');
  for (var t = 0; t < trs.length; t++) {
    trs[t].addEventListener('click', onClickVendedora);
  }
}

function onClickVendedora() {
  var nome = this.getAttribute('data-vendedor');
  vendedoraAberta = (vendedoraAberta === nome) ? '' : nome;
  renderVendedores();
}

/* ── Eventos ──────────────────────────────────────────────────────────────── */
elRefresh.addEventListener('click', loadData);

(function() {
  var vendThs = document.querySelectorAll('#vend-table th.sortable');
  for (var i = 0; i < vendThs.length; i++) {
    (function(th) {
      th.addEventListener('click', function() {
        var col = th.getAttribute('data-col');
        if (vendSortCol === col) { vendSortDir = vendSortDir === 'asc' ? 'desc' : 'asc'; }
        else { vendSortCol = col; vendSortDir = 'desc'; }
        renderVendedores();
      });
    })(vendThs[i]);
  }
})();

loadData();
