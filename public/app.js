// Funções compartilhadas entre as telas
const App = {
  usuario: null,
  async api(url, opcoes = {}) {
    const o = { credentials: 'same-origin', ...opcoes, headers: { ...(opcoes.headers || {}) } };
    if (o.body && typeof o.body !== 'string') { o.body = JSON.stringify(o.body); o.headers['Content-Type'] = 'application/json'; }
    const r = await fetch(url, o);
    if (r.status === 401 && !url.endsWith('/api/login')) { location.href = '/login?volta=' + encodeURIComponent(location.pathname + location.search); throw new Error('Sessão expirada'); }
    const dados = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
    if (!r.ok) throw new Error(dados?.erro || `Erro ${r.status}`);
    return dados;
  },
  async iniciar({ admin = false, menu = true } = {}) {
    this.usuario = await this.api('/api/me');
    if (admin && this.usuario.perfil !== 'admin') { location.href = '/'; return null; }
    if (menu) this.menu();
    return this.usuario;
  },
  menu() {
    const u = this.usuario; const aqui = location.pathname.replace(/\.html$/, '');
    const itens = [['/', 'Painel'], ['/acesso?ponto=portaria', 'Portaria'], ['/acesso?ponto=piscina', 'Piscina'], ['/socios', 'Sócios']];
    if (u.perfil === 'admin') itens.push(['/relatorios', 'Relatórios'], ['/config', 'Configurações']);
    const h = document.createElement('header'); h.className = 'topo';
    h.innerHTML = `<div class="marca">${this.esc(u.clube || 'Clube')} · Controle de Acesso</div>
      <nav>${itens.map(([href, t]) => `<a href="${href}" class="${href.split('?')[0] === (aqui === '/index' ? '/' : aqui) && !href.includes('?') ? 'ativo' : ''}">${t}</a>`).join('')}</nav>
      <span class="mut" style="color:#dce8f5">${this.esc(u.nome)}</span><button id="btSair">Sair</button>`;
    document.body.prepend(h);
    h.querySelector('#btSair').onclick = async () => { await this.api('/api/logout', { method: 'POST' }); location.href = '/login'; };
  },
  esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
  br(iso) { if (!iso) return ''; const [a, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${a}`; },
  hora(dt) { return String(dt || '').slice(11, 16); },
  hoje() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; },
  mascaraCPF(c) { const d = String(c || '').replace(/\D/g, ''); return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : (c || ''); },
  fotoHTML(url, cls = 'foto-mini') { return url ? `<img class="${cls}" src="${this.esc(url)}" alt="">` : `<span class="${cls}" style="display:inline-block"></span>`; },
};
