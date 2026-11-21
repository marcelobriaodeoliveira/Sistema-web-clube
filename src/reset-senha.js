'use strict';
// Redefine a senha de um usuário (uso: npm run reset-senha -- admin NovaSenha123)
// Rode no próprio servidor, com o sistema desligado ou ligado.
const { db, hashSenha } = require('./db');
const [login = 'admin', senha] = process.argv.slice(2);
if (!senha || senha.length < 6) { console.error('Uso: npm run reset-senha -- <login> <nova-senha (mín. 6 caracteres)>'); process.exit(1); }
const info = db.prepare('UPDATE usuarios SET senha_hash = ?, ativo = 1 WHERE login = ?').run(hashSenha(senha), login.toLowerCase());
if (!info.changes) { console.error(`Usuário "${login}" não encontrado.`); process.exit(1); }
db.prepare('DELETE FROM sessoes WHERE usuario_id = (SELECT id FROM usuarios WHERE login = ?)').run(login.toLowerCase());
console.log(`Senha do usuário "${login}" redefinida.`);
