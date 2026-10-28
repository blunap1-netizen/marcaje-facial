// ============================================================
//  Pantalla de marcaje (kiosco)
//  1) Detecta un rostro  2) Verifica que sea real y que parpadee
//  3) El servidor lo reconoce  4) La persona toca Entrada o Salida
// ============================================================
import { cargarModelos, encenderCamara, analizar, crearDetectorParpadeo } from './rostro.js';

const $ = (id) => document.getElementById(id);
const el = {
  video: $('video'), marco: $('marco'), mensaje: $('mensaje'),
  hora: $('hora'), segundos: $('segundos'), ampm: $('ampm'), fecha: $('fecha'), empresa: $('empresa'),
  pasoFrente: $('paso-frente'), pasoReal: $('paso-real'), pasoParpadeo: $('paso-parpadeo'),
  btnEntrada: $('btn-entrada'), btnSalida: $('btn-salida'), motivoEntrada: $('motivo-entrada'), motivoSalida: $('motivo-salida'),
  btnNoSoy: $('btn-no-soy'), dispositivo: $('dispositivo'),
  capa: $('capa-tarjeta'), tNombre: $('t-nombre'), tCodigo: $('t-codigo'), tFecha: $('t-fecha'),
  tSello: $('t-sello'), tTipo: $('t-tipo'), tHora: $('t-hora'), tMensaje: $('t-mensaje'),
};

// ---------- Estado ----------
let cfg = null;
let estado = 'cargando'; // cargando | buscando | consultando | identificado | mostrando | error
let identificado = null; // respuesta del servidor
let fallos = 0;
let ultimaConsulta = 0;
let inicioVerificacion = 0;
let temporizador = null;
const parpadeo = crearDetectorParpadeo();

// Nombre del dispositivo: se configura una vez con ?dispositivo=Entrada%20principal
const params = new URLSearchParams(location.search);
if (params.get('dispositivo')) localStorage.setItem('dispositivo', params.get('dispositivo'));
const nombreDispositivo = localStorage.getItem('dispositivo') || '';
el.dispositivo.textContent = nombreDispositivo ? `Dispositivo: ${nombreDispositivo}` : '';

// Modo diagnóstico (?depurar=1): muestra los valores que mide la cámara, útil para calibrar los Ajustes
const depurar = params.has('depurar') ? Object.assign(document.createElement('pre'), { className: 'depurar' }) : null;
if (depurar) document.body.append(depurar);
let ultimaSimilitud = null;
function mostrarDepuracion(a) {
  if (!depurar) return;
  const n = (v) => (typeof v === 'number' ? v.toFixed(2) : '—');
  depurar.textContent = a.cantidad !== 1
    ? `rostros: ${a.cantidad}`
    : `tamaño: ${Math.round(a.tamano)} px (mín ${cfg.tamanoMinRostro})\ngiro: ${n(a.giro)} (máx ${cfg.giroMax})\nreal: ${n(a.real)}  vivo: ${n(a.vivo)} (mín ${cfg.umbralAntiFoto})\nconfianza: ${n(a.confianza)}\nojos cerrados: ${a.ojosCerrados ? 'sí' : 'no'}\nsimilitud última consulta: ${n(ultimaSimilitud)}`;
}

// ---------- Reloj sincronizado con el servidor ----------
let desfase = 0;
async function sincronizarHora() {
  try {
    const t0 = Date.now();
    const r = await fetch('/api/hora').then((x) => x.json());
    desfase = Date.parse(r.iso) - (t0 + (Date.now() - t0) / 2);
  } catch { /* se usa la hora del dispositivo */ }
}
function pintarReloj() {
  const ahora = new Date(Date.now() + desfase);
  const zona = cfg?.zonaHoraria;
  const partes = new Intl.DateTimeFormat('es-GT', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true, timeZone: zona })
    .formatToParts(ahora);
  const p = Object.fromEntries(partes.map((x) => [x.type, x.value]));
  el.hora.textContent = `${p.hour}:${p.minute}`;
  el.segundos.textContent = p.second;
  el.ampm.textContent = (p.dayPeriod || '').replace(/\s/g, '').replace('.m.', 'm');
  el.fecha.textContent = new Intl.DateTimeFormat('es-GT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: zona }).format(ahora);
}

// ---------- Utilidades de interfaz ----------
function mensaje(texto, nombre) {
  el.mensaje.textContent = '';
  if (nombre) {
    const s = document.createElement('span');
    s.className = 'nombre';
    s.textContent = nombre;
    el.mensaje.append('Hola, ', s, '. ', texto);
  } else {
    el.mensaje.textContent = texto;
  }
}
const marco = (e) => { el.marco.dataset.estado = e; };
const paso = (nodo, ok) => nodo.classList.toggle('ok', !!ok);

function bloquearBotones() {
  for (const b of [el.btnEntrada, el.btnSalida]) {
    b.disabled = true;
    b.classList.remove('sugerido', 'bloqueado');
  }
  el.motivoEntrada.textContent = '';
  el.motivoSalida.textContent = '';
  el.btnNoSoy.hidden = true;
}

function pitido(ok = true) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = ok ? 880 : 220;
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    o.connect(g).connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.25);
  } catch { /* sin sonido */ }
}

function reiniciar(texto = 'Colócate frente a la cámara') {
  clearTimeout(temporizador);
  identificado = null;
  fallos = 0;
  inicioVerificacion = 0;
  parpadeo.reiniciar();
  bloquearBotones();
  marco('espera');
  [el.pasoFrente, el.pasoReal, el.pasoParpadeo].forEach((n) => paso(n, false));
  mensaje(texto);
  estado = 'buscando';
}

// ---------- Ciclo de detección ----------
async function ciclo() {
  if (estado === 'buscando' || estado === 'consultando') {
    try {
      const a = await analizar(el.video);
      if (estado === 'buscando') procesar(a);
    } catch (e) {
      console.error(e);
    }
  }
  setTimeout(ciclo, 50);
}

function procesar(a) {
  mostrarDepuracion(a);
  if (a.cantidad === 0) {
    if (inicioVerificacion) reiniciar();
    return;
  }
  if (a.cantidad > 1) {
    marco('error');
    mensaje('Solo una persona frente a la cámara, por favor.');
    return;
  }
  if (!inicioVerificacion) inicioVerificacion = performance.now();
  marco('detectando');

  const cercaOk = a.tamano >= cfg.tamanoMinRostro;
  const deFrente = a.giro <= cfg.giroMax;
  const frenteOk = cercaOk && deFrente && a.confianza >= 0.6;
  const realOk = !cfg.antiFoto || (a.real >= cfg.umbralAntiFoto && a.vivo >= cfg.umbralAntiFoto);
  const parpadeoOk = !cfg.parpadeo || parpadeo.actualizar(a.ojosCerrados);

  paso(el.pasoFrente, frenteOk);
  paso(el.pasoReal, frenteOk && realOk);
  paso(el.pasoParpadeo, parpadeoOk);

  if (!cercaOk) return mensaje('Acércate un poco más a la cámara.');
  if (!deFrente) return mensaje('Mira de frente a la cámara.');
  if (!realOk) {
    const tiempo = performance.now() - inicioVerificacion;
    return mensaje(tiempo > 6000
      ? 'No se pudo verificar. Busca mejor luz y quítate lentes oscuros o gorra.'
      : 'Verificando que seas una persona real…');
  }
  if (!parpadeoOk) return mensaje('Parpadea una vez.');
  if (!a.descriptor) return;

  if (performance.now() - ultimaConsulta < 900) return;
  ultimaConsulta = performance.now();
  consultar(a.descriptor);
}

async function consultar(descriptor) {
  estado = 'consultando';
  mensaje('Buscando tu registro…');
  try {
    const r = await fetch('/api/kiosco/reconocer', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ descriptor }),
    });
    const datos = await r.json();
    if (!r.ok) throw new Error(datos.error || 'Error del servidor');
    if (estado !== 'consultando') return;
    ultimaSimilitud = datos.similitud;

    if (!datos.reconocido) {
      fallos += 1;
      marco('error');
      if (fallos >= 4) {
        mensaje('No encuentro tu rostro. Si eres nuevo, pide que te registren en Administración.');
        estado = 'mostrando';
        pitido(false);
        temporizador = setTimeout(() => reiniciar(), 4500);
      } else {
        mensaje('No te reconozco todavía… quédate quieto y mira a la cámara.');
        estado = 'buscando';
      }
      return;
    }
    mostrarIdentificado(datos);
  } catch (e) {
    marco('error');
    mensaje(`Sin conexión con el servidor. ${e.message}`);
    estado = 'mostrando';
    temporizador = setTimeout(() => reiniciar(), 4000);
  }
}

function mostrarIdentificado(datos) {
  identificado = datos;
  estado = 'identificado';
  marco('ok');
  [el.pasoFrente, el.pasoReal, el.pasoParpadeo].forEach((n) => paso(n, true));
  const { entrada, salida } = datos.estado;
  const sugerido = entrada.permitido && !salida.permitido ? 'entrada' : (salida.permitido && !entrada.permitido ? 'salida' : null);
  const primerNombre = datos.empleado.nombre.split(' ')[0];
  mensaje(sugerido ? `Toca ${sugerido === 'entrada' ? 'Entrada' : 'Salida'}.` : (entrada.motivo || 'Elige una opción.'), primerNombre);

  el.btnEntrada.disabled = !entrada.permitido;
  el.btnSalida.disabled = !salida.permitido;
  el.btnEntrada.classList.toggle('bloqueado', !entrada.permitido);
  el.btnSalida.classList.toggle('bloqueado', !salida.permitido);
  el.motivoEntrada.textContent = entrada.permitido ? '' : 'No disponible';
  el.motivoSalida.textContent = salida.permitido ? '' : 'No disponible';
  el.btnEntrada.classList.toggle('sugerido', sugerido === 'entrada');
  el.btnSalida.classList.toggle('sugerido', sugerido === 'salida');
  el.btnNoSoy.hidden = false;
  (sugerido === 'salida' ? el.btnSalida : el.btnEntrada).focus({ preventScroll: true });
  pitido(true);

  // Si nadie toca nada en 12 segundos, vuelve al inicio
  temporizador = setTimeout(() => reiniciar(), 12000);
}

async function marcar(tipo) {
  if (estado !== 'identificado' || !identificado) return;
  clearTimeout(temporizador);
  estado = 'mostrando';
  bloquearBotones();
  mensaje('Registrando…');
  try {
    const r = await fetch('/api/kiosco/marcar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: identificado.token, tipo, dispositivo: nombreDispositivo }),
    });
    const datos = await r.json();
    if (!r.ok) throw new Error(datos.error || 'No se pudo registrar');
    mostrarTarjeta({ ok: true, tipo, nombre: datos.empleado.nombre, codigo: datos.empleado.codigo, hora: datos.marcaje.hora, fecha: datos.marcaje.fecha });
    pitido(true);
  } catch (e) {
    mostrarTarjeta({ ok: false, nombre: identificado.empleado.nombre, codigo: identificado.empleado.codigo, mensaje: e.message });
    pitido(false);
  }
}

function mostrarTarjeta({ ok, tipo, nombre, codigo, hora, fecha, mensaje: texto }) {
  const tarjeta = el.capa.querySelector('.tarjeta');
  tarjeta.classList.toggle('error', !ok);
  el.tNombre.textContent = nombre;
  el.tCodigo.textContent = `Código ${codigo}`;
  el.tFecha.textContent = fecha || '';
  el.tTipo.textContent = tipo || '';
  el.tHora.textContent = (hora || '').replace(/\s?([ap])\.\s?m\./i, ' $1m');
  el.tSello.classList.toggle('salida', tipo === 'SALIDA');
  el.tMensaje.textContent = ok
    ? (tipo === 'ENTRADA' ? '¡Buen turno!' : '¡Hasta pronto!')
    : texto;
  // Reinicia la animación del sello
  tarjeta.style.animation = 'none'; el.tSello.style.animation = 'none';
  void tarjeta.offsetWidth;
  tarjeta.style.animation = ''; el.tSello.style.animation = '';
  el.capa.hidden = false;
  const cerrar = () => { el.capa.hidden = true; reiniciar(); };
  el.capa.onclick = cerrar;
  temporizador = setTimeout(cerrar, ok ? 4500 : 6000);
}

el.btnEntrada.addEventListener('click', () => marcar('ENTRADA'));
el.btnSalida.addEventListener('click', () => marcar('SALIDA'));
el.btnNoSoy.addEventListener('click', () => reiniciar('Intenta de nuevo: mira a la cámara.'));

// Mantener la pantalla encendida (tablets/celulares)
async function pantallaEncendida() {
  try { await navigator.wakeLock?.request('screen'); } catch { /* no soportado */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pantallaEncendida(); });

// ---------- Inicio ----------
async function iniciar() {
  try {
    cfg = await fetch('/api/kiosco/config').then((r) => r.json());
    el.empresa.textContent = cfg.empresa;
    document.title = `Marcaje — ${cfg.empresa}`;
    await sincronizarHora();
    pintarReloj();
    setInterval(pintarReloj, 1000);
    setInterval(sincronizarHora, 10 * 60e3);
    setInterval(async () => { // recarga ajustes cada 5 minutos por si el administrador los cambia
      try { cfg = { ...cfg, ...(await fetch('/api/kiosco/config').then((r) => r.json())) }; } catch { /* sin red */ }
    }, 5 * 60e3);

    el.pasoReal.hidden = !cfg.antiFoto;
    el.pasoParpadeo.hidden = !cfg.parpadeo;

    mensaje('Encendiendo la cámara…');
    await encenderCamara(el.video);
    mensaje('Cargando el reconocimiento facial (solo la primera vez tarda)…');
    await cargarModelos();
    pantallaEncendida();
    reiniciar(cfg.hayRostros ? 'Colócate frente a la cámara' : 'Aún no hay rostros registrados. Entra a Administración para registrar empleados.');
    ciclo();
  } catch (e) {
    estado = 'error';
    marco('error');
    mensaje(e.message);
    console.error(e);
  }
}

iniciar();
