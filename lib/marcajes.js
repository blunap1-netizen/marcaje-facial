// Reglas de marcaje (entrada/salida) y registro.
import { modificar, leer, leerAjustes, claveMes, nuevoId, ahoraISO, errorHttp } from './almacen.js';
import { fmtHora, fmtFecha, inicioDelDia } from './util.js';

/** Último marcaje de un empleado (busca en este mes y el anterior) */
async function ultimoMarcaje(empleadoId) {
  const ahora = new Date();
  const mesAnterior = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
  const [actual, anterior] = await Promise.all([leer(claveMes(ahora), []), leer(claveMes(mesAnterior), [])]);
  const lista = [...anterior, ...actual].filter((m) => m.empleado_id === empleadoId);
  lista.sort((a, b) => a.fecha_hora.localeCompare(b.fecha_hora));
  return lista.at(-1) || null;
}

/** Calcula qué puede marcar el empleado con base en su último marcaje */
export function evaluarEstado(ultimo, ajustes) {
  const ahora = Date.now();
  const horasMax = Number(ajustes.horas_max_turno) || 16;
  const minEntre = Number(ajustes.minutos_entre_marcajes) || 0;
  let entrada = { permitido: true, motivo: '' };
  let salida = { permitido: true, motivo: '' };

  const msDesdeUltimo = ultimo ? ahora - Date.parse(ultimo.fecha_hora) : Infinity;
  const enTurno = !!ultimo && ultimo.tipo === 'ENTRADA' && msDesdeUltimo < horasMax * 3600e3;

  if (enTurno) {
    const esHoy = inicioDelDia(ultimo.fecha_hora).getTime() === inicioDelDia(ahora).getTime();
    const cuando = esHoy ? `a las ${fmtHora(ultimo.fecha_hora)}` : `el ${fmtFecha(ultimo.fecha_hora)} a las ${fmtHora(ultimo.fecha_hora)}`;
    entrada = { permitido: false, motivo: `Ya marcaste tu entrada ${cuando}; ahora te toca marcar SALIDA.` };
  } else {
    salida = { permitido: false, motivo: 'No tienes una entrada abierta. Primero marca tu ENTRADA.' };
  }
  if (msDesdeUltimo < minEntre * 60e3) {
    const motivo = `Acabas de marcar ${ultimo.tipo} (${fmtHora(ultimo.fecha_hora)}); espera un momento.`;
    entrada = { permitido: false, motivo };
    salida = { permitido: false, motivo };
  }
  return {
    enTurno,
    ultimo: ultimo ? { tipo: ultimo.tipo, fechaHora: ultimo.fecha_hora, hora: fmtHora(ultimo.fecha_hora) } : null,
    entrada,
    salida,
  };
}

export async function estadoMarcaje(empleadoId, ajustes) {
  return evaluarEstado(await ultimoMarcaje(empleadoId), ajustes || await leerAjustes());
}

/** Registra el marcaje con la hora del servidor. Lanza error si la regla no lo permite. */
export async function registrarMarcaje({ empleadoId, tipo, similitud = null, dispositivo = '', ip = '' }) {
  if (!['ENTRADA', 'SALIDA'].includes(tipo)) throw errorHttp(400, 'Tipo de marcaje inválido');
  const ajustes = await leerAjustes();
  const previo = await ultimoMarcaje(empleadoId);
  const ahora = new Date();
  const clave = claveMes(ahora);

  return modificar(clave, [], (lista) => {
    // Se vuelve a revisar dentro de la escritura por si marcó en otro dispositivo al mismo tiempo
    const delMes = lista.filter((m) => m.empleado_id === empleadoId).sort((a, b) => a.fecha_hora.localeCompare(b.fecha_hora)).at(-1);
    const ultimo = delMes && (!previo || delMes.fecha_hora > previo.fecha_hora) ? delMes : previo;
    const estado = evaluarEstado(ultimo, ajustes);
    const regla = tipo === 'ENTRADA' ? estado.entrada : estado.salida;
    if (!regla.permitido) throw errorHttp(409, regla.motivo);

    const fecha = ahoraISO();
    lista.push({
      id: `${clave.slice(9)}_${nuevoId()}`,
      empleado_id: empleadoId,
      tipo,
      fecha_hora: fecha,
      similitud,
      dispositivo: String(dispositivo).slice(0, 60),
      ip: String(ip).slice(0, 60),
    });
    return { tipo, fechaHora: fecha, hora: fmtHora(fecha), fecha: fmtFecha(fecha) };
  });
}

/** Marcaje manual del administrador (no valida reglas) */
export async function agregarMarcajeManual({ empleadoId, tipo, fecha, motivo, ip }) {
  const clave = claveMes(fecha);
  await modificar(clave, [], (lista) => {
    lista.push({
      id: `${clave.slice(9)}_${nuevoId()}`,
      empleado_id: empleadoId,
      tipo,
      fecha_hora: fecha.toISOString(),
      similitud: null,
      dispositivo: `MANUAL: ${String(motivo || '').slice(0, 50) || 'corrección'}`,
      ip: String(ip || '').slice(0, 60),
    });
  });
}

export async function eliminarMarcaje(id) {
  const mes = String(id).split('_')[0];
  if (!/^\d{4}-\d{2}$/.test(mes)) throw errorHttp(400, 'Marcaje inválido');
  await modificar(`marcajes/${mes}`, [], (lista) => {
    const i = lista.findIndex((m) => m.id === id);
    if (i >= 0) lista.splice(i, 1);
  });
}
