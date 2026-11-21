@echo off
REM Inicia o sistema do clube. Coloque um atalho deste arquivo em shell:startup para iniciar com o Windows.
cd /d "%~dp0"
if not exist node_modules (call npm install --omit=dev)
:loop
node --no-warnings src\server.js
echo Servidor parou. Reiniciando em 5 segundos...
timeout /t 5 >nul
goto loop
