'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clube-teste-'));
process.env.DATA_DIR = dir;
process.env.ADMIN_SENHA = 'senha-teste';
const app = require('../src/server');
let srv, base, cookie;

async function api(url, { method = 'GET', body, tipo } = {}) {
  const headers = { cookie: cookie || '' };
  if (body !== undefined) headers['content-type'] = tipo || 'application/json';
  const r = await fetch(base + url, { method, headers, body: body === undefined ? undefined : (tipo ? body : JSON.stringify(body)) });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, dados: ct.includes('json') ? await r.json() : await r.text() };
}
const iso = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

before(async () => { srv = app.listen(0); await new Promise((r) => srv.once('listening', r)); base = `http://127.0.0.1:${srv.address().port}`; });
after(() => { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('exige login', async () => {
  assert.equal((await api('/api/socios')).status, 401);
  assert.equal((await api('/api/login', { method: 'POST', body: { login: 'admin', senha: 'errada' } })).status, 401);
  assert.equal((await api('/api/login', { method: 'POST', body: { login: 'admin', senha: 'senha-teste' } })).status, 200);
});

test('regras de acesso portaria x piscina, dependente e inadimplência', async () => {
  const t = await api('/api/socios', { method: 'POST', body: { nome: 'Titular Um', cpf: '529.982.247-25', validade: iso(30), exame_validade: iso(60) } });
  assert.equal(t.status, 201, JSON.stringify(t.dados));
  const dep = await api('/api/socios', { method: 'POST', body: { nome: 'Dep Um', tipo: 'dependente', titular_id: t.dados.id } });
  assert.equal(dep.status, 201);

  // por matrícula e por CPF
  let r = await api('/api/acesso/verificar', { method: 'POST', body: { codigo: t.dados.matricula, ponto: 'portaria' } });
  assert.equal(r.dados.liberado, true);
  r = await api('/api/acesso/verificar', { method: 'POST', body: { codigo: '52998224725', ponto: 'piscina' } });
  assert.equal(r.dados.liberado, true);
  // reentrada gera aviso
  r = await api('/api/acesso/verificar', { method: 'POST', body: { codigo: t.dados.matricula, ponto: 'portaria' } });
  assert.match(r.dados.avisos.join(), /já registrada/);

  // dependente sem exame: portaria ok, piscina negada
  r = await api('/api/acesso/verificar', { method: 'POST', body: { codigo: dep.dados.matricula, ponto: 'portaria' } });
  assert.equal(r.dados.liberado, true);
  r = await api('/api/acesso/verificar', { method: 'POST', body: { codigo: dep.dados.matricula, ponto: 'piscina' } });
  assert.equal(r.dados.liberado, false); assert.match(r.dados.motivo, /exame/i);

  // titular inadimplente bloqueia dependente
  const det = (await api('/api/socios/' + t.dados.id)).dados;
  await api('/api/socios/' + t.dados.id, { method: 'PUT', body: { ...det, situacao: 'inadimplente' } });
  r = await api('/api/acesso/verificar', { method: 'POST', body: { codigo: dep.dados.matricula, ponto: 'portaria' } });
  assert.equal(r.dados.liberado, false); assert.match(r.dados.motivo, /Titular/);

  // código inexistente
  r = await api('/api/acesso/verificar', { method: 'POST', body: { codigo: 'XXXX', ponto: 'portaria' } });
  assert.equal(r.dados.liberado, false);
});

test('QR: reemissão invalida o código antigo', async () => {
  const s = await api('/api/socios', { method: 'POST', body: { nome: 'Fulano QR', validade: iso(10) } });
  const antigo = (await api('/api/socios/' + s.dados.id)).dados.token_qr;
  assert.equal((await api('/api/acesso/verificar', { method: 'POST', body: { codigo: antigo, ponto: 'portaria' } })).dados.liberado, true);
  await api(`/api/socios/${s.dados.id}/reemitir`, { method: 'POST' });
  assert.equal((await api('/api/acesso/verificar', { method: 'POST', body: { codigo: antigo, ponto: 'portaria' } })).dados.liberado, false);
  const svg = await api(`/api/socios/${s.dados.id}/qr`);
  assert.match(svg.dados, /<svg/);
});

test('importação CSV com titular e dependente', async () => {
  const csv = 'matricula;nome;cpf;data_nasc;tipo;matricula_titular;situacao;validade;exame_validade\n'
    + '5001;Beltrano;;01/02/1980;dependente;5000;ativo;;31/12/2099\n'
    + '5000;Ciclano;;01/01/1970;titular;;ativo;31/12/2099;31/12/2099\n'
    + '5002;Erro;111;;titular;;ativo;;\n';
  const r = await api('/api/socios/importar', { method: 'POST', body: csv, tipo: 'text/csv' });
  assert.equal(r.dados.inseridos, 2);
  assert.equal(r.dados.erros.length, 1);
  const p = await api('/api/acesso/verificar', { method: 'POST', body: { codigo: '5001', ponto: 'piscina' } });
  assert.equal(p.dados.liberado, true);
});

test('perfil recepção não acessa cadastro', async () => {
  await api('/api/usuarios', { method: 'POST', body: { nome: 'Recep', login: 'recep', senha: '123456', perfil: 'recepcao' } });
  await api('/api/login', { method: 'POST', body: { login: 'recep', senha: '123456' } });
  assert.equal((await api('/api/socios', { method: 'POST', body: { nome: 'X' } })).status, 403);
  assert.equal((await api('/api/socios?q=Ciclano')).status, 200);
});
