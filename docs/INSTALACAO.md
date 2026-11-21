# Instalação e Implantação

## 1. Servidor

1. Instale o **Node.js 22 LTS** (https://nodejs.org) no PC que será o servidor.
2. Copie a pasta do sistema para o PC (ex.: `C:\clube` ou `/opt/sistema-web-clube`).
3. Abra o terminal na pasta e rode `npm install` (uma única vez, precisa de internet).
4. Inicie:
   - **Windows:** dois cliques em `iniciar-windows.bat`. Para iniciar com o Windows: `Win+R` → `shell:startup` → cole um atalho do `.bat`.
     Configure o Windows para **não suspender** (Energia → Suspensão: Nunca).
   - **Linux:** use `docs/clube-acesso.service` (systemd).
5. O terminal mostra o endereço na rede, ex.: `http://192.168.0.10:3000`.
6. Entre com **admin / admin123** e **troque a senha** em Configurações. Ajuste o nome do clube.

**IP fixo:** reserve o IP do servidor no roteador (DHCP estático) para o endereço não mudar.

## 2. Estações (portaria e piscina)

- Abra o Chrome no endereço do servidor e faça login com um usuário de perfil **Recepção** (crie um por funcionário).
- Portaria: `http://IP:3000/acesso?ponto=portaria` · Piscina: `http://IP:3000/acesso?ponto=piscina`.
- Salve como favorito/atalho na tela inicial e use o botão **Tela cheia**.
- **Leitor QR USB/Bluetooth:** funciona como teclado — basta o cursor estar no campo de leitura (a tela mantém o foco automaticamente).
  Configure o leitor para enviar **Enter** (sufixo CR) após a leitura (padrão de fábrica na maioria).

## 3. Câmera do tablet como leitor (opcional, custo zero)

Navegadores só liberam a câmera em **HTTPS**. Duas opções:

**Opção A — certificado autoassinado (recomendado):**
```bash
# na pasta data/ do servidor (openssl vem junto com o Git for Windows)
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -keyout chave.pem -out certificado.pem -subj "/CN=clube" -addext "subjectAltName=IP:192.168.0.10"
```
Reinicie o sistema e acesse `https://IP:3443`. Na primeira vez, o Chrome mostra um aviso: **Avançado → Continuar**.

**Opção B — liberar o endereço no Chrome do tablet:** `chrome://flags/#unsafely-treat-insecure-origin-as-secure` → informe `http://IP:3000` → Ativar → Reiniciar.

## 4. Cadastro inicial

1. Exporte a planilha atual de sócios para **CSV (separado por ponto e vírgula)** com as colunas do modelo (`Sócios → Importar planilha → Baixar modelo`).
2. Importe. Linhas com erro são listadas (CPF inválido, titular inexistente etc.) — corrija e importe de novo (matrícula existente é atualizada).
3. Tire as fotos (webcam na secretaria ou arquivo do celular). Dica: montar uma "mesa de recadastramento" nas primeiras semanas.
4. Entregue as carteirinhas: **Baixar QR (WhatsApp)** para envio digital, ou selecione sócios e **Imprimir carteirinhas**.

## 5. Rotina

| Quem | O quê | Quando |
|---|---|---|
| Tesouraria/secretaria | Atualizar "mensalidade paga até" e situação (inadimplente/ativo) | A cada baixa de pagamento ou fechamento mensal |
| Secretaria | Lançar validade do exame médico | A cada exame apresentado |
| Admin | Conferir **Relatórios → Pendências** | Semanal |
| Admin | **Configurações → Baixar backup** + copiar pasta `data/fotos` | Semanal (pendrive em rodízio) |
| Admin | Esqueceu a senha do admin → no servidor: `npm run reset-senha -- admin NovaSenha123` | Sob demanda |
| Admin | Carteirinha perdida → **Reemitir** (o QR antigo para de funcionar na hora) | Sob demanda |

## 6. Catraca/fechadura (opcional)

1. Grave `docs/esp32-acionamento/esp32-acionamento.ino` no ESP32 (Arduino IDE, placa "ESP32 Dev Module"), ajustando Wi-Fi, IP e chave.
2. Ligue o contato do relé na entrada de liberação externa da catraca (eletricista).
3. Em **Configurações → Pontos de acesso**, preencha a URL `http://192.168.0.50/abrir?chave=SUA_CHAVE`, salve e clique **Testar**.

## 7. Plano de implantação sugerido

| Semana | Atividade |
|---|---|
| 1 | Levantamento (itens "a validar" da lista de infra), compra dos equipamentos, instalação do servidor |
| 2 | Importação da base de sócios, saneamento de inconsistências, treinamento de recepção (1 h) |
| 3–4 | Recadastramento de fotos e entrega de carteirinhas; operação **em paralelo** com conferência por documento |
| 5 | Operação plena; documento só para quem esqueceu a carteirinha (busca por nome) |
