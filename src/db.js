'use strict';
// Banco de dados SQLite embutido no Node.js (node:sqlite) - não precisa instalar servidor de banco.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FOTOS_DIR = path.join(DATA_DIR, 'fotos');
fs.mkdirSync(FOTOS_DIR, { recursive: true });

const db = new DatabaseSync(process.env.DB_FILE || path.join(DATA_DIR, 'clube.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');

db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  login TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  perfil TEXT NOT NULL CHECK (perfil IN ('admin','recepcao')),
  ativo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sessoes (
  token TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS socios (
  id INTEGER PRIMARY KEY,
  matricula TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  cpf TEXT UNIQUE,
  data_nasc TEXT,
  tipo TEXT NOT NULL DEFAULT 'titular' CHECK (tipo IN ('titular','dependente')),
  titular_id INTEGER REFERENCES socios(id) ON DELETE SET NULL,
  parentesco TEXT,
  telefone TEXT,
  email TEXT,
  foto TEXT,
  situacao TEXT NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo','inadimplente','suspenso','inativo')),
  validade TEXT,               -- mensalidade/anuidade paga até (AAAA-MM-DD)
  exame_validade TEXT,         -- exame médico para piscina válido até (AAAA-MM-DD)
  token_qr TEXT NOT NULL UNIQUE,
  observacoes TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_socios_nome ON socios(nome);
CREATE INDEX IF NOT EXISTS ix_socios_titular ON socios(titular_id);
CREATE TABLE IF NOT EXISTS pontos_acesso (
  id INTEGER PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  exige_exame INTEGER NOT NULL DEFAULT 0,
  acionamento_url TEXT,        -- URL chamada quando o acesso é liberado (ex.: ESP32 + relé da catraca)
  ativo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS acessos (
  id INTEGER PRIMARY KEY,
  socio_id INTEGER REFERENCES socios(id) ON DELETE SET NULL,
  ponto_id INTEGER NOT NULL REFERENCES pontos_acesso(id),
  data_hora TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  resultado TEXT NOT NULL CHECK (resultado IN ('liberado','negado')),
  motivo TEXT,
  codigo_lido TEXT,
  metodo TEXT NOT NULL DEFAULT 'qr',
  operador_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS ix_acessos_data ON acessos(data_hora);
CREATE INDEX IF NOT EXISTS ix_acessos_socio ON acessos(socio_id, ponto_id, data_hora);
CREATE TABLE IF NOT EXISTS config (
  chave TEXT PRIMARY KEY,
  valor TEXT
);
`);

function hashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(senha), salt, 64).toString('hex');
  return `${salt}:${h}`;
}
function conferirSenha(senha, armazenado) {
  const [salt, h] = String(armazenado).split(':');
  if (!salt || !h) return false;
  const calc = crypto.scryptSync(String(senha), salt, 64);
  const ref = Buffer.from(h, 'hex');
  return ref.length === calc.length && crypto.timingSafeEqual(ref, calc);
}
function novoTokenQR() {
  // 16 caracteres sem ambiguidade (sem 0/O/1/I) - difícil de adivinhar, fácil de ler
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(16);
  let s = '';
  for (const b of bytes) s += alfabeto[b % alfabeto.length];
  return s;
}

// Dados iniciais
const temPonto = db.prepare('SELECT COUNT(*) n FROM pontos_acesso').get().n;
if (!temPonto) {
  const ins = db.prepare('INSERT INTO pontos_acesso (codigo, nome, exige_exame) VALUES (?,?,?)');
  ins.run('portaria', 'Portaria principal', 0);
  ins.run('piscina', 'Piscinas', 1);
}
const cfgPadrao = { nome_clube: 'Clube', antipassback_min: '5', aviso_exame_dias: '7', tempo_resultado_seg: '4' };
const insCfg = db.prepare('INSERT OR IGNORE INTO config (chave, valor) VALUES (?,?)');
for (const [k, v] of Object.entries(cfgPadrao)) insCfg.run(k, v);

const temUsuario = db.prepare('SELECT COUNT(*) n FROM usuarios').get().n;
if (!temUsuario) {
  const senha = process.env.ADMIN_SENHA || 'admin123';
  db.prepare("INSERT INTO usuarios (nome, login, senha_hash, perfil) VALUES ('Administrador','admin',?,'admin')")
    .run(hashSenha(senha));
  if (!process.env.ADMIN_SENHA) {
    console.warn('\n*** Usuário inicial criado: admin / admin123 — TROQUE A SENHA no primeiro acesso (Configurações). ***\n');
  }
}

function getConfig() {
  const out = {};
  for (const r of db.prepare('SELECT chave, valor FROM config').all()) out[r.chave] = r.valor;
  return out;
}

function transacao(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { db, DATA_DIR, FOTOS_DIR, hashSenha, conferirSenha, novoTokenQR, getConfig, transacao };
