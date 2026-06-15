/* relatorio.js — Detalhes por vendedor: ranking clicável → clientes 10+ e pedidos */

var vendedores = [];
var DATE_FROM  = '2026-06-02';
var DATE_TO    = '';   // vazio = sem limite final
var aberto     = {};   // controla quais vendedores estão expandidos

var elLoading     = document.getElementById('loading');
var elEmpty       = document.getElementById('empty-state');
var elTable       = document.getElementById('data-table');
var elBody        = document.getElementById('table-body');
var elAlertErrors = document.getElementById('alert-errors');
var elRefresh     = document.getElementById('btn-refresh');
var elDownload    = document.getElementById('btn-download');
var elHeaderSync  = document.getElementById('header-sync');
var elWinnerCard  = document.getElementById('winner-card');
var elWinnerName  = document.getElementById('winner-name');
var elWinnerSub   = document.getElementById('winner-sub');
var elHintClick   = document.getElementById('hint-click');
var elFrom        = document.getElementById('input-from');
var elTo          = document.getElementById('input-to');
var elApply       = document.getElementById('btn-apply');

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

/* ── Fetch ────────────────────────────────────────────────────────────────── */
function loadData() {
  elRefresh.classList.add('loading');
  elLoading.classList.remove('hidden');
  elEmpty.classList.add('hidden');
  elTable.classList.add('hidden');
  elWinnerCard.classList.add('hidden');
  elAlertErrors.classList.add('hidden');

  var url = '/api/clientes-tetra?from=' + DATE_FROM + (DATE_TO ? '&to=' + DATE_TO : '');
  var xhr = new XMLHttpRequest();
  xhr.open('GET', url, true);

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
          var periodo = 'A partir de ' + brDate(DATE_FROM) +
            (DATE_TO ? ' até ' + brDate(DATE_TO) : '');
          elHeaderSync.textContent =
            periodo + ' · Atualizado em ' +
            d.toLocaleDateString('pt-BR') + ' às ' +
            d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        }

        vendedores = json.vendedores || [];
        render();
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

/* ── Render ───────────────────────────────────────────────────────────────── */
function render() {
  if (!vendedores.length) {
    elTable.classList.add('hidden');
    elWinnerCard.classList.add('hidden');
    elHintClick.classList.add('hidden');
    elEmpty.classList.remove('hidden');
    return;
  }
  elEmpty.classList.add('hidden');
  elTable.classList.remove('hidden');
  elHintClick.classList.remove('hidden');

  // Vencedor em destaque (top 1)
  var w = vendedores[0];
  elWinnerName.textContent = w.rep_nome;
  elWinnerSub.textContent =
    fmtN(w.clientes_meta) + ' clientes com 10+ tetras · ' +
    w.pct + '% da base · ' + fmtN(w.qtde_tetra) + ' tetras';
  elWinnerCard.classList.remove('hidden');

  var html = '';
  for (var i = 0; i < vendedores.length; i++) {
    var g     = vendedores[i];
    var pos   = i + 1;
    var badge = '<span class="rank-num rank-pos-' + pos + '">' + pos + '</span>';
    var isOpen = !!aberto[g.rep_nome];

    // Linha do vendedor (clicável)
    html +=
      '<tr class="row-vendedor' + (isOpen ? ' is-open' : '') + '" data-rep="' + esc(g.rep_nome) + '">' +
        '<td class="td-rank">' + badge + '</td>' +
        '<td class="td-vendedor">' + esc(g.rep_nome) + '</td>' +
        '<td class="td-num meta-pos">' + fmtN(g.clientes_meta) + '</td>' +
        '<td class="td-num">' + g.pct + '%</td>' +
        '<td class="td-num">' + fmtN(g.qtde_tetra) + '</td>' +
        '<td class="td-center"><span class="chevron">' + (isOpen ? '&#9650;' : '&#9660;') + '</span></td>' +
      '</tr>';

    // Linha de detalhes (clientes do vendedor)
    var sub = '';
    for (var j = 0; j < g.clientes.length; j++) {
      var c = g.clientes[j];
      sub +=
        '<tr>' +
          '<td class="sub-pos">' + (j + 1) + '</td>' +
          '<td class="sub-cli">' + esc(c.cli_nome) + ' <span class="sub-emp">(' + esc(c.emp) + ')</span></td>' +
          '<td class="sub-qtd">' + fmtN(c.qtde_tetra) + ' tetras</td>' +
          '<td class="sub-ped">Pedido(s): ' + esc((c.pedidos || []).join(', ')) + '</td>' +
        '</tr>';
    }
    html +=
      '<tr class="row-detalhe' + (isOpen ? '' : ' hidden') + '" data-detail="' + esc(g.rep_nome) + '">' +
        '<td colspan="6" class="detalhe-cell">' +
          '<table class="sub-table"><tbody>' + sub + '</tbody></table>' +
        '</td>' +
      '</tr>';
  }
  elBody.innerHTML = html;
  bindRows();
}

function bindRows() {
  var rows = document.querySelectorAll('.row-vendedor');
  for (var i = 0; i < rows.length; i++) {
    rows[i].addEventListener('click', function() {
      var rep = this.getAttribute('data-rep');
      aberto[rep] = !aberto[rep];
      this.classList.toggle('is-open');
      var chev = this.querySelector('.chevron');
      if (chev) chev.innerHTML = aberto[rep] ? '&#9650;' : '&#9660;';
      var det = document.querySelector('.row-detalhe[data-detail="' + cssEsc(rep) + '"]');
      if (det) det.classList.toggle('hidden');
    });
  }
}

/* ── Download CSV (lista plana: vendedor → cliente → pedidos) ─────────────── */
function csvCell(v) {
  var s = (v == null) ? '' : String(v);
  return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function numBR(n) { return (Math.round((n || 0) * 100) / 100).toString().replace('.', ','); }

function baixarCSV() {
  if (!vendedores.length) { alert('Nada para baixar ainda.'); return; }
  var linhas = ['Posição Vendedor;Vendedor;% com 10+;Cliente;Empresa;Qtde Tetra;Valor Tetra (R$);Pedidos'];
  for (var i = 0; i < vendedores.length; i++) {
    var g = vendedores[i];
    for (var j = 0; j < g.clientes.length; j++) {
      var c = g.clientes[j];
      linhas.push([
        (i + 1),
        csvCell(g.rep_nome),
        numBR(g.pct),
        csvCell(c.cli_nome),
        csvCell(c.emp),
        numBR(c.qtde_tetra),
        numBR(c.valor_tetra),
        csvCell((c.pedidos || []).join(', '))
      ].join(';'));
    }
  }
  var conteudo = '﻿' + linhas.join('\r\n');
  var blob = new Blob([conteudo], { type: 'text/csv;charset=utf-8;' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href = url;
  a.download = 'detalhes-vendedores-tetra_' + DATE_FROM + (DATE_TO ? '_a_' + DATE_TO : '') + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */
function setText(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; }
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function cssEsc(str) { return String(str || '').replace(/"/g, '\\"'); }
function brDate(iso) {           // 'YYYY-MM-DD' -> 'DD/MM/AAAA'
  if (!iso) return '';
  var p = iso.split('-');
  return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso;
}
function hojeISO() {
  var d = new Date();
  var mm = String(d.getMonth() + 1);
  var dd = String(d.getDate());
  if (mm.length < 2) mm = '0' + mm;
  if (dd.length < 2) dd = '0' + dd;
  return d.getFullYear() + '-' + mm + '-' + dd;
}
function aplicarPeriodo() {
  var f = elFrom.value || '2026-06-02';
  var t = elTo.value   || '';
  if (t && t < f) { alert('A data final não pode ser anterior à inicial.'); return; }
  DATE_FROM = f;
  DATE_TO   = t;
  loadData();
}
function showError(msg) {
  elLoading.classList.add('hidden');
  elAlertErrors.innerHTML = '<strong>Erro:</strong> ' + esc(msg);
  elAlertErrors.classList.remove('hidden');
}

/* ── Eventos ──────────────────────────────────────────────────────────────── */
elRefresh.addEventListener('click', loadData);
elDownload.addEventListener('click', baixarCSV);
elApply.addEventListener('click', aplicarPeriodo);

// Inicializa campos: De = 02/06/2026, Até = hoje
elFrom.value = DATE_FROM;
elTo.value   = hojeISO();
DATE_TO      = elTo.value;

setInterval(loadData, 1800000);
loadData();
