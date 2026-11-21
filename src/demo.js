'use strict';
// Popula o banco com sócios fictícios para demonstração/treinamento. Uso: npm run demo
const { db, novoTokenQR } = require('./db');
const { hoje } = require('./acesso');
const d = (n) => { const x = new Date(hoje() + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const ins = db.prepare(`INSERT OR IGNORE INTO socios (matricula, nome, tipo, titular_id, parentesco, situacao, validade, exame_validade, data_nasc, token_qr)
  VALUES (?,?,?,?,?,?,?,?,?,?)`);
const id = (m) => db.prepare('SELECT id FROM socios WHERE matricula = ?').get(m)?.id;
const dados = [
  ['90001', 'SÓCIO DEMO EM DIA', 'titular', null, null, 'ativo', d(30), d(90), '1980-04-10'],
  ['90002', 'DEPENDENTE DEMO', 'dependente', '90001', 'Filho(a)', 'ativo', null, d(3), '2014-08-20'],
  ['90003', 'SÓCIO DEMO SEM EXAME', 'titular', null, null, 'ativo', d(30), null, '1975-01-15'],
  ['90004', 'SÓCIO DEMO INADIMPLENTE', 'titular', null, null, 'inadimplente', d(-20), d(60), '1990-11-02'],
  ['90005', 'DEPENDENTE DE INADIMPLENTE', 'dependente', '90004', 'Cônjuge', 'ativo', null, d(60), '1991-06-30'],
  ['90006', 'SÓCIO DEMO MENSALIDADE VENCIDA', 'titular', null, null, 'ativo', d(-2), d(60), '1968-02-25'],
];
for (const [m, nome, tipo, tit, par, sit, val, ex, nasc] of dados) ins.run(m, nome, tipo, tit ? id(tit) : null, par, sit, val, ex, nasc, novoTokenQR());
console.log('Sócios de demonstração criados (matrículas 90001 a 90006). Digite a matrícula na tela de acesso para testar.');
