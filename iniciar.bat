@echo off
title Servidor EME v3.0 - Control de Despliegue
echo ========================================
echo   EME - Expediente Medico Electronico
echo ========================================
echo.

:: 1. Comprobar si Node.js está instalado en el sistema
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ========================================================
    echo ERROR: Node.js no esta instalado en tu sistema.
    echo ========================================================
    echo.
    echo El sistema EME requiere Node.js para funcionar.
    echo.
    echo Abriendo la pagina de descarga...
    start https://nodejs.org/es/download/current/
    echo.
    echo Por favor, instalalo, reinicia tu equipo y vuelve a ejecutar este archivo.
    echo.
    pause
    exit /b 1
)

:: 2. Instalar dependencias si no existe la carpeta node_modules
if not exist "node_modules" (
    echo No se detectaron las librerias. Instalando dependencias por primera vez...
    call npm install
    if errorlevel 1 (
        echo ERROR: Hubo un fallo al ejecutar 'npm install'.
        pause
        exit /b 1
    )
    echo ✓ Dependencias instaladas correctamente.
    echo.
)

:: 3. Arrancar el script multiplataforma que creaste
echo Iniciando secuencia automatizada...
call npm start

pause