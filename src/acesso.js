'use strict';
// Regras de liberação de acesso (portaria e piscinas)
const { db, getConfig } = require('./db');

function hoje() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDias(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function br(iso) {
  if (!iso) return '';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

const SQL_SOCIO = `
  SELECT s.*, t.nome AS titular_nome, t.situacao AS titular_situacao, t.validade AS titular_validade
  FROM socios s LEFT JOIN socios t ON t.id = s.titular_id`;

/** Localiza o sócio pelo código lido: token do QR, matrícula ou CPF. */
function localizar(codigo) {
  const c = String(codigo || '').trim();
  if (!c) return null;
  const up = c.toUpperCase();
  let s = db.prepare(`${SQL_SOCIO} WHERE s.token_qr = ?`).get(up);
  if (s) return { socio: s, metodo: 'qr' };
  s = db.prepare(`${SQL_SOCIO} WHERE s.matricula = ?`).get(c);
  if (s) return { socio: s, metodo: 'matricula' };
  const dig = c.replace(/\D/g, '');
  if (dig.length === 11) {
    s = db.prepare(`${SQL_SOCIO} WHERE s.cpf = ?`).get(dig);
    if (s) return { socio: s, metodo: 'cpf' };
  }
  return null;
}

function buscarPorId(id) {
  return db.prepare(`${SQL_SOCIO} WHERE s.id = ?`).get(id);
}

const ROTULO_SITUACAO = { inadimplente: 'Sócio inadimplente', suspenso: 'Sócio suspenso', inativo: 'Cadastro inativo' };

/** Avalia a regra de acesso. Retorna { liberado, motivo, avisos[] } */
function avaliar(socio, ponto, cfg = getConfig()) {
  const avisos = [];
  const dataHoje = hoje();
  if (!socio) return { liberado: false, motivo: 'Carteirinha / cadastro não encontrado', avisos };

  // Situação própria
  if (socio.situacao !== 'ativo') return { liberado: false, motivo: ROTULO_SITUACAO[socio.situacao] || 'Situação irregular', avisos };

  // Dependente herda a situação financeira do titular
  if (socio.tipo === 'dependente') {
    if (!socio.titular_id) return { liberado: false, motivo: 'Dependente sem titular vinculado', avisos };
    if (socio.titular_situacao !== 'ativo') {
      return { liberado: false, motivo: `Titular (${socio.titular_nome}): ${ROTULO_SITUACAO[socio.titular_situacao] || 'situação irregular'}`, avisos };
    }
  }
  const validade = socio.tipo === 'dependente' ? socio.titular_validade : socio.validade;
  if (validade && validade < dataHoje) return { liberado: false, motivo: `Mensalidade vencida em ${br(validade)}`, avisos };

  // Piscina: exige exame médico válido
  if (ponto.exige_exame) {
    if (!socio.exame_validade) return { liberado: false, motivo: 'Sem exame médico cadastrado', avisos };
    if (socio.exame_validade < dataHoje) return { liberado: false, motivo: `Exame médico vencido em ${br(socio.exame_validade)}`, avisos };
    const diasAviso = Number(cfg.aviso_exame_dias || 7);
    if (socio.exame_validade <= addDias(dataHoje, diasAviso)) avisos.push(`Exame médico vence em ${br(socio.exame_validade)}`);
  }
  if (validade && validade <= addDias(dataHoje, 5)) avisos.push(`Mensalidade vence em ${br(validade)}`);

  // Anti-passback: alerta se o mesmo cartão já entrou neste ponto há poucos minutos (possível empréstimo)
  const min = Number(cfg.antipassback_min || 0);
  if (min > 0) {
    const ult = db.prepare(`SELECT data_hora FROM acessos WHERE socio_id = ? AND ponto_id = ? AND resultado = 'liberado'
      AND data_hora >= datetime('now','localtime', ?) ORDER BY id DESC LIMIT 1`).get(socio.id, ponto.id, `-${min} minutes`);
    if (ult) avisos.push(`Atenção: entrada já registrada às ${ult.data_hora.slice(11, 16)} — confira a foto`);
  }
  return { liberado: true, motivo: null, avisos };
}

function idade(nasc) {
  if (!nasc) return null;
  const n = new Date(nasc + 'T12:00:00'), h = new Date();
  let i = h.getFullYear() - n.getFullYear();
  if (h.getMonth() < n.getMonth() || (h.getMonth() === n.getMonth() && h.getDate() < n.getDate())) i--;
  return i;
}

function resumoSocio(s) {
  if (!s) return null;
  return {
    id: s.id, matricula: s.matricula, nome: s.nome, tipo: s.tipo, parentesco: s.parentesco,
    titular_nome: s.titular_nome || null, idade: idade(s.data_nasc),
    foto: s.foto ? `/fotos/${s.foto}` : null,
    situacao: s.situacao, exame_validade: s.exame_validade,
    validade: s.tipo === 'dependente' ? s.titular_validade : s.validade,
  };
}

/** Aciona catraca/fechadura (ex.: ESP32 com relé) sem bloquear a resposta. */
function acionar(url) {
  if (!url) return;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2500);
  fetch(url, { signal: ctrl.signal })
    .catch((e) => console.error(`[acionamento] falha ao chamar ${url}: ${e.message}`))
    .finally(() => clearTimeout(t));
}

/** Registra uma tentativa de acesso: avalia, grava log e aciona a catraca se liberado. */
function registrar({ socio, ponto, codigoLido, metodo, operadorId }) {
  const r = avaliar(socio, ponto);
  const info = db.prepare(`INSERT INTO acessos (socio_id, ponto_id, resultado, motivo, codigo_lido, metodo, operador_id)
    VALUES (?,?,?,?,?,?,?)`).run(socio ? socio.id : null, ponto.id, r.liberado ? 'liberado' : 'negado',
    r.motivo, codigoLido || null, metodo, operadorId || null);
  if (r.liberado) acionar(ponto.acionamento_url);
  return { id: Number(info.lastInsertRowid), ...r, ponto: ponto.nome, socio: resumoSocio(socio) };
}

module.exports = { localizar, buscarPorId, avaliar, registrar, resumoSocio, hoje, br, SQL_SOCIO };
