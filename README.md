# 🏥 Software de Expediente Médico Electrónico

Prototipo funcional de Expediente Médico Electrónico para consultorios médicos pequeños.

**Versión:** BETA 3.0
**Conforme a:** Estándar IEEE 830-1998 y Caso de Uso "Apertura de Expediente Médico"

---

## 🆕 Novedades y Arquitectura

- ✅ **Soporte para TRES roles**: Administrador, Médico y Recepcionista.
- ✅ **Autoconfiguración Segura**: Script `setup.js` que genera automáticamente el archivo `.env` con un secreto criptográfico seguro de 64 caracteres.
- ✅ **Seguridad Reforzada**: 
  - Prevención de ataques de fuerza bruta (*Rate Limiting*).
  - Cabeceras HTTP seguras (*Helmet*).
  - Cierre de sesión automático por inactividad (15 minutos).
- ✅ **Eliminación Lógica (Soft Delete)**: Los pacientes se marcan como inactivos y se archiva su expediente, pero se conserva el historial clínico por cumplimiento de auditoría.
- ✅ **Auditoría Global**: Los administradores pueden monitorear accesos denegados, logins fallidos y restaurar pacientes eliminados.
- ✅ **Control de acceso y Bootstrap**: El sistema exige la creación de un Administrador como primer paso. Posteriormente, solo el Admin puede dar de alta a médicos y recepcionistas.

---

## 🚀 Cómo ejecutarlo

### Requisitos
- Node.js v18 o superior
- npm v9 o superior

### Pasos

\`\`\`bash
# 1. Instalar dependencias
npm install

# 2. Iniciar el servidor (auto-generará la BD y el entorno)
npm start
\`\`\`

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

### 👨‍⚕️ Médico
- Acceso completo a expedientes y datos clínicos.
- Crear consultas médicas (signos vitales, diagnóstico, tratamiento).
- Prescribir medicamentos y registrar alergias.
- Realizar "Soft Delete" de pacientes con justificación obligatoria.

### 👩‍💼 Recepcionista
- Abrir expedientes médicos.
- Gestionar datos demográficos de pacientes.
- Agendar citas para cualquier médico del consultorio.
- **NO puede** acceder a consultas, diagnósticos o antecedentes clínicos.

---

## 🔐 Seguridad

- Contraseñas con hash bcrypt (10 rondas).
- Autenticación JWT con expiración de 24 horas y generación de secreto aleatorio en el primer arranque.
- Monitoreo de inactividad de sesión (alerta al minuto 14, cierre al 15).
- Control de acceso basado en roles (RBAC).
- `express-rate-limit` para bloqueo temporal tras múltiples intentos fallidos de login.

---

## 🌐 API Endpoints

### Autenticación
- `GET  /api/auth/setup-status` - Verifica si el sistema requiere el bootstrap del administrador inicial.
- `POST /api/auth/registro` - Registro de usuario (Validado por admin, excepto en bootstrap).
- `POST /api/auth/login` - Iniciar sesión (Limitado a 5 intentos / 15 min).
- `POST /api/auth/verificar-codigo` - Verificar código para recuperación de contraseña.
- `POST /api/auth/reset-password` - Restablecer contraseña.

### Administración (Solo Admin)
- `GET  /api/admin/usuarios` - Listado total de usuarios.
- `PUT  /api/admin/usuarios/:id` - Editar datos de usuario.
- `PUT  /api/admin/usuarios/:id/estado` - Activar/Desactivar acceso de un usuario.
- `GET  /api/admin/pacientes-eliminados` - Listado de bajas lógicas.
- `POST /api/admin/pacientes/:id/restaurar` - Restaurar paciente.
- `GET  /api/admin/stats` - Estadísticas globales del sistema.

### Pacientes y Expedientes
- `GET    /api/pacientes` - Listar pacientes activos.
- `GET    /api/pacientes/buscar/:termino` - Búsqueda inteligente por CURP o coincidencias parciales.
- `POST   /api/pacientes/apertura-expediente` - Creación de paciente y expediente simultáneo.
- `PUT    /api/pacientes/:id` - Actualización de datos (requiere justificación en auditoría).
- `DELETE /api/pacientes/:id` - Eliminación lógica de paciente y cancelación de sus citas (Solo médicos).

### Citas & Consultas
- `GET    /api/citas` y `/api/citas/hoy` - Listado de agenda.
- `POST   /api/citas` - Agendar cita.
- `POST   /api/consultas` - Registrar consulta clínica con medicamentos (Solo médicos).

---

## 📊 Modelo de datos

El sistema ahora opera con las siguientes tablas principales en SQLite:

- **usuarios**: Control de roles unificado (Admin, Médico, Recepcionista).
- **pacientes**: Datos demográficos y bandera `activo` para eliminación lógica.
- **expedientes**: Formato único `EXP-YYYY-NNNNN`.
- **citas**: Control de agenda y estados (pendiente, completada, cancelada).
- **consultas**: Historial clínico y signos vitales.
- **antecedentes_medicos**: Condiciones, alergias y prescripciones.
- **auditoria**: Registro inmutable de cada creación, edición, borrado o inicio de sesión fallido.

---

Desarrollado por Edson Joel Carrera Avila.  
Licencia MIT