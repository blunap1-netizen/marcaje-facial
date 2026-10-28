// Planificador de reportes por correo (diario, semanal, mensual).
import { leer, modificar, leerAjustes } from './almacen.js';
import { rangoPeriodo, generarExcel } from './reportes.js';
import { enviarCorreo, separarCorreos } from './correo.js';
import { ultimoDiaDelMes, NOMBRES_DIAS } from './util.js';

const MINUTOS_REINTENTO = 15;

/** ¿Hoy es día de envío para esta programación? */
function esDiaDeEnvio(p, fecha) {
  if (p.frecuencia === 'DIARIO') return true;
  if (p.frecuencia === 'SEMANAL') return fecha.getDay() === Number(p.dia_semana);
  if (p.frecuencia === 'MENSUAL') return fecha.getDate() === ultimoDiaDelMes(fecha); // último día del mes
  return false;
}

function horaProgramadaHoy(p, fecha) {
  const [h, m] = String(p.hora).split(':').map(Number);
  return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate(), h || 0, m || 0);
}

/** Texto amigable: "Todos los días a las 18:00" */
export function describirProgramacion(p) {
  if (p.frecuencia === 'DIARIO') return `Todos los días a las ${p.hora} (reporte del día)`;
  if (p.frecuencia === 'SEMANAL') return `Cada ${NOMBRES_DIAS[p.dia_semana]} a las ${p.hora} (últimos 7 días)`;
  return `Último día de cada mes a las ${p.hora} (mes completo)`;
}

/**
 * Al crear o editar una programación: si hoy ya pasó la hora, se marca el periodo actual como
 * "ya atendido" para que no se envíe de inmediato (usa el botón "Enviar ahora" para probar).
 */
export function periodoInicial(p, ahora = new Date()) {
  if (esDiaDeEnvio(p, ahora) && ahora >= horaProgramadaHoy(p, ahora)) {
    return rangoPeriodo(p.frecuencia, ahora).clave;
  }
  return null;
}

/** Genera el Excel de una programación y lo envía. Devuelve el texto del resultado. */
export async function ejecutarProgramacion(p, referencia = new Date()) {
  const ajustes = await leerAjustes();
  const rango = rangoPeriodo(p.frecuencia, referencia);
  const { buffer, totales, rangoTexto } = await generarExcel({ ...rango, titulo: rango.titulo });
  const nombreArchivo = `asistencia_${p.frecuencia.toLowerCase()}_${rango.clave}.xlsx`;

  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;color:#1d2939;max-width:560px">
      <h2 style="color:#1f3a5f;margin:0 0 4px">Reporte de asistencia — ${p.frecuencia.toLowerCase()}</h2>
      <p style="margin:0 0 16px;color:#667085">${ajustes.empresa} · Periodo: ${rangoTexto}</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px">
        <tr><td style="padding:8px;border:1px solid #e4e7ec">Empleados que marcaron</td><td style="padding:8px;border:1px solid #e4e7ec;text-align:right"><b>${totales.empleadosConMarcaje}</b></td></tr>
        <tr><td style="padding:8px;border:1px solid #e4e7ec">Marcajes registrados</td><td style="padding:8px;border:1px solid #e4e7ec;text-align:right"><b>${totales.marcajes}</b></td></tr>
        <tr><td style="padding:8px;border:1px solid #e4e7ec">Horas trabajadas (total)</td><td style="padding:8px;border:1px solid #e4e7ec;text-align:right"><b>${totales.horas}</b></td></tr>
        <tr><td style="padding:8px;border:1px solid #e4e7ec">Jornadas incompletas</td><td style="padding:8px;border:1px solid #e4e7ec;text-align:right"><b>${totales.incompletas}</b></td></tr>
      </table>
      <p style="margin-top:16px">El detalle completo va en el archivo Excel adjunto (<b>${nombreArchivo}</b>).</p>
      <p style="font-size:12px;color:#98a2b3">Enviado automáticamente por el Sistema de Marcaje Facial · ${p.nombre}</p>
    </div>`;

  await enviarCorreo({
    para: separarCorreos(p.destinatarios),
    asunto: `Reporte de asistencia ${p.frecuencia.toLowerCase()} — ${rangoTexto} — ${ajustes.empresa}`,
    html,
    adjuntos: [{ filename: nombreArchivo, content: buffer }],
  });
  return { clave: rango.clave, mensaje: `Enviado a ${separarCorreos(p.destinatarios).length} destinatario(s) (${totales.marcajes} marcajes)` };
}

/** Guarda cambios en una programación (estado del último envío) */
export async function actualizarProgramacion(id, cambios) {
  await modificar('programaciones', [], (lista) => {
    const p = lista.find((x) => x.id === id);
    if (p) Object.assign(p, cambios);
  });
}

/** Revisa qué reportes toca enviar. Netlify lo ejecuta cada 5 minutos (función programada). */
export async function revisarProgramaciones() {
  const ahora = new Date();
  const programaciones = (await leer('programaciones', [])).filter((p) => p.activo);
  const enviados = [];
  for (const p of programaciones) {
    if (!esDiaDeEnvio(p, ahora) || ahora < horaProgramadaHoy(p, ahora)) continue;
    const clave = rangoPeriodo(p.frecuencia, ahora).clave;
    if (p.ultimo_periodo === clave) continue; // ya se envió este periodo
    if (p.reintentar_desde && Date.parse(p.reintentar_desde) > Date.now()) continue; // esperando reintento

    try {
      const r = await ejecutarProgramacion(p, ahora);
      await actualizarProgramacion(p.id, {
        ultimo_periodo: clave, ultimo_envio: new Date().toISOString(), ultimo_resultado: `OK: ${r.mensaje}`, reintentar_desde: null,
      });
      enviados.push(p.nombre);
      console.log(`[reportes] "${p.nombre}" enviado (${clave})`);
    } catch (e) {
      await actualizarProgramacion(p.id, {
        ultimo_resultado: `ERROR: ${e.message} (se reintentará en ${MINUTOS_REINTENTO} min)`,
        reintentar_desde: new Date(Date.now() + MINUTOS_REINTENTO * 60e3).toISOString(),
      });
      console.error(`[reportes] Error enviando "${p.nombre}":`, e.message);
    }
  }
  return enviados;
}
