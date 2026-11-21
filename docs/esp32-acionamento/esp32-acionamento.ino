/*
  Acionamento de catraca / fechadura eletromagnética pelo Sistema do Clube
  Hardware: ESP32 DevKit + módulo relé 1 canal 5V (opto-isolado) + fonte 5V 1A.
  Ligação: relé IN -> GPIO 26 | VCC -> 5V | GND -> GND.
           Contato NA/COM do relé -> entrada "liberação externa / botoeira" da catraca
           (ou em série com a alimentação da fechadura eletroímã, usando o contato NF).
  Uso: o sistema chama  http://IP_DO_ESP32/abrir?chave=SUA_CHAVE  quando o acesso é liberado.
  Cadastre essa URL em Configurações > Pontos de acesso > URL de acionamento.
*/
#include <WiFi.h>
#include <WebServer.h>

const char* WIFI_NOME  = "REDE_DO_CLUBE";
const char* WIFI_SENHA = "SENHA_DA_REDE";
const char* CHAVE      = "troque-esta-chave";   // mesma chave usada na URL
const int   PINO_RELE  = 26;
const int   PULSO_MS   = 1000;                  // tempo que o relé fica acionado
const bool  RELE_ATIVO_BAIXO = true;            // maioria dos módulos relé aciona com nível LOW

// IP fixo (ajuste para a faixa da rede do clube)
IPAddress ip(192, 168, 0, 50), gateway(192, 168, 0, 1), mascara(255, 255, 255, 0);

WebServer server(80);

void rele(bool ligado) { digitalWrite(PINO_RELE, (ligado ^ RELE_ATIVO_BAIXO) ? HIGH : LOW); }

void abrir() {
  if (server.arg("chave") != CHAVE) { server.send(403, "text/plain", "chave invalida"); return; }
  rele(true); delay(PULSO_MS); rele(false);
  server.send(200, "text/plain", "ok");
}

void setup() {
  pinMode(PINO_RELE, OUTPUT); rele(false);
  Serial.begin(115200);
  WiFi.config(ip, gateway, mascara);
  WiFi.begin(WIFI_NOME, WIFI_SENHA);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.printf("\nConectado. IP: %s\n", WiFi.localIP().toString().c_str());
  server.on("/abrir", abrir);
  server.on("/", []() { server.send(200, "text/plain", "acionamento ativo"); });
  server.begin();
}

void loop() {
  server.handleClient();
  if (WiFi.status() != WL_CONNECTED) { WiFi.reconnect(); delay(2000); }
}
