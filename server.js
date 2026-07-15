require('dotenv').config();
const express  = require('express');
const Firebird = require('node-firebird');
const sql      = require('mssql');
const cors     = require('cors');
const path     = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0 }));

// ── Configs ──────────────────────────────────────────────────────────────────

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

function ssConfig(prefix) {
  return {
    server:   process.env[`${prefix}_HOST`],
    port:     parseInt(process.env[`${prefix}_PORT`]) || 1433,
    database: process.env[`${prefix}_DATABASE`],
    user:     process.env[`${prefix}_USER`],
    password: process.env[`${prefix}_PASSWORD`],
    options: {
      encrypt:                process.env[`${prefix}_ENCRYPT`] === 'true',
      trustServerCertificate: true,
      instanceName:           process.env[`${prefix}_INSTANCE`] || undefined,
    },
    connectionTimeout: 15000,
    requestTimeout:    60000,
  };
}

const cfgMG  = fbConfig('DB_MG');
const cfgSJC = fbConfig('DB_SJC');
const cfgOWN = ssConfig('DB_OWN');

function fbConfigured(cfg) { return !!(cfg.host && cfg.database); }
function ssConfigured(cfg) { return !!(cfg.server && cfg.database && cfg.user); }

// ── Firebird: query ──────────────────────────────────────────────────────────

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

// ── SQL Server: pool persistente ─────────────────────────────────────────────

let ownPool = null;

async function getOwnPool() {
  if (ownPool) return ownPool;
  ownPool = new sql.ConnectionPool(cfgOWN);
  ownPool.on('error', err => {
    console.error('Pool OWN error:', err.message);
    ownPool = null;
  });
  await ownPool.connect();
  return ownPool;
}

// ── SQL queries Firebird ─────────────────────────────────────────────────────

const SQL_FB_MG = `
  SELECT CAST('SPM' AS VARCHAR(5)) AS emp,
         r.rep_nome,
         pvi.pvi_pro_codigo,
         pro.pro_resumo,
         SUM(pvi.pvi_quantidade)  AS qtde,
         SUM(pvi.pvi_totalitem)   AS valortotal,
         p.pdv_numero,
         p.pdv_data,
         c.cli_codigo,
         c.cli_nome,
         t.nome                  AS subgrupo,
         s.nome                  AS familia,
         pro.pro_tipo
  FROM pedidos_vendas p
  INNER JOIN pedidos_vendas_itens pvi ON pvi.pvi_numero     = p.pdv_numero
  INNER JOIN produtos             pro ON pro.pro_codigo      = pvi.pvi_pro_codigo
  INNER JOIN representantes       r   ON r.rep_codigo        = p.pdv_rep_codigo
  INNER JOIN clientes             c   ON c.cli_codigo        = p.pdv_cli_codigo
  LEFT  JOIN produtos_nivel2      t   ON t.codigo            = pro.pro_nivel2
  LEFT  JOIN produtos_nivel3      s   ON s.codigo            = pro.pro_nivel3
  WHERE p.pdv_data            >= ?
  AND   p.pdv_data            <= ?
  AND   p.pdv_psi_codigo       IN ('FF','AA')
  AND   p.pdv_tve_codigo   NOT IN ('7','6','26','34')
  AND   r.rep_rvs_codigo       IN ('1','16')
  AND   r.rep_nome         NOT LIKE '%IVANILDO%'
  AND   r.rep_nome         NOT LIKE '%JUCELIA%'
  AND   r.rep_nome         NOT LIKE '%VICTOR HUGO%'
  AND   pro.pro_nivel2 = 1
  AND   pro.pro_nivel3 NOT IN ('1')
  GROUP BY r.rep_nome, pvi.pvi_pro_codigo, pro.pro_resumo,
           p.pdv_numero, p.pdv_data, c.cli_codigo, c.cli_nome, t.nome, s.nome, pro.pro_tipo
`;

const SQL_FB_SJC = `
  SELECT CAST('SJC' AS VARCHAR(5)) AS emp,
         r.rep_nome,
         pvi.pvi_pro_codigo,
         pro.pro_resumo,
         SUM(pvi.pvi_quantidade)  AS qtde,
         SUM(pvi.pvi_totalitem)   AS valortotal,
         p.pdv_numero,
         p.pdv_data,
         c.cli_codigo,
         c.cli_nome,
         t.nome                  AS subgrupo,
         s.nome                  AS familia,
         pro.pro_tipo
  FROM pedidos_vendas p
  INNER JOIN pedidos_vendas_itens pvi ON pvi.pvi_numero     = p.pdv_numero
  INNER JOIN produtos             pro ON pro.pro_codigo      = pvi.pvi_pro_codigo
  INNER JOIN representantes       r   ON r.rep_codigo        = p.pdv_rep_codigo
  INNER JOIN clientes             c   ON c.cli_codigo        = p.pdv_cli_codigo
  LEFT  JOIN produtos_nivel2      t   ON t.codigo            = pro.pro_nivel2
  LEFT  JOIN produtos_nivel3      s   ON s.codigo            = pro.pro_nivel3
  WHERE p.pdv_data            >= ?
  AND   p.pdv_data            <= ?
  AND   p.pdv_psi_codigo       IN ('FF','AA')
  AND   p.pdv_tve_codigo   NOT IN ('7','6','26','34')
  AND   r.rep_rvs_codigo       IN ('1','16')
  AND   r.rep_nome         NOT LIKE '%IVANILDO%'
  AND   pro.pro_nivel2 = 1
  AND   pro.pro_nivel3 NOT IN ('1')
  GROUP BY r.rep_nome, pvi.pvi_pro_codigo, pro.pro_resumo,
           p.pdv_numero, p.pdv_data, c.cli_codigo, c.cli_nome, t.nome, s.nome, pro.pro_tipo
`;

// ── Campanha "Outras Chaves" ─────────────────────────────────────────────────

const CAMPANHA_INICIO = '2026-07-14';
const CAMPANHA_FIM    = '2026-07-17';

// Metas de valor (R$) por vendedor no período da campanha
const METAS_VENDEDOR = {
  'TELEVENDAS DANIELA SILVA':   500,
  'TELEVENDAS DEBORA':          3200,
  'TELEVENDAS ISABELLA RODRIGUES':  800,
  'TELEVENDAS LAIS':            5600,
  'TELEVENDAS LUCIMARA':        5600,
  'TELEVENDAS MARIA SAMARA':     800,
  'TELEVENDAS NAIARA':          5600,
  'TELEVENDAS POLIANA RODRIGUES':  4800,
  'TELEVENDAS SERGIO':          4800,
  'TELEVENDAS SUELI FERREIRA':  4000,
  'TELEVENDAS SUELIN':          6400,
  'TELEVENDAS ANA ROSA':         500,
  'TELEVENDAS INGRID PRADO':     500,
  'TELEVENDAS NADIA APARECIDA': 1250,
  'TELEVENDAS NATHALIA ALMEIDA': 3100,
  'TELEVENDAS REBECA PEREIRA':   500,
  'TELEVENDAS SUZANA FRANCINE': 3400,
  'TELEVENDAS ELLEN MATOS':      500,
  'TELEVENDAS ELLEN VITORIA':    500,
};

function normRep(nome) {
  return String(nome || '').trim().toUpperCase();
}

// ── Cria tabela no SQL Server (se não existir) ───────────────────────────────

const DDL = `
IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name='TI-DIRETORIA_VendasTetra' AND xtype='U')
BEGIN
  CREATE TABLE [TI-DIRETORIA_VendasTetra] (
    id              BIGINT IDENTITY(1,1) PRIMARY KEY,
    emp             VARCHAR(5)      NOT NULL,
    rep_nome        NVARCHAR(150),
    pvi_pro_codigo  VARCHAR(30),
    pro_resumo      NVARCHAR(200),
    qtde            DECIMAL(15,4),
    valortotal      DECIMAL(15,2),
    pdv_numero      VARCHAR(30),
    pdv_data        DATE,
    cli_codigo      VARCHAR(30),
    cli_nome        NVARCHAR(200),
    subgrupo        NVARCHAR(100),
    familia         NVARCHAR(100),
    sincronizado_em DATETIME2 DEFAULT GETDATE()
  );
  CREATE INDEX IX_vts_data     ON [TI-DIRETORIA_VendasTetra] (pdv_data);
  CREATE INDEX IX_vts_emp_data ON [TI-DIRETORIA_VendasTetra] (emp, pdv_data);
END;

IF NOT EXISTS (SELECT 1 FROM sys.columns
               WHERE object_id = OBJECT_ID('[TI-DIRETORIA_VendasTetra]')
               AND   name = 'subgrupo')
  ALTER TABLE [TI-DIRETORIA_VendasTetra] ADD subgrupo NVARCHAR(100);

IF NOT EXISTS (SELECT 1 FROM sys.columns
               WHERE object_id = OBJECT_ID('[TI-DIRETORIA_VendasTetra]')
               AND   name = 'familia')
  ALTER TABLE [TI-DIRETORIA_VendasTetra] ADD familia NVARCHAR(100);

IF NOT EXISTS (SELECT 1 FROM sys.columns
               WHERE object_id = OBJECT_ID('[TI-DIRETORIA_VendasTetra]')
               AND   name = 'sincronizado_em')
  ALTER TABLE [TI-DIRETORIA_VendasTetra] ADD sincronizado_em DATETIME2 DEFAULT GETDATE();
`;

async function ensureTable() {
  if (!ssConfigured(cfgOWN)) return;
  try {
    const pool = await getOwnPool();
    await pool.request().query(DDL);
    console.log('✓ Tabela TI-DIRETORIA_VendasTetra verificada no SQL Server.');
  } catch (e) {
    console.error('Erro ao verificar tabela:', e.message);
  }
}

// ── Sincroniza Firebird → SQL Server ─────────────────────────────────────────

// Converte para string truncada no limite da coluna (evita erro de tamanho)
function str(v, max) {
  if (v == null) return null;
  const s = String(v).trim();
  return max ? s.slice(0, max) : s;
}

async function syncToOwn(rows, dateFrom, dateTo) {
  if (!ssConfigured(cfgOWN)) return [];
  if (!rows.length) return [];

  // Pool exclusivo para o sync — evita contaminar o pool de leitura
  const pool = new sql.ConnectionPool(cfgOWN);
  await pool.connect();

  // Limpa período
  await pool.request()
    .input('dateFrom', sql.DateTime, dateFrom)
    .input('dateTo',   sql.DateTime, dateTo)
    .query(`DELETE FROM [TI-DIRETORIA_VendasTetra] WHERE pdv_data >= @dateFrom AND pdv_data <= @dateTo`);

  // Monta linhas para inserção
  const prepared = rows.map(r => ({
    emp:            str(r.emp, 5)            ?? '',
    rep_nome:       str(r.rep_nome, 150),
    pvi_pro_codigo: str(r.pvi_pro_codigo, 30),
    pro_resumo:     str(r.pro_resumo, 200),
    qtde:           r.qtde       != null ? parseFloat(r.qtde)       : null,
    valortotal:     r.valortotal != null ? parseFloat(r.valortotal) : null,
    pdv_numero:     str(r.pdv_numero, 30),
    pdv_data:       r.pdv_data ? new Date(r.pdv_data) : null,
    cli_codigo:     str(r.cli_codigo, 30),
    cli_nome:       str(r.cli_nome, 200),
    subgrupo:       str(r.subgrupo, 100),
    familia:        str(r.familia, 100),
  }));

  // Insere em lotes de 20 (evita timeout e problemas de conexão)
  const BATCH = 20;
  const errosSinc = [];
  let ok = 0;

  for (let i = 0; i < prepared.length; i += BATCH) {
    const lote = prepared.slice(i, i + BATCH);
    const req   = pool.request();
    const vals  = lote.map((r, j) => {
      const n = i + j;
      req.input(`emp${n}`,  sql.VarChar(5),     r.emp);
      req.input(`rep${n}`,  sql.NVarChar(150),  r.rep_nome);
      req.input(`pro${n}`,  sql.VarChar(30),    r.pvi_pro_codigo);
      req.input(`res${n}`,  sql.NVarChar(200),  r.pro_resumo);
      req.input(`qty${n}`,  sql.Decimal(15,4),  r.qtde);
      req.input(`val${n}`,  sql.Decimal(15,2),  r.valortotal);
      req.input(`num${n}`,  sql.VarChar(30),    r.pdv_numero);
      req.input(`dat${n}`,  sql.Date,           r.pdv_data);
      req.input(`cod${n}`,  sql.VarChar(30),    r.cli_codigo);
      req.input(`cli${n}`,  sql.NVarChar(200),  r.cli_nome);
      req.input(`sub${n}`,  sql.NVarChar(100),  r.subgrupo);
      req.input(`fam${n}`,  sql.NVarChar(100),  r.familia);
      return `(@emp${n},@rep${n},@pro${n},@res${n},@qty${n},@val${n},@num${n},@dat${n},@cod${n},@cli${n},@sub${n},@fam${n})`;
    }).join(',');

    try {
      await req.query(`
        INSERT INTO [TI-DIRETORIA_VendasTetra]
          (emp,rep_nome,pvi_pro_codigo,pro_resumo,qtde,valortotal,pdv_numero,pdv_data,cli_codigo,cli_nome,subgrupo,familia)
        VALUES ${vals}
      `);
      ok += lote.length;
    } catch (e) {
      const msg = `Lote ${Math.floor(i/BATCH)+1} (linhas ${i+1}-${i+lote.length}): ${e.message}`;
      errosSinc.push(msg);
      console.error('[sync]', msg);

      // Tenta linha a linha como fallback
      for (const r of lote) {
        try {
          await pool.request()
            .input('e', sql.VarChar(5),    r.emp)
            .input('r', sql.NVarChar(150), r.rep_nome)
            .input('p', sql.VarChar(30),   r.pvi_pro_codigo)
            .input('s', sql.NVarChar(200), r.pro_resumo)
            .input('q', sql.Decimal(15,4), r.qtde)
            .input('v', sql.Decimal(15,2), r.valortotal)
            .input('n', sql.VarChar(30),   r.pdv_numero)
            .input('d', sql.Date,          r.pdv_data)
            .input('c', sql.VarChar(30),   r.cli_codigo)
            .input('l', sql.NVarChar(200), r.cli_nome)
            .input('g', sql.NVarChar(100), r.subgrupo)
            .input('f', sql.NVarChar(100), r.familia)
            .query(`
              INSERT INTO [TI-DIRETORIA_VendasTetra]
                (emp,rep_nome,pvi_pro_codigo,pro_resumo,qtde,valortotal,pdv_numero,pdv_data,cli_codigo,cli_nome,subgrupo,familia)
              VALUES (@e,@r,@p,@s,@q,@v,@n,@d,@c,@l,@g,@f)
            `);
          ok++;
        } catch (e2) {
          console.error(`[sync] linha falhou (${r.cli_nome}/${r.subgrupo}): ${e2.message}`);
        }
      }
    }
  }

  console.log(`[sync] ${ok}/${prepared.length} linhas inseridas.`);
  await pool.close();
  return errosSinc;
}

// ── Lê do SQL Server ─────────────────────────────────────────────────────────

async function readFromOwn(dateParam, company) {
  const pool = await getOwnPool();
  const req  = pool.request().input('dateFrom', sql.DateTime, dateParam);

  let where = 'WHERE pdv_data >= @dateFrom';
  if (company === 'mg')  { req.input('emp', sql.VarChar(5), 'SPM'); where += ' AND emp = @emp'; }
  if (company === 'sjc') { req.input('emp', sql.VarChar(5), 'SJC'); where += ' AND emp = @emp'; }

  const result = await req.query(`
    SELECT emp, rep_nome, pvi_pro_codigo, pro_resumo, qtde, valortotal,
           pdv_numero, pdv_data, cli_codigo, cli_nome, subgrupo
    FROM [TI-DIRETORIA_VendasTetra]
    ${where}
  `);
  return result.recordset;
}

// ── Filtro "Outras Chaves" (o SQL já restringe a nivel2=1 / nivel3<>1) ───────

function isOutrasChaves(pro_tipo) {
  return String(pro_tipo || '').toUpperCase() === 'PA';
}

// ── Busca Firebird (MG/SJC) + sincroniza em segundo plano ───────────────────

async function buscarVendas(from, to, company) {
  const dateFrom = new Date(`${from}T00:00:00`);
  const dateTo   = new Date(`${to}T23:59:59`);
  if (isNaN(dateFrom) || isNaN(dateTo)) throw new Error('Data inválida. Use YYYY-MM-DD.');

  const erros   = [];
  let allRows   = [];
  const tasks   = [];

  if (company === 'mg' || company === 'all') {
    if (fbConfigured(cfgMG)) {
      tasks.push(
        queryFirebird(cfgMG, SQL_FB_MG, [dateFrom, dateTo])
          .then(rows => { allRows = allRows.concat(rows); })
          .catch(e => erros.push(e.message))
      );
    } else {
      erros.push('MG: DB_MG_HOST ou DB_MG_DATABASE não configurado.');
    }
  }

  if (company === 'sjc' || company === 'all') {
    if (fbConfigured(cfgSJC)) {
      tasks.push(
        queryFirebird(cfgSJC, SQL_FB_SJC, [dateFrom, dateTo])
          .then(rows => { allRows = allRows.concat(rows); })
          .catch(e => erros.push(e.message))
      );
    } else {
      erros.push('SJC: DB_SJC_HOST ou DB_SJC_DATABASE não configurado.');
    }
  }

  await Promise.all(tasks);

  console.log(`[FB] ${allRows.length} linhas | ${[...new Set(allRows.map(r=>`${r.emp}|${r.cli_codigo}`))].length} clientes`);

  if (ssConfigured(cfgOWN) && allRows.length > 0) {
    syncToOwn([...allRows], dateFrom, dateTo).catch(e =>
      console.error('[sync bg]', e.message)
    );
  }

  return { erros, rows: allRows };
}

// Ranking por vendedor: % da meta de valor (R$) batida no período
function calcularRanking(rows) {
  const vendMap = {};
  for (const nome in METAS_VENDEDOR) {
    vendMap[normRep(nome)] = { rep_nome: nome.trim(), meta: METAS_VENDEDOR[nome], vendido: 0 };
  }
  for (const r of rows) {
    if (!isOutrasChaves(r.pro_tipo)) continue;
    const k = normRep(r.rep_nome);
    if (!vendMap[k]) vendMap[k] = { rep_nome: str(r.rep_nome, 150), meta: 0, vendido: 0 };
    vendMap[k].vendido += parseFloat(r.valortotal) || 0;
  }
  return Object.values(vendMap).map(r => ({
    rep_nome: r.rep_nome,
    meta:     r.meta,
    vendido:  +r.vendido.toFixed(2),
    pct:      r.meta > 0 ? +((r.vendido / r.meta) * 100).toFixed(1) : 0,
  })).sort((a, b) => b.pct - a.pct);
}

// ── Endpoint /api/vendas (ranking resumido) ──────────────────────────────────

app.get('/api/vendas', async (req, res) => {
  const from    = req.query.from    || CAMPANHA_INICIO;
  const to      = req.query.to      || CAMPANHA_FIM;
  const company = (req.query.company || 'all').toLowerCase();

  let dados;
  try {
    dados = await buscarVendas(from, to, company);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const ranking = calcularRanking(dados.rows);

  const totalMeta    = ranking.reduce((s, r) => s + r.meta, 0);
  const totalVendido = ranking.reduce((s, r) => s + r.vendido, 0);
  const pctGeral      = totalMeta > 0 ? +((totalVendido / totalMeta) * 100).toFixed(1) : 0;
  const bateramMeta   = ranking.filter(r => r.pct >= 100).length;

  res.json({
    erros: dados.erros,
    sincronizado_em: new Date().toISOString(),
    kpis: {
      pctGeral,
      bateramMeta,
      totalVendedores: ranking.length,
      totalVendido,
      totalMeta,
    },
    ranking,   // ranking por vendedor, pronto para exibir
  });
});

// ── Endpoint /api/detalhes (por pedido, para análise) ────────────────────────

app.get('/api/detalhes', async (req, res) => {
  const from    = req.query.from    || CAMPANHA_INICIO;
  const to      = req.query.to      || CAMPANHA_FIM;
  const company = (req.query.company || 'all').toLowerCase();

  let dados;
  try {
    dados = await buscarVendas(from, to, company);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const rowsCampanha = dados.rows.filter(r => isOutrasChaves(r.pro_tipo));

  const pedidos = rowsCampanha
    .map(r => ({
      emp:        str(r.emp, 5),
      pdv_numero: r.pdv_numero,
      pdv_data:   r.pdv_data,
      rep_nome:   str(r.rep_nome, 150),
      cli_codigo: r.cli_codigo,
      cli_nome:   str(r.cli_nome, 200),
      pro_resumo: str(r.pro_resumo, 200),
      subgrupo:   str(r.subgrupo, 100),
      familia:    str(r.familia, 100),
      qtde:       parseFloat(r.qtde)       || 0,
      valortotal: parseFloat(r.valortotal) || 0,
    }))
    .sort((a, b) => new Date(b.pdv_data) - new Date(a.pdv_data));

  res.json({
    erros: dados.erros,
    sincronizado_em: new Date().toISOString(),
    vendedores: calcularRanking(dados.rows), // meta, vendido, pct por vendedora
    pedidos,
  });
});

app.get('/api/status', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ── Diagnóstico ───────────────────────────────────────────────────────────────

app.get('/api/debug', async (req, res) => {
  const from     = req.query.from || CAMPANHA_INICIO;
  const to       = req.query.to   || CAMPANHA_FIM;
  const dateFrom = new Date(`${from}T00:00:00`);
  const dateTo   = new Date(`${to}T23:59:59`);
  const resultado = {};

  // Firebird MG
  if (fbConfigured(cfgMG)) {
    try {
      const rows = await queryFirebird(cfgMG, SQL_FB_MG, [dateFrom, dateTo]);
      const clientes = [...new Set(rows.map(r => r.cli_codigo))];
      resultado.firebird_mg = { linhas: rows.length, clientes: clientes.length, lista_clientes: rows.map(r => ({ cli_codigo: r.cli_codigo, cli_nome: r.cli_nome, subgrupo: r.subgrupo, familia: r.familia, qtde: r.qtde })) };
    } catch (e) {
      resultado.firebird_mg = { erro: e.message };
    }
  } else {
    resultado.firebird_mg = { erro: 'não configurado' };
  }

  // Firebird SJC
  if (fbConfigured(cfgSJC)) {
    try {
      const rows = await queryFirebird(cfgSJC, SQL_FB_SJC, [dateFrom, dateTo]);
      const clientes = [...new Set(rows.map(r => r.cli_codigo))];
      resultado.firebird_sjc = { linhas: rows.length, clientes: clientes.length, lista_clientes: rows.map(r => ({ cli_codigo: r.cli_codigo, cli_nome: r.cli_nome, subgrupo: r.subgrupo, familia: r.familia, qtde: r.qtde })) };
    } catch (e) {
      resultado.firebird_sjc = { erro: e.message };
    }
  } else {
    resultado.firebird_sjc = { erro: 'não configurado' };
  }

  // SQL Server OWN
  if (ssConfigured(cfgOWN)) {
    try {
      const pool   = await getOwnPool();
      const result = await pool.request()
        .input('dateFrom', sql.DateTime, dateFrom)
        .input('dateTo',   sql.DateTime, dateTo)
        .query(`
          SELECT emp, cli_codigo, cli_nome,
                 COUNT(*)   AS linhas,
                 SUM(qtde)  AS qtde_total,
                 MAX(subgrupo) AS ultimo_subgrupo,
                 MAX(familia)  AS ultima_familia
          FROM [TI-DIRETORIA_VendasTetra]
          WHERE pdv_data >= @dateFrom AND pdv_data <= @dateTo
          GROUP BY emp, cli_codigo, cli_nome
          ORDER BY emp, cli_nome
        `);
      resultado.sql_server_own = { clientes: result.recordset.length, detalhe: result.recordset };
    } catch (e) {
      resultado.sql_server_own = { erro: e.message };
    }
  } else {
    resultado.sql_server_own = { erro: 'não configurado' };
  }

  res.json(resultado);
});

// ── Start ─────────────────────────────────────────────────────────────────────

(async () => {
  await ensureTable();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✓ Painel Outras Chaves rodando em http://0.0.0.0:${PORT}`);
    console.log(`  Acesso local:  http://localhost:${PORT}\n`);
  });
})();
