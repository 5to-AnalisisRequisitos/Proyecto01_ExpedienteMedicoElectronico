#!/bin/bash

# Servidor EME v3.0 - Control de Despliegue
# =============================================

echo "========================================"
echo "  EME - Expediente Medico Electronico"
echo "========================================"

# 1. Verificar si Node.js está instalado
if ! command -v node &> /dev/null; then
    echo "Error: Node.js no está instalado."
    echo "Abriendo página de descarga..."
    # Intenta abrir el navegador predeterminado
    xdg-open https://nodejs.org/es/download/
    echo "Instálalo y vuelve a ejecutar este script."
    exit 1
fi

# 2. Instalar dependencias si no existen
if [ ! -d "node_modules" ]; then
    echo "No se detectaron dependencias. Instalando..."
    npm install
    if [ $? -ne 0 ]; then
        echo "Error durante la instalación de dependencias."
        exit 1
    fi
    echo "Dependencias instaladas con éxito."
fi

# 3. Iniciar el servidor
echo "Lanzando el servidor..."
npm start