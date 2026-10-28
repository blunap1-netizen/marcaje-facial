// ============================================================
//  Panel de administración
// ============================================================
import { cargarModelos, encenderCamara, apagarCamara, analizar } from './rostro.js';

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Comunicación con el servidor ----------
async function api(metodo, url, cuerpo) {
  const r = await fetch(url, {
    method: metodo,
    headers: cuerpo ? { 'Content-Type': 'application/json' } : {},
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const datos = await r.json().catch(() => ({}));
  if (r.status === 401 && !url.endsWith('/login')) { mostrarLogin(); throw new Error(datos.error || 'Sesión vencida'); }
  if (!r.ok) throw new Error(datos.error || `Error ${r.status}`);
  return datos;
}

let temporizadorAviso;
function aviso(texto, error = false) {
  const t = $('#aviso');
  t.textContent = texto;
  t.classList.toggle('error', error);
  t.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { t.hidden = true; }, error ? 6000 : 3000);
}

/** Ejecuta una acción mostrando errores y deshabilitando el botón mientras tanto */
async function accion(boton, fn) {
  if (boton) boton.disabled = true;
  try { return await fn(); } catch (e) { aviso(e.message, true); return null; } finally { if (boton) boton.disabled = false; }
}

const hoyISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ---------- Ingreso ----------
function mostrarLogin() {
  $('#vista-app').hidden = true;
  $('#vista-login').hidden = false;
  $('#form-login [name=clave]').focus();
}

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    await api('POST', '/api/admin/login', { clave: e.target.clave.value });
    e.target.reset();
    entrar();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});

$('#btn-salir').addEventListener('click', async () => {
  await api('POST', '/api/admin/logout').catch(() => {});
  mostrarLogin();
});

// ---------- Pestañas ----------
const cargadores = {};
let pestanaActual = 'hoy';
function irA(tab) {
  pestanaActual = tab;
  $$('.pestanas button').forEach((b) => b.classList.toggle('activa', b.dataset.tab === tab));
  $$('.tab').forEach((s) => { s.hidden = s.id !== `tab-${tab}`; });
  history.replaceState(null, '', `#${tab}`);
  cargadores[tab]?.();
}
$$('.pestanas button').forEach((b) => b.addEventListener('click', () => irA(b.dataset.tab)));
document.addEventListener('click', (e) => {
  const enlace = e.target.closest('[data-ir]');
  if (enlace) { e.preventDefault(); irA(enlace.dataset.ir); }
});

// ============================================================
//  HOY
// ============================================================
cargadores.hoy = async () => {
  const d = await api('GET', '/api/admin/hoy').catch((e) => aviso(e.message, true));
  if (!d) return;
  $('#hoy-fecha').textContent = new Date().toLocaleDateString('es-GT', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#c-marcajes').textContent = d.marcajesHoy;
  $('#c-turno').textContent = d.enTurno.length;
  $('#c-activos').textContent = d.empleadosActivos;
  $('#c-rostro').textContent = d.conRostro;
  $('#lista-turno').innerHTML = d.enTurno.length
    ? d.enTurno.map((n) => `<li>${esc(n)}</li>`).join('')
    : '<li class="vacio">Nadie tiene una entrada abierta en este momento.</li>';
  $('#lista-ultimos').innerHTML = d.ultimos.length
    ? d.ultimos.map((m) => `<li><span>${esc(m.nombre)}</span><span><span class="etiqueta ${m.tipo === 'ENTRADA' ? 'entrada' : 'salida'}">${m.tipo === 'ENTRADA' ? 'Entrada' : 'Salida'}</span> ${esc(m.hora)}</span></li>`).join('')
    : '<li class="vacio">Todavía no hay marcajes hoy.</li>';
};

// ============================================================
//  EMPLEADOS
// ============================================================
let empleados = [];

async function cargarEmpleados() {
  empleados = await api('GET', '/api/admin/empleados');
  // Llenar selects de otras pestañas
  const opciones = empleados.map((e) => `<option value="${e.id}">${esc(e.nombre)} (${esc(e.codigo)})</option>`).join('');
  $('#form-filtro [name=empleado]').innerHTML = `<option value="">Todos</option>${opciones}`;
  $('#form-manual [name=empleadoId]').innerHTML = opciones;
  return empleados;
}

cargadores.empleados = async () => {
  await accion(null, cargarEmpleados);
  const tbody = $('#tbody-empleados');
  if (!empleados.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="vacio">Aún no hay empleados. Agrega el primero con el formulario de arriba.</td></tr>';
    return;
  }
  tbody.innerHTML = empleados.map((e) => `
    <tr class="${e.activo ? '' : 'inactivo'}">
      <td>${esc(e.codigo)}</td>
      <td><b>${esc(e.nombre)}</b></td>
      <td>${esc(e.puesto)}</td>
      <td>${e.rostros ? `<span class="etiqueta ok">${e.rostros} muestras</span>` : '<span class="etiqueta error">Sin registrar</span>'}</td>
      <td>${!e.activo ? '<span class="etiqueta neutra">Inactivo</span>' : e.enTurno ? '<span class="etiqueta entrada">En turno</span>' : '<span class="etiqueta neutra">Fuera</span>'}</td>
      <td><div class="acciones">
        <button class="btn chico primario" data-accion="rostro" data-id="${e.id}">${e.rostros ? 'Agregar muestras' : 'Registrar rostro'}</button>
        <button class="btn chico" data-accion="editar" data-id="${e.id}">Editar</button>
        ${e.rostros ? `<button class="btn chico" data-accion="borrar-rostros" data-id="${e.id}">Borrar rostro</button>` : ''}
        <button class="btn chico" data-accion="activo" data-id="${e.id}">${e.activo ? 'Desactivar' : 'Activar'}</button>
        <button class="btn chico peligro" data-accion="eliminar" data-id="${e.id}">Eliminar</button>
      </div></td>
    </tr>`).join('');
};

$('#form-empleado').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const datos = { codigo: f.codigo.value, nombre: f.nombre.value, puesto: f.puesto.value };
  const r = await accion(f.querySelector('button'), () => api('POST', '/api/admin/empleados', datos));
  if (!r) return;
  f.reset();
  aviso(`${datos.nombre} agregado. Ahora registra su rostro.`);
  await cargadores.empleados();
  const emp = empleados.find((x) => x.id === r.id);
  if (emp) abrirRegistroRostro(emp);
});

$('#tbody-empleados').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-accion]');
  if (!b) return;
  const emp = empleados.find((x) => x.id === b.dataset.id);
  if (!emp) return;
  const acc = b.dataset.accion;
  if (acc === 'rostro') abrirRegistroRostro(emp);
  if (acc === 'editar') abrirEditar(emp);
  if (acc === 'borrar-rostros') {
    if (!confirm(`¿Borrar las muestras de rostro de ${emp.nombre}? Tendrá que registrarse de nuevo para poder marcar.`)) return;
    if (await accion(b, () => api('DELETE', `/api/admin/empleados/${emp.id}/rostros`))) { aviso('Rostro borrado'); cargadores.empleados(); }
  }
  if (acc === 'activo') {
    const r = await accion(b, () => api('PUT', `/api/admin/empleados/${emp.id}`, { ...emp, activo: !emp.activo }));
    if (r) { aviso(emp.activo ? `${emp.nombre} desactivado: ya no podrá marcar` : `${emp.nombre} activado`); cargadores.empleados(); }
  }
  if (acc === 'eliminar') {
    if (!confirm(`¿Eliminar a ${emp.nombre}?\n\nTambién se borrarán TODOS sus marcajes. Si solo dejó de trabajar, mejor usa "Desactivar" para conservar su historial.`)) return;
    if (await accion(b, () => api('DELETE', `/api/admin/empleados/${emp.id}`))) { aviso('Empleado eliminado'); cargadores.empleados(); }
  }
});

// ---- Editar ----
const dlgEditar = $('#dlg-editar');
function abrirEditar(emp) {
  const f = $('#form-editar');
  f.id.value = emp.id; f.codigo.value = emp.codigo; f.nombre.value = emp.nombre; f.puesto.value = emp.puesto;
  dlgEditar.showModal();
}
$('#btn-editar-cancelar').addEventListener('click', () => dlgEditar.close());
$('#form-editar').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const emp = empleados.find((x) => x.id === f.id.value);
  const r = await accion(f.querySelector('[type=submit]'), () => api('PUT', `/api/admin/empleados/${f.id.value}`, {
    codigo: f.codigo.value, nombre: f.nombre.value, puesto: f.puesto.value, activo: emp?.activo !== false,
  }));
  if (r) { dlgEditar.close(); aviso('Cambios guardados'); cargadores.empleados(); }
});

// ---- Registro de rostro ----
const dlgRostro = $('#dlg-rostro');
const MUESTRAS = 5;
const INSTRUCCIONES = [
  'Mira de frente a la cámara.',
  'Gira la cabeza un poco a tu izquierda.',
  'Ahora un poco a tu derecha.',
  'Levanta un poco la barbilla.',
  'Mira de frente otra vez.',
];
let registroActivo = false;
let empleadoRegistro = null;

function mensajeRostro(t) { $('#rostro-mensaje').textContent = t; }

async function abrirRegistroRostro(emp) {
  empleadoRegistro = emp;
  $('#rostro-nombre').textContent = emp.nombre;
  $('#btn-rostro-repetir').hidden = true;
  $$('#perforaciones li').forEach((li) => li.classList.remove('hecha'));
  dlgRostro.showModal();
  const video = $('#rostro-video');
  try {
    mensajeRostro('Encendiendo la cámara…');
    await encenderCamara(video);
    mensajeRostro('Cargando el reconocimiento facial…');
    await cargarModelos();
    const ajustes = await api('GET', '/api/admin/ajustes');
    await capturar(video, Number(ajustes.tamano_min_rostro) || 150);
  } catch (e) {
    mensajeRostro(e.message);
  }
}

async function capturar(video, tamanoMin) {
  registroActivo = true;
  const muestras = [];
  let ultima = 0;
  mensajeRostro(INSTRUCCIONES[0]);
  while (registroActivo && muestras.length < MUESTRAS) {
    const a = await analizar(video);
    if (!registroActivo) break;
    if (a.cantidad === 0) { mensajeRostro('No veo ningún rostro. Colócate dentro del óvalo.'); continue; }
    if (a.cantidad > 1) { mensajeRostro('Solo debe haber una persona frente a la cámara.'); continue; }
    if (a.tamano < tamanoMin) { mensajeRostro('Acércate un poco más.'); continue; }
    if (a.confianza < 0.6 || !a.descriptor) { mensajeRostro('Busca mejor luz en tu cara.'); continue; }
    mensajeRostro(INSTRUCCIONES[muestras.length]);
    if (performance.now() - ultima < 1100) continue; // tiempo para que cambie de posición
    muestras.push(a.descriptor);
    ultima = performance.now();
    $$('#perforaciones li')[muestras.length - 1].classList.add('hecha');
    if (muestras.length < MUESTRAS) mensajeRostro(INSTRUCCIONES[muestras.length]);
  }
  if (!registroActivo) return;
  registroActivo = false;
  mensajeRostro('Guardando…');
  try {
    await api('POST', `/api/admin/empleados/${empleadoRegistro.id}/rostros`, { descriptores: muestras });
    mensajeRostro(`¡Listo! ${empleadoRegistro.nombre} ya puede marcar con su rostro.`);
    apagarCamara(video);
    $('#btn-rostro-cerrar').textContent = 'Terminar';
    cargadores.empleados();
  } catch (e) {
    mensajeRostro(e.message);
    $('#btn-rostro-repetir').hidden = false;
  }
}

function cerrarRegistro() {
  registroActivo = false;
  apagarCamara($('#rostro-video'));
  $('#btn-rostro-cerrar').textContent = 'Cancelar';
  if (dlgRostro.open) dlgRostro.close();
}
$('#btn-rostro-cerrar').addEventListener('click', cerrarRegistro);
dlgRostro.addEventListener('cancel', cerrarRegistro);
$('#btn-rostro-repetir').addEventListener('click', () => {
  cerrarRegistro();
  if (empleadoRegistro) abrirRegistroRostro(empleadoRegistro);
});

// ============================================================
//  MARCAJES
// ============================================================
const filtro = $('#form-filtro');
filtro.desde.value = hoyISO();
filtro.hasta.value = hoyISO();
$('#form-manual').fecha.value = hoyISO();
let empleadosCargados = false;

const parametrosFiltro = () => new URLSearchParams({ desde: filtro.desde.value, hasta: filtro.hasta.value, empleado: filtro.empleado.value });

cargadores.marcajes = async () => {
  if (!empleadosCargados) { await accion(null, cargarEmpleados); empleadosCargados = true; }
  const filas = await api('GET', `/api/admin/marcajes?${parametrosFiltro()}`).catch((e) => aviso(e.message, true));
  if (!filas) return;
  $('#marcajes-total').textContent = (filas.length === 1 ? '1 marcaje encontrado' : `${filas.length} marcajes encontrados`);
  $('#tbody-marcajes').innerHTML = filas.length ? filas.map((m) => `
    <tr>
      <td>${esc(m.fecha)}</td>
      <td>${esc(m.hora)}</td>
      <td><b>${esc(m.nombre)}</b><span class="detalle">${esc(m.codigo)}</span></td>
      <td><span class="etiqueta ${m.tipo === 'ENTRADA' ? 'entrada' : 'salida'}">${m.tipo === 'ENTRADA' ? 'Entrada' : 'Salida'}</span></td>
      <td>${m.similitud != null ? `${Math.round(m.similitud * 100)}%` : '—'}</td>
      <td>${esc(m.dispositivo) || '—'}</td>
      <td><div class="acciones"><button class="btn chico peligro" data-borrar="${m.id}">Eliminar</button></div></td>
    </tr>`).join('') : '<tr><td colspan="7" class="vacio">No hay marcajes en estas fechas.</td></tr>';
};

filtro.addEventListener('submit', (e) => { e.preventDefault(); cargadores.marcajes(); });
$('#btn-excel').addEventListener('click', () => {
  if (!filtro.reportValidity()) return;
  location.href = `/api/admin/reporte.xlsx?${parametrosFiltro()}`;
});
$('#tbody-marcajes').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-borrar]');
  if (!b || !confirm('¿Eliminar este marcaje? Esta acción no se puede deshacer.')) return;
  if (await accion(b, () => api('DELETE', `/api/admin/marcajes/${b.dataset.borrar}`))) { aviso('Marcaje eliminado'); cargadores.marcajes(); }
});
$('#form-manual').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const r = await accion(f.querySelector('button'), () => api('POST', '/api/admin/marcajes', {
    empleadoId: f.empleadoId.value, tipo: f.tipo.value, fecha: f.fecha.value, hora: f.hora.value, motivo: f.motivo.value,
  }));
  if (r) { aviso('Marcaje manual guardado'); f.motivo.value = ''; cargadores.marcajes(); }
});

// ============================================================
//  REPORTES POR CORREO
// ============================================================
const formProg = $('#form-prog');
let programaciones = [];

const EXPLICACION = {
  DIARIO: 'Se envía todos los días a la hora indicada, con los marcajes de ese día. Ponlo después del cierre de la jornada.',
  SEMANAL: 'Se envía el día de la semana elegido, con los 7 días que terminan ese día.',
  MENSUAL: 'Se envía el último día de cada mes a la hora indicada, con el mes completo.',
};
function actualizarFrecuencia() {
  const f = formProg.frecuencia.value;
  $('#campo-dia').hidden = f !== 'SEMANAL';
  $('#explica-frecuencia').textContent = EXPLICACION[f];
}
$$('[name=frecuencia]', formProg).forEach((r) => r.addEventListener('change', actualizarFrecuencia));
actualizarFrecuencia();

cargadores.reportes = async () => {
  try {
    const [lista, ajustes] = await Promise.all([api('GET', '/api/admin/programaciones'), api('GET', '/api/admin/ajustes')]);
    programaciones = lista;
    $('#aviso-smtp').hidden = ajustes.smtp_listo;
  } catch (e) { aviso(e.message, true); return; }
  $('#tbody-programaciones').innerHTML = programaciones.length ? programaciones.map((p) => {
    const resultado = p.ultimo_resultado || '';
    const esError = resultado.startsWith('ERROR');
    return `<tr class="${p.activo ? '' : 'inactivo'}">
      <td><label class="check"><input type="checkbox" data-activo="${p.id}" ${p.activo ? 'checked' : ''} aria-label="Activar ${esc(p.nombre)}"></label></td>
      <td><b>${esc(p.nombre)}</b></td>
      <td>${esc(p.descripcion)}</td>
      <td>${esc(p.destinatarios)}</td>
      <td>${p.ultimo_envio_texto ? esc(p.ultimo_envio_texto) : 'Nunca'}
        ${resultado ? `<span class="detalle"><span class="etiqueta ${esError ? 'error' : 'ok'}">${esError ? 'Error' : 'Enviado'}</span> ${esc(resultado.replace(/^(OK|ERROR)[^:]*:\s*/, ''))}</span>` : ''}</td>
      <td><div class="acciones">
        <button class="btn chico primario" data-enviar="${p.id}">Enviar ahora</button>
        <button class="btn chico" data-editar="${p.id}">Editar</button>
        <button class="btn chico peligro" data-eliminar="${p.id}">Eliminar</button>
      </div></td>
    </tr>`;
  }).join('') : '<tr><td colspan="6" class="vacio">No hay envíos programados. Crea el primero abajo.</td></tr>';
};

function datosProgramacion(p, cambios = {}) {
  return { nombre: p.nombre, frecuencia: p.frecuencia, hora: p.hora, dia_semana: p.dia_semana, destinatarios: p.destinatarios, activo: p.activo, ...cambios };
}

$('#tbody-programaciones').addEventListener('click', async (e) => {
  const t = e.target;
  const id = t.dataset.enviar || t.dataset.editar || t.dataset.eliminar || '';
  const p = programaciones.find((x) => x.id === id);
  if (!p) return;
  if (t.dataset.enviar) {
    const r = await accion(t, () => api('POST', `/api/admin/programaciones/${id}/enviar`));
    if (r) aviso(r.mensaje);
    cargadores.reportes();
  }
  if (t.dataset.editar) {
    formProg.id.value = p.id;
    formProg.nombre.value = p.nombre;
    formProg.frecuencia.value = p.frecuencia;
    formProg.hora.value = p.hora;
    formProg.dia_semana.value = p.dia_semana;
    formProg.destinatarios.value = p.destinatarios;
    actualizarFrecuencia();
    $('#titulo-form-prog').textContent = `Editar: ${p.nombre}`;
    $('#btn-cancelar-prog').hidden = false;
    formProg.scrollIntoView({ behavior: 'smooth' });
  }
  if (t.dataset.eliminar) {
    if (!confirm(`¿Eliminar la programación "${p.nombre}"?`)) return;
    if (await accion(t, () => api('DELETE', `/api/admin/programaciones/${id}`))) { aviso('Programación eliminada'); cargadores.reportes(); }
  }
});
$('#tbody-programaciones').addEventListener('change', async (e) => {
  const id = e.target.dataset.activo || '';
  const p = programaciones.find((x) => x.id === id);
  if (!p) return;
  const r = await accion(null, () => api('PUT', `/api/admin/programaciones/${id}`, datosProgramacion(p, { activo: e.target.checked })));
  if (r) aviso(e.target.checked ? 'Envío activado' : 'Envío pausado');
  cargadores.reportes();
});

function limpiarFormProg() {
  formProg.reset();
  formProg.id.value = '';
  $('#titulo-form-prog').textContent = 'Nueva programación';
  $('#btn-cancelar-prog').hidden = true;
  actualizarFrecuencia();
}
$('#btn-cancelar-prog').addEventListener('click', limpiarFormProg);
formProg.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = formProg.id.value;
  const actual = programaciones.find((x) => x.id === id);
  const datos = {
    nombre: formProg.nombre.value, frecuencia: formProg.frecuencia.value, hora: formProg.hora.value,
    dia_semana: Number(formProg.dia_semana.value), destinatarios: formProg.destinatarios.value,
    activo: actual ? actual.activo : true,
  };
  const r = await accion($('#btn-guardar-prog'), () => (id
    ? api('PUT', `/api/admin/programaciones/${id}`, datos)
    : api('POST', '/api/admin/programaciones', datos)));
  if (r) { aviso('Programación guardada'); limpiarFormProg(); cargadores.reportes(); }
});

// ============================================================
//  AJUSTES
// ============================================================
const formAjustes = $('#form-ajustes');
function mostrarValores() {
  $('#out-umbral').textContent = Number(formAjustes.umbral_similitud.value).toFixed(2);
  $('#out-antifoto').textContent = Number(formAjustes.umbral_anti_foto.value).toFixed(2);
  $('#out-giro').textContent = Number(formAjustes.giro_max.value).toFixed(2);
}
formAjustes.umbral_similitud.addEventListener('input', mostrarValores);
formAjustes.umbral_anti_foto.addEventListener('input', mostrarValores);
formAjustes.giro_max.addEventListener('input', mostrarValores);

cargadores.ajustes = async () => {
  const a = await api('GET', '/api/admin/ajustes').catch((e) => aviso(e.message, true));
  if (!a) return;
  for (const campo of formAjustes.elements) {
    if (!campo.name || !(campo.name in a)) continue;
    if (campo.type === 'checkbox') campo.checked = a[campo.name] === '1';
    else campo.value = a[campo.name];
  }
  formAjustes.smtp_clave.value = '';
  formAjustes.smtp_clave.placeholder = a.smtp_clave_guardada ? '•••••••• (guardada; escribe otra para cambiarla)' : 'Pega aquí la contraseña de aplicación';
  $('#nombre-empresa').textContent = a.empresa;
  mostrarValores();
};

formAjustes.addEventListener('submit', async (e) => {
  e.preventDefault();
  const datos = {};
  for (const campo of formAjustes.elements) {
    if (!campo.name) continue;
    datos[campo.name] = campo.type === 'checkbox' ? (campo.checked ? '1' : '0') : campo.value;
  }
  const r = await accion(formAjustes.querySelector('[type=submit]'), () => api('PUT', '/api/admin/ajustes', datos));
  if (r) { aviso('Ajustes guardados'); cargadores.ajustes(); }
});

$('#btn-gmail').addEventListener('click', () => {
  formAjustes.smtp_host.value = 'smtp.gmail.com';
  formAjustes.smtp_puerto.value = 465;
  formAjustes.smtp_seguro.checked = true;
  formAjustes.smtp_usuario.focus();
});

$('#form-prueba').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await accion(e.target.querySelector('button'), () => api('POST', '/api/admin/correo-prueba', { para: e.target.para.value }));
  if (r) aviso('Correo de prueba enviado. Revisa la bandeja de entrada (y spam).');
});

// ============================================================
//  INICIO
// ============================================================
async function entrar() {
  $('#vista-login').hidden = true;
  $('#vista-app').hidden = false;
  api('GET', '/api/admin/ajustes').then((a) => { $('#nombre-empresa').textContent = a.empresa; }).catch(() => {});
  const inicial = location.hash.slice(1);
  irA(cargadores[inicial] ? inicial : 'hoy');
}

(async () => {
  const { activa } = await fetch('/api/admin/sesion').then((r) => r.json());
  if (activa) entrar(); else mostrarLogin();
  setInterval(() => { if (!$('#vista-app').hidden && pestanaActual === 'hoy') cargadores.hoy(); }, 30_000);
})();
