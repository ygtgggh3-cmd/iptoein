@echo off
chcp 65001 >nul
title Compilar ConversorIPK.exe
echo ============================================
echo   Compilando ConversorIPK.exe (necesita internet y Node.js)
echo ============================================
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo No se encontro Node.js. Instalalo desde https://nodejs.org
  echo Para Windows 7/8/8.1 usa Node 14 o 16 ^(LTS antiguo^).
  pause
  exit /b 1
)
cd /d "%~dp0"
call npm install
if errorlevel 1 goto fallo
call npx --yes electron-packager@17 . ConversorIPK --platform=win32 --arch=x64 --electron-version=22.3.27 --out=dist --overwrite --ignore="^/dist" --ignore="COMPILAR.bat"
if errorlevel 1 goto fallo
echo.
echo ============================================
echo   LISTO. Abre:  dist\ConversorIPK-win32-x64\ConversorIPK.exe
echo ============================================
pause
exit /b 0
:fallo
echo.
echo Hubo un error. Revisa los mensajes de arriba.
pause
exit /b 1
