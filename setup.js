const fs = require('fs');
const crypto = require('crypto');

// Comprobamos si el archivo .env ya existe para no sobrescribir datos de un usuario activo
if (!fs.existsSync('.env')) {
  console.log('⚠ No se encontró el archivo .env. Generando entorno limpio automáticamente...');
  
  // Generamos un secreto criptográfico aleatorio y seguro de 64 caracteres en hexadecimal
  const nuevoSecreto = crypto.randomBytes(32).toString('hex');
  
  // Definimos la estructura del archivo directamente en el código
  const estructuraBaseEnv = `# ============================================================
# CONFIGURACIÓN AUTOMÁTICA DEL SISTEMA EME
# ============================================================
# Generado de forma independiente para cada entorno de usuario.

# Secreto criptográfico aleatorio único para firmar tokens JWT
JWT_SECRET=${nuevoSecreto}

# Puerto de escucha para el servidor Express
PORT=3000

# Parámetros de seguridad del caso de uso (Valores por defecto)
INACTIVITY_TIMEOUT_MINUTES=15
MAX_LOGIN_ATTEMPTS=5
LOGIN_BLOCK_MINUTES=15
`;

  try {
    // Escribimos el archivo .env en la raíz del proyecto
    fs.writeFileSync('.env', estructuraBaseEnv, 'utf8');
    console.log('✓ Archivo .env independiente creado con éxito y JWT Secret configurado.');
  } catch (error) {
    console.error('❌ Error crítico al escribir el archivo .env:', error.message);
  }
} else {
  console.log('✓ El archivo .env ya existe. Omitiendo inicialización.');
}