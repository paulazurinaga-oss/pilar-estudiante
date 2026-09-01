@echo off
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js no esta instalado. Instala Node.js para poder abrir PILAR del estudiante.
  pause
  exit /b 1
)

tasklist /FI "IMAGENAME eq node.exe" 2>NUL | find /I /N "node.exe">NUL
if errorlevel 1 (
  start "PILAR server" cmd /k "node server.js"
)

start "" "http://127.0.0.1:3000/"