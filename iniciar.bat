@echo off
title WhatsApp Web - Servidor y App
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  ==============================================================
  echo   WhatsApp Web - Modo Navegador Directo
  echo   No se detecto Node.js instalado en el sistema.
  echo   Abriendo index.html directamente en tu navegador...
  echo   (Sincronizacion activa entre pestanas y ventanas)
  echo  ==============================================================
  echo.
  start "" "%~dp0index.html"
  pause
  exit /b
)
echo.
echo  ==============================================================
echo   Iniciando WhatsApp Web con servidor Node.js en tiempo real...
echo  ==============================================================
echo.
start "" http://localhost:3000
node server.js
pause
