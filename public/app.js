const API_URL = '/api';
let currentUser = null;
let currentPatientId = null;
let currentAppointmentId = null;
let medicamentos = [];
let resetTokenTemp = null;
let pacienteExistenteId = null;

// ============================================
// SEGURIDAD: Timeout de inactividad (15 min)
// ============================================
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutos
const WARNING_BEFORE_MS = 60 * 1000;           // Aviso 60 segundos antes
let inactivityTimer = null;
let warningTimer = null;
let warningModal = null;
let countdownInterval = null;

function resetInactivityTimer() {
  // Solo aplica si hay sesión activa
  if (!sessionStorage.getItem('token')) return;

  clearTimeout(inactivityTimer);
  clearTimeout(warningTimer);

  // Timer de advertencia (a los 14 minutos)
  warningTimer = setTimeout(() => {
    showInactivityWarning();
  }, INACTIVITY_TIMEOUT_MS - WARNING_BEFORE_MS);

  // Timer de logout (a los 15 minutos)
  inactivityTimer = setTimeout(() => {
    logoutByInactivity();
  }, INACTIVITY_TIMEOUT_MS);
}

function showInactivityWarning() {
  // No mostrar si ya hay un modal de advertencia
  if (document.getElementById('inactivity-warning')) return;

  let secondsLeft = 60;

  const overlay = document.createElement('div');
  overlay.id = 'inactivity-warning';
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.6); z-index: 9999;
    display: flex; align-items: center; justify-content: center;
  `;

  overlay.innerHTML = `
    <div style="
      background: white; border-radius: 12px; padding: 32px;
      max-width: 420px; width: 90%; text-align: center;
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
    ">
      <div style="font-size: 48px; margin-bottom: 12px;">⏱</div>
      <h2 style="font-size: 20px; font-weight: 600; margin: 0 0 8px 0; color: #1a1a1a;">
        Tu sesión está por expirar
      </h2>
      <p style="font-size: 14px; color: #666; margin: 0 0 20px 0;">
        Por seguridad, cerraremos tu sesión en
      </p>
      <div id="inactivity-countdown" style="
        font-size: 48px; font-weight: 700; color: #E24B4A;
        margin-bottom: 24px; font-variant-numeric: tabular-nums;
      ">60</div>
      <p style="font-size: 13px; color: #888; margin: 0 0 24px 0;">
        segundos por inactividad
      </p>
      <div style="display: flex; gap: 12px; justify-content: center;">
        <button id="btn-logout-now" style="
          background: transparent; border: 1px solid #ddd;
          padding: 10px 20px; border-radius: 8px; font-size: 14px; cursor: pointer;
        ">Cerrar sesión ahora</button>
        <button id="btn-stay-connected" style="
          background: #1D9E75; color: white; border: 0;
          padding: 10px 24px; border-radius: 8px; font-size: 14px;
          cursor: pointer; font-weight: 500;
        ">Seguir conectado</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Cuenta regresiva
  countdownInterval = setInterval(() => {
    secondsLeft--;
    const el = document.getElementById('inactivity-countdown');
    if (el) el.textContent = secondsLeft;
    if (secondsLeft <= 0) {
      clearInterval(countdownInterval);
    }
  }, 1000);

  // Botón: seguir conectado
  document.getElementById('btn-stay-connected').addEventListener('click', () => {
    dismissInactivityWarning();
    resetInactivityTimer();
  });

  // Botón: cerrar sesión ahora
  document.getElementById('btn-logout-now').addEventListener('click', () => {
    dismissInactivityWarning();
    logoutByInactivity();
  });
}

function dismissInactivityWarning() {
  clearInterval(countdownInterval);
  const el = document.getElementById('inactivity-warning');
  if (el) el.remove();
}

function logoutByInactivity() {
  dismissInactivityWarning();
  clearTimeout(inactivityTimer);
  clearTimeout(warningTimer);

  // Limpiar sesión
  sessionStorage.removeItem('token');
  sessionStorage.removeItem('user');
  currentUser = null;

  // Guardar motivo para mostrar en login
  sessionStorage.setItem('logout_reason', 'inactivity');

  // Volver a la pantalla de login
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('login-screen').classList.add('active');

  // Mostrar mensaje
  const emailInput = document.getElementById('login-email');
  if (emailInput) emailInput.focus();
  
  // Toast de aviso
  showToast('Tu sesión fue cerrada automáticamente por inactividad', 'error');
}

function startInactivityWatcher() {
  // Eventos que cuentan como actividad
  ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click'].forEach(event => {
    document.addEventListener(event, resetInactivityTimer, { passive: true });
  });
  resetInactivityTimer();
}

function stopInactivityWatcher() {
  clearTimeout(inactivityTimer);
  clearTimeout(warningTimer);
  clearInterval(countdownInterval);
  dismissInactivityWarning();
  ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click'].forEach(event => {
    document.removeEventListener(event, resetInactivityTimer);
  });
}

async function apiCall(endpoint, options = {}) {
  const token = sessionStorage.getItem('token');
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(API_URL + endpoint, {
    ...options,
    headers
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Error en la solicitud');
  }

  return response.json();
}

function showScreen(screenId) {
  // Protección: la pantalla de registro solo es accesible si no hay admin (bootstrap)
  if (screenId === 'register-screen') {
    // Verificar de forma asíncrona; si ya hay admin, redirigir a login
    apiCall('/auth/setup-status').then(status => {
      if (status.tieneAdmin) {
        showToast('El registro inicial ya fue completado. Inicia sesión.', 'error');
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById('login-screen').classList.add('active');
      } else {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById('register-screen').classList.add('active');
      }
    }).catch(() => {
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      document.getElementById('register-screen').classList.add('active');
    });
    return;
  }
  
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

async function showInitialScreen() {
  try {
    const status = await apiCall('/auth/setup-status');
    if (!status.tieneAdmin) {
      // No hay admin → mostrar pantalla de bootstrap
      showScreen('welcome-screen');
    } else {
      showScreen('login-screen');
    }
  } catch (err) {
    showScreen('welcome-screen');
  }
}

function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active'));

  const targetPage = document.getElementById(page + '-page');
  if (targetPage) targetPage.classList.add('active');
  const navLink = document.querySelector(`.nav-link[data-page="${page}"]`);
  if (navLink) navLink.classList.add('active');

  if (page === 'dashboard') loadDashboard();
  if (page === 'pacientes') loadPacientes();
  if (page === 'citas') loadCitas();
  if (page === 'auditoria') loadAuditoria();
  if (page === 'admin-usuarios') loadAdminUsuarios();
  if (page === 'admin-auditoria') loadAdminAuditoria();
  if (page === 'admin-eliminados') loadAdminEliminados();
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast ' + type;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

function showModal(title, body) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = body;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

// ============================================
// REGISTRO
// ============================================
function toggleMedicoFields() {
  const rol = document.getElementById('reg-rol').value;
  const medicoFields = document.getElementById('medico-fields');
  const licencia = document.getElementById('reg-licencia');
  
  if (rol === 'medico') {
    medicoFields.classList.remove('hidden');
    licencia.required = true;
  } else {
    medicoFields.classList.add('hidden');
    licencia.required = false;
  }
}

document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorDiv = document.getElementById('register-error');
  errorDiv.classList.add('hidden');

  // Verificar que no haya admin ya (protección adicional anti-tampering)
  try {
    const status = await apiCall('/auth/setup-status');
    if (status.tieneAdmin) {
      errorDiv.textContent = 'El sistema ya tiene un administrador. Inicia sesión normalmente.';
      errorDiv.classList.remove('hidden');
      setTimeout(() => showInitialScreen(), 2500);
      return;
    }
  } catch (err) {
    // continuar
  }

  const password = document.getElementById('reg-password').value;
  const passwordConfirm = document.getElementById('reg-password-confirm').value;

  if (password !== passwordConfirm) {
    errorDiv.textContent = 'Las contraseñas no coinciden';
    errorDiv.classList.remove('hidden');
    return;
  }

  if (password.length < 8) {
    errorDiv.textContent = 'La contraseña debe tener al menos 8 caracteres';
    errorDiv.classList.remove('hidden');
    return;
  }

  const data = {
    rol: 'admin', // Forzado: solo se crea admin desde aquí (bootstrap)
    nombre: document.getElementById('reg-nombre').value,
    apellido: document.getElementById('reg-apellido').value,
    email: document.getElementById('reg-email').value,
    especialidad: null,
    numero_licencia: null,
    telefono: document.getElementById('reg-telefono').value,
    password: password
  };

  try {
    const result = await apiCall('/auth/registro', {
      method: 'POST',
      body: JSON.stringify(data)
    });
    document.getElementById('recovery-code-display').textContent = result.codigoRecuperacion;
    showScreen('recovery-code-screen');
  } catch (err) {
    errorDiv.textContent = err.message;
    errorDiv.classList.remove('hidden');
  }
});

document.getElementById('confirm-saved').addEventListener('change', (e) => {
  document.getElementById('continue-btn').disabled = !e.target.checked;
});

function copyRecoveryCode() {
  const code = document.getElementById('recovery-code-display').textContent;
  navigator.clipboard.writeText(code).then(() => showToast('Código copiado'));
}

function downloadRecoveryCode() {
  const code = document.getElementById('recovery-code-display').textContent;
  const fecha = new Date().toLocaleString('es-ES');
  const contenido = `EME - CÓDIGO DE RECUPERACIÓN

Código: ${code}
Generado: ${fecha}

IMPORTANTE: Es la única forma de recuperar tu contraseña.`;

  const blob = new Blob([contenido], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `EME-codigo-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Archivo descargado');
}

function goToLogin() {
  showScreen('login-screen');
}

// ============================================
// LOGIN
// ============================================
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const errorDiv = document.getElementById('login-error');

  try {
    const data = await apiCall('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });

    sessionStorage.setItem('token', data.token);
    sessionStorage.setItem('user', JSON.stringify(data));
    currentUser = data;
    
    setupUserInterface();
    showScreen('app-screen');
    navigateTo('dashboard');
    errorDiv.classList.add('hidden');
    
    // Iniciar monitor de inactividad
    startInactivityWatcher();
  } catch (err) {
    errorDiv.textContent = err.message;
    errorDiv.classList.remove('hidden');
  }
});

// Recuperación
document.getElementById('forgot-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('forgot-email').value;
  const codigo = document.getElementById('forgot-codigo').value.trim().toUpperCase();
  const errorDiv = document.getElementById('forgot-error');
  try {
    const result = await apiCall('/auth/verificar-codigo', {
      method: 'POST',
      body: JSON.stringify({ email, codigo })
    });
    resetTokenTemp = result.resetToken;
    showScreen('reset-password-screen');
  } catch (err) {
    errorDiv.textContent = err.message;
    errorDiv.classList.remove('hidden');
  }
});

document.getElementById('reset-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = document.getElementById('reset-password').value;
  const passwordConfirm = document.getElementById('reset-password-confirm').value;
  const errorDiv = document.getElementById('reset-error');
  errorDiv.classList.add('hidden');

  if (password !== passwordConfirm) {
    errorDiv.textContent = 'Las contraseñas no coinciden';
    errorDiv.classList.remove('hidden');
    return;
  }

  try {
    const result = await apiCall('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ resetToken: resetTokenTemp, nuevaPassword: password })
    });
    document.getElementById('recovery-code-display').textContent = result.nuevoCodigoRecuperacion;
    showScreen('recovery-code-screen');
    showToast('Contraseña restablecida');
  } catch (err) {
    errorDiv.textContent = err.message;
    errorDiv.classList.remove('hidden');
  }
});

function logout() {
  stopInactivityWatcher();
  sessionStorage.removeItem('token');
  sessionStorage.removeItem('user');
  currentUser = null;
  showScreen('login-screen');
}

// ============================================
// CONFIGURAR UI SEGÚN ROL
// ============================================
function setupUserInterface() {
  const user = currentUser;
  
  // Nombre con prefijo según rol
  let prefijo = '';
  if (user.rol === 'medico') prefijo = 'Dr. ';
  else if (user.rol === 'admin') prefijo = 'Admin ';
  
  document.getElementById('navbar-user-name').textContent = 
    prefijo + `${user.nombre} ${user.apellido}`;
  
  const rolBadge = document.getElementById('navbar-user-rol');
  const rolLabel = { medico: 'Médico', recepcionista: 'Recepción', admin: 'Administrador' };
  rolBadge.textContent = rolLabel[user.rol] || user.rol;
  rolBadge.className = 'badge-rol ' + user.rol;

  // Menú dinámico según rol
  const menu = document.getElementById('navbar-menu');
  const menuItems = [
    // Médico y Recepcionista
    { page: 'dashboard', label: 'Dashboard', roles: ['medico', 'recepcionista', 'admin'] },
    { page: 'pacientes', label: 'Pacientes', roles: ['medico', 'recepcionista'] },
    { page: 'citas', label: 'Citas', roles: ['medico', 'recepcionista'] },
    // Admin exclusivo
    { page: 'admin-usuarios', label: '👥 Usuarios', roles: ['admin'] },
    { page: 'admin-auditoria', label: '🔍 Auditoría global', roles: ['admin'] },
    { page: 'admin-eliminados', label: '🗑 Eliminados', roles: ['admin'] },
    // Todos
    { page: 'auditoria', label: 'Mi actividad', roles: ['medico', 'recepcionista', 'admin'] }
  ];

  menu.innerHTML = menuItems
    .filter(item => item.roles.includes(user.rol))
    .map(item => `<button class="nav-link" data-page="${item.page}">${item.label}</button>`)
    .join('');

  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => navigateTo(link.dataset.page));
  });

  // Acciones rápidas según rol
  const quickActions = document.getElementById('quick-actions');
  if (user.rol === 'admin') {
    quickActions.innerHTML = `
      <button class="action-btn" onclick="navigateTo('admin-usuarios')">👥 Gestionar usuarios</button>
      <button class="action-btn" onclick="navigateTo('admin-auditoria')">🔍 Auditoría global</button>
      <button class="action-btn" onclick="navigateTo('admin-eliminados')">🗑 Pacientes eliminados</button>
    `;
  } else {
    quickActions.innerHTML = `
      <button class="action-btn" onclick="navigateTo('pacientes'); setTimeout(abrirModalNuevoPaciente, 200)">👤 Nuevo paciente</button>
      <button class="action-btn" onclick="navigateTo('pacientes')">🔍 Ver pacientes</button>
    `;
  }
}

// ============================================
// DASHBOARD
// ============================================
async function loadDashboard() {
  if (!currentUser) currentUser = JSON.parse(sessionStorage.getItem('user'));
  
  let titulo;
  if (currentUser.rol === 'medico') titulo = `Dr. ${currentUser.apellido}`;
  else if (currentUser.rol === 'admin') titulo = `${currentUser.nombre} (Administrador)`;
  else titulo = `${currentUser.nombre}`;
  
  document.getElementById('welcome-message').textContent = `Bienvenido, ${titulo}`;
  
  const today = new Date();
  document.getElementById('today-date').textContent = today.toLocaleDateString('es-ES', 
    { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  // Si es admin, mostrar dashboard especial con stats del sistema
  if (currentUser.rol === 'admin') {
    return loadAdminDashboard();
  }

  try {
    const stats = await apiCall('/dashboard/stats');
    document.getElementById('stat-citas-hoy').textContent = stats.citasHoy;
    document.getElementById('stat-pacientes').textContent = stats.totalPacientes;
    document.getElementById('stat-expedientes').textContent = stats.expedientesActivos;
    document.getElementById('stat-consultas').textContent = stats.consultasMes;

    const citas = await apiCall('/citas/hoy');
    const citasList = document.getElementById('citas-hoy-list');
    
    if (citas.length === 0) {
      citasList.innerHTML = '<p class="empty-state">No hay citas para hoy</p>';
    } else {
      citasList.innerHTML = citas.map(c => `
        <div class="appointment-item">
          <div class="appointment-info">
            <p class="appointment-name">${c.paciente_nombre} ${c.paciente_apellido}</p>
            <p class="appointment-time">${c.hora_cita} - ${c.motivo_consulta || 'Consulta'}${currentUser.rol === 'recepcionista' ? ` (Dr. ${c.medico_apellido})` : ''}</p>
          </div>
          ${c.estado === 'pendiente' && currentUser.rol === 'medico' ? 
            `<button class="btn btn-primary btn-sm" onclick="openConsulta(${c.id}, ${c.paciente_id})">Atender</button>` :
            `<span class="badge badge-${c.estado === 'completada' ? 'completed' : 'pending'}">${c.estado}</span>`
          }
        </div>
      `).join('');
    }
  } catch (err) {
    console.error(err);
    showToast('Error al cargar dashboard', 'error');
  }
}


// ============================================
// PACIENTES (hub central)
// ============================================
async function loadPacientes() {
  try {
    const search = document.getElementById('search-pacientes').value;
    const url = search ? `/pacientes?search=${encodeURIComponent(search)}` : '/pacientes';
    const pacientes = await apiCall(url);
    
    const list = document.getElementById('pacientes-list');
    if (pacientes.length === 0) {
      list.innerHTML = '<tr><td colspan="5" class="text-center empty-state">No hay pacientes registrados. Crea el primero con el botón "+ Nuevo paciente".</td></tr>';
      return;
    }

    const esMedico = currentUser && currentUser.rol === 'medico';

    list.innerHTML = pacientes.map(p => {
      const nombreEsc = (p.nombre + ' ' + p.apellido).replace(/'/g, "\\'");
      return `
      <tr>
        <td>${p.numero_expediente ? `<span class="expediente-badge">${p.numero_expediente}</span>` : '<span class="text-tertiary">Sin expediente</span>'}</td>
        <td><strong>${p.nombre} ${p.apellido}</strong></td>
        <td>${p.numero_identidad}</td>
        <td>${p.telefono || '-'}</td>
        <td class="actions" style="white-space: nowrap;">
          <button class="btn btn-primary btn-sm" onclick="viewPatient(${p.id})" title="Ver detalle">Ver</button>
          <button class="btn btn-success btn-sm" onclick="abrirModalAgendarCita(${p.id})" title="Agendar cita">📅 Agendar</button>
          <button class="btn btn-secondary btn-sm" onclick="toggleAccionesPaciente(event, ${p.id}, '${nombreEsc}', '${p.numero_identidad}', ${esMedico})" title="Más acciones" style="padding: 4px 8px;">⋮</button>
        </td>
      </tr>
    `;
    }).join('');
  } catch (err) {
    showToast('Error al cargar pacientes', 'error');
  }
}

// Menú de acciones secundarias (✏️ Editar, 🗑 Eliminar)
function toggleAccionesPaciente(event, id, nombreCompleto, CURP, esMedico) {
  event.stopPropagation();
  
  // Cerrar cualquier menú abierto
  document.querySelectorAll('.dropdown-acciones').forEach(d => d.remove());
  
  const btn = event.currentTarget;
  const rect = btn.getBoundingClientRect();
  
  const menu = document.createElement('div');
  menu.className = 'dropdown-acciones';
  menu.style.cssText = `
    position: fixed;
    top: ${rect.bottom + 4}px;
    left: ${rect.left - 140}px;
    background: white;
    border: 1px solid #E5E5E5;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    z-index: 1000;
    min-width: 180px;
    padding: 6px;
  `;
  
  menu.innerHTML = `
    <button onclick="editarPaciente(${id}); closeAccionesMenu();" 
            style="display:flex; align-items:center; gap:8px; background:transparent; border:0; padding:8px 10px; border-radius:6px; font-size:13px; cursor:pointer; width:100%; text-align:left;"
            onmouseover="this.style.background='#F5F5F5'" onmouseout="this.style.background='transparent'">
      ✏️ Editar paciente
    </button>
    ${esMedico ? `
    <hr style="border:0; border-top:1px solid #E5E5E5; margin:4px 0;">
    <button onclick="confirmDeletePatient(${id}, '${nombreCompleto}', '${CURP}'); closeAccionesMenu();" 
            style="display:flex; align-items:center; gap:8px; background:transparent; border:0; padding:8px 10px; border-radius:6px; font-size:13px; cursor:pointer; width:100%; text-align:left; color:#A32D2D;"
            onmouseover="this.style.background='#FCEBEB'" onmouseout="this.style.background='transparent'">
      🗑 Eliminar
    </button>
    ` : ''}
  `;
  
  document.body.appendChild(menu);
  
  // Cerrar al hacer click fuera
  setTimeout(() => {
    document.addEventListener('click', closeAccionesMenu, { once: true });
  }, 0);
}

function closeAccionesMenu() {
  document.querySelectorAll('.dropdown-acciones').forEach(d => d.remove());
}

let searchTimeout;
function searchPatients() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(loadPacientes, 300);
}

// Modal de confirmación para eliminar paciente (solo médicos)
function confirmDeletePatient(id, nombreCompleto, CURP) {
  const body = `
    <div class="alert alert-warning" style="margin-bottom: 1rem;">
      <strong>⚠ Acción irreversible</strong><br>
      Estás a punto de eliminar al paciente del sistema. Esta acción:
      <ul style="margin: 0.5rem 0 0 1rem; padding: 0;">
        <li>Marcará al paciente como inactivo (eliminación lógica)</li>
        <li>Archivará su expediente médico</li>
        <li>Cancelará todas sus citas pendientes</li>
        <li>Conservará el historial clínico por motivos de auditoría</li>
      </ul>
    </div>

    <p><strong>Paciente:</strong> ${nombreCompleto}</p>
    <p><strong>CURP:</strong> ${CURP}</p>

    <div class="form-group" style="margin-top: 1rem;">
      <label>Motivo de eliminación (opcional)</label>
      <textarea id="delete-motivo" placeholder="Ej: Solicitud del paciente, error de registro, paciente fallecido..."></textarea>
    </div>

    <div class="form-group">
      <label class="confirm-checkbox">
        <input type="checkbox" id="confirm-delete-check">
        Confirmo que deseo eliminar este paciente
      </label>
    </div>

    <div id="delete-error" class="error-message hidden"></div>

    <div class="form-actions">
      <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button type="button" class="btn btn-danger" id="btn-confirm-delete" disabled onclick="executeDeletePatient(${id})">Eliminar paciente</button>
    </div>
  `;

  showModal('Eliminar paciente', body);

  // Habilitar el botón solo cuando se marque el checkbox
  document.getElementById('confirm-delete-check').addEventListener('change', (e) => {
    document.getElementById('btn-confirm-delete').disabled = !e.target.checked;
  });
}

async function executeDeletePatient(id) {
  const motivo = document.getElementById('delete-motivo').value.trim();
  const errorDiv = document.getElementById('delete-error');
  const btn = document.getElementById('btn-confirm-delete');

  errorDiv.classList.add('hidden');
  btn.disabled = true;
  btn.textContent = 'Eliminando...';

  try {
    const result = await apiCall(`/pacientes/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ motivo: motivo || null })
    });

    closeModal();

    // Mensaje detallado de lo que pasó
    let mensaje = 'Paciente eliminado exitosamente';
    const detalles = [];
    if (result.expediente_archivado) detalles.push('expediente archivado');
    if (result.citas_canceladas > 0) detalles.push(`${result.citas_canceladas} cita(s) cancelada(s)`);
    if (detalles.length > 0) mensaje += ` (${detalles.join(', ')})`;
    
    showToast(mensaje);

    // Si estamos en la vista de detalle del paciente eliminado, navegar a la lista
    const enDetalle = document.getElementById('paciente-detail-page').classList.contains('active');
    if (enDetalle) {
      navigateTo('pacientes');
    } else {
      loadPacientes();
    }
  } catch (err) {
    errorDiv.textContent = err.message;
    errorDiv.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Eliminar paciente';
  }
}

async function viewPatient(id) {
  try {
    const patient = await apiCall(`/pacientes/${id}`);
    currentPatientId = id;

    const edad = Math.floor((Date.now() - new Date(patient.fecha_nacimiento).getTime()) / 31557600000);
    const esMedico = currentUser.rol === 'medico';

    let html = `
      <div class="patient-header">
        <div>
          <h1>${patient.nombre} ${patient.apellido}</h1>
          ${patient.numero_expediente ? `<p style="margin-bottom: 0.5rem;"><span class="expediente-badge">${patient.numero_expediente}</span></p>` : ''}
          <div class="patient-info-grid">
            <p><strong>CURP:</strong> ${patient.numero_identidad}</p>
            <p><strong>Edad:</strong> ${edad} años</p>
            <p><strong>Sexo:</strong> ${patient.sexo === 'M' ? 'Masculino' : patient.sexo === 'F' ? 'Femenino' : 'Otro'}</p>
            <p><strong>Teléfono:</strong> ${patient.telefono || '-'}</p>
            ${patient.motivo_apertura ? `<p><strong>Motivo apertura:</strong> ${patient.motivo_apertura}</p>` : ''}
            ${patient.medico_nombre ? `<p><strong>Médico responsable:</strong> Dr. ${patient.medico_nombre} ${patient.medico_apellido}</p>` : ''}
          </div>
        </div>
        <div style="text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 0.5rem;">
          <div>
            <p class="text-secondary" style="font-size: 12px;">Tipo de sangre</p>
            <p style="font-size: 22px; font-weight: 500; color: var(--color-primary);">${patient.tipo_sangre || '-'}</p>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="editarPaciente(${patient.id})">✏️ Editar paciente</button>
          ${esMedico ? `<button class="btn btn-danger btn-sm" onclick="confirmDeletePatient(${patient.id}, '${(patient.nombre + ' ' + patient.apellido).replace(/'/g, "\\'")}', '${patient.numero_identidad}')">🗑 Eliminar paciente</button>` : ''}
        </div>
      </div>
    `;

    // Antecedentes y consultas (solo médicos)
    if (esMedico) {
      html += `
        <div class="card">
          <h2>Antecedentes médicos</h2>
          ${patient.alergias ? `<div class="antecedente-item antecedente-condicion"><strong>⚠ Alergias:</strong> ${patient.alergias}</div>` : ''}
          ${(!patient.antecedentes || patient.antecedentes.length === 0) ? 
            '<p class="empty-state">Sin antecedentes registrados</p>' :
            patient.antecedentes.map(a => `
              <div class="antecedente-item antecedente-${a.tipo === 'condición' ? 'condicion' : 'prescripcion'}">
                <strong>${a.tipo === 'condición' ? a.condicion : a.medicamento_nombre}</strong>
                ${a.dosis ? ` - ${a.dosis}` : ''}
                ${a.notas ? `<div style="font-size: 12px; margin-top: 4px;">${a.notas}</div>` : ''}
                <span class="badge badge-${a.estado === 'activo' ? 'completed' : 'pending'}" style="margin-left: 8px;">${a.estado}</span>
              </div>
            `).join('')
          }
        </div>

        <div class="card">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
            <h2>Historial de consultas (${patient.consultas ? patient.consultas.length : 0})</h2>
            <button class="btn btn-primary btn-sm" onclick="openConsultaDirect(${patient.id})">+ Nueva consulta</button>
          </div>
          ${(!patient.consultas || patient.consultas.length === 0) ? 
            '<p class="empty-state">Sin consultas registradas</p>' :
            patient.consultas.map(c => `
              <div class="consulta-item">
                <div class="consulta-header">
                  <span class="consulta-date">${formatDateTime(c.fecha_consulta)}</span>
                  <span class="text-secondary" style="font-size: 12px;">Dr. ${c.medico_nombre}</span>
                </div>
                <div class="consulta-diagnostico">${c.diagnostico}</div>
                <div class="text-secondary" style="font-size: 13px; margin-top: 4px;">${c.motivo_consulta}</div>
              </div>
            `).join('')
          }
        </div>
      `;
    } else {
      // Recepcionista solo ve un mensaje informativo
      html += `
        <div class="card">
          <p class="text-secondary" style="text-align: center; padding: 1rem;">
            Como recepcionista, no tienes acceso a la información clínica del paciente.
          </p>
        </div>
      `;
    }

    document.getElementById('paciente-detail-content').innerHTML = html;
    navigateTo('paciente-detail');
  } catch (err) {
    showToast('Error al cargar paciente', 'error');
  }
}

// ============================================
// CITAS
// ============================================
async function loadCitas() {
  try {
    const citas = await apiCall('/citas');
    const list = document.getElementById('citas-list');
    
    if (citas.length === 0) {
      list.innerHTML = '<tr><td colspan="7" class="text-center empty-state">No hay citas registradas</td></tr>';
      return;
    }

    const esMedico = currentUser.rol === 'medico';

    list.innerHTML = citas.map(c => `
      <tr>
        <td><strong>${c.paciente_nombre} ${c.paciente_apellido}</strong></td>
        <td>Dr. ${c.medico_apellido}</td>
        <td>${formatDate(c.fecha_cita)}</td>
        <td>${c.hora_cita}</td>
        <td>${c.motivo_consulta || '-'}</td>
        <td><span class="badge badge-${c.estado === 'pendiente' ? 'pending' : c.estado === 'completada' ? 'completed' : 'cancelled'}">${c.estado}</span></td>
        <td class="actions">
          ${c.estado === 'pendiente' && esMedico ? `
            <button class="btn btn-primary btn-sm" onclick="openConsulta(${c.id}, ${c.paciente_id})">Atender</button>
          ` : ''}
          ${c.estado === 'pendiente' ? `
            <button class="btn btn-secondary btn-sm" onclick="cancelarCita(${c.id})">Cancelar</button>
          ` : ''}
        </td>
      </tr>
    `).join('');
  } catch (err) {
    showToast('Error al cargar citas', 'error');
  }
}

async function cancelarCita(id) {
  if (!confirm('¿Cancelar esta cita?')) return;
  try {
    await apiCall(`/citas/${id}`, { method: 'DELETE' });
    showToast('Cita cancelada');
    loadCitas();
  } catch (err) {
    showToast('Error al cancelar', 'error');
  }
}

async function showAppointmentForm() {
  try {
    const pacientes = await apiCall('/pacientes');
    
    if (pacientes.length === 0) {
      showModal('Sin pacientes', `
        <p style="text-align: center; padding: 1rem;">
          No hay pacientes registrados. Crea uno primero desde la pestaña Pacientes.
        </p>
        <div class="form-actions">
          <button class="btn btn-primary" onclick="closeModal(); navigateTo('pacientes');">Ir a pacientes</button>
        </div>
      `);
      return;
    }

    const esMedico = currentUser.rol === 'medico';
    let selectMedico = '';
    
    if (!esMedico) {
      const medicos = await apiCall('/medicos');
      selectMedico = `
        <div class="form-group">
          <label>Médico *</label>
          <select id="a-medico" required>
            <option value="">Seleccionar médico</option>
            ${medicos.map(m => `<option value="${m.id}">Dr. ${m.nombre} ${m.apellido}${m.especialidad ? ' - ' + m.especialidad : ''}</option>`).join('')}
          </select>
        </div>
      `;
    }

    const body = `
      <form id="appointment-form">
        <div class="form-group">
          <label>Paciente *</label>
          <select id="a-paciente" required>
            <option value="">Seleccionar paciente</option>
            ${pacientes.map(p => `<option value="${p.id}">${p.nombre} ${p.apellido} - ${p.numero_identidad}</option>`).join('')}
          </select>
        </div>

        ${selectMedico}

        <div class="form-row">
          <div class="form-group">
            <label>Fecha *</label>
            <input type="date" id="a-fecha" required min="${new Date().toISOString().split('T')[0]}">
          </div>
          <div class="form-group">
            <label>Hora *</label>
            <input type="time" id="a-hora" required>
          </div>
        </div>

        <div class="form-group">
          <label>Motivo de consulta</label>
          <input type="text" id="a-motivo" placeholder="Ej: Revisión general">
        </div>

        <div class="form-group">
          <label>Notas adicionales</label>
          <textarea id="a-notas"></textarea>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Agendar cita</button>
        </div>
      </form>
    `;

    showModal('Agendar cita', body);

    document.getElementById('appointment-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const data = {
        paciente_id: document.getElementById('a-paciente').value,
        fecha_cita: document.getElementById('a-fecha').value,
        hora_cita: document.getElementById('a-hora').value,
        motivo_consulta: document.getElementById('a-motivo').value,
        notas: document.getElementById('a-notas').value
      };

      if (!esMedico) {
        data.medico_id = document.getElementById('a-medico').value;
      }

      try {
        await apiCall('/citas', {
          method: 'POST',
          body: JSON.stringify(data)
        });
        showToast('Cita agendada');
        closeModal();
        loadCitas();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  } catch (err) {
    showToast('Error al cargar formulario', 'error');
  }
}

// ============================================
// CONSULTAS (solo médicos)
// ============================================
async function openConsulta(citaId, pacienteId) {
  currentAppointmentId = citaId;
  currentPatientId = pacienteId;
  medicamentos = [];
  
  try {
    const patient = await apiCall(`/pacientes/${pacienteId}`);
    const edad = Math.floor((Date.now() - new Date(patient.fecha_nacimiento).getTime()) / 31557600000);

    document.getElementById('consulta-content').innerHTML = `
      <div class="patient-header">
        <div>
          <h1>${patient.nombre} ${patient.apellido}</h1>
          ${patient.numero_expediente ? `<p><span class="expediente-badge">${patient.numero_expediente}</span></p>` : ''}
          <div class="patient-info-grid">
            <p><strong>CURP:</strong> ${patient.numero_identidad}</p>
            <p><strong>Edad:</strong> ${edad} años</p>
            <p><strong>Sexo:</strong> ${patient.sexo === 'M' ? 'Masculino' : 'Femenino'}</p>
          </div>
          ${patient.alergias ? `<div class="antecedente-item antecedente-condicion" style="margin-top: 10px;"><strong>⚠ Alergias:</strong> ${patient.alergias}</div>` : ''}
        </div>
        <div style="text-align: right;">
          <p class="text-secondary" style="font-size: 12px;">Tipo de sangre</p>
          <p style="font-size: 22px; font-weight: 500; color: var(--color-primary);">${patient.tipo_sangre || '-'}</p>
        </div>
      </div>

      <div class="card">
        <h1 style="margin-bottom: 1.5rem;">Nueva consulta - ${new Date().toLocaleDateString('es-ES')}</h1>
        <form id="consulta-form">
          <div class="section">
            <h3>Signos vitales</h3>
            <div class="form-row-3">
              <div class="form-group"><label>Peso (kg)</label><input type="number" step="0.1" id="c-peso"></div>
              <div class="form-group"><label>Altura (cm)</label><input type="number" step="0.1" id="c-altura"></div>
              <div class="form-group"><label>Presión arterial</label><input type="text" id="c-presion" placeholder="120/80"></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label>Temperatura (°C)</label><input type="number" step="0.1" id="c-temp"></div>
              <div class="form-group"><label>FC (lpm)</label><input type="number" id="c-fc"></div>
            </div>
          </div>

          <div class="section">
            <h3>Motivo y síntomas</h3>
            <div class="form-group"><label>Motivo *</label><input type="text" id="c-motivo" required></div>
            <div class="form-group"><label>Síntomas *</label><textarea id="c-sintomas" required></textarea></div>
          </div>

          <div class="section">
            <h3>Diagnóstico</h3>
            <div class="form-group"><label>Diagnóstico *</label><textarea id="c-diagnostico" required></textarea></div>
          </div>

          <div class="section">
            <h3>Plan de tratamiento</h3>
            <div class="form-group"><label>Plan</label><textarea id="c-tratamiento"></textarea></div>
            <div class="form-group">
              <label>Medicamentos prescritos</label>
              <div id="medications-list"></div>
              <button type="button" class="btn btn-secondary btn-sm" onclick="addMedication()">+ Agregar medicamento</button>
            </div>
            <div class="form-group"><label>Próximo control</label><input type="date" id="c-proximo" min="${new Date().toISOString().split('T')[0]}"></div>
          </div>

          <div class="form-group"><label>Observaciones</label><textarea id="c-observaciones"></textarea></div>

          <div class="form-actions">
            <button type="button" class="btn btn-secondary" onclick="navigateTo('citas')">Cancelar</button>
            <button type="submit" class="btn btn-success">✓ Guardar consulta</button>
          </div>
        </form>
      </div>
    `;

    navigateTo('consulta');

    document.getElementById('consulta-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = {
        cita_id: currentAppointmentId,
        paciente_id: currentPatientId,
        peso: parseFloat(document.getElementById('c-peso').value) || null,
        altura: parseFloat(document.getElementById('c-altura').value) || null,
        presion_arterial: document.getElementById('c-presion').value,
        temperatura: parseFloat(document.getElementById('c-temp').value) || null,
        frecuencia_cardiaca: parseInt(document.getElementById('c-fc').value) || null,
        motivo_consulta: document.getElementById('c-motivo').value,
        sintomas: document.getElementById('c-sintomas').value,
        diagnostico: document.getElementById('c-diagnostico').value,
        plan_tratamiento: document.getElementById('c-tratamiento').value,
        observaciones: document.getElementById('c-observaciones').value,
        fecha_proximo_control: document.getElementById('c-proximo').value || null,
        medicamentos: medicamentos.filter(m => m.nombre)
      };

      try {
        await apiCall('/consultas', { method: 'POST', body: JSON.stringify(data) });
        showToast('Consulta guardada');
        navigateTo('citas');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  } catch (err) {
    showToast('Error al abrir consulta', 'error');
  }
}

function openConsultaDirect(pacienteId) {
  openConsulta(null, pacienteId);
}

function addMedication() {
  medicamentos.push({ nombre: '', dosis: '', duracion_dias: '' });
  renderMedications();
}

function removeMedication(index) {
  medicamentos.splice(index, 1);
  renderMedications();
}

function updateMedication(index, field, value) {
  medicamentos[index][field] = value;
}

function renderMedications() {
  const container = document.getElementById('medications-list');
  if (!container) return;
  container.innerHTML = medicamentos.map((med, idx) => `
    <div class="medication-row">
      <input type="text" placeholder="Medicamento" value="${med.nombre}" onchange="updateMedication(${idx}, 'nombre', this.value)">
      <input type="text" placeholder="Dosis" value="${med.dosis}" onchange="updateMedication(${idx}, 'dosis', this.value)">
      <input type="number" placeholder="Días" min="1" value="${med.duracion_dias}" onchange="updateMedication(${idx}, 'duracion_dias', this.value)">
      <button type="button" class="btn-icon" onclick="removeMedication(${idx})">🗑</button>
    </div>
  `).join('');
}

// ============================================
// AUDITORÍA
// ============================================
async function loadAuditoria() {
  try {
    const registros = await apiCall('/auditoria/mias');
    const list = document.getElementById('auditoria-list');
    
    if (registros.length === 0) {
      list.innerHTML = '<tr><td colspan="4" class="text-center empty-state">Sin registros de actividad</td></tr>';
      return;
    }

    list.innerHTML = registros.map(r => `
      <tr>
        <td>${formatDateTime(r.fecha_accion)}</td>
        <td><span class="badge badge-${r.exitoso ? 'completed' : 'cancelled'}">${r.accion}</span></td>
        <td>${r.entidad}</td>
        <td>${r.descripcion || '-'}</td>
      </tr>
    `).join('');
  } catch (err) {
    showToast('Error al cargar auditoría', 'error');
  }
}

// ============================================
// UTILIDADES
// ============================================
function formatDate(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('es-ES');
}

function formatDateTime(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString('es-ES');
}

document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('modal-overlay')) {
    closeModal();
  }
});

// ============================================
// INICIALIZACIÓN
// ============================================
window.addEventListener('load', async () => {
  const token = sessionStorage.getItem('token');
  const user = sessionStorage.getItem('user');
  
  if (token && user) {
    currentUser = JSON.parse(user);
    setupUserInterface();
    showScreen('app-screen');
    navigateTo('dashboard');
    // Iniciar monitor de inactividad para sesión restaurada
    startInactivityWatcher();
  } else {
    // Mostrar mensaje si la sesión cerró por inactividad
    const logoutReason = sessionStorage.getItem('logout_reason');
    if (logoutReason === 'inactivity') {
      sessionStorage.removeItem('logout_reason');
    }
    await showInitialScreen();
  }
});

// ============================================
// FUNCIONES DE ADMINISTRADOR
// ============================================

async function loadAdminDashboard() {
  try {
    const stats = await apiCall('/admin/stats');
    
    // Actualizamos los stats de la sección normal para que el admin vea info global
    document.getElementById('stat-citas-hoy').textContent = stats.medicos_activos;
    document.querySelector('#stat-citas-hoy').previousElementSibling.textContent = 'Médicos activos';
    
    document.getElementById('stat-pacientes').textContent = stats.pacientes_activos;
    document.querySelector('#stat-pacientes').previousElementSibling.textContent = 'Pacientes activos';
    
    document.getElementById('stat-expedientes').textContent = stats.expedientes_activos;
    document.querySelector('#stat-expedientes').previousElementSibling.textContent = 'Expedientes activos';
    
    document.getElementById('stat-consultas').textContent = stats.auditoria_registros;
    document.querySelector('#stat-consultas').previousElementSibling.textContent = 'Acciones auditadas';

    // Reemplazar la lista de citas con un panel de administración
    const citasList = document.getElementById('citas-hoy-list');
    citasList.innerHTML = `
      <div class="admin-stats-grid">
        <div class="admin-stat-card">
          <h4>👨‍⚕️ Médicos</h4>
          <p><strong>${stats.medicos_activos}</strong> activos · ${stats.medicos_inactivos} inactivos</p>
        </div>
        <div class="admin-stat-card">
          <h4>👩‍💼 Recepcionistas</h4>
          <p><strong>${stats.recepcionistas_activos}</strong> activas · ${stats.recepcionistas_inactivos} inactivas</p>
        </div>
        <div class="admin-stat-card">
          <h4>🏥 Pacientes</h4>
          <p><strong>${stats.pacientes_activos}</strong> activos · ${stats.pacientes_eliminados} eliminados</p>
        </div>
        <div class="admin-stat-card">
          <h4>📋 Expedientes</h4>
          <p><strong>${stats.expedientes_activos}</strong> activos · ${stats.expedientes_archivados} archivados</p>
        </div>
        <div class="admin-stat-card alert">
          <h4>⚠ Accesos denegados</h4>
          <p><strong>${stats.intentos_acceso_denegado}</strong> intentos</p>
        </div>
        <div class="admin-stat-card alert">
          <h4>⚠ Logins fallidos</h4>
          <p><strong>${stats.logins_fallidos}</strong> intentos</p>
        </div>
      </div>
    `;
  } catch (err) {
    showToast('Error al cargar dashboard', 'error');
  }
}

// ============================================
// GESTIÓN DE USUARIOS (ADMIN)
// ============================================
// Almacenar usuarios cargados para edición
let usuariosCache = [];

async function loadAdminUsuarios() {
  try {
    const usuarios = await apiCall('/admin/usuarios');
    usuariosCache = usuarios; // Para acceder desde el modal de edición
    const tbody = document.getElementById('admin-usuarios-list');
    
    if (!tbody) return;
    
    if (usuarios.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center empty-state">No hay usuarios registrados</td></tr>';
      return;
    }

    tbody.innerHTML = usuarios.map(u => {
      const rolLabel = { medico: 'Médico', recepcionista: 'Recepción', admin: 'Admin' }[u.rol] || u.rol;
      const esYo = u.id === currentUser.id;
      const esUltimoAdmin = u.rol === 'admin' && usuarios.filter(x => x.rol === 'admin' && x.activo === 1).length === 1;
      
      return `
        <tr class="${u.activo ? '' : 'usuario-inactivo'}">
          <td><strong>${u.nombre} ${u.apellido}</strong>${esYo ? ' <span class="badge-rol admin" style="font-size:10px;">tú</span>' : ''}</td>
          <td>${u.email}</td>
          <td><span class="badge-rol ${u.rol}">${rolLabel}</span></td>
          <td>${u.especialidad || u.numero_licencia || '-'}</td>
          <td>${u.activo ? '<span class="badge badge-completed">Activo</span>' : '<span class="badge badge-pending">Inactivo</span>'}</td>
          <td class="actions">
            <button class="btn btn-primary btn-sm" onclick="editarUsuario(${u.id})" title="Editar datos del usuario">
              ✏️ Editar
            </button>
            ${(!esYo && !(esUltimoAdmin && u.activo)) ? 
              `<button class="btn btn-sm ${u.activo ? 'btn-danger' : 'btn-success'}" 
                       onclick="toggleUsuario(${u.id}, ${u.activo ? 0 : 1}, '${(u.nombre + ' ' + u.apellido).replace(/'/g, "\\'")}')">
                ${u.activo ? 'Desactivar' : 'Activar'}
               </button>` : 
              ''
            }
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    showToast('Error al cargar usuarios', 'error');
  }
}

// Editar datos de un usuario existente
function editarUsuario(id) {
  const u = usuariosCache.find(x => x.id === id);
  if (!u) {
    showToast('Usuario no encontrado', 'error');
    return;
  }

  const esMedico = u.rol === 'medico';
  
  const body = `
    <form id="form-editar-usuario">
      <div class="alert alert-info" style="margin-bottom: 1rem;">
        ℹ Editando datos de <strong>${u.nombre} ${u.apellido}</strong> (${u.email}).
        El email y el rol no se pueden modificar.
      </div>

      <div class="form-row">
        <div class="form-group">
          <label>Email (no editable)</label>
          <input type="email" value="${u.email}" disabled style="opacity: 0.6;">
        </div>
        <div class="form-group">
          <label>Rol (no editable)</label>
          <input type="text" value="${({medico:'Médico',recepcionista:'Recepcionista',admin:'Administrador'})[u.rol]}" disabled style="opacity: 0.6;">
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label>Nombre *</label>
          <input type="text" id="edit-nombre" value="${u.nombre || ''}" required>
        </div>
        <div class="form-group">
          <label>Apellido *</label>
          <input type="text" id="edit-apellido" value="${u.apellido || ''}" required>
        </div>
      </div>

      <div class="form-group">
        <label>Teléfono</label>
        <input type="text" id="edit-telefono" value="${u.telefono || ''}" placeholder="Ej: 999-999-9999">
      </div>

      ${esMedico ? `
      <div class="form-row">
        <div class="form-group">
          <label>Especialidad</label>
          <input type="text" id="edit-especialidad" value="${u.especialidad || ''}" placeholder="Ej: Medicina General">
        </div>
        <div class="form-group">
          <label>Núm. Licencia (no editable)</label>
          <input type="text" value="${u.numero_licencia || ''}" disabled style="opacity: 0.6;">
        </div>
      </div>
      ` : ''}

      <div id="edit-error" class="error-message hidden"></div>

      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-primary">Guardar cambios</button>
      </div>
    </form>
  `;

  showModal('Editar usuario', body);

  document.getElementById('form-editar-usuario').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorDiv = document.getElementById('edit-error');
    errorDiv.classList.add('hidden');

    const data = {
      nombre: document.getElementById('edit-nombre').value.trim(),
      apellido: document.getElementById('edit-apellido').value.trim(),
      telefono: document.getElementById('edit-telefono').value.trim()
    };

    // Especialidad solo si es médico
    const especialidadField = document.getElementById('edit-especialidad');
    if (especialidadField) {
      data.especialidad = especialidadField.value.trim();
    }

    // Validar
    if (!data.nombre || !data.apellido) {
      errorDiv.textContent = 'El nombre y apellido son obligatorios';
      errorDiv.classList.remove('hidden');
      return;
    }

    try {
      await apiCall(`/admin/usuarios/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data)
      });
      
      closeModal();
      showToast(`Usuario ${data.nombre} ${data.apellido} actualizado exitosamente`);
      loadAdminUsuarios();
    } catch (err) {
      errorDiv.textContent = err.message;
      errorDiv.classList.remove('hidden');
    }
  });
}

async function toggleUsuario(id, nuevoEstado, nombreCompleto) {
  const accion = nuevoEstado ? 'activar' : 'desactivar';
  if (!confirm(`¿Confirmas ${accion} a ${nombreCompleto}?`)) return;

  try {
    await apiCall(`/admin/usuarios/${id}/estado`, {
      method: 'PUT',
      body: JSON.stringify({ activo: nuevoEstado === 1 })
    });
    showToast(`Usuario ${accion === 'activar' ? 'activado' : 'desactivado'} exitosamente`);
    loadAdminUsuarios();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Crear nuevo usuario desde admin
function showCrearUsuario() {
  const body = `
    <form id="form-crear-usuario">
      <div class="form-row">
        <div class="form-group">
          <label>Rol *</label>
          <select id="cu-rol" required onchange="document.getElementById('cu-licencia-row').style.display = this.value==='medico' ? 'flex' : 'none'">
            <option value="">Seleccionar</option>
            <option value="medico">Médico</option>
            <option value="recepcionista">Recepcionista</option>
            <option value="admin">Administrador</option>
          </select>
        </div>
        <div class="form-group">
          <label>Email *</label>
          <input type="email" id="cu-email" required>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label>Nombre *</label>
          <input type="text" id="cu-nombre" required>
        </div>
        <div class="form-group">
          <label>Apellido *</label>
          <input type="text" id="cu-apellido" required>
        </div>
      </div>

      <div class="form-row" id="cu-licencia-row" style="display:none;">
        <div class="form-group">
          <label>Número de licencia (médicos)</label>
          <input type="text" id="cu-licencia">
        </div>
        <div class="form-group">
          <label>Especialidad</label>
          <input type="text" id="cu-especialidad">
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label>Teléfono</label>
          <input type="text" id="cu-telefono">
        </div>
        <div class="form-group">
          <label>Contraseña inicial * (mín. 8 caracteres)</label>
          <input type="password" id="cu-password" required minlength="8">
        </div>
      </div>

      <div id="cu-error" class="error-message hidden"></div>

      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-primary">Crear usuario</button>
      </div>
    </form>
  `;

  showModal('Crear nuevo usuario', body);

  document.getElementById('form-crear-usuario').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorDiv = document.getElementById('cu-error');
    errorDiv.classList.add('hidden');

    const data = {
      rol: document.getElementById('cu-rol').value,
      email: document.getElementById('cu-email').value,
      password: document.getElementById('cu-password').value,
      nombre: document.getElementById('cu-nombre').value,
      apellido: document.getElementById('cu-apellido').value,
      telefono: document.getElementById('cu-telefono').value || null,
      numero_licencia: document.getElementById('cu-licencia').value || null,
      especialidad: document.getElementById('cu-especialidad').value || null
    };

    try {
      const result = await apiCall('/auth/registro', {
        method: 'POST',
        body: JSON.stringify(data)
      });
      
      closeModal();
      
      // Mostrar código de recuperación al admin
      showModal('✓ Usuario creado', `
        <div style="text-align: center;">
          <p style="margin-bottom: 1rem;">Usuario <strong>${result.nombre} ${result.apellido}</strong> creado exitosamente.</p>
          <p class="text-secondary" style="margin-bottom: 1rem;">Entrega estas credenciales al usuario:</p>
          <div class="recovery-code-box">
            <p class="recovery-code-label">Email</p>
            <div class="recovery-code" style="font-size: 14px;">${result.email}</div>
            <p class="recovery-code-label" style="margin-top:1rem;">Código de recuperación</p>
            <div class="recovery-code">${result.codigoRecuperacion}</div>
          </div>
          <p class="text-secondary" style="margin-top: 1rem; font-size: 12px;">Anota el código antes de cerrar esta ventana, no podrás verlo de nuevo.</p>
          <div class="form-actions" style="justify-content: center;">
            <button class="btn btn-primary" onclick="closeModal(); loadAdminUsuarios();">Entendido</button>
          </div>
        </div>
      `);
    } catch (err) {
      errorDiv.textContent = err.message;
      errorDiv.classList.remove('hidden');
    }
  });
}

// ============================================
// AUDITORÍA GLOBAL (ADMIN)
// ============================================
async function loadAdminAuditoria() {
  try {
    const filtroAccion = document.getElementById('filtro-accion')?.value || '';
    const filtroUsuario = document.getElementById('filtro-usuario')?.value || '';
    
    let url = '/auditoria/todas?limit=200';
    if (filtroAccion) url += '&accion=' + encodeURIComponent(filtroAccion);
    if (filtroUsuario) url += '&usuario_email=' + encodeURIComponent(filtroUsuario);
    
    const registros = await apiCall(url);
    const tbody = document.getElementById('admin-auditoria-list');
    
    if (!tbody) return;
    
    if (registros.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center empty-state">Sin registros</td></tr>';
      return;
    }

    tbody.innerHTML = registros.map(r => {
      const fecha = new Date(r.fecha_accion).toLocaleString('es-ES');
      const accionClass = {
        'CREATE': 'badge-completed',
        'UPDATE': 'badge-pending',
        'DELETE': 'badge-danger',
        'RESTORE': 'badge-completed',
        'LOGIN': 'badge-completed',
        'LOGIN_FAILED': 'badge-danger',
        'ACCESS_DENIED': 'badge-danger',
        'PASSWORD_RESET': 'badge-pending'
      }[r.accion] || 'badge-pending';
      
      return `
        <tr>
          <td style="font-size:12px;">${fecha}</td>
          <td>${r.usuario_email}<br><span class="badge-rol ${r.usuario_rol}" style="font-size:10px;">${r.usuario_rol}</span></td>
          <td><span class="badge ${accionClass}">${r.accion}</span></td>
          <td>${r.entidad}${r.entidad_id ? ' #' + r.entidad_id : ''}</td>
          <td style="font-size:12px;">${r.descripcion || '-'}</td>
          <td style="font-size:11px;">${r.ip_origen || '-'}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    showToast('Error al cargar auditoría', 'error');
  }
}

// ============================================
// PACIENTES ELIMINADOS (ADMIN)
// ============================================
async function loadAdminEliminados() {
  try {
    const pacientes = await apiCall('/admin/pacientes-eliminados');
    const tbody = document.getElementById('admin-eliminados-list');
    
    if (!tbody) return;
    
    if (pacientes.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center empty-state">No hay pacientes eliminados</td></tr>';
      return;
    }

    tbody.innerHTML = pacientes.map(p => {
      const fechaEliminacion = p.fecha_eliminacion ? new Date(p.fecha_eliminacion).toLocaleString('es-ES') : '-';
      return `
        <tr>
          <td>${p.numero_expediente ? `<span class="expediente-badge">${p.numero_expediente}</span>` : '-'}</td>
          <td><strong>${p.nombre} ${p.apellido}</strong></td>
          <td>${p.numero_identidad}</td>
          <td>${p.eliminado_por_nombre || '-'}</td>
          <td style="font-size:12px;">${fechaEliminacion}<br><span style="color: var(--color-tertiary); font-size:11px;">${p.motivo_eliminacion || 'Sin motivo'}</span></td>
          <td class="actions">
            <button class="btn btn-success btn-sm" onclick="restaurarPaciente(${p.id}, '${(p.nombre + ' ' + p.apellido).replace(/'/g, "\\'")}')">↩ Restaurar</button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    showToast('Error al cargar pacientes eliminados', 'error');
  }
}

async function restaurarPaciente(id, nombreCompleto) {
  if (!confirm(`¿Restaurar a ${nombreCompleto}?\n\nEsto reactivará el paciente y su expediente.`)) return;

  try {
    const result = await apiCall(`/admin/pacientes/${id}/restaurar`, { method: 'POST' });
    let msg = 'Paciente restaurado exitosamente';
    if (result.expediente_reactivado) msg += ' (expediente reactivado)';
    showToast(msg);
    loadAdminEliminados();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ============================================
// EDICIÓN DE PACIENTES (Opción D - con motivo obligatorio)
// ============================================
async function editarPaciente(id) {
  try {
    const p = await apiCall(`/pacientes/${id}`);
    
    const body = `
      <form id="form-editar-paciente">
        <div class="alert alert-warning" style="margin-bottom: 1rem;">
          <strong>⚠ Atención:</strong> Todos los cambios quedarán registrados en la auditoría del sistema 
          junto con el motivo proporcionado. El administrador puede revisar y revertir cambios si es necesario.
        </div>

        <h3 style="margin-bottom: 1rem; color: var(--color-primary);">Datos de identificación</h3>
        
        <div class="form-row">
          <div class="form-group">
            <label>CURP * <span style="color: var(--color-danger); font-size: 11px;">⚠ Editable - usar con cuidado</span></label>
            <input type="text" id="ep-curp" value="${p.numero_identidad || ''}" required>
          </div>
          <div class="form-group">
            <label>Fecha de nacimiento *</label>
            <input type="date" id="ep-fnac" value="${p.fecha_nacimiento || ''}" required>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>Nombre *</label>
            <input type="text" id="ep-nombre" value="${p.nombre || ''}" required>
          </div>
          <div class="form-group">
            <label>Apellido *</label>
            <input type="text" id="ep-apellido" value="${p.apellido || ''}" required>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>Sexo *</label>
            <select id="ep-sexo" required>
              <option value="M" ${p.sexo === 'M' ? 'selected' : ''}>Masculino</option>
              <option value="F" ${p.sexo === 'F' ? 'selected' : ''}>Femenino</option>
              <option value="O" ${p.sexo === 'O' ? 'selected' : ''}>Otro</option>
            </select>
          </div>
          <div class="form-group">
            <label>Tipo de sangre</label>
            <select id="ep-sangre">
              <option value="">No especificado</option>
              ${['O+','O-','A+','A-','B+','B-','AB+','AB-'].map(t => 
                `<option value="${t}" ${p.tipo_sangre === t ? 'selected' : ''}>${t}</option>`
              ).join('')}
            </select>
          </div>
        </div>

        <h3 style="margin: 1.5rem 0 1rem; color: var(--color-primary);">Datos de contacto</h3>

        <div class="form-row">
          <div class="form-group">
            <label>Teléfono</label>
            <input type="text" id="ep-telefono" value="${p.telefono || ''}" placeholder="Ej: 555-1234567">
          </div>
          <div class="form-group">
            <label>Email</label>
            <input type="email" id="ep-email" value="${p.email || ''}">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>Dirección</label>
            <input type="text" id="ep-direccion" value="${p.direccion || ''}">
          </div>
          <div class="form-group">
            <label>Ciudad</label>
            <input type="text" id="ep-ciudad" value="${p.ciudad || ''}">
          </div>
        </div>

        <h3 style="margin: 1.5rem 0 1rem; color: var(--color-primary);">Datos médicos</h3>

        <div class="form-group">
          <label>Alergias conocidas</label>
          <textarea id="ep-alergias" rows="2" placeholder="Ej: Penicilina, Aspirina, polen...">${p.alergias || ''}</textarea>
        </div>

        <h3 style="margin: 1.5rem 0 1rem; color: var(--color-danger);">Motivo del cambio (obligatorio)</h3>

        <div class="form-group">
          <label>Describe la razón del cambio * <span style="font-size:11px; color: var(--color-text-secondary);">(mínimo 5 caracteres)</span></label>
          <textarea id="ep-motivo" rows="3" required minlength="5" 
                    placeholder="Ej: El paciente proporcionó número telefónico actualizado / Corrección de CURP capturado erróneamente / Actualización de domicilio por mudanza..."></textarea>
        </div>

        <div id="ep-error" class="error-message hidden"></div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar cambios</button>
        </div>
      </form>
    `;

    showModal(`Editar paciente: ${p.nombre} ${p.apellido}`, body);

    document.getElementById('form-editar-paciente').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorDiv = document.getElementById('ep-error');
      errorDiv.classList.add('hidden');

      const motivo = document.getElementById('ep-motivo').value.trim();
      if (motivo.length < 5) {
        errorDiv.textContent = 'El motivo del cambio es obligatorio (mínimo 5 caracteres)';
        errorDiv.classList.remove('hidden');
        return;
      }

      const data = {
        numero_identidad: document.getElementById('ep-curp').value.trim(),
        nombre: document.getElementById('ep-nombre').value.trim(),
        apellido: document.getElementById('ep-apellido').value.trim(),
        fecha_nacimiento: document.getElementById('ep-fnac').value,
        sexo: document.getElementById('ep-sexo').value,
        telefono: document.getElementById('ep-telefono').value.trim() || null,
        email: document.getElementById('ep-email').value.trim() || null,
        direccion: document.getElementById('ep-direccion').value.trim() || null,
        ciudad: document.getElementById('ep-ciudad').value.trim() || null,
        tipo_sangre: document.getElementById('ep-sangre').value || null,
        alergias: document.getElementById('ep-alergias').value.trim() || null,
        motivo: motivo
      };

      try {
        const result = await apiCall(`/pacientes/${id}`, {
          method: 'PUT',
          body: JSON.stringify(data)
        });
        
        closeModal();
        
        let mensaje = `Paciente actualizado exitosamente`;
        if (result.campos_modificados && result.campos_modificados.length > 0) {
          mensaje += ` (${result.campos_modificados.length} campo${result.campos_modificados.length > 1 ? 's' : ''} modificado${result.campos_modificados.length > 1 ? 's' : ''})`;
        }
        showToast(mensaje);
        
        // Refrescar vista
        if (document.getElementById('pacientes-page').classList.contains('active')) {
          loadPacientes();
        } else if (currentPatientId === id) {
          viewPatient(id);
        }
      } catch (err) {
        errorDiv.textContent = err.message;
        errorDiv.classList.remove('hidden');
      }
    });

  } catch (err) {
    showToast('Error al cargar datos del paciente: ' + err.message, 'error');
  }
}

// ============================================
// MODAL: NUEVO PACIENTE (reemplaza apertura)
// ============================================
async function abrirModalNuevoPaciente() {
  // Cargar médicos para el select
  let medicos = [];
  try {
    medicos = await apiCall('/medicos');
  } catch (err) {}

  const medicoOpts = medicos.map(m => 
    `<option value="${m.id}">Dr. ${m.nombre} ${m.apellido}${m.especialidad ? ' — ' + m.especialidad : ''}</option>`
  ).join('');

  const body = `
    <form id="form-nuevo-paciente">
      <p style="font-size: 13px; color: var(--color-text-secondary); margin: 0 0 16px 0;">Crear paciente y su expediente médico en un solo paso</p>

      <p style="font-size: 11px; color: var(--color-text-tertiary); margin: 0 0 8px 0; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;">Identificación</p>
      <div class="form-row">
        <div class="form-group">
          <label>CURP *</label>
          <input type="text" id="np-curp" required placeholder="Ej: GARC900101HDF...">
        </div>
        <div class="form-group">
          <label>Fecha de nacimiento *</label>
          <input type="date" id="np-fnac" required>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label>Nombre *</label>
          <input type="text" id="np-nombre" required>
        </div>
        <div class="form-group">
          <label>Apellido *</label>
          <input type="text" id="np-apellido" required>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label>Sexo *</label>
          <select id="np-sexo" required>
            <option value="">Seleccionar...</option>
            <option value="M">Masculino</option>
            <option value="F">Femenino</option>
            <option value="O">Otro</option>
          </select>
        </div>
        <div class="form-group">
          <label>Teléfono</label>
          <input type="tel" id="np-telefono" placeholder="Ej: 555-1234">
        </div>
      </div>

      <p style="font-size: 11px; color: var(--color-text-tertiary); margin: 16px 0 8px 0; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;">Apertura del expediente</p>
      
      <div class="form-row">
        <div class="form-group">
          <label>Motivo de apertura *</label>
          <input type="text" id="np-motivo" required placeholder="Ej: Chequeo inicial, primera consulta...">
        </div>
        <div class="form-group">
          <label>Médico responsable</label>
          <select id="np-medico">
            <option value="">Sin asignar</option>
            ${medicoOpts}
          </select>
        </div>
      </div>

      <details style="margin: 16px 0;">
        <summary style="cursor: pointer; color: var(--color-primary); font-size: 13px; padding: 4px 0;">▸ Mostrar datos adicionales (email, dirección, tipo sangre, alergias)</summary>
        
        <div style="margin-top: 12px;">
          <div class="form-row">
            <div class="form-group">
              <label>Email</label>
              <input type="email" id="np-email">
            </div>
            <div class="form-group">
              <label>Tipo de sangre</label>
              <select id="np-sangre">
                <option value="">No especificado</option>
                <option value="O+">O+</option>
                <option value="O-">O-</option>
                <option value="A+">A+</option>
                <option value="A-">A-</option>
                <option value="B+">B+</option>
                <option value="B-">B-</option>
                <option value="AB+">AB+</option>
                <option value="AB-">AB-</option>
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>Dirección</label>
              <input type="text" id="np-direccion">
            </div>
            <div class="form-group">
              <label>Ciudad</label>
              <input type="text" id="np-ciudad">
            </div>
          </div>

          <div class="form-group">
            <label>Alergias conocidas</label>
            <textarea id="np-alergias" rows="2" placeholder="Ej: Penicilina, polen..."></textarea>
          </div>

          <div class="form-group">
            <label>Notas adicionales</label>
            <textarea id="np-notas" rows="2" placeholder="Información relevante sobre el paciente..."></textarea>
          </div>
        </div>
      </details>

      <div id="np-error" class="error-message hidden"></div>

      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-success">✓ Crear paciente y expediente</button>
      </div>
    </form>
  `;

  showModal('Nuevo paciente', body);

  document.getElementById('form-nuevo-paciente').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorDiv = document.getElementById('np-error');
    errorDiv.classList.add('hidden');

    const data = {
      numero_identidad: document.getElementById('np-curp').value.trim(),
      nombre: document.getElementById('np-nombre').value.trim(),
      apellido: document.getElementById('np-apellido').value.trim(),
      fecha_nacimiento: document.getElementById('np-fnac').value,
      sexo: document.getElementById('np-sexo').value,
      telefono: document.getElementById('np-telefono').value.trim() || null,
      email: document.getElementById('np-email')?.value.trim() || null,
      direccion: document.getElementById('np-direccion')?.value.trim() || null,
      ciudad: document.getElementById('np-ciudad')?.value.trim() || null,
      tipo_sangre: document.getElementById('np-sangre')?.value || null,
      alergias: document.getElementById('np-alergias')?.value.trim() || null,
      motivo_apertura: document.getElementById('np-motivo').value.trim(),
      medico_responsable_id: document.getElementById('np-medico').value || null,
      notas_apertura: document.getElementById('np-notas')?.value.trim() || null
    };

    try {
      const result = await apiCall('/pacientes/apertura-expediente', {
        method: 'POST',
        body: JSON.stringify(data)
      });
      
      closeModal();
      showToast(`Paciente creado: ${data.nombre} ${data.apellido} — Expediente ${result.numero_expediente}`);
      loadPacientes();
    } catch (err) {
      errorDiv.textContent = err.message;
      errorDiv.classList.remove('hidden');
    }
  });
}

// ============================================
// MODAL: AGENDAR CITA desde paciente
// ============================================
async function abrirModalAgendarCita(pacienteId) {
  try {
    // Cargar datos del paciente y médicos
    const [paciente, medicos] = await Promise.all([
      apiCall(`/pacientes/${pacienteId}`),
      apiCall('/medicos')
    ]);

    if (paciente.activo === 0) {
      showToast('No se puede agendar cita a un paciente eliminado', 'error');
      return;
    }

    const medicoOpts = medicos.map(m => 
      `<option value="${m.id}">Dr. ${m.nombre} ${m.apellido}${m.especialidad ? ' — ' + m.especialidad : ''}</option>`
    ).join('');

    // Fecha mínima = hoy
    const hoy = new Date().toISOString().split('T')[0];

    const body = `
      <form id="form-agendar-cita">
        <div class="alert alert-info" style="margin-bottom: 16px; padding: 12px 14px; background: #E6F1FB; border-left: 3px solid #185FA5; border-radius: 6px;">
          <p style="font-size: 12px; color: #185FA5; margin: 0 0 2px 0; font-weight: 500;">Paciente</p>
          <p style="font-size: 14px; color: #042C53; margin: 0; font-weight: 500;">${paciente.nombre} ${paciente.apellido}${paciente.numero_expediente ? ' · ' + paciente.numero_expediente : ''}</p>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>Fecha *</label>
            <input type="date" id="ac-fecha" min="${hoy}" required>
          </div>
          <div class="form-group">
            <label>Hora *</label>
            <input type="time" id="ac-hora" required>
          </div>
        </div>

        <div class="form-group">
          <label>Médico *</label>
          <select id="ac-medico" required>
            <option value="">Seleccionar médico...</option>
            ${medicoOpts}
          </select>
        </div>

        <div class="form-group">
          <label>Motivo de la consulta</label>
          <input type="text" id="ac-motivo" placeholder="Ej: Chequeo general, dolor de cabeza, seguimiento...">
        </div>

        <div class="form-group">
          <label>Notas adicionales</label>
          <textarea id="ac-notas" rows="2" placeholder="Información relevante para la cita..."></textarea>
        </div>

        <div id="ac-error" class="error-message hidden"></div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-success">📅 Agendar cita</button>
        </div>
      </form>
    `;

    showModal(`Agendar cita`, body);

    document.getElementById('form-agendar-cita').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorDiv = document.getElementById('ac-error');
      errorDiv.classList.add('hidden');

      const data = {
        paciente_id: pacienteId,
        medico_id: parseInt(document.getElementById('ac-medico').value),
        fecha_cita: document.getElementById('ac-fecha').value,
        hora_cita: document.getElementById('ac-hora').value,
        motivo_consulta: document.getElementById('ac-motivo').value.trim() || null,
        notas: document.getElementById('ac-notas').value.trim() || null
      };

      try {
        await apiCall('/citas', {
          method: 'POST',
          body: JSON.stringify(data)
        });
        
        closeModal();
        const fechaFmt = new Date(data.fecha_cita).toLocaleDateString('es-ES');
        showToast(`✓ Cita agendada para ${paciente.nombre} ${paciente.apellido} el ${fechaFmt} a las ${data.hora_cita}`);
      } catch (err) {
        errorDiv.textContent = err.message;
        errorDiv.classList.remove('hidden');
      }
    });
  } catch (err) {
    showToast('Error al cargar datos: ' + err.message, 'error');
  }
}
