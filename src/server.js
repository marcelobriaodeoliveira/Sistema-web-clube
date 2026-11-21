'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const express = require('express');
const QRCode = require('qrcode');
const { db, FOTOS_DIR, DATA_DIR, hashSenha, conferirSenha, novoTokenQR, getConfig, transacao } = require('./db');
const acesso = require('./acesso');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '3mb' }));
app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '5mb' }));

// ---------- Autenticação (cookie de sessão) ----------
const SESSAO_HORAS = 14;
function lerCookie(req, nome) {
  const m = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(nome + '='));
  return m ? decodeURIComponent(m.slice(nome.length + 1)) : null;
}
function usuarioDaSessao(req) {
  const token = lerCookie(req, 'sessao');
  if (!token) return null;
  const u = db.prepare(`SELECT u.id, u.nome, u.login, u.perfil FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.token = ? AND s.expira > ? AND u.ativo = 1`).get(token, Date.now());
  return u || null;
}
function exigeLogin(req, res, next) {
  const u = usuarioDaSessao(req);
  if (!u) return res.status(401).json({ erro: 'Sessão expirada. Faça login novamente.' });
  req.usuario = u;
  next();
}
function exigeAdmin(req, res, next) {
  exigeLogin(req, res, () => {
    if (req.usuario.perfil !== 'admin') return res.status(403).json({ erro: 'Acesso restrito ao administrador.' });
    next();
  });
}
const tentativas = new Map(); // proteção simples contra força bruta
app.post('/api/login', (req, res) => {
  const { login, senha } = req.body || {};
  const chave = `${req.ip}|${login}`;
  const t = tentativas.get(chave) || { n: 0, ate: 0 };
  if (t.ate > Date.now()) return res.status(429).json({ erro: 'Muitas tentativas. Aguarde 1 minuto.' });
  const u = db.prepare('SELECT * FROM usuarios WHERE login = ? AND ativo = 1').get(String(login || '').trim().toLowerCase());
  if (!u || !conferirSenha(senha || '', u.senha_hash)) {
    t.n++; if (t.n >= 5) { t.ate = Date.now() + 60000; t.n = 0; }
    tentativas.set(chave, t);
    return res.status(401).json({ erro: 'Usuário ou senha inválidos.' });
  }
  tentativas.delete(chave);
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessoes WHERE expira < ?').run(Date.now());
  db.prepare('INSERT INTO sessoes (token, usuario_id, expira) VALUES (?,?,?)').run(token, u.id, Date.now() + SESSAO_HORAS * 3600e3);
  res.setHeader('Set-Cookie', `sessao=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSAO_HORAS * 3600}`);
  res.json({ id: u.id, nome: u.nome, perfil: u.perfil });
});
app.post('/api/logout', (req, res) => {
  const token = lerCookie(req, 'sessao');
  if (token) db.prepare('DELETE FROM sessoes WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', 'sessao=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});
app.get('/api/me', exigeLogin, (req, res) => res.json({ ...req.usuario, clube: getConfig().nome_clube }));
app.put('/api/me/senha', exigeLogin, (req, res) => {
  const { atual, nova } = req.body || {};
  const u = db.prepare('SELECT senha_hash FROM usuarios WHERE id = ?').get(req.usuario.id);
  if (!conferirSenha(atual || '', u.senha_hash)) return res.status(400).json({ erro: 'Senha atual incorreta.' });
  if (!nova || String(nova).length < 6) return res.status(400).json({ erro: 'A nova senha deve ter ao menos 6 caracteres.' });
  db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(hashSenha(nova), req.usuario.id);
  res.json({ ok: true });
});

// ---------- Utilidades ----------
function dataISO(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  throw new Error(`Data inválida: "${s}" (use DD/MM/AAAA)`);
}
function cpfValido(c) {
  if (!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (n) => { let s = 0; for (let i = 0; i < n; i++) s += +c[i] * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === +c[9] && dv(10) === +c[10];
}
function limpa(v) { const s = v === undefined || v === null ? '' : String(v).trim(); return s || null; }
function ponto(codigo) {
  return db.prepare('SELECT * FROM pontos_acesso WHERE codigo = ? AND ativo = 1').get(String(codigo || ''));
}
const erro = (res, e, st = 400) => res.status(st).json({ erro: e.message || String(e) });

// ---------- Acesso (portaria / piscina) ----------
app.get('/api/pontos', exigeLogin, (req, res) => {
  res.json(db.prepare('SELECT id, codigo, nome, exige_exame, acionamento_url, ativo FROM pontos_acesso ORDER BY id').all());
});
app.post('/api/acesso/verificar', exigeLogin, (req, res) => {
  const p = ponto(req.body.ponto);
  if (!p) return erro(res, 'Ponto de acesso inválido.');
  const achado = acesso.localizar(req.body.codigo);
  const r = acesso.registrar({ socio: achado?.socio, ponto: p, codigoLido: String(req.body.codigo || '').slice(0, 40),
    metodo: achado?.metodo || 'qr', operadorId: req.usuario.id });
  res.json(r);
});
// Entrada a partir da busca por nome (sem carteirinha) — fica registrada como "busca"
app.post('/api/acesso/socio/:id', exigeLogin, (req, res) => {
  const p = ponto(req.body.ponto);
  if (!p) return erro(res, 'Ponto de acesso inválido.');
  const s = acesso.buscarPorId(Number(req.params.id));
  if (!s) return erro(res, 'Sócio não encontrado.', 404);
  res.json(acesso.registrar({ socio: s, ponto: p, metodo: 'busca', operadorId: req.usuario.id }));
});
app.get('/api/painel', exigeLogin, (req, res) => {
  const dia = acesso.hoje();
  const porPonto = db.prepare(`SELECT p.codigo, p.nome,
      SUM(a.resultado='liberado') liberados, SUM(a.resultado='negado') negados
    FROM pontos_acesso p LEFT JOIN acessos a ON a.ponto_id = p.id AND date(a.data_hora) = ?
    GROUP BY p.id ORDER BY p.id`).all(dia);
  const ultimos = db.prepare(`SELECT a.id, a.data_hora, a.resultado, a.motivo, p.nome ponto, s.nome, s.matricula
    FROM acessos a JOIN pontos_acesso p ON p.id = a.ponto_id LEFT JOIN socios s ON s.id = a.socio_id
    ORDER BY a.id DESC LIMIT 15`).all();
  const totais = db.prepare(`SELECT COUNT(*) total, SUM(situacao='ativo') ativos, SUM(situacao='inadimplente') inadimplentes FROM socios`).get();
  res.json({ dia, porPonto, ultimos, totais });
});

// ---------- Sócios ----------
app.get('/api/socios', exigeLogin, (req, res) => {
  const q = String(req.query.q || '').trim();
  const where = []; const args = [];
  if (q) {
    const dig = q.replace(/\D/g, '');
    const cond = ['s.nome LIKE ?', 's.matricula = ?']; args.push(`%${q}%`, q);
    if (dig.length >= 3) { cond.push('s.cpf LIKE ?'); args.push(`${dig}%`); }
    where.push(`(${cond.join(' OR ')})`);
  }
  if (req.query.situacao) { where.push('s.situacao = ?'); args.push(req.query.situacao); }
  if (req.query.tipo) { where.push('s.tipo = ?'); args.push(req.query.tipo); }
  const lim = Math.min(Number(req.query.limite) || 200, 2000);
  const rows = db.prepare(`${acesso.SQL_SOCIO} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY s.nome LIMIT ${lim}`).all(...args);
  const admin = req.usuario.perfil === 'admin';
  res.json(rows.map((s) => ({ ...acesso.resumoSocio(s), cpf: admin ? s.cpf : undefined, telefone: admin ? s.telefone : undefined,
    situacao_titular: s.titular_situacao })));
});
app.get('/api/socios/:id', exigeAdmin, (req, res) => {
  const s = db.prepare('SELECT * FROM socios WHERE id = ?').get(Number(req.params.id));
  if (!s) return erro(res, 'Sócio não encontrado.', 404);
  s.titular = s.titular_id ? db.prepare('SELECT id, nome, matricula FROM socios WHERE id = ?').get(s.titular_id) : null;
  s.dependentes = db.prepare('SELECT id, matricula, nome, parentesco, situacao, exame_validade FROM socios WHERE titular_id = ? ORDER BY nome').all(s.id);
  s.ultimos_acessos = db.prepare(`SELECT a.data_hora, a.resultado, a.motivo, p.nome ponto FROM acessos a
    JOIN pontos_acesso p ON p.id = a.ponto_id WHERE a.socio_id = ? ORDER BY a.id DESC LIMIT 10`).all(s.id);
  res.json(s);
});

function validarSocio(b, id) {
  const d = {
    matricula: limpa(b.matricula), nome: limpa(b.nome), cpf: limpa(b.cpf)?.replace(/\D/g, '') || null,
    data_nasc: dataISO(b.data_nasc), tipo: b.tipo === 'dependente' ? 'dependente' : 'titular',
    titular_id: b.titular_id ? Number(b.titular_id) : null, parentesco: limpa(b.parentesco),
    telefone: limpa(b.telefone), email: limpa(b.email),
    situacao: ['ativo', 'inadimplente', 'suspenso', 'inativo'].includes(b.situacao) ? b.situacao : 'ativo',
    validade: dataISO(b.validade), exame_validade: dataISO(b.exame_validade), observacoes: limpa(b.observacoes),
  };
  if (!d.nome) throw new Error('Informe o nome.');
  d.nome = d.nome.toUpperCase();
  if (d.cpf && !cpfValido(d.cpf)) throw new Error('CPF inválido.');
  if (d.tipo === 'dependente') {
    if (!d.titular_id) throw new Error('Dependente precisa de um titular.');
    if (d.titular_id === id) throw new Error('Sócio não pode ser titular de si mesmo.');
    const t = db.prepare('SELECT tipo FROM socios WHERE id = ?').get(d.titular_id);
    if (!t || t.tipo !== 'titular') throw new Error('Titular inválido.');
  } else d.titular_id = null;
  if (!d.matricula) {
    const max = db.prepare("SELECT MAX(CAST(matricula AS INTEGER)) m FROM socios WHERE matricula GLOB '[0-9]*'").get().m || 0;
    d.matricula = String(max + 1).padStart(5, '0');
  }
  return d;
}
function msgUnique(e) {
  const m = String(e.message);
  if (m.includes('socios.matricula')) return new Error('Matrícula já cadastrada.');
  if (m.includes('socios.cpf')) return new Error('CPF já cadastrado.');
  return e;
}
const CAMPOS = ['matricula', 'nome', 'cpf', 'data_nasc', 'tipo', 'titular_id', 'parentesco', 'telefone', 'email', 'situacao', 'validade', 'exame_validade', 'observacoes'];

app.post('/api/socios', exigeAdmin, (req, res) => {
  try {
    const d = validarSocio(req.body || {});
    const info = db.prepare(`INSERT INTO socios (${CAMPOS.join(',')}, token_qr) VALUES (${CAMPOS.map(() => '?').join(',')}, ?)`)
      .run(...CAMPOS.map((c) => d[c]), novoTokenQR());
    res.status(201).json({ id: Number(info.lastInsertRowid), matricula: d.matricula });
  } catch (e) { erro(res, msgUnique(e)); }
});
app.put('/api/socios/:id', exigeAdmin, (req, res) => {
  const id = Number(req.params.id);
  try {
    const d = validarSocio(req.body || {}, id);
    if (d.tipo === 'dependente' && db.prepare('SELECT COUNT(*) n FROM socios WHERE titular_id = ?').get(id).n)
      throw new Error('Este sócio tem dependentes; não pode virar dependente.');
    const info = db.prepare(`UPDATE socios SET ${CAMPOS.map((c) => c + ' = ?').join(', ')}, atualizado_em = datetime('now','localtime') WHERE id = ?`)
      .run(...CAMPOS.map((c) => d[c]), id);
    if (!info.changes) return erro(res, 'Sócio não encontrado.', 404);
    res.json({ ok: true });
  } catch (e) { erro(res, msgUnique(e)); }
});
// Reemitir carteirinha (perda/roubo): gera novo QR e invalida o anterior
app.post('/api/socios/:id/reemitir', exigeAdmin, (req, res) => {
  const info = db.prepare("UPDATE socios SET token_qr = ?, atualizado_em = datetime('now','localtime') WHERE id = ?").run(novoTokenQR(), Number(req.params.id));
  if (!info.changes) return erro(res, 'Sócio não encontrado.', 404);
  res.json({ ok: true });
});
app.post('/api/socios/:id/foto', exigeAdmin, (req, res) => {
  const id = Number(req.params.id);
  const s = db.prepare('SELECT foto FROM socios WHERE id = ?').get(id);
  if (!s) return erro(res, 'Sócio não encontrado.', 404);
  const m = String(req.body?.imagem || '').match(/^data:image\/(jpeg|png|webp);base64,(.+)$/);
  if (!m) return erro(res, 'Imagem inválida (use JPG/PNG).');
  const nome = `${id}-${crypto.randomBytes(4).toString('hex')}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  fs.writeFileSync(path.join(FOTOS_DIR, nome), Buffer.from(m[2], 'base64'));
  if (s.foto) fs.rm(path.join(FOTOS_DIR, path.basename(s.foto)), { force: true }, () => {});
  db.prepare('UPDATE socios SET foto = ? WHERE id = ?').run(nome, id);
  res.json({ foto: `/fotos/${nome}` });
});
app.delete('/api/socios/:id', exigeAdmin, (req, res) => {
  // Exclusão definitiva só para cadastros sem histórico; senão, use situação "inativo"
  const id = Number(req.params.id);
  const n = db.prepare('SELECT COUNT(*) n FROM acessos WHERE socio_id = ?').get(id).n;
  const dep = db.prepare('SELECT COUNT(*) n FROM socios WHERE titular_id = ?').get(id).n;
  if (n || dep) return erro(res, 'Sócio possui histórico de acessos ou dependentes. Altere a situação para "inativo".');
  const s = db.prepare('SELECT foto FROM socios WHERE id = ?').get(id);
  db.prepare('DELETE FROM socios WHERE id = ?').run(id);
  if (s?.foto) fs.rm(path.join(FOTOS_DIR, s.foto), { force: true }, () => {});
  res.json({ ok: true });
});
app.get('/api/socios/:id/qr', exigeAdmin, async (req, res) => {
  const s = db.prepare('SELECT token_qr, matricula FROM socios WHERE id = ?').get(Number(req.params.id));
  if (!s) return erro(res, 'Sócio não encontrado.', 404);
  if (req.query.formato === 'png') {
    res.type('png');
    if (req.query.download) res.setHeader('Content-Disposition', `attachment; filename="carteirinha-${s.matricula}.png"`);
    return res.send(await QRCode.toBuffer(s.token_qr, { width: 600, margin: 2, errorCorrectionLevel: 'M' }));
  }
  res.type('svg').send(await QRCode.toString(s.token_qr, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }));
});

// Importação CSV (planilha atual do clube). Separador ; ou ,  — primeira linha = cabeçalho.
function parseCSV(texto) {
  const linhas = String(texto).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!linhas.length) return [];
  const sep = (linhas[0].match(/;/g) || []).length >= (linhas[0].match(/,/g) || []).length ? ';' : ',';
  const split = (l) => {
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (ch === sep && !q) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur); return out.map((s) => s.trim());
  };
  const cab = split(linhas[0]).map((h) => h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '_'));
  return linhas.slice(1).map((l, i) => { const v = split(l); const o = { _linha: i + 2 }; cab.forEach((h, j) => { o[h] = v[j]; }); return o; });
}
app.post('/api/socios/importar', exigeAdmin, (req, res) => {
  const registros = parseCSV(req.body);
  const erros = []; let inseridos = 0; let atualizados = 0;
  // titulares primeiro, depois dependentes (que referenciam a matrícula do titular)
  const ordem = [...registros].sort((a, b) => (String(a.tipo).toLowerCase().startsWith('dep') ? 1 : 0) - (String(b.tipo).toLowerCase().startsWith('dep') ? 1 : 0));
  transacao(() => {
    for (const r of ordem) {
      try {
        const tipo = String(r.tipo || '').toLowerCase().startsWith('dep') ? 'dependente' : 'titular';
        let titular_id = null;
        if (tipo === 'dependente') {
          const t = db.prepare('SELECT id FROM socios WHERE matricula = ?').get(String(r.matricula_titular || '').trim());
          if (!t) throw new Error(`titular com matrícula "${r.matricula_titular || ''}" não encontrado`);
          titular_id = t.id;
        }
        const sit = String(r.situacao || 'ativo').toLowerCase();
        const existente = r.matricula ? db.prepare('SELECT id FROM socios WHERE matricula = ?').get(String(r.matricula).trim()) : null;
        const d = validarSocio({ ...r, tipo, titular_id, situacao: sit, exame_validade: r.exame_validade || r.exame_medico }, existente?.id);
        if (existente) {
          db.prepare(`UPDATE socios SET ${CAMPOS.map((c) => c + ' = ?').join(', ')}, atualizado_em = datetime('now','localtime') WHERE id = ?`)
            .run(...CAMPOS.map((c) => d[c]), existente.id);
          atualizados++;
        } else {
          db.prepare(`INSERT INTO socios (${CAMPOS.join(',')}, token_qr) VALUES (${CAMPOS.map(() => '?').join(',')}, ?)`)
            .run(...CAMPOS.map((c) => d[c]), novoTokenQR());
          inseridos++;
        }
      } catch (e) { erros.push(`Linha ${r._linha}: ${msgUnique(e).message}`); }
    }
  });
  res.json({ total: registros.length, inseridos, atualizados, erros });
});
const csvCampo = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function enviarCSV(res, nome, cab, linhas) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
  res.send('﻿' + [cab.join(';'), ...linhas.map((l) => l.map(csvCampo).join(';'))].join('\r\n'));
}
app.get('/api/socios-exportar.csv', exigeAdmin, (req, res) => {
  const rows = db.prepare(`SELECT s.*, t.matricula mt FROM socios s LEFT JOIN socios t ON t.id = s.titular_id ORDER BY s.nome`).all();
  enviarCSV(res, 'socios.csv', ['matricula', 'nome', 'cpf', 'data_nasc', 'tipo', 'matricula_titular', 'parentesco', 'telefone', 'email', 'situacao', 'validade', 'exame_validade'],
    rows.map((s) => [s.matricula, s.nome, s.cpf, acesso.br(s.data_nasc), s.tipo, s.mt, s.parentesco, s.telefone, s.email, s.situacao, acesso.br(s.validade), acesso.br(s.exame_validade)]));
});

// ---------- Relatórios ----------
function consultaAcessos(q) {
  const where = ['date(a.data_hora) BETWEEN ? AND ?']; const args = [dataISO(q.de) || acesso.hoje(), dataISO(q.ate) || dataISO(q.de) || acesso.hoje()];
  if (q.ponto) { where.push('p.codigo = ?'); args.push(q.ponto); }
  if (q.resultado) { where.push('a.resultado = ?'); args.push(q.resultado); }
  return db.prepare(`SELECT a.id, a.data_hora, a.resultado, a.motivo, a.metodo, a.codigo_lido, p.nome ponto, s.matricula, s.nome, u.nome operador
    FROM acessos a JOIN pontos_acesso p ON p.id = a.ponto_id LEFT JOIN socios s ON s.id = a.socio_id
    LEFT JOIN usuarios u ON u.id = a.operador_id WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT 20000`).all(...args);
}
app.get('/api/acessos', exigeAdmin, (req, res) => { try { res.json(consultaAcessos(req.query)); } catch (e) { erro(res, e); } });
app.get('/api/acessos.csv', exigeAdmin, (req, res) => {
  try {
    enviarCSV(res, 'acessos.csv', ['data_hora', 'ponto', 'matricula', 'nome', 'resultado', 'motivo', 'metodo', 'operador'],
      consultaAcessos(req.query).map((a) => [a.data_hora, a.ponto, a.matricula, a.nome, a.resultado, a.motivo, a.metodo, a.operador]));
  } catch (e) { erro(res, e); }
});
app.get('/api/relatorio/pendencias', exigeAdmin, (req, res) => {
  const dia = acesso.hoje();
  res.json({
    exame_vencido: db.prepare(`SELECT id, matricula, nome, exame_validade FROM socios WHERE situacao='ativo' AND (exame_validade IS NULL OR exame_validade < ?) ORDER BY nome`).all(dia),
    mensalidade_vencida: db.prepare(`SELECT id, matricula, nome, validade FROM socios WHERE tipo='titular' AND situacao='ativo' AND validade < ? ORDER BY validade`).all(dia),
  });
});

// ---------- Configurações / usuários / backup ----------
app.get('/api/config', exigeLogin, (req, res) => res.json(getConfig()));
app.put('/api/config', exigeAdmin, (req, res) => {
  const permitidas = ['nome_clube', 'antipassback_min', 'aviso_exame_dias', 'tempo_resultado_seg'];
  const up = db.prepare('INSERT INTO config (chave, valor) VALUES (?,?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor');
  for (const k of permitidas) if (k in (req.body || {})) up.run(k, String(req.body[k]));
  res.json(getConfig());
});
app.put('/api/pontos/:id', exigeAdmin, (req, res) => {
  const b = req.body || {};
  const url = limpa(b.acionamento_url);
  if (url && !/^https?:\/\//i.test(url)) return erro(res, 'URL de acionamento deve começar com http:// ou https://');
  db.prepare('UPDATE pontos_acesso SET nome = ?, exige_exame = ?, acionamento_url = ?, ativo = ? WHERE id = ?')
    .run(limpa(b.nome) || 'Ponto', b.exige_exame ? 1 : 0, url, b.ativo === false ? 0 : 1, Number(req.params.id));
  res.json({ ok: true });
});
app.post('/api/pontos', exigeAdmin, (req, res) => {
  const codigo = String(req.body?.codigo || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!codigo || !limpa(req.body?.nome)) return erro(res, 'Informe código e nome.');
  try {
    db.prepare('INSERT INTO pontos_acesso (codigo, nome, exige_exame) VALUES (?,?,?)').run(codigo, limpa(req.body.nome), req.body.exige_exame ? 1 : 0);
    res.status(201).json({ ok: true });
  } catch { erro(res, 'Código já existe.'); }
});
app.post('/api/pontos/:id/testar', exigeAdmin, async (req, res) => {
  const p = db.prepare('SELECT acionamento_url FROM pontos_acesso WHERE id = ?').get(Number(req.params.id));
  if (!p?.acionamento_url) return erro(res, 'Ponto sem URL de acionamento.');
  try {
    const r = await fetch(p.acionamento_url, { signal: AbortSignal.timeout(3000) });
    res.json({ ok: r.ok, status: r.status });
  } catch (e) { erro(res, `Sem resposta do dispositivo: ${e.message}`, 502); }
});
app.get('/api/usuarios', exigeAdmin, (req, res) => res.json(db.prepare('SELECT id, nome, login, perfil, ativo FROM usuarios ORDER BY nome').all()));
app.post('/api/usuarios', exigeAdmin, (req, res) => {
  const b = req.body || {};
  if (!limpa(b.nome) || !limpa(b.login) || String(b.senha || '').length < 6) return erro(res, 'Informe nome, login e senha (mín. 6 caracteres).');
  try {
    db.prepare('INSERT INTO usuarios (nome, login, senha_hash, perfil) VALUES (?,?,?,?)')
      .run(limpa(b.nome), limpa(b.login).toLowerCase(), hashSenha(b.senha), b.perfil === 'admin' ? 'admin' : 'recepcao');
    res.status(201).json({ ok: true });
  } catch { erro(res, 'Login já existe.'); }
});
app.put('/api/usuarios/:id', exigeAdmin, (req, res) => {
  const id = Number(req.params.id); const b = req.body || {};
  if (id === req.usuario.id && (b.ativo === false || b.perfil === 'recepcao')) return erro(res, 'Você não pode desativar ou rebaixar o próprio usuário.');
  db.prepare('UPDATE usuarios SET perfil = COALESCE(?, perfil), ativo = COALESCE(?, ativo) WHERE id = ?')
    .run(b.perfil ? (b.perfil === 'admin' ? 'admin' : 'recepcao') : null, b.ativo === undefined ? null : (b.ativo ? 1 : 0), id);
  if (b.senha) {
    if (String(b.senha).length < 6) return erro(res, 'Senha deve ter ao menos 6 caracteres.');
    db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(hashSenha(b.senha), id);
  }
  if (b.ativo === false || b.senha) db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(id);
  res.json({ ok: true });
});
app.get('/api/backup', exigeAdmin, (req, res) => {
  const arq = path.join(os.tmpdir(), `clube-backup-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${arq.replace(/'/g, "''")}'`);
  res.download(arq, `clube-backup-${acesso.hoje()}.db`, () => fs.rm(arq, { force: true }, () => {}));
});

// ---------- Arquivos estáticos ----------
app.get('/fotos/:arquivo', exigeLogin, (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(path.join(FOTOS_DIR, path.basename(req.params.arquivo)), (e) => { if (e && !res.headersSent) res.status(404).end(); });
});
app.get('/vendor/html5-qrcode.min.js', (req, res) => res.sendFile(require.resolve('html5-qrcode/html5-qrcode.min.js')));
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));
app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));
app.use((err, req, res, _next) => { console.error(err); res.status(500).json({ erro: 'Erro interno.' }); });

if (require.main === module) {
  const PORTA = Number(process.env.PORTA || 3000);
  app.listen(PORTA, '0.0.0.0', () => {
    const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
    console.log(`Sistema do clube rodando. Dados em: ${DATA_DIR}`);
    console.log(`  Neste computador: http://localhost:${PORTA}`);
    for (const ip of ips) console.log(`  Na rede do clube: http://${ip}:${PORTA}`);
  });
  // HTTPS opcional: necessário para usar a CÂMERA de tablets/celulares como leitor de QR pela rede.
  // Coloque certificado.pem e chave.pem na pasta de dados (ver docs/INSTALACAO.md).
  const cert = path.join(DATA_DIR, 'certificado.pem'); const key = path.join(DATA_DIR, 'chave.pem');
  if (fs.existsSync(cert) && fs.existsSync(key)) {
    const PORTA_HTTPS = Number(process.env.PORTA_HTTPS || 3443);
    require('node:https').createServer({ cert: fs.readFileSync(cert), key: fs.readFileSync(key) }, app)
      .listen(PORTA_HTTPS, '0.0.0.0', () => console.log(`  HTTPS (câmera em tablets): porta ${PORTA_HTTPS}`));
  }
}
module.exports = app;
