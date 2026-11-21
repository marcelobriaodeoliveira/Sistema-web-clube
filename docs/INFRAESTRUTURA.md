# Lista de Infraestrutura — Controle de Acesso do Clube

> **Valores são estimativas de faixa de mercado** para orientar o orçamento. **Cotar localmente** antes da compra.
> Itens marcados "a validar com o clube" dependem de levantamento em campo (equipamentos existentes, distâncias, cobertura de Wi-Fi).

## 1. Arquitetura

```
                 ┌──────────────── Rede local do clube (sem dependência de internet) ───────────────┐
                 │                                                                                    │
 [Secretaria]    │   SERVIDOR (PC/mini PC) ── nobreak                                                 │
  cadastro,      │     Node.js + SQLite  ── switch/roteador ──┬── cabo ──> [PORTARIA] PC/notebook     │
  fotos,         │     backup em pendrive                     │                + leitor QR USB        │
  carteirinhas   │                                            │                (+ ESP32/relé catraca) │
                 │                                            └── Wi-Fi ──> [PISCINA] tablet          │
                 │                                                 (AP externo)  + leitor QR BT/câmera│
                 │                                                               (+ ESP32/relé)       │
                 └────────────────────────────────────────────────────────────────────────────────────┘
```

**Por que servidor local e não nuvem:** zero mensalidade, resposta mais rápida e a entrada continua funcionando se a internet cair.
A nuvem (VPS a partir de ~R$ 30–60/mês) fica como alternativa caso o clube não tenha um PC que possa ficar ligado.

## 2. Itens obrigatórios

| # | Item | Especificação mínima | Qtd | Local | Faixa estimada (R$/un) | Observação |
|---|---|---|---|---|---|---|
| 1 | Servidor | PC ou mini PC: CPU dual-core, 4 GB RAM, SSD 120 GB, Windows 10/11 ou Linux, placa de rede | 1 | Secretaria | 0 (reaproveitar) a 600–1.200 (usado/mini PC) | Pode ser o PC da secretaria, desde que fique ligado no horário do clube |
| 2 | Nobreak | 600–700 VA, bivolt | 1 | Secretaria | 350–550 | Protege servidor e switch/roteador |
| 3 | Estação da portaria | PC, notebook ou tablet com navegador Chrome | 1 | Portaria | 0 (reaproveitar) a 700–1.200 | Monitor de 15"+ facilita ver a foto |
| 4 | Leitor QR Code 2D USB | Leitor de imagem 2D (lê QR em papel e em tela de celular), modo teclado/HID | 1 | Portaria | 150–300 | **Precisa ser 2D** — leitor 1D (código de barras comum) não lê QR |
| 5 | Estação da piscina | Tablet Android 8–10" ou celular reaproveitado | 1 | Piscina | 0 (reaproveitar) a 700–1.200 | Proteger de água/sol (capa e local coberto) |
| 6 | Leitor QR 2D sem fio (Bluetooth) | Pareia com o tablet como teclado | 1 | Piscina | 250–450 | Alternativa grátis: câmera do tablet (exige HTTPS — ver INSTALACAO.md) |
| 7 | Suporte para tablet | Suporte de mesa/parede com trava | 1 | Piscina | 60–150 | |
| 8 | Roteador / switch | Roteador Wi-Fi ou switch 5–8 portas | 1 | Secretaria | 80–250 | Pode já existir — a validar com o clube |
| 9 | Ponto de acesso Wi-Fi externo | AP/CPE para área externa (IP65) — se o Wi-Fi atual não alcança a piscina | 1 | Piscina | 200–450 | A validar com teste de sinal no local |
| 10 | Cabeamento de rede | Cabo Cat5e/Cat6 + conectores RJ45 + canaleta | conforme distância | Secretaria→Portaria/AP | 2–4/m | Medir distâncias em campo |
| 11 | Webcam (fotos dos sócios) | 720p ou superior | 1 | Secretaria | 80–150 | Ou usar foto do celular/arquivo |
| 12 | Mídia de backup | Pendrive 32 GB ou HD externo | 2 | Secretaria | 40–300 | Rodízio de 2 mídias; guardar uma fora do clube |

## 3. Carteirinhas (escolher uma opção)

| Opção | Custo estimado | Comentário |
|---|---|---|
| A. Impressão em papel cartão 180 g + plastificação | R$ 1–2 por carteirinha | Impressora comum; mais barato |
| B. Terceirizar em PVC (gráfica) a partir do arquivo do sistema | R$ 3–6 por carteirinha | Mais durável, sem investimento |
| C. QR digital no celular (enviado por WhatsApp) | R$ 0 | Sistema já gera o PNG; o leitor 2D lê na tela do celular |
| D. Impressora térmica de cartão PVC | R$ 6.000–10.000 (equipamento) | **Não recomendado** para o orçamento atual |

Recomendação: **C para todos + A ou B** para quem preferir cartão físico (crianças, idosos).

## 4. Itens opcionais — automação de catraca/fechadura

O sistema já envia o comando de liberação; só é necessário o hardware abaixo **por ponto** que for automatizado.

| # | Item | Especificação | Qtd/ponto | Faixa estimada (R$) | Observação |
|---|---|---|---|---|---|
| 13 | Módulo ESP32 | ESP32 DevKit com Wi-Fi | 1 | 30–60 | Firmware em `docs/esp32-acionamento` |
| 14 | Módulo relé | 1 canal, 5 V, opto-isolado | 1 | 10–25 | |
| 15 | Fonte + caixa | Fonte 5 V 1 A + caixa plástica com prensa-cabo | 1 | 30–60 | |
| 16 | Catraca | Catraca/torniquete com entrada de liberação externa (contato seco) | 1 | 2.500–6.000 | Só se o clube não tiver; verificar se a existente aceita contato seco |
| 17 | Fechadura eletroímã (alternativa à catraca) | 150–300 kgf + fonte com bateria + botão de saída | 1 | 250–600 | Para portão/porta da área da piscina |

**Instalação elétrica da catraca/fechadura:** recomenda-se eletricista. Manter sempre **liberação manual de emergência** (rota de fuga).

## 5. Software

| Item | Custo |
|---|---|
| Sistema de controle de acesso (este repositório) | R$ 0 |
| Node.js 22 LTS, navegador Chrome | R$ 0 |
| Sistema operacional | Usar o existente (Windows) ou Linux gratuito |
| Certificado HTTPS (só para câmera em tablet) | R$ 0 (autoassinado) |

## 6. Resumo por cenário (estimativa)

| Cenário | Composição | Faixa estimada |
|---|---|---|
| **Mínimo** | Reaproveita PC (servidor+portaria) e celular/tablet existente; compra leitor USB, nobreak e pendrive; carteirinha digital | **R$ 580 – 1.150** |
| **Recomendado** | Mínimo + mini PC dedicado, tablet novo, leitor Bluetooth na piscina, suporte, AP externo, webcam, cabeamento (~30 m) | **R$ 2.530 – 4.870** |
| **Com automação** | Recomendado + ESP32/relé/fonte em 2 pontos (catraca já existente) | **+ R$ 140 – 290** |

Catraca nova e fechadura eletroímã não entram nos totais acima (somar conforme item 16/17).

## 7. Pontos a validar com o clube antes da compra

- [ ] Quantidade de sócios titulares e dependentes (define tempo de cadastro/fotos e quantidade de carteirinhas).
- [ ] Existe planilha/sistema com a lista de sócios? Formato (Excel, sistema da tesouraria)? → importação CSV.
- [ ] Existe PC que possa ficar ligado como servidor? Sistema operacional?
- [ ] Cobertura de Wi-Fi na entrada da piscina (teste de sinal com celular).
- [ ] Distância em metros secretaria → portaria e secretaria → piscina.
- [ ] Existe catraca/portão eletrônico? Aceita comando por contato seco?
- [ ] Regra de exame médico da piscina: validade (ex.: 6 meses) e quem lança no sistema.
- [ ] Como a tesouraria informa a situação de pagamento (atualização de "mensalidade paga até").
- [ ] Responsável pelo backup semanal.

## 8. LGPD

O sistema armazena nome, CPF, data de nascimento, foto e histórico de acesso. Recomendações:
informar os sócios sobre a finalidade (controle de acesso), restringir o perfil **admin** a poucas pessoas,
usar senhas individuais por funcionário, guardar os backups em local seguro e excluir dados de ex-sócios quando não houver mais necessidade.
