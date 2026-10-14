@echo off
title WhatsApp Web - Servidor WiFi en Tiempo Real
cd /d "%~dp0"

set "NODE_CMD=node"
where node >nul 2>nul
if errorlevel 1 (
  if exist "C:\Program Files\Adobe\Adobe Photoshop 2025\node.exe" (
    set "NODE_CMD=C:\Program Files\Adobe\Adobe Photoshop 2025\node.exe"
  ) else if exist "C:\Program Files\nodejs\node.exe" (
    set "NODE_CMD=C:\Program Files\nodejs\node.exe"
  ) else (
    echo.
    echo ==============================================================
    echo  No se encontro Node.js en el sistema.
    echo  Descargalo desde https://nodejs.org para habilitar la red WiFi.
    echo  Abriendo version local en tu navegador...
    echo ==============================================================
    echo.
    start "" "%~dp0index.html"
    pause
    exit /b
  )
)

echo.
echo ==============================================================
echo   Iniciando Servidor WhatsApp Web en Tiempo Real...
echo   En esta PC:         http://localhost:3000
echo   En el Celular WiFi:  http://192.168.101.73:3000/?user=hermano
echo ==============================================================
echo.
start "" http://localhost:3000
"%NODE_CMD%" server.js
pause
