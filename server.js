require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const initSqlJs = require('sql.js');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'eme_jwt_dev_secret_CAMBIAR_en_produccion!';
const DB_FILE = path.join(__dirname, 'eme.db');

// ============================================
// SEGURIDAD: Cabeceras HTTP con Helmet
// ============================================
app.use(helmet({
  contentSecurityPolicy: false // Desactivado para permitir el frontend inline
}));

// ============================================
// SEGURIDAD: CORS restringido al origen local
// ============================================
const allowedOrigins = [
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`
];

app.use(cors({
  origin: (origin, callback) => {
    // Permitir sin origin (apps nativas, Postman, curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Origen no permitido por CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// ============================================
// SEGURIDAD: Rate limiting en login
// ============================================
const loginRateLimit = rateLimit({
  windowMs: (parseInt(process.env.LOGIN_BLOCK_MINUTES) || 15) * 60 * 1000,
  max: parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 5,
  message: {
    error: `Demasiados intentos de inicio de sesión. Intenta de nuevo en ${process.env.LOGIN_BLOCK_MINUTES || 15} minutos.`
  },
  standardHeaders: true,
  legacyHeaders: false
});

// ============================================
// SEGURIDAD: Bloquear acceso a archivos sensibles
// ============================================
app.use((req, res, next) => {
  const blockedPaths = ['.env', 'eme.db', '.gitignore', 'package.json', 'server.js'];
  const requestedFile = path.basename(req.path);
  if (blockedPaths.some(f => req.path.includes(f))) {
    return res.status(403).json({ error: 'Acceso denegado' });
  }
  next();
});

app.use(express.json({ limit: '1mb' })); // Limitar tamaño de requests
app.use(express.static(path.join(__dirname, 'public')));

let db;

// ============================================
// FUNCIONES AUXILIARES DE BASE DE DATOS
// ============================================
function saveDatabase() {
  const data = db.export();
  fs.writeFileSync(DB_FILE, Buffer.from(data));
}

function runQuery(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  stmt.free();
  saveDatabase();
}

function getQuery(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const result = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return result;
}

function allQuery(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function insertQuery(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  stmt.free();
  const result = db.exec("SELECT last_insert_rowid() as id");
  saveDatabase();
  return result[0].values[0][0];
}

// ============================================
// FUNCIONES DE AUDITORÍA
// ============================================
function registrarAuditoria(req, accion, entidad, entidadId, descripcion, datosAntes = null, datosDespues = null, exitoso = true, mensajeError = null) {
  try {
    const usuario = req.usuario || {};
    const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';

    runQuery(
      `INSERT INTO auditoria (usuario_id, usuario_email, usuario_rol, accion, entidad, entidad_id, descripcion, datos_antes, datos_despues, ip_origen, user_agent, exitoso, mensaje_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        usuario.id || null,
        usuario.email || 'sistema',
        usuario.rol || 'sistema',
        accion,
        entidad,
        entidadId,
        descripcion,
        datosAntes ? JSON.stringify(datosAntes) : null,
        datosDespues ? JSON.stringify(datosDespues) : null,
        ip,
        userAgent,
        exitoso ? 1 : 0,
        mensajeError
      ]
    );
  } catch (err) {
    console.error('Error registrando auditoría:', err);
  }
}

// ============================================
// GENERADORES
// ============================================
function generarCodigoRecuperacion() {
  const bytes = crypto.randomBytes(8);
  const partes = [];
  for (let i = 0; i < 8; i += 2) {
    partes.push(bytes.readUInt16BE(i).toString(16).toUpperCase().padStart(4, '0'));
  }
  return 'EME-' + partes.join('-');
}

function generarNumeroExpediente() {
  const year = new Date().getFullYear();
  const result = getQuery(
    `SELECT COUNT(*) + 1 as siguiente FROM expedientes WHERE numero_expediente LIKE ?`,
    [`EXP-${year}-%`]
  );
  const numero = String(result.siguiente).padStart(5, '0');
  return `EXP-${year}-${numero}`;
}

// ============================================
// INICIALIZACIÓN DE BASE DE DATOS
// ============================================
async function initDatabase() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_FILE)) {
    const fileBuffer = fs.readFileSync(DB_FILE);
    db = new SQL.Database(fileBuffer);
    console.log('✓ Base de datos cargada');
  } else {
    db = new SQL.Database();
    console.log('✓ Nueva base de datos creada');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      contrasena TEXT NOT NULL,
      codigo_recuperacion TEXT NOT NULL,
      nombre TEXT NOT NULL,
      apellido TEXT NOT NULL,
      rol TEXT NOT NULL,
      especialidad TEXT,
      numero_licencia TEXT UNIQUE,
      telefono TEXT,
      activo INTEGER DEFAULT 1,
      fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
      ultimo_acceso DATETIME
    );

    CREATE TABLE IF NOT EXISTS pacientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero_identidad TEXT UNIQUE NOT NULL,
      nombre TEXT NOT NULL,
      apellido TEXT NOT NULL,
      fecha_nacimiento DATE NOT NULL,
      sexo TEXT NOT NULL,
      telefono TEXT,
      email TEXT,
      direccion TEXT,
      ciudad TEXT,
      tipo_sangre TEXT,
      alergias TEXT,
      observaciones TEXT,
      activo INTEGER DEFAULT 1,
      fecha_eliminacion DATETIME,
      eliminado_por_id INTEGER,
      motivo_eliminacion TEXT,
      fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (eliminado_por_id) REFERENCES usuarios(id)
    );

    CREATE TABLE IF NOT EXISTS expedientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero_expediente TEXT UNIQUE NOT NULL,
      paciente_id INTEGER UNIQUE NOT NULL,
      medico_responsable_id INTEGER,
      motivo_apertura TEXT NOT NULL,
      estado TEXT DEFAULT 'activo',
      fecha_apertura DATETIME DEFAULT CURRENT_TIMESTAMP,
      abierto_por_id INTEGER NOT NULL,
      notas_apertura TEXT,
      FOREIGN KEY (paciente_id) REFERENCES pacientes(id),
      FOREIGN KEY (medico_responsable_id) REFERENCES usuarios(id),
      FOREIGN KEY (abierto_por_id) REFERENCES usuarios(id)
    );

    CREATE TABLE IF NOT EXISTS citas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paciente_id INTEGER NOT NULL,
      medico_id INTEGER NOT NULL,
      fecha_cita DATE NOT NULL,
      hora_cita TIME NOT NULL,
      estado TEXT DEFAULT 'pendiente',
      motivo_consulta TEXT,
      notas TEXT,
      agendada_por_id INTEGER,
      fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (paciente_id) REFERENCES pacientes(id),
      FOREIGN KEY (medico_id) REFERENCES usuarios(id),
      FOREIGN KEY (agendada_por_id) REFERENCES usuarios(id)
    );

    CREATE TABLE IF NOT EXISTS consultas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cita_id INTEGER,
      paciente_id INTEGER NOT NULL,
      medico_id INTEGER NOT NULL,
      fecha_consulta DATETIME DEFAULT CURRENT_TIMESTAMP,
      peso REAL,
      altura REAL,
      presion_arterial TEXT,
      temperatura REAL,
      frecuencia_cardiaca INTEGER,
      motivo_consulta TEXT NOT NULL,
      sintomas TEXT NOT NULL,
      diagnostico TEXT NOT NULL,
      plan_tratamiento TEXT,
      observaciones TEXT,
      fecha_proximo_control DATE,
      FOREIGN KEY (cita_id) REFERENCES citas(id),
      FOREIGN KEY (paciente_id) REFERENCES pacientes(id),
      FOREIGN KEY (medico_id) REFERENCES usuarios(id)
    );

    CREATE TABLE IF NOT EXISTS antecedentes_medicos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paciente_id INTEGER NOT NULL,
      consulta_id INTEGER,
      tipo TEXT NOT NULL,
      condicion TEXT,
      medicamento_nombre TEXT,
      dosis TEXT,
      cantidad INTEGER,
      duracion_dias INTEGER,
      estado TEXT DEFAULT 'activo',
      notas TEXT,
      fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (paciente_id) REFERENCES pacientes(id),
      FOREIGN KEY (consulta_id) REFERENCES consultas(id)
    );

    CREATE TABLE IF NOT EXISTS auditoria (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER,
      usuario_email TEXT NOT NULL,
      usuario_rol TEXT NOT NULL,
      accion TEXT NOT NULL,
      entidad TEXT NOT NULL,
      entidad_id INTEGER,
      descripcion TEXT,
      datos_antes TEXT,
      datos_despues TEXT,
      ip_origen TEXT,
      user_agent TEXT,
      fecha_accion DATETIME DEFAULT CURRENT_TIMESTAMP,
      exitoso INTEGER DEFAULT 1,
      mensaje_error TEXT,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    );

    CREATE INDEX IF NOT EXISTS idx_pacientes_identidad ON pacientes(numero_identidad);
    CREATE INDEX IF NOT EXISTS idx_pacientes_nombre ON pacientes(nombre);
    CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);
    CREATE INDEX IF NOT EXISTS idx_expedientes_numero ON expedientes(numero_expediente);
    CREATE INDEX IF NOT EXISTS idx_citas_fecha ON citas(fecha_cita);
    CREATE INDEX IF NOT EXISTS idx_consultas_paciente ON consultas(paciente_id);
    CREATE INDEX IF NOT EXISTS idx_auditoria_usuario ON auditoria(usuario_id);
    CREATE INDEX IF NOT EXISTS idx_auditoria_fecha ON auditoria(fecha_accion);
    CREATE INDEX IF NOT EXISTS idx_pacientes_activo ON pacientes(activo);
  `);

  // Migración para BDs existentes: agregar columnas nuevas si no existen
  try {
    const columnasPacientes = allQuery("PRAGMA table_info(pacientes)");
    const tieneActivo = columnasPacientes.some(c => c.name === 'activo');
    
    if (!tieneActivo) {
      console.log('→ Migrando tabla pacientes: agregando columnas de eliminación lógica');
      db.exec(`
        ALTER TABLE pacientes ADD COLUMN activo INTEGER DEFAULT 1;
        ALTER TABLE pacientes ADD COLUMN fecha_eliminacion DATETIME;
        ALTER TABLE pacientes ADD COLUMN eliminado_por_id INTEGER;
        ALTER TABLE pacientes ADD COLUMN motivo_eliminacion TEXT;
      `);
      // Asegurar que todos los pacientes existentes queden como activos
      db.exec(`UPDATE pacientes SET activo = 1 WHERE activo IS NULL`);
      console.log('✓ Migración completada');
    }

    // Migración: eliminar tabla seguros_medicos si existe (deprecada)
    const tablas = allQuery("SELECT name FROM sqlite_master WHERE type='table' AND name='seguros_medicos'");
    if (tablas.length > 0) {
      console.log('→ Eliminando tabla seguros_medicos (deprecada)');
      db.exec(`DROP TABLE seguros_medicos`);
      console.log('✓ Tabla seguros_medicos eliminada');
    }
  } catch (err) {
    console.error('Error en migración:', err);
  }

  saveDatabase();
  console.log('✓ Tablas verificadas');
}

// ============================================
// MIDDLEWARE DE AUTENTICACIÓN
// ============================================
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Token requerido' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.usuario = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

// Middleware para verificar rol
function requireRole(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.usuario) {
      return res.status(401).json({ error: 'No autenticado' });
    }
    if (!rolesPermitidos.includes(req.usuario.rol)) {
      registrarAuditoria(req, 'ACCESS_DENIED', 'sistema', null, 
        `Intento de acceso denegado a ${req.path}`, null, null, false, 
        `Rol ${req.usuario.rol} no autorizado`);
      return res.status(403).json({ error: 'No tienes permisos para esta acción' });
    }
    next();
  };
}

// ============================================
// ENDPOINTS DE AUTENTICACIÓN
// ============================================

// Verificar estado del setup (si hay usuarios y/o admin)
app.get('/api/auth/setup-status', (req, res) => {
  const totalUsuarios = getQuery('SELECT COUNT(*) as count FROM usuarios');
  const totalAdmins = getQuery("SELECT COUNT(*) as count FROM usuarios WHERE rol = 'admin' AND activo = 1");
  res.json({ 
    tieneUsuarios: totalUsuarios.count > 0,
    tieneAdmin: totalAdmins.count > 0,
    requiereBootstrap: totalAdmins.count === 0
  });
});

// Registro de usuarios
// Lógica:
//   - Si NO hay admin en el sistema → BOOTSTRAP: el primer usuario es admin (sin autenticación)
//   - Si YA hay admin → solo el admin puede crear nuevos usuarios (médicos/recepcionistas)
app.post('/api/auth/registro', (req, res) => {
  try {
    const { email, password, nombre, apellido, rol, especialidad, numero_licencia, telefono } = req.body;

    if (!email || !password || !nombre || !apellido || !rol) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }

    if (!['medico', 'recepcionista', 'admin'].includes(rol)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }

    // Verificar si existe ya un admin en el sistema
    const adminCount = getQuery("SELECT COUNT(*) as count FROM usuarios WHERE rol = 'admin' AND activo = 1");
    const requiereBootstrap = adminCount.count === 0;

    if (requiereBootstrap) {
      // BOOTSTRAP: no hay admin, el primer registro debe ser admin
      if (rol !== 'admin') {
        return res.status(403).json({ 
          error: 'El sistema requiere primero un administrador. Por favor regístrate con rol "admin".' 
        });
      }
      // No requiere autenticación - es el primer usuario
      console.log('→ BOOTSTRAP: creando primer administrador');
    } else {
      // YA hay admin: solo un admin autenticado puede crear nuevos usuarios
      const token = req.headers.authorization?.split(' ')[1];
      if (!token) {
        return res.status(401).json({ 
          error: 'Solo el administrador puede crear nuevos usuarios. Inicia sesión como admin.' 
        });
      }
      
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.rol !== 'admin') {
          return res.status(403).json({ 
            error: 'Solo el administrador puede crear nuevos usuarios.' 
          });
        }
        req.usuario = decoded;
      } catch (err) {
        return res.status(401).json({ error: 'Token inválido' });
      }
    }

    // Validaciones por rol
    if (rol === 'medico' && !numero_licencia) {
      return res.status(400).json({ error: 'Los médicos deben proporcionar número de licencia' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    }

    // Política de contraseña robusta
    const tieneMinuscula = /[a-z]/.test(password);
    const tieneMayuscula = /[A-Z]/.test(password);
    const tieneNumero = /[0-9]/.test(password);
    if (!tieneMinuscula || !tieneMayuscula || !tieneNumero) {
      return res.status(400).json({ 
        error: 'La contraseña debe tener al menos una mayúscula, una minúscula y un número' 
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Email inválido' });
    }

    const existeEmail = getQuery('SELECT id FROM usuarios WHERE email = ?', [email]);
    if (existeEmail) {
      return res.status(400).json({ error: 'Este email ya está registrado' });
    }

    if (numero_licencia) {
      const existeLicencia = getQuery('SELECT id FROM usuarios WHERE numero_licencia = ?', [numero_licencia]);
      if (existeLicencia) {
        return res.status(400).json({ error: 'Este número de licencia ya está registrado' });
      }
    }

    const codigoRecuperacion = generarCodigoRecuperacion();
    const hashedPassword = bcrypt.hashSync(password, 10);
    const hashedCodigo = bcrypt.hashSync(codigoRecuperacion, 10);

    const id = insertQuery(
      `INSERT INTO usuarios (email, contrasena, codigo_recuperacion, nombre, apellido, rol, especialidad, numero_licencia, telefono)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [email, hashedPassword, hashedCodigo, nombre, apellido, rol, especialidad || null, numero_licencia || null, telefono || null]
    );

    // Auditoría: si fue bootstrap, el actor es "SISTEMA"; si no, el admin
    const reqAudit = requiereBootstrap 
      ? { usuario: { id, email, rol: 'sistema' }, ip: req.ip, headers: req.headers }
      : req;
    
    registrarAuditoria(reqAudit, 'CREATE', 'usuarios', id, 
      requiereBootstrap 
        ? `Bootstrap: primer admin creado: ${nombre} ${apellido}`
        : `Admin creó ${rol}: ${nombre} ${apellido}`
    );

    console.log(`✓ ${requiereBootstrap ? 'Bootstrap admin' : 'Nuevo ' + rol} registrado: ${nombre} ${apellido} (${email})`);

    res.status(201).json({
      id,
      email,
      nombre,
      apellido,
      rol,
      codigoRecuperacion,
      bootstrap: requiereBootstrap,
      mensaje: 'Guarda tu código de recuperación. Es la única forma de recuperar tu contraseña.'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al registrar' });
  }
});

// Login
app.post('/api/auth/login', loginRateLimit, (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña requeridos' });
    }

    const usuario = getQuery('SELECT * FROM usuarios WHERE email = ?', [email]);

    // ⚠ Mensaje genérico para no revelar si el email existe o no
    if (!usuario) {
      registrarAuditoria(
        { ip: req.ip, headers: req.headers },
        'LOGIN_FAILED', 'usuarios', null,
        `Intento fallido: email no registrado`,
        null, null, false, 'Email no encontrado'
      );
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // ⚠ Mensaje genérico también para usuario desactivado
    if (!usuario.activo) {
      registrarAuditoria(
        { usuario: { id: usuario.id, email, rol: usuario.rol }, ip: req.ip, headers: req.headers },
        'LOGIN_FAILED', 'usuarios', usuario.id,
        `Intento de login en cuenta inactiva: ${email}`,
        null, null, false, 'Cuenta inactiva'
      );
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const validPassword = bcrypt.compareSync(password, usuario.contrasena);
    if (!validPassword) {
      registrarAuditoria(
        { usuario: { id: usuario.id, email, rol: usuario.rol }, ip: req.ip, headers: req.headers },
        'LOGIN_FAILED', 'usuarios', usuario.id,
        `Intento de login fallido: contraseña incorrecta`,
        null, null, false, 'Contraseña incorrecta'
      );
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const token = jwt.sign(
      { id: usuario.id, email: usuario.email, rol: usuario.rol, nombre: usuario.nombre + ' ' + usuario.apellido },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    runQuery('UPDATE usuarios SET ultimo_acceso = CURRENT_TIMESTAMP WHERE id = ?', [usuario.id]);

    registrarAuditoria(
      { usuario: { id: usuario.id, email, rol: usuario.rol }, ip: req.ip, headers: req.headers },
      'LOGIN', 'usuarios', usuario.id,
      `Login exitoso: ${email}`
    );

    res.json({
      id: usuario.id,
      nombre: usuario.nombre,
      apellido: usuario.apellido,
      email: usuario.email,
      rol: usuario.rol,
      especialidad: usuario.especialidad,
      numero_licencia: usuario.numero_licencia,
      token
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// Verificar código de recuperación
app.post('/api/auth/verificar-codigo', (req, res) => {
  try {
    const { email, codigo } = req.body;
    if (!email || !codigo) {
      return res.status(400).json({ error: 'Email y código son requeridos' });
    }

    const usuario = getQuery('SELECT * FROM usuarios WHERE email = ?', [email]);
    if (!usuario) {
      return res.status(401).json({ error: 'Email o código inválido' });
    }

    const codigoValido = bcrypt.compareSync(codigo, usuario.codigo_recuperacion);
    if (!codigoValido) {
      return res.status(401).json({ error: 'Email o código inválido' });
    }

    const resetToken = jwt.sign(
      { id: usuario.id, email: usuario.email, purpose: 'reset' },
      JWT_SECRET,
      { expiresIn: '15m' }
    );

    res.json({
      message: 'Código verificado correctamente',
      resetToken
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al verificar código' });
  }
});

// Restablecer contraseña
app.post('/api/auth/reset-password', (req, res) => {
  try {
    const { resetToken, nuevaPassword } = req.body;
    if (!resetToken || !nuevaPassword) {
      return res.status(400).json({ error: 'Token y nueva contraseña son requeridos' });
    }

    if (nuevaPassword.length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    }

    let decoded;
    try {
      decoded = jwt.verify(resetToken, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: 'Token expirado o inválido' });
    }

    if (decoded.purpose !== 'reset') {
      return res.status(401).json({ error: 'Token inválido' });
    }

    const nuevoCodigo = generarCodigoRecuperacion();
    const hashedPassword = bcrypt.hashSync(nuevaPassword, 10);
    const hashedCodigo = bcrypt.hashSync(nuevoCodigo, 10);

    runQuery(
      'UPDATE usuarios SET contrasena = ?, codigo_recuperacion = ? WHERE id = ?',
      [hashedPassword, hashedCodigo, decoded.id]
    );

    registrarAuditoria(
      { usuario: { id: decoded.id, email: decoded.email }, ip: req.ip, headers: req.headers },
      'PASSWORD_RESET', 'usuarios', decoded.id,
      'Contraseña restablecida con código de recuperación'
    );

    res.json({
      message: 'Contraseña restablecida exitosamente',
      nuevoCodigoRecuperacion: nuevoCodigo
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al restablecer contraseña' });
  }
});

// ============================================
// ENDPOINTS DE INFORMACIÓN
// ============================================
app.get('/api/usuario/info', authMiddleware, (req, res) => {
  const usuario = getQuery(
    'SELECT id, email, nombre, apellido, rol, especialidad, numero_licencia, telefono FROM usuarios WHERE id = ?',
    [req.usuario.id]
  );
  res.json(usuario);
});

app.get('/api/dashboard/stats', authMiddleware, (req, res) => {
  const hoy = new Date().toISOString().split('T')[0];
  const inicioMes = new Date();
  inicioMes.setDate(1);
  const inicioMesStr = inicioMes.toISOString().split('T')[0];

  let citasHoyQuery, consultasMesQuery;
  let citasHoyParams, consultasMesParams;

  if (req.usuario.rol === 'medico') {
    citasHoyQuery = 'SELECT COUNT(*) as count FROM citas WHERE fecha_cita = ? AND medico_id = ?';
    citasHoyParams = [hoy, req.usuario.id];
    consultasMesQuery = 'SELECT COUNT(*) as count FROM consultas WHERE date(fecha_consulta) >= ? AND medico_id = ?';
    consultasMesParams = [inicioMesStr, req.usuario.id];
  } else {
    citasHoyQuery = 'SELECT COUNT(*) as count FROM citas WHERE fecha_cita = ?';
    citasHoyParams = [hoy];
    consultasMesQuery = 'SELECT COUNT(*) as count FROM consultas WHERE date(fecha_consulta) >= ?';
    consultasMesParams = [inicioMesStr];
  }

  const citasHoy = getQuery(citasHoyQuery, citasHoyParams);
  const totalPacientes = getQuery('SELECT COUNT(*) as count FROM pacientes', []);
  const consultasMes = getQuery(consultasMesQuery, consultasMesParams);
  const expedientesActivos = getQuery("SELECT COUNT(*) as count FROM expedientes WHERE estado = 'activo'", []);

  res.json({
    citasHoy: citasHoy.count,
    totalPacientes: totalPacientes.count,
    consultasMes: consultasMes.count,
    expedientesActivos: expedientesActivos.count
  });
});

// ============================================
// ENDPOINTS DE PACIENTES
// ============================================
app.get('/api/pacientes', authMiddleware, (req, res) => {
  const { search } = req.query;
  let query = `
    SELECT p.*, e.numero_expediente, e.estado as estado_expediente
    FROM pacientes p
    LEFT JOIN expedientes e ON e.paciente_id = p.id
    WHERE p.activo = 1
  `;
  let params = [];

  if (search) {
    query += ' AND (p.nombre LIKE ? OR p.apellido LIKE ? OR p.numero_identidad LIKE ? OR p.telefono LIKE ?)';
    const searchTerm = `%${search}%`;
    params = [searchTerm, searchTerm, searchTerm, searchTerm];
  }

  query += ' ORDER BY p.fecha_registro DESC';
  const pacientes = allQuery(query, params);
  res.json(pacientes);
});

// Búsqueda de pacientes para apertura de expediente
// Acepta cédula EXACTA o nombre/apellido PARCIAL (mínimo 3 caracteres)
// Devuelve un array de coincidencias para que el usuario elija
app.get('/api/pacientes/buscar/:termino', authMiddleware, (req, res) => {
  const termino = (req.params.termino || '').trim();
  
  if (termino.length < 3) {
    return res.status(400).json({ error: 'Ingresa al menos 3 caracteres para buscar' });
  }

  // Primero buscar por cédula exacta (caso ideal)
  const porCedula = getQuery(
    `SELECT p.*, e.numero_expediente, e.id as expediente_id
     FROM pacientes p
     LEFT JOIN expedientes e ON e.paciente_id = p.id
     WHERE p.numero_identidad = ? AND p.activo = 1`,
    [termino]
  );

  if (porCedula) {
    return res.json({ 
      tipo: 'exacta',
      resultados: [porCedula] 
    });
  }

  // Si no hay coincidencia exacta por cédula, buscar por nombre/apellido parcial
  const term = `%${termino}%`;
  const resultados = allQuery(
    `SELECT p.*, e.numero_expediente, e.id as expediente_id
     FROM pacientes p
     LEFT JOIN expedientes e ON e.paciente_id = p.id
     WHERE (p.nombre LIKE ? OR p.apellido LIKE ? OR (p.nombre || ' ' || p.apellido) LIKE ? OR p.telefono LIKE ?)
       AND p.activo = 1
     ORDER BY p.apellido, p.nombre
     LIMIT 20`,
    [term, term, term, term]
  );

  res.json({ 
    tipo: resultados.length > 0 ? 'parcial' : 'sin_resultados',
    resultados 
  });
});

// Endpoint legacy (mantenido para compatibilidad con código antiguo)
app.get('/api/pacientes/verificar/:identidad', authMiddleware, (req, res) => {
  const paciente = getQuery(
    `SELECT p.*, e.numero_expediente, e.id as expediente_id
     FROM pacientes p
     LEFT JOIN expedientes e ON e.paciente_id = p.id
     WHERE p.numero_identidad = ? AND p.activo = 1`,
    [req.params.identidad]
  );
  
  if (paciente) {
    res.json({ existe: true, paciente });
  } else {
    res.json({ existe: false });
  }
});

app.get('/api/pacientes/:id', authMiddleware, (req, res) => {
  const paciente = getQuery(
    `SELECT p.*, e.numero_expediente, e.fecha_apertura, e.motivo_apertura, 
            e.estado as estado_expediente,
            u.nombre as medico_nombre, u.apellido as medico_apellido
     FROM pacientes p
     LEFT JOIN expedientes e ON e.paciente_id = p.id
     LEFT JOIN usuarios u ON e.medico_responsable_id = u.id
     WHERE p.id = ?`,
    [req.params.id]
  );
  
  if (!paciente) return res.status(404).json({ error: 'Paciente no encontrado' });

  // Recepcionistas no acceden a datos clínicos
  if (req.usuario.rol === 'recepcionista') {
    res.json({ ...paciente, antecedentes: [], consultas: [] });
    return;
  }

  // Médicos ven todo
  const antecedentes = allQuery(
    'SELECT * FROM antecedentes_medicos WHERE paciente_id = ? ORDER BY fecha_registro DESC',
    [req.params.id]
  );
  const consultas = allQuery(
    `SELECT c.*, m.nombre as medico_nombre, m.apellido as medico_apellido
     FROM consultas c
     JOIN usuarios m ON c.medico_id = m.id
     WHERE c.paciente_id = ?
     ORDER BY c.fecha_consulta DESC`,
    [req.params.id]
  );

  res.json({ ...paciente, antecedentes, consultas });
});

// Crear paciente + apertura de expediente (ambos roles)
app.post('/api/pacientes/apertura-expediente', authMiddleware, (req, res) => {
  try {
    const {
      numero_identidad, nombre, apellido, fecha_nacimiento, sexo, telefono, email,
      direccion, ciudad, tipo_sangre, alergias,
      motivo_apertura, medico_responsable_id, notas_apertura
    } = req.body;

    if (!numero_identidad || !nombre || !apellido || !fecha_nacimiento || !sexo || !motivo_apertura) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }

    // Verificar si ya existe
    const existePaciente = getQuery('SELECT id FROM pacientes WHERE numero_identidad = ?', [numero_identidad]);
    if (existePaciente) {
      const existeExpediente = getQuery('SELECT * FROM expedientes WHERE paciente_id = ?', [existePaciente.id]);
      if (existeExpediente) {
        return res.status(400).json({ 
          error: 'Este paciente ya tiene un expediente abierto',
          numero_expediente: existeExpediente.numero_expediente
        });
      }
    }

    let pacienteId;
    if (existePaciente) {
      pacienteId = existePaciente.id;
    } else {
      pacienteId = insertQuery(
        `INSERT INTO pacientes (numero_identidad, nombre, apellido, fecha_nacimiento, sexo, telefono, email, direccion, ciudad, tipo_sangre, alergias)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [numero_identidad, nombre, apellido, fecha_nacimiento, sexo, telefono || null, email || null, direccion || null, ciudad || null, tipo_sangre || null, alergias || null]
      );

      registrarAuditoria(req, 'CREATE', 'pacientes', pacienteId, 
        `Paciente creado: ${nombre} ${apellido}`);
    }

    // Crear expediente
    const numeroExpediente = generarNumeroExpediente();
    const expedienteId = insertQuery(
      `INSERT INTO expedientes (numero_expediente, paciente_id, medico_responsable_id, motivo_apertura, abierto_por_id, notas_apertura)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [numeroExpediente, pacienteId, medico_responsable_id || null, motivo_apertura, req.usuario.id, notas_apertura || null]
    );

    registrarAuditoria(req, 'CREATE', 'expedientes', expedienteId,
      `Expediente abierto: ${numeroExpediente} para ${nombre} ${apellido}`);

    res.status(201).json({
      paciente_id: pacienteId,
      expediente_id: expedienteId,
      numero_expediente: numeroExpediente,
      message: 'Expediente abierto exitosamente'
    });
  } catch (err) {
    console.error(err);
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Ya existe un paciente con ese CURP' });
    }
    res.status(500).json({ error: 'Error al abrir expediente' });
  }
});

// Crear paciente simple (sin expediente) - solo médicos por compatibilidad
app.post('/api/pacientes', authMiddleware, (req, res) => {
  try {
    const { numero_identidad, nombre, apellido, fecha_nacimiento, sexo, telefono, email, direccion, ciudad, tipo_sangre, alergias } = req.body;

    if (!numero_identidad || !nombre || !apellido || !fecha_nacimiento || !sexo) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }

    const id = insertQuery(
      `INSERT INTO pacientes (numero_identidad, nombre, apellido, fecha_nacimiento, sexo, telefono, email, direccion, ciudad, tipo_sangre, alergias)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [numero_identidad, nombre, apellido, fecha_nacimiento, sexo, telefono || null, email || null, direccion || null, ciudad || null, tipo_sangre || null, alergias || null]
    );

    registrarAuditoria(req, 'CREATE', 'pacientes', id, `Paciente creado: ${nombre} ${apellido}`);

    const paciente = getQuery('SELECT * FROM pacientes WHERE id = ?', [id]);
    res.status(201).json(paciente);
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Ya existe un paciente con ese CURP' });
    }
    res.status(500).json({ error: 'Error al crear paciente' });
  }
});

app.put('/api/pacientes/:id', authMiddleware, (req, res) => {
  try {
    const datosAntes = getQuery('SELECT * FROM pacientes WHERE id = ?', [req.params.id]);
    if (!datosAntes) return res.status(404).json({ error: 'Paciente no encontrado' });
    
    if (datosAntes.activo === 0) {
      return res.status(400).json({ error: 'No se puede editar un paciente eliminado. Restáuralo primero.' });
    }

    const { numero_identidad, nombre, apellido, fecha_nacimiento, sexo, telefono, email, direccion, ciudad, tipo_sangre, alergias, motivo } = req.body;

    // Motivo obligatorio (Opción D - edición con auditoría reforzada)
    if (!motivo || motivo.trim().length < 5) {
      return res.status(400).json({ error: 'Debes proporcionar un motivo del cambio (mínimo 5 caracteres)' });
    }

    // Validar campos obligatorios
    if (!numero_identidad || !nombre || !apellido || !fecha_nacimiento || !sexo) {
      return res.status(400).json({ error: 'Faltan campos obligatorios: CURP, nombre, apellido, fecha de nacimiento, sexo' });
    }

    // Si el CURP cambió, verificar que no esté en uso por otro paciente
    if (numero_identidad !== datosAntes.numero_identidad) {
      const existeCURP = getQuery(
        'SELECT id, nombre, apellido FROM pacientes WHERE numero_identidad = ? AND id != ?',
        [numero_identidad, req.params.id]
      );
      if (existeCURP) {
        return res.status(400).json({ 
          error: `Ese CURP ya pertenece a otro paciente: ${existeCURP.nombre} ${existeCURP.apellido}` 
        });
      }
    }

    runQuery(
      `UPDATE pacientes 
       SET numero_identidad=?, nombre=?, apellido=?, fecha_nacimiento=?, sexo=?, 
           telefono=?, email=?, direccion=?, ciudad=?, tipo_sangre=?, alergias=?
       WHERE id=?`,
      [numero_identidad, nombre, apellido, fecha_nacimiento, sexo, 
       telefono || null, email || null, direccion || null, ciudad || null, 
       tipo_sangre || null, alergias || null, req.params.id]
    );

    const datosDespues = getQuery('SELECT * FROM pacientes WHERE id = ?', [req.params.id]);
    
    // Construir descripción detallada con los campos modificados
    const camposCambiados = [];
    const camposComparar = ['numero_identidad', 'nombre', 'apellido', 'fecha_nacimiento', 'sexo', 'telefono', 'email', 'direccion', 'ciudad', 'tipo_sangre', 'alergias'];
    const nombresCampos = {
      numero_identidad: 'CURP',
      nombre: 'Nombre',
      apellido: 'Apellido',
      fecha_nacimiento: 'Fecha nacimiento',
      sexo: 'Sexo',
      telefono: 'Teléfono',
      email: 'Email',
      direccion: 'Dirección',
      ciudad: 'Ciudad',
      tipo_sangre: 'Tipo sangre',
      alergias: 'Alergias'
    };
    
    for (const campo of camposComparar) {
      if (String(datosAntes[campo] || '') !== String(datosDespues[campo] || '')) {
        camposCambiados.push(nombresCampos[campo]);
      }
    }
    
    const descripcion = camposCambiados.length > 0
      ? `Paciente actualizado (${camposCambiados.join(', ')}): ${nombre} ${apellido}. Motivo: ${motivo}`
      : `Paciente "actualizado" sin cambios reales: ${nombre} ${apellido}. Motivo: ${motivo}`;
    
    registrarAuditoria(req, 'UPDATE', 'pacientes', req.params.id,
      descripcion, datosAntes, datosDespues);

    res.json({
      ...datosDespues,
      campos_modificados: camposCambiados,
      mensaje: 'Paciente actualizado exitosamente'
    });
  } catch (err) {
    console.error('Error al actualizar paciente:', err);
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Ya existe un paciente con ese CURP' });
    }
    res.status(500).json({ error: 'Error al actualizar paciente' });
  }
});

// Eliminar paciente (soft delete - solo médicos)
// Marca al paciente como inactivo, archiva su expediente y registra en auditoría.
// No elimina datos clínicos para preservar historial médico (RN11, RN21).
app.delete('/api/pacientes/:id', authMiddleware, requireRole('medico'), (req, res) => {
  try {
    const pacienteId = req.params.id;
    const { motivo } = req.body || {};

    // Verificar que el paciente existe y está activo
    const paciente = getQuery(
      'SELECT * FROM pacientes WHERE id = ? AND activo = 1',
      [pacienteId]
    );
    
    if (!paciente) {
      return res.status(404).json({ error: 'Paciente no encontrado o ya eliminado' });
    }

    // Realizar soft delete del paciente
    runQuery(
      `UPDATE pacientes 
       SET activo = 0, 
           fecha_eliminacion = CURRENT_TIMESTAMP, 
           eliminado_por_id = ?, 
           motivo_eliminacion = ?
       WHERE id = ?`,
      [req.usuario.id, motivo || null, pacienteId]
    );

    // Archivar el expediente asociado (si existe)
    const expediente = getQuery(
      'SELECT * FROM expedientes WHERE paciente_id = ?',
      [pacienteId]
    );

    if (expediente) {
      runQuery(
        `UPDATE expedientes SET estado = 'archivado' WHERE id = ?`,
        [expediente.id]
      );
      registrarAuditoria(req, 'UPDATE', 'expedientes', expediente.id,
        `Expediente archivado por eliminación de paciente: ${expediente.numero_expediente}`);
    }

    // Cancelar citas pendientes del paciente
    const citasPendientes = allQuery(
      `SELECT id FROM citas WHERE paciente_id = ? AND estado = 'pendiente'`,
      [pacienteId]
    );

    if (citasPendientes.length > 0) {
      runQuery(
        `UPDATE citas SET estado = 'cancelada' WHERE paciente_id = ? AND estado = 'pendiente'`,
        [pacienteId]
      );
      registrarAuditoria(req, 'UPDATE', 'citas', null,
        `${citasPendientes.length} cita(s) cancelada(s) por eliminación de paciente ID ${pacienteId}`);
    }

    // Registrar la eliminación en auditoría con datos antes/después
    const datosDespues = getQuery('SELECT * FROM pacientes WHERE id = ?', [pacienteId]);
    registrarAuditoria(req, 'DELETE', 'pacientes', pacienteId,
      `Paciente eliminado: ${paciente.nombre} ${paciente.apellido} (${paciente.numero_identidad})${motivo ? ' - Motivo: ' + motivo : ''}`,
      paciente, datosDespues);

    console.log(`✓ Paciente eliminado (soft delete): ${paciente.nombre} ${paciente.apellido} por usuario ${req.usuario.email}`);

    res.json({
      message: 'Paciente eliminado exitosamente',
      paciente_id: pacienteId,
      expediente_archivado: !!expediente,
      citas_canceladas: citasPendientes.length
    });
  } catch (err) {
    console.error('Error al eliminar paciente:', err);
    res.status(500).json({ error: 'Error al eliminar paciente' });
  }
});

// ============================================
// ENDPOINTS DE MÉDICOS (para asignar a expedientes)
// ============================================
app.get('/api/medicos', authMiddleware, (req, res) => {
  const medicos = allQuery(
    "SELECT id, nombre, apellido, especialidad FROM usuarios WHERE rol = 'medico' AND activo = 1 ORDER BY apellido",
    []
  );
  res.json(medicos);
});

// ============================================
// ENDPOINTS DE CITAS
// ============================================
app.get('/api/citas', authMiddleware, (req, res) => {
  let query = `
    SELECT c.*, p.nombre as paciente_nombre, p.apellido as paciente_apellido, p.numero_identidad,
           m.nombre as medico_nombre, m.apellido as medico_apellido
    FROM citas c
    JOIN pacientes p ON c.paciente_id = p.id
    JOIN usuarios m ON c.medico_id = m.id
  `;
  const params = [];

  if (req.usuario.rol === 'medico') {
    query += ' WHERE c.medico_id = ?';
    params.push(req.usuario.id);
  }

  query += ' ORDER BY c.fecha_cita DESC, c.hora_cita ASC';
  const citas = allQuery(query, params);
  res.json(citas);
});

app.get('/api/citas/hoy', authMiddleware, (req, res) => {
  const hoy = new Date().toISOString().split('T')[0];
  let query = `
    SELECT c.*, p.nombre as paciente_nombre, p.apellido as paciente_apellido, p.numero_identidad,
           m.nombre as medico_nombre, m.apellido as medico_apellido
    FROM citas c
    JOIN pacientes p ON c.paciente_id = p.id
    JOIN usuarios m ON c.medico_id = m.id
    WHERE c.fecha_cita = ?
  `;
  const params = [hoy];

  if (req.usuario.rol === 'medico') {
    query += ' AND c.medico_id = ?';
    params.push(req.usuario.id);
  }

  query += ' ORDER BY c.hora_cita ASC';
  const citas = allQuery(query, params);
  res.json(citas);
});

app.post('/api/citas', authMiddleware, (req, res) => {
  try {
    const { paciente_id, medico_id, fecha_cita, hora_cita, motivo_consulta, notas } = req.body;
    if (!paciente_id || !fecha_cita || !hora_cita) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }

    let medicoFinal = medico_id;
    if (req.usuario.rol === 'medico') {
      medicoFinal = req.usuario.id;
    } else if (!medico_id) {
      return res.status(400).json({ error: 'Debe seleccionar un médico' });
    }

    const id = insertQuery(
      `INSERT INTO citas (paciente_id, medico_id, fecha_cita, hora_cita, motivo_consulta, notas, agendada_por_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [paciente_id, medicoFinal, fecha_cita, hora_cita, motivo_consulta || null, notas || null, req.usuario.id]
    );

    registrarAuditoria(req, 'CREATE', 'citas', id, 
      `Cita agendada para ${fecha_cita} ${hora_cita}`);

    res.status(201).json({ id, message: 'Cita agendada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al agendar cita' });
  }
});

app.put('/api/citas/:id', authMiddleware, (req, res) => {
  try {
    const { estado } = req.body;
    const datosAntes = getQuery('SELECT * FROM citas WHERE id = ?', [req.params.id]);
    runQuery('UPDATE citas SET estado = ? WHERE id = ?', [estado, req.params.id]);
    
    registrarAuditoria(req, 'UPDATE', 'citas', req.params.id,
      `Cita actualizada a estado: ${estado}`, datosAntes, { ...datosAntes, estado });

    res.json({ message: 'Cita actualizada' });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar cita' });
  }
});

app.delete('/api/citas/:id', authMiddleware, (req, res) => {
  try {
    runQuery('UPDATE citas SET estado = ? WHERE id = ?', ['cancelada', req.params.id]);
    registrarAuditoria(req, 'UPDATE', 'citas', req.params.id, 'Cita cancelada');
    res.json({ message: 'Cita cancelada' });
  } catch (err) {
    res.status(500).json({ error: 'Error al cancelar cita' });
  }
});

// ============================================
// ENDPOINTS DE CONSULTAS (solo médicos)
// ============================================
app.post('/api/consultas', authMiddleware, requireRole('medico'), (req, res) => {
  try {
    const {
      cita_id, paciente_id, peso, altura, presion_arterial, temperatura,
      frecuencia_cardiaca, motivo_consulta, sintomas, diagnostico,
      plan_tratamiento, observaciones, fecha_proximo_control, medicamentos
    } = req.body;

    if (!paciente_id || !motivo_consulta || !sintomas || !diagnostico) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }

    const consultaId = insertQuery(
      `INSERT INTO consultas (cita_id, paciente_id, medico_id, peso, altura, presion_arterial, temperatura, frecuencia_cardiaca, motivo_consulta, sintomas, diagnostico, plan_tratamiento, observaciones, fecha_proximo_control)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [cita_id || null, paciente_id, req.usuario.id, peso || null, altura || null, presion_arterial || null, temperatura || null, frecuencia_cardiaca || null, motivo_consulta, sintomas, diagnostico, plan_tratamiento || null, observaciones || null, fecha_proximo_control || null]
    );

    if (medicamentos && Array.isArray(medicamentos)) {
      medicamentos.forEach(med => {
        if (med.nombre) {
          runQuery(
            `INSERT INTO antecedentes_medicos (paciente_id, consulta_id, tipo, medicamento_nombre, dosis, duracion_dias, estado, notas)
             VALUES (?, ?, 'prescripción', ?, ?, ?, 'activo', ?)`,
            [paciente_id, consultaId, med.nombre, med.dosis || '', med.duracion_dias || null, med.notas || '']
          );
        }
      });
    }

    if (cita_id) {
      runQuery('UPDATE citas SET estado = ? WHERE id = ?', ['completada', cita_id]);
    }

    registrarAuditoria(req, 'CREATE', 'consultas', consultaId,
      `Consulta registrada con diagnóstico: ${diagnostico.substring(0, 100)}`);

    saveDatabase();
    res.status(201).json({ id: consultaId, message: 'Consulta guardada exitosamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar consulta' });
  }
});

app.get('/api/consultas/:id', authMiddleware, requireRole('medico'), (req, res) => {
  const consulta = getQuery(`
    SELECT c.*, p.nombre as paciente_nombre, p.apellido as paciente_apellido, m.nombre as medico_nombre
    FROM consultas c
    JOIN pacientes p ON c.paciente_id = p.id
    JOIN usuarios m ON c.medico_id = m.id
    WHERE c.id = ?
  `, [req.params.id]);

  if (!consulta) return res.status(404).json({ error: 'Consulta no encontrada' });

  const medicamentos = allQuery(
    `SELECT * FROM antecedentes_medicos WHERE consulta_id = ? AND tipo = 'prescripción'`,
    [req.params.id]
  );

  res.json({ ...consulta, medicamentos });
});

// ============================================
// ENDPOINTS DE ANTECEDENTES (solo médicos)
// ============================================
app.post('/api/antecedentes', authMiddleware, requireRole('medico'), (req, res) => {
  try {
    const { paciente_id, tipo, condicion, medicamento_nombre, dosis, estado, notas } = req.body;
    const id = insertQuery(
      `INSERT INTO antecedentes_medicos (paciente_id, tipo, condicion, medicamento_nombre, dosis, estado, notas)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [paciente_id, tipo, condicion || null, medicamento_nombre || null, dosis || null, estado || 'activo', notas || null]
    );
    registrarAuditoria(req, 'CREATE', 'antecedentes_medicos', id, 
      `Antecedente agregado: ${tipo} - ${condicion || medicamento_nombre}`);
    res.status(201).json({ id });
  } catch (err) {
    res.status(500).json({ error: 'Error al agregar antecedente' });
  }
});

// ============================================
// ENDPOINTS DE AUDITORÍA
// ============================================
app.get('/api/auditoria/mias', authMiddleware, (req, res) => {
  const registros = allQuery(
    `SELECT * FROM auditoria 
     WHERE usuario_id = ? 
     ORDER BY fecha_accion DESC 
     LIMIT 100`,
    [req.usuario.id]
  );
  res.json(registros);
});

// Auditoría global (solo admin)
app.get('/api/auditoria/todas', authMiddleware, requireRole('admin'), (req, res) => {
  const { accion, usuario_email, entidad, limit } = req.query;
  
  let query = 'SELECT * FROM auditoria WHERE 1=1';
  const params = [];
  
  if (accion) {
    query += ' AND accion = ?';
    params.push(accion);
  }
  if (usuario_email) {
    query += ' AND usuario_email LIKE ?';
    params.push('%' + usuario_email + '%');
  }
  if (entidad) {
    query += ' AND entidad = ?';
    params.push(entidad);
  }
  
  query += ' ORDER BY fecha_accion DESC LIMIT ?';
  params.push(parseInt(limit) || 200);
  
  const registros = allQuery(query, params);
  res.json(registros);
});

// ============================================
// ENDPOINTS DE ADMINISTRACIÓN (solo admin)
// ============================================

// Listar TODOS los usuarios (activos e inactivos)
app.get('/api/admin/usuarios', authMiddleware, requireRole('admin'), (req, res) => {
  const usuarios = allQuery(
    `SELECT id, email, nombre, apellido, rol, especialidad, numero_licencia, 
            telefono, activo, fecha_creacion, ultimo_acceso
     FROM usuarios
     ORDER BY rol, apellido, nombre`,
    []
  );
  res.json(usuarios);
});

// Activar/desactivar usuario
app.put('/api/admin/usuarios/:id/estado', authMiddleware, requireRole('admin'), (req, res) => {
  try {
    const { activo } = req.body;
    const usuarioId = req.params.id;
    
    if (activo === undefined) {
      return res.status(400).json({ error: 'Debes indicar el estado (activo: true/false)' });
    }

    // Validar que el admin no se desactive a sí mismo
    if (parseInt(usuarioId) === req.usuario.id && !activo) {
      return res.status(400).json({ error: 'No puedes desactivarte a ti mismo' });
    }

    // Validar que no se desactive al último admin
    if (!activo) {
      const usuario = getQuery('SELECT rol FROM usuarios WHERE id = ?', [usuarioId]);
      if (usuario && usuario.rol === 'admin') {
        const adminsActivos = getQuery(
          "SELECT COUNT(*) as count FROM usuarios WHERE rol = 'admin' AND activo = 1 AND id != ?",
          [usuarioId]
        );
        if (adminsActivos.count === 0) {
          return res.status(400).json({ 
            error: 'No puedes desactivar al último administrador activo del sistema' 
          });
        }
      }
    }

    const datosAntes = getQuery('SELECT * FROM usuarios WHERE id = ?', [usuarioId]);
    if (!datosAntes) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    runQuery('UPDATE usuarios SET activo = ? WHERE id = ?', [activo ? 1 : 0, usuarioId]);

    const datosDespues = getQuery('SELECT * FROM usuarios WHERE id = ?', [usuarioId]);
    
    registrarAuditoria(req, 'UPDATE', 'usuarios', usuarioId,
      `Usuario ${activo ? 'activado' : 'desactivado'}: ${datosAntes.nombre} ${datosAntes.apellido}`,
      datosAntes, datosDespues);

    res.json({ 
      message: `Usuario ${activo ? 'activado' : 'desactivado'} exitosamente`,
      usuario: datosDespues
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al cambiar estado del usuario' });
  }
});

// Editar datos básicos de un usuario
app.put('/api/admin/usuarios/:id', authMiddleware, requireRole('admin'), (req, res) => {
  try {
    const { nombre, apellido, telefono, especialidad } = req.body;
    const datosAntes = getQuery('SELECT * FROM usuarios WHERE id = ?', [req.params.id]);
    
    if (!datosAntes) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    runQuery(
      `UPDATE usuarios SET nombre = ?, apellido = ?, telefono = ?, especialidad = ? WHERE id = ?`,
      [nombre || datosAntes.nombre, apellido || datosAntes.apellido, 
       telefono !== undefined ? telefono : datosAntes.telefono, 
       especialidad !== undefined ? especialidad : datosAntes.especialidad,
       req.params.id]
    );

    const datosDespues = getQuery('SELECT * FROM usuarios WHERE id = ?', [req.params.id]);
    registrarAuditoria(req, 'UPDATE', 'usuarios', req.params.id,
      `Usuario actualizado: ${datosDespues.nombre} ${datosDespues.apellido}`,
      datosAntes, datosDespues);

    res.json(datosDespues);
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar usuario' });
  }
});

// Listar pacientes eliminados (solo admin)
app.get('/api/admin/pacientes-eliminados', authMiddleware, requireRole('admin'), (req, res) => {
  const pacientes = allQuery(
    `SELECT p.*, 
            e.numero_expediente,
            u.nombre || ' ' || u.apellido AS eliminado_por_nombre
     FROM pacientes p
     LEFT JOIN expedientes e ON e.paciente_id = p.id
     LEFT JOIN usuarios u ON p.eliminado_por_id = u.id
     WHERE p.activo = 0
     ORDER BY p.fecha_eliminacion DESC`,
    []
  );
  res.json(pacientes);
});

// Restaurar paciente eliminado (solo admin)
app.post('/api/admin/pacientes/:id/restaurar', authMiddleware, requireRole('admin'), (req, res) => {
  try {
    const pacienteId = req.params.id;
    
    const paciente = getQuery(
      'SELECT * FROM pacientes WHERE id = ? AND activo = 0',
      [pacienteId]
    );
    
    if (!paciente) {
      return res.status(404).json({ error: 'Paciente no encontrado o ya está activo' });
    }

    // Restaurar paciente
    runQuery(
      `UPDATE pacientes 
       SET activo = 1, 
           fecha_eliminacion = NULL, 
           eliminado_por_id = NULL, 
           motivo_eliminacion = NULL
       WHERE id = ?`,
      [pacienteId]
    );

    // Reactivar expediente si estaba archivado por la eliminación
    const expediente = getQuery(
      `SELECT * FROM expedientes WHERE paciente_id = ? AND estado = 'archivado'`,
      [pacienteId]
    );

    if (expediente) {
      runQuery(`UPDATE expedientes SET estado = 'activo' WHERE id = ?`, [expediente.id]);
      registrarAuditoria(req, 'UPDATE', 'expedientes', expediente.id,
        `Expediente reactivado: ${expediente.numero_expediente}`);
    }

    const datosDespues = getQuery('SELECT * FROM pacientes WHERE id = ?', [pacienteId]);
    registrarAuditoria(req, 'RESTORE', 'pacientes', pacienteId,
      `Paciente restaurado: ${paciente.nombre} ${paciente.apellido} (${paciente.numero_identidad})`,
      paciente, datosDespues);

    console.log(`✓ Paciente restaurado: ${paciente.nombre} ${paciente.apellido} por admin ${req.usuario.email}`);

    res.json({
      message: 'Paciente restaurado exitosamente',
      paciente_id: pacienteId,
      expediente_reactivado: !!expediente
    });
  } catch (err) {
    console.error('Error al restaurar paciente:', err);
    res.status(500).json({ error: 'Error al restaurar paciente' });
  }
});

// Stats del dashboard de admin
app.get('/api/admin/stats', authMiddleware, requireRole('admin'), (req, res) => {
  const stats = {
    medicos_activos: getQuery("SELECT COUNT(*) as c FROM usuarios WHERE rol = 'medico' AND activo = 1").c,
    medicos_inactivos: getQuery("SELECT COUNT(*) as c FROM usuarios WHERE rol = 'medico' AND activo = 0").c,
    recepcionistas_activos: getQuery("SELECT COUNT(*) as c FROM usuarios WHERE rol = 'recepcionista' AND activo = 1").c,
    recepcionistas_inactivos: getQuery("SELECT COUNT(*) as c FROM usuarios WHERE rol = 'recepcionista' AND activo = 0").c,
    pacientes_activos: getQuery("SELECT COUNT(*) as c FROM pacientes WHERE activo = 1").c,
    pacientes_eliminados: getQuery("SELECT COUNT(*) as c FROM pacientes WHERE activo = 0").c,
    expedientes_activos: getQuery("SELECT COUNT(*) as c FROM expedientes WHERE estado = 'activo'").c,
    expedientes_archivados: getQuery("SELECT COUNT(*) as c FROM expedientes WHERE estado = 'archivado'").c,
    consultas_total: getQuery("SELECT COUNT(*) as c FROM consultas").c,
    auditoria_registros: getQuery("SELECT COUNT(*) as c FROM auditoria").c,
    intentos_acceso_denegado: getQuery("SELECT COUNT(*) as c FROM auditoria WHERE accion = 'ACCESS_DENIED'").c,
    logins_fallidos: getQuery("SELECT COUNT(*) as c FROM auditoria WHERE accion = 'LOGIN_FAILED'").c
  };
  res.json(stats);
});

// ============================================
// SERVIR FRONTEND
// ============================================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================
// INICIAR SERVIDOR
// ============================================
initDatabase().then(() => {
  app.listen(PORT, () => {
    const jwtOk = process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32;
    console.log('\n========================================');
    console.log('  EME v2.0 - Expediente Médico Electrónico');
    console.log('  Conforme a IEEE 830 + Caso de Uso');
    console.log('========================================');
    console.log(`  Servidor:    http://localhost:${PORT}`);
    console.log(`  Estado:      ✓ Funcionando`);
    console.log(`  JWT Secret:  ${jwtOk ? '✓ Configurado (.env)' : '⚠ Usando valor por defecto (cambiar .env)'}`);
    console.log(`  Rate limit:  ✓ ${process.env.MAX_LOGIN_ATTEMPTS || 5} intentos / ${process.env.LOGIN_BLOCK_MINUTES || 15} min`);
    console.log(`  Helmet:      ✓ Cabeceras de seguridad activas`);
    console.log(`  CORS:        ✓ Restringido a localhost:${PORT}`);
    console.log('');
    console.log('  Abre tu navegador en http://localhost:3000');
    console.log('========================================\n');
  });
}).catch(err => {
  console.error('Error al inicializar:', err);
  process.exit(1);
});
