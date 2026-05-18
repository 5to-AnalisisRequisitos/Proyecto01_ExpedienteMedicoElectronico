# 🏥 Software de Expediente Médico Electrónico

Prototipo funcional de Expediente Médico Electrónico para consultorios médicos pequeños.

**Autor:** Edson Joel Carrera Avila <br>
**Estándar:** IEEE 830-1998 <br>
**Versión:** 3.0 <br>

---

## 🆕 Novedades y Arquitectura

- ✅ **Soporte para TRES roles**: Administrador, Médico y Recepcionista.
- ✅ **Autoconfiguración Segura**: Script `setup.js` que genera automáticamente el archivo `.env` con un secreto criptográfico aleatorio de 64 caracteres en cada instalación.
- ✅ **Scripts autoejecutables multiplataforma**: `iniciar.sh` (Linux/macOS) e `iniciar.bat` (Windows) que verifican Node.js, instalan dependencias y lanzan el servidor.
- ✅ **Seguridad Reforzada**:
  - Prevención de ataques de fuerza bruta (*Rate Limiting* en login).
  - Cabeceras HTTP seguras (*Helmet*).
  - CORS restringido a localhost.
  - Cierre de sesión automático por inactividad (15 minutos) con aviso previo de 60 segundos.
  - Sesión en `sessionStorage` (no persiste al cerrar el navegador).
  - Bloqueo de acceso por URL a archivos sensibles (`eme.db`, `.env`).
- ✅ **Eliminación Lógica (Soft Delete)**: Los pacientes se marcan como inactivos y se archiva su expediente; las citas pendientes se cancelan automáticamente en cascada. Preserva el historial clínico por cumplimiento de auditoría.
- ✅ **Auditoría Global**: Los administradores pueden monitorear accesos denegados, logins fallidos y restaurar pacientes eliminados.
- ✅ **Control de acceso y Bootstrap**: El sistema exige la creación de un Administrador como primer paso. Posteriormente, solo el Admin puede dar de alta a médicos y recepcionistas.
- ✅ **Hub de Pacientes**: Las citas se agendan desde el detalle del paciente (paciente preseleccionado en el modal), eliminando el problema del dropdown masivo.

---

## 🚀 Cómo ejecutarlo

### Requisitos
- Node.js v18 o superior
- npm v9 o superior

### Opción A: Scripts automáticos (recomendado)

**Linux / macOS:**
```bash
./iniciar.sh
```

**Windows:** doble clic en `iniciar.bat`

El script verifica que Node.js esté instalado, instala las dependencias si no existen y lanza el servidor automáticamente.

### Opción B: Manual

```bash
# 1. Instalar dependencias
npm install

# 2. Iniciar el servidor (auto-generará la BD y el archivo .env)
npm start
```

Abre tu navegador en: **http://localhost:3000**

---

## 🆕 Primera vez que usas el sistema (Bootstrap)

1. Verás la **pantalla de bienvenida** indicando que se requiere un administrador.
2. Haz clic en **"Crear administrador"**.
3. Completa tus datos personales, email y contraseña (mínimo 8 caracteres, con mayúsculas, minúsculas y números).
4. Se generará un **código único de recuperación** (formato: `EME-XXXX-XXXX-XXXX-XXXX`).
5. **¡IMPORTANTE!** Guarda este código; es la única forma de recuperar tu contraseña.
6. Inicia sesión. Una vez dentro, podrás usar el menú **"Gestión de usuarios"** para crear las cuentas del resto de tu equipo (Médicos y Recepcionistas).

---

## 👥 Roles del sistema

### 👑 Administrador
- Crear, editar y activar/desactivar cuentas de usuarios.
- Monitorear el panel de estadísticas globales.
- Ver la bitácora de auditoría de todo el sistema.
- Restaurar pacientes eliminados.
- **NO accede** a expedientes, consultas ni datos clínicos.

### 👨‍⚕️ Médico
- Acceso completo a expedientes y datos clínicos.
- Crear consultas médicas (signos vitales, diagnóstico, tratamiento).
- Prescribir medicamentos y registrar antecedentes.
- Realizar "Soft Delete" de pacientes con justificación obligatoria.

### 👩‍💼 Recepcionista
- Abrir expedientes médicos.
- Gestionar datos demográficos de pacientes.
- Agendar citas para cualquier médico del consultorio.
- **NO puede** acceder a consultas, diagnósticos o antecedentes clínicos.
- **NO puede** eliminar pacientes.

---

## 🔐 Seguridad

- Contraseñas con hash bcrypt (10 rondas).
- Autenticación JWT con expiración de 24 horas; secreto generado aleatoriamente en el primer arranque mediante `setup.js`.
- Sesión almacenada en `sessionStorage` (no persiste entre sesiones del navegador).
- Monitoreo de inactividad de sesión (aviso al minuto 14, cierre al 15).
- Control de acceso basado en roles (RBAC) con auditoría de accesos denegados.
- `express-rate-limit` para bloqueo temporal tras múltiples intentos fallidos de login (5 intentos/15 min por IP).
- Cabeceras HTTP seguras vía `helmet`.
- CORS restringido al origen local.
- Mensajes de error de login genéricos (no revelan si el email existe).

---

## 🌐 API Endpoints (32 totales)

### Autenticación (5)
- `GET  /api/auth/setup-status` – Verifica si el sistema requiere el bootstrap del administrador inicial.
- `POST /api/auth/registro` – Registro de usuario (bootstrap o vía admin).
- `POST /api/auth/login` – Iniciar sesión (rate limit: 5/15 min).
- `POST /api/auth/verificar-codigo` – Verificar código de recuperación.
- `POST /api/auth/reset-password` – Restablecer contraseña.

### Administración (6, solo Admin)
- `GET  /api/admin/usuarios` – Listado total de usuarios.
- `PUT  /api/admin/usuarios/:id` – Editar datos de usuario.
- `PUT  /api/admin/usuarios/:id/estado` – Activar/Desactivar acceso de un usuario.
- `GET  /api/admin/pacientes-eliminados` – Listado de bajas lógicas.
- `POST /api/admin/pacientes/:id/restaurar` – Restaurar paciente.
- `GET  /api/admin/stats` – Estadísticas globales del sistema.

### Pacientes y Expedientes (8)
- `GET    /api/pacientes` – Listar pacientes activos.
- `GET    /api/pacientes/buscar/:termino` – Búsqueda inteligente por CURP, nombre, apellido o teléfono.
- `GET    /api/pacientes/verificar/:identidad` – Verificar existencia previa por CURP.
- `GET    /api/pacientes/:id` – Detalle del paciente (filtrado por rol).
- `POST   /api/pacientes` – Crear paciente sin expediente.
- `POST   /api/pacientes/apertura-expediente` – Creación de paciente y expediente simultánea.
- `PUT    /api/pacientes/:id` – Actualización de datos (requiere justificación).
- `DELETE /api/pacientes/:id` – Eliminación lógica con cascada (solo médico).

### Citas (5)
- `GET    /api/citas` – Listar citas con filtros.
- `GET    /api/citas/hoy` – Citas del día.
- `POST   /api/citas` – Agendar cita.
- `PUT    /api/citas/:id` – Cambiar estado de cita.
- `DELETE /api/citas/:id` – Cancelar cita.

### Consultas y Antecedentes (3, solo Médico)
- `POST   /api/consultas` – Registrar consulta clínica con medicamentos.
- `GET    /api/consultas/:id` – Detalle de consulta.
- `POST   /api/antecedentes` – Registrar antecedente o prescripción.

### Auditoría (2)
- `GET    /api/auditoria/mias` – Auditoría propia (últimas 100 acciones, todos los roles).
- `GET    /api/auditoria/todas` – Auditoría global con filtros (solo Admin).

### Utilidades (3)
- `GET    /api/medicos` – Listar médicos activos.
- `GET    /api/dashboard/stats` – Estadísticas del dashboard según rol.
- `GET    /api/usuario/info` – Información del usuario en sesión.

---

## 📊 Modelo de datos

El sistema opera con 7 tablas principales en SQLite:

- **usuarios**: Control de roles unificado (Admin, Médico, Recepcionista). Incluye `codigo_recuperacion` hasheado y bandera `activo`.
- **pacientes**: Datos demográficos y campos de eliminación lógica (`activo`, `fecha_eliminacion`, `eliminado_por_id`, `motivo_eliminacion`).
- **expedientes**: Formato único `EXP-YYYY-NNNNN`, con campo `notas_apertura`.
- **citas**: Control de agenda y estados (pendiente, completada, cancelada). Registra `agendada_por_id`.
- **consultas**: Historial clínico con signos vitales completos (peso, altura, presión, temperatura, frecuencia cardiaca).
- **antecedentes_medicos**: Condiciones crónicas, alergias y prescripciones (con dosis, cantidad y duración).
- **auditoria**: Registro inmutable de cada acción con `usuario_email`, `usuario_rol`, `accion`, `entidad`, `entidad_id`, `descripcion`, `datos_antes`, `datos_despues` (JSON), `ip_origen`, `user_agent`, `fecha_accion`, `exitoso` y `mensaje_error`.

---

## 📁 Estructura del proyecto

```
eme-prototipo/
├── server.js              # Backend Node.js + Express
├── setup.js               # Auto-generador del archivo .env
├── package.json           # Dependencias y scripts npm
├── README.md              # Este archivo
├── iniciar.sh             # Script de arranque Linux/macOS
├── iniciar.bat            # Script de arranque Windows
├── .env                   # Variables de entorno (auto-generado)
├── .gitignore             # Exclusiones de Git
├── eme.db                 # Base de datos SQLite (auto-generada)
└── public/
    ├── index.html         # Frontend SPA con todas las pantallas
    ├── styles.css         # Estilos visuales del sistema
    └── app.js             # Lógica del cliente
```

---

## 🔧 Variables de entorno (.env)

El archivo `.env` se genera automáticamente la primera vez que se ejecuta `npm start`. Contiene:

```
JWT_SECRET=<64 caracteres hexadecimales aleatorios>
PORT=3000
INACTIVITY_TIMEOUT_MINUTES=15
MAX_LOGIN_ATTEMPTS=5
LOGIN_BLOCK_MINUTES=15
```

**Importante:** El archivo `.env` está en `.gitignore` y nunca debe versionarse. Cada instalación tiene su propio secreto único.

---

## 📚 Documentación adicional

- **`EME_ERS_IEEE830.md`** – Especificación de Requisitos de Software conforme al estándar IEEE 830-1998.
- **`EME_Diagramas_PlantUML.md`** – 8 diagramas UML formales en formato PlantUML.
- **`EME_Esquema_BD_v2.md`** – Esquema completo de la base de datos.
