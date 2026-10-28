// ============================================================
//  API del Sistema de Marcaje Facial (función de Netlify)
//  Atiende todas las rutas /api/*
// ============================================================
import { config as ajustesBase } from '../../lib/config.js'; // primero: zona horaria
import {
  leer, modificar, leerAjustes, guardarAjustes, leerEmpleados, listarClaves, nuevoId, ahoraISO, errorHttp,
} from '../../lib/almacen.js';
import { descriptorValido, buscarCoincidencia, guardarRostros, contarRostros, borrarRostros } from '../../lib/rostros.js';
import { estadoMarcaje, registrarMarcaje, agregarMarcajeManual, eliminarMarcaje } from '../../lib/marcajes.js';
import { generarExcel, listarMarcajes } from '../../lib/reportes.js';
import { enviarCorreo, separarCorreos, correoValido, smtpConfigurado } from '../../lib/correo.js';
import { ejecutarProgramacion, describirProgramacion, periodoInicial, actualizarProgramacion } from '../../lib/planificador.js';
import {
  claveCorrecta, cookieSesion, cookieCerrar, sesionValida, crearPermisoMarcaje, usarPermisoMarcaje,
} from '../../lib/auth.js';
import { fmtFecha, fmtHora, desdeClaveDia, sumarDias, inicioDelDia, claveDia } from '../../lib/util.js';

const texto = (v, max = 80) => String(v ?? '').trim().slice(0, max);
const json = (datos, status = 200, extra = {}) => new Response(JSON.stringify(datos), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
});

// ---------- Rutas ----------
const rutas = [];
const ruta = (metodo, patron, admin, fn) => {
  const re = new RegExp(`^${patron.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`);
  rutas.push({ metodo, re, admin, fn });
};

// ===== Kiosco =====
ruta('GET', '/hora', false, () => ({ iso: ahoraISO() }));

ruta('GET', '/kiosco/config', false, async () => {
  const [a, rostros] = await Promise.all([leerAjustes(), leer('rostros', [])]);
  return {
    empresa: a.empresa,
    antiFoto: a.anti_foto === '1',
    umbralAntiFoto: Number(a.umbral_anti_foto),
    parpadeo: a.parpadeo === '1',
    tamanoMinRostro: Number(a.tamano_min_rostro),
    giroMax: Number(a.giro_max) || 0.25,
    hayRostros: rostros.length > 0,
    zonaHoraria: ajustesBase.zonaHoraria,
    horaServidor: ahoraISO(),
  };
});

ruta('POST', '/kiosco/reconocer', false, async ({ body }) => {
  if (!descriptorValido(body.descriptor)) throw errorHttp(400, 'Descriptor de rostro inválido');
  const ajustes = await leerAjustes();
  const umbral = Number(ajustes.umbral_similitud) || 0.5;
  const mejor = await buscarCoincidencia(body.descriptor);
  if (!mejor || mejor.similitud < umbral) return { reconocido: false, similitud: mejor?.similitud ?? 0 };
  const emp = (await leerEmpleados()).find((e) => e.id === mejor.empleadoId && e.activo);
  if (!emp) return { reconocido: false, similitud: 0 };
  return {
    reconocido: true,
    similitud: mejor.similitud,
    empleado: { codigo: emp.codigo, nombre: emp.nombre, puesto: emp.puesto },
    estado: await estadoMarcaje(emp.id, ajustes),
    token: await crearPermisoMarcaje(emp.id, mejor.similitud),
  };
});

ruta('POST', '/kiosco/marcar', false, async ({ body, ip }) => {
  const permiso = await usarPermisoMarcaje(body.token);
  if (!permiso) throw errorHttp(401, 'El reconocimiento venció. Vuelve a escanear tu rostro.');
  const emp = (await leerEmpleados()).find((e) => e.id === permiso.empleadoId && e.activo);
  if (!emp) throw errorHttp(404, 'Empleado no encontrado');
  const marcaje = await registrarMarcaje({
    empleadoId: emp.id, tipo: body.tipo, similitud: permiso.similitud, dispositivo: texto(body.dispositivo, 60), ip,
  });
  return { ok: true, marcaje, empleado: { nombre: emp.nombre, codigo: emp.codigo } };
});

// ===== Sesión =====
ruta('POST', '/admin/login', false, async ({ body, req }) => {
  if (!claveCorrecta(body.clave)) {
    await new Promise((ok) => { setTimeout(ok, 600); }); // frena intentos repetidos
    throw errorHttp(401, 'Contraseña incorrecta');
  }
  return json({ ok: true }, 200, { 'Set-Cookie': await cookieSesion(req) });
});
ruta('POST', '/admin/logout', false, () => json({ ok: true }, 200, { 'Set-Cookie': cookieCerrar }));
ruta('GET', '/admin/sesion', false, async ({ req }) => ({ activa: await sesionValida(req) }));

// ===== Hoy =====
ruta('GET', '/admin/hoy', true, async () => {
  const hoy = inicioDelDia(new Date());
  const [marcajes, empleados, conteo, ajustes] = await Promise.all([
    listarMarcajes({ inicio: hoy, fin: sumarDias(hoy, 1) }), leerEmpleados(), contarRostros(), leerAjustes(),
  ]);
  const activos = empleados.filter((e) => e.activo).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const estados = await Promise.all(activos.map((e) => estadoMarcaje(e.id, ajustes)));
  return {
    empleadosActivos: activos.length,
    conRostro: activos.filter((e) => conteo[e.id]).length,
    marcajesHoy: marcajes.length,
    enTurno: activos.filter((_, i) => estados[i].enTurno).map((e) => e.nombre),
    ultimos: marcajes.slice(-8).reverse().map((m) => ({ nombre: m.nombre, tipo: m.tipo, hora: fmtHora(m.fechaHora) })),
  };
});

// ===== Empleados =====
ruta('GET', '/admin/empleados', true, async () => {
  const [empleados, conteo, ajustes] = await Promise.all([leerEmpleados(), contarRostros(), leerAjustes()]);
  const ordenados = [...empleados].sort((a, b) => (b.activo - a.activo) || a.nombre.localeCompare(b.nombre, 'es'));
  const estados = await Promise.all(ordenados.map((e) => estadoMarcaje(e.id, ajustes)));
  return ordenados.map((e, i) => ({ ...e, rostros: conteo[e.id] || 0, enTurno: estados[i].enTurno }));
});

function validarEmpleado(body) {
  const codigo = texto(body.codigo, 20);
  const nombre = texto(body.nombre, 80);
  const puesto = texto(body.puesto, 60);
  if (!codigo) throw errorHttp(400, 'El código es obligatorio');
  if (nombre.length < 3) throw errorHttp(400, 'Escribe el nombre completo');
  return { codigo, nombre, puesto };
}

ruta('POST', '/admin/empleados', true, async ({ body }) => {
  const datos = validarEmpleado(body);
  const id = nuevoId();
  await modificar('empleados', [], (lista) => {
    if (lista.some((e) => e.codigo.toLowerCase() === datos.codigo.toLowerCase())) throw errorHttp(409, `Ya existe un empleado con el código ${datos.codigo}`);
    lista.push({ id, ...datos, activo: true, creado_en: ahoraISO() });
  });
  return { id };
});

ruta('PUT', '/admin/empleados/:id', true, async ({ body, params }) => {
  const datos = validarEmpleado(body);
  await modificar('empleados', [], (lista) => {
    const e = lista.find((x) => x.id === params.id);
    if (!e) throw errorHttp(404, 'Empleado no encontrado');
    if (lista.some((x) => x.id !== params.id && x.codigo.toLowerCase() === datos.codigo.toLowerCase())) throw errorHttp(409, `Ya existe un empleado con el código ${datos.codigo}`);
    Object.assign(e, datos, { activo: body.activo !== false });
  });
  return { ok: true };
});

ruta('DELETE', '/admin/empleados/:id', true, async ({ params }) => {
  await modificar('empleados', [], (lista) => {
    const i = lista.findIndex((x) => x.id === params.id);
    if (i >= 0) lista.splice(i, 1);
  });
  await borrarRostros(params.id);
  // Borra también sus marcajes de todos los meses
  for (const clave of await listarClaves('marcajes/')) {
    const lista = await leer(clave, []);
    if (lista.some((m) => m.empleado_id === params.id)) {
      await modificar(clave, [], (l) => {
        const quedan = l.filter((m) => m.empleado_id !== params.id);
        l.length = 0;
        l.push(...quedan);
      });
    }
  }
  return { ok: true };
});

ruta('POST', '/admin/empleados/:id/rostros', true, async ({ body, params }) => {
  if (!(await leerEmpleados()).some((e) => e.id === params.id)) throw errorHttp(404, 'Empleado no encontrado');
  const lista = body.descriptores;
  if (!Array.isArray(lista) || !lista.length || lista.length > 20 || !lista.every(descriptorValido)) {
    throw errorHttp(400, 'Muestras de rostro inválidas');
  }
  await guardarRostros(params.id, lista, Number((await leerAjustes()).umbral_similitud) || 0.5);
  return { ok: true, guardados: lista.length };
});

ruta('DELETE', '/admin/empleados/:id/rostros', true, async ({ params }) => {
  await borrarRostros(params.id);
  return { ok: true };
});

// ===== Marcajes =====
function leerRango(q) {
  const hoy = inicioDelDia(new Date());
  const inicio = desdeClaveDia(q.get('desde')) || hoy;
  const hasta = desdeClaveDia(q.get('hasta')) || inicio;
  if (hasta < inicio) throw errorHttp(400, 'La fecha "hasta" no puede ser antes que "desde"');
  if ((hasta - inicio) / 864e5 > 400) throw errorHttp(400, 'El rango máximo es de un año');
  return { inicio, fin: sumarDias(hasta, 1), empleadoId: q.get('empleado') || null };
}

ruta('GET', '/admin/marcajes', true, async ({ query }) => {
  const filas = (await listarMarcajes(leerRango(query))).reverse();
  return filas.map((m) => ({ ...m, fecha: fmtFecha(m.fechaHora), hora: fmtHora(m.fechaHora) }));
});

ruta('POST', '/admin/marcajes', true, async ({ body, ip }) => {
  if (!['ENTRADA', 'SALIDA'].includes(body.tipo)) throw errorHttp(400, 'Tipo inválido');
  const dia = desdeClaveDia(body.fecha);
  const m = /^(\d{2}):(\d{2})$/.exec(String(body.hora || ''));
  if (!dia || !m) throw errorHttp(400, 'Fecha u hora inválida');
  dia.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (dia > new Date()) throw errorHttp(400, 'No se puede registrar un marcaje en el futuro');
  if (!(await leerEmpleados()).some((e) => e.id === body.empleadoId)) throw errorHttp(404, 'Empleado no encontrado');
  await agregarMarcajeManual({ empleadoId: body.empleadoId, tipo: body.tipo, fecha: dia, motivo: texto(body.motivo, 50), ip });
  return { ok: true };
});

ruta('DELETE', '/admin/marcajes/:id', true, async ({ params }) => {
  await eliminarMarcaje(params.id);
  return { ok: true };
});

ruta('GET', '/admin/reporte.xlsx', true, async ({ query }) => {
  const rango = leerRango(query);
  const { buffer } = await generarExcel(rango);
  const nombre = `asistencia_${claveDia(rango.inicio)}_al_${claveDia(sumarDias(rango.fin, -1))}.xlsx`;
  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${nombre}"`,
      'Cache-Control': 'no-store',
    },
  });
});

// ===== Programación de reportes =====
function validarProgramacion(body) {
  const nombre = texto(body.nombre, 60) || 'Reporte';
  const frecuencia = String(body.frecuencia || '').toUpperCase();
  if (!['DIARIO', 'SEMANAL', 'MENSUAL'].includes(frecuencia)) throw errorHttp(400, 'Frecuencia inválida');
  const hora = String(body.hora || '');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) throw errorHttp(400, 'Hora inválida (usa HH:MM)');
  const diaSemana = Math.min(Math.max(Number(body.dia_semana ?? 6), 0), 6);
  const correos = separarCorreos(body.destinatarios);
  if (!correos.length) throw errorHttp(400, 'Agrega al menos un correo destinatario');
  const malos = correos.filter((c) => !correoValido(c));
  if (malos.length) throw errorHttp(400, `Correo inválido: ${malos.join(', ')}`);
  return { nombre, frecuencia, hora, dia_semana: diaSemana, destinatarios: correos.join(', '), activo: body.activo !== false };
}

ruta('GET', '/admin/programaciones', true, async () => {
  const lista = await leer('programaciones', []);
  return lista.map((p) => ({
    ...p, descripcion: describirProgramacion(p),
    ultimo_envio_texto: p.ultimo_envio ? `${fmtFecha(p.ultimo_envio)} ${fmtHora(p.ultimo_envio)}` : null,
  }));
});

ruta('POST', '/admin/programaciones', true, async ({ body }) => {
  const p = validarProgramacion(body);
  const id = nuevoId();
  await modificar('programaciones', [], (lista) => {
    lista.push({ id, ...p, ultimo_periodo: periodoInicial(p), ultimo_envio: null, ultimo_resultado: null, reintentar_desde: null });
  });
  return { id };
});

ruta('PUT', '/admin/programaciones/:id', true, async ({ body, params }) => {
  const p = validarProgramacion(body);
  await modificar('programaciones', [], (lista) => {
    const actual = lista.find((x) => x.id === params.id);
    if (!actual) throw errorHttp(404, 'Programación no encontrada');
    Object.assign(actual, p, { ultimo_periodo: periodoInicial(p) ?? actual.ultimo_periodo });
  });
  return { ok: true };
});

ruta('DELETE', '/admin/programaciones/:id', true, async ({ params }) => {
  await modificar('programaciones', [], (lista) => {
    const i = lista.findIndex((x) => x.id === params.id);
    if (i >= 0) lista.splice(i, 1);
  });
  return { ok: true };
});

ruta('POST', '/admin/programaciones/:id/enviar', true, async ({ params }) => {
  const p = (await leer('programaciones', [])).find((x) => x.id === params.id);
  if (!p) throw errorHttp(404, 'Programación no encontrada');
  try {
    const r = await ejecutarProgramacion(p);
    await actualizarProgramacion(p.id, { ultimo_envio: ahoraISO(), ultimo_resultado: `OK (manual): ${r.mensaje}` });
    return { ok: true, mensaje: r.mensaje };
  } catch (e) {
    await actualizarProgramacion(p.id, { ultimo_resultado: `ERROR: ${e.message}` });
    throw errorHttp(502, `No se pudo enviar: ${e.message}`);
  }
});

// ===== Ajustes =====
ruta('GET', '/admin/ajustes', true, async () => {
  const a = await leerAjustes();
  const { smtp_clave: clave, ...resto } = a;
  return { ...resto, smtp_clave_guardada: Boolean(clave), smtp_listo: smtpConfigurado(a) };
});

ruta('PUT', '/admin/ajustes', true, async ({ body }) => {
  const b = { ...body };
  if (!b.smtp_clave) delete b.smtp_clave;
  const numeros = {
    umbral_similitud: [0.3, 0.95], umbral_anti_foto: [0.1, 0.95], tamano_min_rostro: [60, 600], giro_max: [0.1, 0.6],
    horas_max_turno: [4, 36], minutos_entre_marcajes: [0, 60], smtp_puerto: [1, 65535],
  };
  for (const [k, [min, max]] of Object.entries(numeros)) {
    if (k in b) {
      const n = Number(b[k]);
      if (!Number.isFinite(n) || n < min || n > max) throw errorHttp(400, `Valor fuera de rango para ${k} (${min} a ${max})`);
    }
  }
  if ('empresa' in b) b.empresa = texto(b.empresa, 80) || 'Mi Empresa';
  await guardarAjustes(b);
  return { ok: true };
});

ruta('POST', '/admin/correo-prueba', true, async ({ body }) => {
  const para = separarCorreos(body.para).filter(correoValido);
  if (!para.length) throw errorHttp(400, 'Escribe un correo válido');
  try {
    await enviarCorreo({
      para,
      asunto: `Prueba del Sistema de Marcaje — ${(await leerAjustes()).empresa}`,
      html: '<p>¡Funciona! 🎉 Este es un correo de prueba del Sistema de Marcaje Facial. Ya puedes programar tus reportes.</p>',
    });
  } catch (e) {
    throw errorHttp(502, `No se pudo enviar: ${e.message}`);
  }
  return { ok: true };
});

// ---------- Manejador principal ----------
export default async (req, context) => {
  const url = new URL(req.url);
  const camino = url.pathname.replace(/^\/(\.netlify\/functions\/)?api/, '') || '/';
  try {
    for (const r of rutas) {
      if (r.metodo !== req.method) continue;
      const m = r.re.exec(camino);
      if (!m) continue;
      if (r.admin && !(await sesionValida(req))) throw errorHttp(401, 'Sesión vencida. Vuelve a ingresar.');
      let body = {};
      if (req.method !== 'GET' && req.method !== 'DELETE') {
        const crudo = await req.text();
        if (crudo.length > 2_000_000) throw errorHttp(413, 'Solicitud demasiado grande');
        try { body = crudo ? JSON.parse(crudo) : {}; } catch { throw errorHttp(400, 'JSON inválido'); }
      }
      const res = await r.fn({
        req, body: body || {}, query: url.searchParams, params: m.groups || {}, ip: context?.ip || '',
      });
      return res instanceof Response ? res : json(res);
    }
    return json({ error: 'Ruta no encontrada' }, 404);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500 && status !== 502) console.error(e);
    return json({ error: status === 500 ? 'Error interno del servidor' : e.message }, status);
  }
};

export const config = { path: '/api/*' };
