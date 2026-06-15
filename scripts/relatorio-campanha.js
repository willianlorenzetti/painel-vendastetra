// Relatório da campanha Chave Tetra → CSV (abre no Excel)
// Clientes com 10+ tetras, com vendedor e número(s) de pedido, do top 1 pra baixo.
require('dotenv').config();
const Firebird = require('node-firebird');
const fs   = require('fs');
const path = require('path');

const DATA_INICIO = process.argv[2] || '2026-06-02';

function fbConfig(prefix) {
  return {
    host:           process.env[`${prefix}_HOST`],
    port:           parseInt(process.env[`${prefix}_PORT`]) || 3050,
    database:       process.env[`${prefix}_DATABASE`],
    user:           process.env[`${prefix}_USER`]     || 'SYSDBA',
    password:       process.env[`${prefix}_PASSWORD`] || '',
    lowercase_keys: true,
    role:           null,
    pageSize:       4096,
  };
}

function queryFirebird(cfg, querySql, params) {
  return new Promise((resolve, reject) => {
    Firebird.attach(cfg, (err, db) => {
      if (err) return reject(new Error(`FB connect (${cfg.host}): ${err.message}`));
      db.query(querySql, params, (err, rows) => {
        db.detach();
        if (err) return reject(new Error(`FB query (${cfg.host}): ${err.message}`));
        resolve(rows || []);
      });
    });
  });
}

const SQL = emp => `
  SELECT CAST('${emp}' AS VARCHAR(5)) AS emp,
         r.rep_nome, pvi.pvi_pro_codigo, pro.pro_resumo,
         SUM(pvi.pvi_quantidade) AS qtde,
         SUM(pvi.pvi_totalitem)  AS valortotal,
         p.pdv_numero, p.pdv_data, c.cli_codigo, c.cli_nome,
         s.nome AS subgrupo, pro.pro_tipo
  FROM pedidos_vendas p
  INNER JOIN pedidos_vendas_itens pvi ON pvi.pvi_numero = p.pdv_numero
  INNER JOIN produtos             pro ON pro.pro_codigo = pvi.pvi_pro_codigo
  INNER JOIN representantes       r   ON r.rep_codigo   = p.pdv_rep_codigo
  INNER JOIN clientes             c   ON c.cli_codigo   = p.pdv_cli_codigo
  LEFT  JOIN produtos_nivel3      s   ON s.codigo       = pro.pro_nivel3
  WHERE p.pdv_data          >= ?
  AND   p.pdv_psi_codigo     IN ('FF','AA')
  AND   p.pdv_tve_codigo NOT IN ('7','6','26','34')
  AND   r.rep_rvs_codigo     IN ('1','16')
  ${emp === 'SPM'
    ? `AND r.rep_nome NOT LIKE '%IVANILDO%' AND r.rep_nome NOT LIKE '%JUCELIA%' AND r.rep_nome NOT LIKE '%VICTOR HUGO%'`
    : `AND r.rep_nome NOT LIKE '%IVANILDO%'`}
  GROUP BY r.rep_nome, pvi.pvi_pro_codigo, pro.pro_resumo,
           p.pdv_numero, p.pdv_data, c.cli_codigo, c.cli_nome, s.nome, pro.pro_tipo
`;

const isTetra = (sub, tipo) =>
  sub && String(sub).toUpperCase().includes('TETRA') &&
  String(tipo || '').toUpperCase() === 'PA';

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const num = n => (Math.round(n * 100) / 100).toString().replace('.', ',');

(async () => {
  const dateParam = new Date(`${DATA_INICIO}T00:00:00`);
  const rows = [];

  for (const emp of ['SPM', 'SJC']) {
    const prefix = emp === 'SPM' ? 'DB_MG' : 'DB_SJC';
    try {
      const r = await queryFirebird(fbConfig(prefix), SQL(emp), [dateParam]);
      rows.push(...r);
      console.log(`[${emp}] ${r.length} linhas`);
    } catch (e) {
      console.error(`[${emp}] ERRO: ${e.message}`);
    }
  }

  // Agrega por cliente
  const map = {};
  for (const r of rows) {
    const key = `${r.emp}||${r.cli_codigo}`;
    if (!map[key]) {
      map[key] = {
        emp: r.emp, rep_nome: r.rep_nome,
        cli_codigo: r.cli_codigo, cli_nome: r.cli_nome,
        qtde_tetra: 0, valor_tetra: 0, pedidos: new Set(),
      };
    }
    if (isTetra(r.subgrupo, r.pro_tipo)) {
      const c = map[key];
      c.qtde_tetra  += parseFloat(r.qtde)       || 0;
      c.valor_tetra += parseFloat(r.valortotal) || 0;
      if (r.pdv_numero != null) c.pedidos.add(String(r.pdv_numero));
    }
  }

  const lista = Object.values(map)
    .filter(c => c.qtde_tetra >= 10)
    .sort((a, b) => b.qtde_tetra - a.qtde_tetra);

  // Monta CSV
  const header = ['Posição', 'Empresa', 'Vendedor', 'Cliente', 'Qtde Tetra', 'Valor Tetra (R$)', 'Pedidos'];
  const linhas = [header.join(';')];
  lista.forEach((c, i) => {
    linhas.push([
      i + 1,
      c.emp,
      csvCell(c.rep_nome),
      csvCell(c.cli_nome),
      num(c.qtde_tetra),
      num(c.valor_tetra),
      csvCell([...c.pedidos].sort((a, b) => Number(a) - Number(b)).join(', ')),
    ].join(';'));
  });

  const out = path.join(__dirname, '..', `relatorio-campanha-tetra_${DATA_INICIO}.csv`);
  fs.writeFileSync(out, '﻿' + linhas.join('\r\n'), 'utf8');

  console.log(`\n✓ ${lista.length} clientes com 10+ tetras`);
  console.log(`✓ Arquivo: ${out}`);
})();
