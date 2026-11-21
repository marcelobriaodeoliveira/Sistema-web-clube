# Sistema Web do Clube — Controle de Acesso de Sócios

Sistema de baixo custo para agilizar a entrada de sócios no clube e nas piscinas, substituindo a conferência manual de documento por **carteirinha com QR Code**.

- Leitura do QR (leitor USB/Bluetooth ou câmera do tablet) → resposta em **menos de 1 segundo**, com tela **verde (LIBERADO)** ou **vermelha (NEGADO)**, foto do sócio e bip sonoro.
- **Portaria** confere situação do sócio e mensalidade.
- **Piscinas** conferem, além disso, a **validade do exame médico**.
- Dependentes herdam a situação financeira do titular (titular inadimplente bloqueia os dependentes).
- Sem carteirinha? Busca por nome, matrícula ou CPF.
- Alerta de reentrada (mesmo cartão usado há poucos minutos — possível empréstimo de carteirinha).
- Histórico de todas as passagens, relatórios e exportação CSV.
- Saída opcional para **abrir catraca/fechadura** (ESP32 + relé, ~R$ 100 por ponto).
- Roda **na rede local** do clube: não depende de internet nem de mensalidade de nuvem.

## Tecnologia

| Item | Escolha | Por quê |
|---|---|---|
| Servidor | Node.js 22 LTS + Express | gratuito, roda em Windows ou Linux, em PC simples |
| Banco de dados | SQLite embutido no Node (`node:sqlite`) | nada para instalar ou administrar; backup = copiar 1 arquivo |
| Telas | HTML/JS no navegador (Chrome) | funciona em PC, tablet ou celular, sem instalar app |
| QR Code | `qrcode` (geração) e `html5-qrcode` (leitura por câmera) | bibliotecas abertas, funcionam offline |

## Início rápido

```bash
# requer Node.js 22.13 ou superior (https://nodejs.org — versão LTS)
npm install
npm run demo     # opcional: cria 6 sócios fictícios (matrículas 90001 a 90006)
npm start        # abre em http://localhost:3000  (usuário admin / senha admin123)
```

No Windows, basta dar dois cliques em `iniciar-windows.bat`.

Telas:

| Endereço | Uso | Perfil |
|---|---|---|
| `/` | Painel do dia (entradas por ponto, últimas passagens) | todos |
| `/acesso?ponto=portaria` | Tela da portaria | todos |
| `/acesso?ponto=piscina` | Tela da piscina | todos |
| `/socios` | Cadastro, foto, dependentes, QR, importação de planilha, impressão de carteirinhas | admin (recepção só consulta) |
| `/relatorios` | Histórico de acessos, pendências (exame/mensalidade vencidos) | admin |
| `/config` | Nome do clube, pontos de acesso, catraca, usuários, backup | admin |

## Documentação

- [docs/Manual_Usuario_Controle_Acesso.pdf](docs/Manual_Usuario_Controle_Acesso.pdf) — **manual do usuário** completo (infraestrutura, instalação e uso), também em [Word](docs/Manual_Usuario_Controle_Acesso.docx)
- [docs/INFRAESTRUTURA.md](docs/INFRAESTRUTURA.md) — **lista de equipamentos e custos estimados**
- [docs/Lista_Infraestrutura_Clube.xlsx](docs/Lista_Infraestrutura_Clube.xlsx) — mesma lista em planilha, com totais por cenário
- [docs/INSTALACAO.md](docs/INSTALACAO.md) — instalação, rede, HTTPS para câmera, backup, implantação
- [docs/esp32-acionamento](docs/esp32-acionamento) — firmware para acionar catraca/fechadura

## Esqueceu a senha do admin?

No servidor, dentro da pasta do sistema:

```bash
npm run reset-senha -- admin NovaSenha123
```

## Testes

```bash
npm test
```
