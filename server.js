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
app.use(express.static(path.join(__dirname, 'public')));

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
         s.nome                  AS subgrupo
  FROM pedidos_vendas p
  INNER JOIN pedidos_vendas_itens pvi ON pvi.pvi_numero     = p.pdv_numero
  INNER JOIN produtos             pro ON pro.pro_codigo      = pvi.pvi_pro_codigo
  INNER JOIN representantes       r   ON r.rep_codigo        = p.pdv_rep_codigo
  INNER JOIN clientes             c   ON c.cli_codigo        = p.pdv_cli_codigo
  LEFT  JOIN produtos_nivel3      s   ON s.codigo            = pro.pro_nivel3
  WHERE p.pdv_data            >= ?
  AND   p.pdv_psi_codigo       IN ('FF','AA')
  AND   p.pdv_tve_codigo   NOT IN ('7','6','26','34')
  AND   r.rep_rvs_codigo       IN ('1','16')
  GROUP BY r.rep_nome, pvi.pvi_pro_codigo, pro.pro_resumo,
           p.pdv_numero, p.pdv_data, c.cli_codigo, c.cli_nome, s.nome
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
         s.nome                  AS subgrupo
  FROM pedidos_vendas p
  INNER JOIN pedidos_vendas_itens pvi ON pvi.pvi_numero     = p.pdv_numero
  INNER JOIN produtos             pro ON pro.pro_codigo      = pvi.pvi_pro_codigo
  INNER JOIN representantes       r   ON r.rep_codigo        = p.pdv_rep_codigo
  INNER JOIN clientes             c   ON c.cli_codigo        = p.pdv_cli_codigo
  LEFT  JOIN produtos_nivel3      s   ON s.codigo            = pro.pro_nivel3
  WHERE p.pdv_data            >= ?
  AND   p.pdv_psi_codigo       IN ('FF','AA')
  AND   p.pdv_tve_codigo   NOT IN ('7','6','26','34')
  AND   r.rep_rvs_codigo       IN ('1','16')
  GROUP BY r.rep_nome, pvi.pvi_pro_codigo, pro.pro_resumo,
           p.pdv_numero, p.pdv_data, c.cli_codigo, c.cli_nome, s.nome
`;

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
    sincronizado_em DATETIME2 DEFAULT GETDATE()
  );
  CREATE INDEX IX_vts_data     ON [TI-DIRETORIA_VendasTetra] (pdv_data);
  CREATE INDEX IX_vts_emp_data ON [TI-DIRETORIA_VendasTetra] (emp, pdv_data);
  PRINT 'Tabela TI-DIRETORIA_VendasTetra criada.';
END
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

async function syncToOwn(rows, dateParam) {
  if (!ssConfigured(cfgOWN)) return;
  if (!rows.length) return;

  const pool = await getOwnPool();

  await pool.request()
    .input('dateFrom', sql.DateTime, dateParam)
    .query(`DELETE FROM [TI-DIRETORIA_VendasTetra] WHERE pdv_data >= @dateFrom`);

  const ps = new sql.PreparedStatement(pool);
  ps.input('emp',            sql.VarChar(5));
  ps.input('rep_nome',       sql.NVarChar(150));
  ps.input('pvi_pro_codigo', sql.VarChar(30));
  ps.input('pro_resumo',     sql.NVarChar(200));
  ps.input('qtde',           sql.Decimal(15, 4));
  ps.input('valortotal',     sql.Decimal(15, 2));
  ps.input('pdv_numero',     sql.VarChar(30));
  ps.input('pdv_data',       sql.Date);
  ps.input('cli_codigo',     sql.VarChar(30));
  ps.input('cli_nome',       sql.NVarChar(200));
  ps.input('subgrupo',       sql.NVarChar(100));

  await ps.prepare(`
    INSERT INTO [TI-DIRETORIA_VendasTetra]
      (emp, rep_nome, pvi_pro_codigo, pro_resumo, qtde, valortotal,
       pdv_numero, pdv_data, cli_codigo, cli_nome, subgrupo)
    VALUES
      (@emp, @rep_nome, @pvi_pro_codigo, @pro_resumo, @qtde, @valortotal,
       @pdv_numero, @pdv_data, @cli_codigo, @cli_nome, @subgrupo)
  `);

  try {
    for (const r of rows) {
      await ps.execute({
        emp:            r.emp,
        rep_nome:       r.rep_nome       || null,
        pvi_pro_codigo: r.pvi_pro_codigo || null,
        pro_resumo:     r.pro_resumo     || null,
        qtde:           r.qtde      != null ? parseFloat(r.qtde)      : null,
        valortotal:     r.valortotal!= null ? parseFloat(r.valortotal): null,
        pdv_numero:     r.pdv_numero     || null,
        pdv_data:       r.pdv_data ? new Date(r.pdv_data) : null,
        cli_codigo:     r.cli_codigo     || null,
        cli_nome:       r.cli_nome       || null,
        subgrupo:       r.subgrupo       || null,
      });
    }
  } finally {
    await ps.unprepare();
  }
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

// ── Agrega por cliente ────────────────────────────────────────────────────────

function isTetra(subgrupo) {
  return subgrupo && String(subgrupo).toUpperCase().includes('TETRA');
}

function aggregate(rows) {
  const map = {};
  for (const r of rows) {
    const key = `${r.emp}||${r.cli_codigo}`;
    if (!map[key]) {
      map[key] = {
        emp:         r.emp,
        rep_nome:    r.rep_nome,
        cli_codigo:  r.cli_codigo,
        cli_nome:    r.cli_nome,
        qtde_tetra:  0,
        valor_tetra: 0,
        valor_total: 0,
      };
    }
    const c = map[key];
    c.valor_total += parseFloat(r.valortotal) || 0;
    if (isTetra(r.subgrupo)) {
      c.qtde_tetra  += parseFloat(r.qtde)       || 0;
      c.valor_tetra += parseFloat(r.valortotal)  || 0;
    }
  }
  return Object.values(map);
}

// ── Endpoint /api/vendas ──────────────────────────────────────────────────────

app.get('/api/vendas', async (req, res) => {
  const from    = req.query.from    || '2026-06-01';
  const company = (req.query.company || 'all').toLowerCase();

  const dateParam = new Date(`${from}T00:00:00`);
  if (isNaN(dateParam)) return res.status(400).json({ error: 'Data inválida. Use YYYY-MM-DD.' });

  const erros   = [];
  let allRows   = [];
  const tasks   = [];

  // 1) Busca no Firebird MG
  if (company === 'mg' || company === 'all') {
    if (fbConfigured(cfgMG)) {
      tasks.push(
        queryFirebird(cfgMG, SQL_FB_MG, [dateParam])
          .then(rows => { allRows = allRows.concat(rows); })
          .catch(e => erros.push(e.message))
      );
    } else {
      erros.push('MG: DB_MG_HOST ou DB_MG_DATABASE não configurado.');
    }
  }

  // 2) Busca no Firebird SJC
  if (company === 'sjc' || company === 'all') {
    if (fbConfigured(cfgSJC)) {
      tasks.push(
        queryFirebird(cfgSJC, SQL_FB_SJC, [dateParam])
          .then(rows => { allRows = allRows.concat(rows); })
          .catch(e => erros.push(e.message))
      );
    } else {
      erros.push('SJC: DB_SJC_HOST ou DB_SJC_DATABASE não configurado.');
    }
  }

  await Promise.all(tasks);

  // 3) Salva no SQL Server (seu servidor)
  if (ssConfigured(cfgOWN) && allRows.length > 0) {
    try {
      await syncToOwn(allRows, dateParam);
    } catch (e) {
      erros.push(`Sync OWN: ${e.message}`);
    }
  }

  // 4) Lê do SQL Server (ou agrega direto se OWN não configurado)
  let rows = allRows;
  if (ssConfigured(cfgOWN)) {
    try {
      rows = await readFromOwn(dateParam, company);
    } catch (e) {
      erros.push(`Leitura OWN: ${e.message}`);
    }
  }

  // 5) Agrega e responde
  const todosClientes = aggregate(rows);
  // denominador do %: TODOS os clientes que compraram no período
  const totalPeriodo  = todosClientes.length;
  const atingiramMeta = todosClientes.filter(c => c.qtde_tetra >= 10).length;
  const pctMeta       = totalPeriodo > 0 ? +((atingiramMeta / totalPeriodo) * 100).toFixed(1) : 0;

  // tabela: apenas quem comprou tetra, ordenado por qtde decrescente
  const clientesTetra = todosClientes
    .filter(c => c.qtde_tetra > 0)
    .sort((a, b) => b.qtde_tetra - a.qtde_tetra);

  const totalQtde  = clientesTetra.reduce((s, c) => s + c.qtde_tetra,  0);
  const totalValor = clientesTetra.reduce((s, c) => s + c.valor_tetra, 0);

  res.json({
    erros,
    sincronizado_em: new Date().toISOString(),
    kpis: {
      totalPeriodo,        // todos os clientes do período (denominador do %)
      comTetra: clientesTetra.length,
      atingiramMeta,
      pctMeta,
      totalQtdeTetra: totalQtde,
      totalValorTetra: totalValor,
    },
    clientes: clientesTetra,
  });
});

app.get('/api/status', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ── Start ─────────────────────────────────────────────────────────────────────

(async () => {
  await ensureTable();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✓ Painel Tetra rodando em http://0.0.0.0:${PORT}`);
    console.log(`  Acesso local:  http://localhost:${PORT}\n`);
  });
})();
