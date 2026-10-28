// Generación de reportes de asistencia en Excel (.xlsx)
import ExcelJS from 'exceljs';
import { leerAjustes, leerEmpleados, leerMarcajesRango } from './almacen.js';
import {
  fmtFecha, inicioDelDia, sumarDias, claveDia, NOMBRES_MESES,
} from './util.js';

// ---------- Periodos ----------

/**
 * Calcula el rango de fechas de un reporte. Todos terminan el día de referencia:
 *  - DIARIO:  ese día completo
 *  - SEMANAL: los 7 días que terminan ese día
 *  - MENSUAL: el mes completo de ese día
 */
export function rangoPeriodo(frecuencia, referencia = new Date()) {
  const hoy = inicioDelDia(referencia);
  if (frecuencia === 'DIARIO') {
    return { inicio: hoy, fin: sumarDias(hoy, 1), clave: claveDia(hoy), titulo: `Diario — ${fmtFecha(hoy)}` };
  }
  if (frecuencia === 'SEMANAL') {
    const fin = sumarDias(hoy, 1);
    const inicio = sumarDias(fin, -7);
    return { inicio, fin, clave: claveDia(hoy), titulo: `Semanal — ${fmtFecha(inicio)} al ${fmtFecha(hoy)}` };
  }
  if (frecuencia === 'MENSUAL') {
    const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const fin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1);
    const clave = `${inicio.getFullYear()}-${String(inicio.getMonth() + 1).padStart(2, '0')}`;
    return { inicio, fin, clave, titulo: `Mensual — ${NOMBRES_MESES[inicio.getMonth()]} ${inicio.getFullYear()}` };
  }
  throw new Error(`Frecuencia desconocida: ${frecuencia}`);
}

// ---------- Datos ----------

/** Lista de marcajes "crudos" en un rango (para la pantalla de administración y la hoja Detalle) */
export async function listarMarcajes({ inicio, fin, empleadoId = null }) {
  const [marcajes, empleados] = await Promise.all([leerMarcajesRango(inicio, fin), leerEmpleados()]);
  const porId = new Map(empleados.map((e) => [e.id, e]));
  return marcajes
    .filter((m) => porId.has(m.empleado_id) && (!empleadoId || m.empleado_id === empleadoId))
    .map((m) => {
      const e = porId.get(m.empleado_id);
      return {
        id: m.id, tipo: m.tipo, fechaHora: m.fecha_hora, similitud: m.similitud, dispositivo: m.dispositivo,
        empleadoId: e.id, codigo: e.codigo, nombre: e.nombre, puesto: e.puesto,
      };
    });
}

/**
 * Une cada ENTRADA con su SALIDA para calcular horas trabajadas.
 * Devuelve una fila por jornada.
 */
export async function calcularAsistencia({ inicio, fin, empleadoId = null }) {
  const ajustes = await leerAjustes();
  const horasMax = Number(ajustes.horas_max_turno) || 16;
  // Se buscan marcajes desde un poco antes del inicio para no perder entradas de turnos nocturnos
  const desde = new Date(inicio.getTime() - horasMax * 3600e3);
  const marcajes = await listarMarcajes({ inicio: desde, fin, empleadoId });

  const porEmpleado = new Map();
  for (const m of marcajes) {
    if (!porEmpleado.has(m.empleadoId)) porEmpleado.set(m.empleadoId, []);
    porEmpleado.get(m.empleadoId).push(m);
  }

  const filas = [];
  const ahora = Date.now();
  for (const lista of porEmpleado.values()) {
    let abierta = null;
    const cerrarSinSalida = (entrada) => {
      const enCurso = ahora - Date.parse(entrada.fechaHora) < horasMax * 3600e3;
      filas.push(fila(entrada, entrada, null, enCurso ? 'En turno (aún sin salida)' : 'Sin salida'));
    };
    for (const m of lista) {
      if (m.tipo === 'ENTRADA') {
        if (abierta) cerrarSinSalida(abierta);
        abierta = m;
      } else if (abierta) {
        filas.push(fila(abierta, abierta, m, 'Completa'));
        abierta = null;
      } else {
        filas.push(fila(m, null, m, 'Salida sin entrada'));
      }
    }
    if (abierta) cerrarSinSalida(abierta);
  }

  // Solo jornadas que pertenecen al periodo (según su hora de entrada, o de salida si no hubo entrada)
  return filas
    .filter((f) => f.referencia >= inicio && f.referencia < fin)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es') || a.referencia - b.referencia);
}

function fila(ref, entrada, salida, observacion) {
  const ent = entrada ? new Date(entrada.fechaHora) : null;
  const sal = salida ? new Date(salida.fechaHora) : null;
  const horas = ent && sal ? (sal - ent) / 3600e3 : null;
  return {
    referencia: new Date(ref.fechaHora),
    empleadoId: ref.empleadoId,
    codigo: ref.codigo,
    nombre: ref.nombre,
    puesto: ref.puesto,
    entrada: ent,
    salida: sal,
    horas,
    observacion,
  };
}

/** Totales por empleado (incluye empleados activos sin marcajes, para ver ausencias) */
export async function calcularResumen(asistencia, empleadoId = null) {
  const todos = await leerEmpleados();
  const empleados = todos
    .filter((e) => (empleadoId ? e.id === empleadoId : e.activo))
    .map(({ id, codigo, nombre, puesto }) => ({ id, codigo, nombre, puesto }));
  const mapa = new Map(empleados.map((e) => [e.id, { ...e, dias: new Set(), horas: 0, jornadas: 0, incompletas: 0 }]));
  for (const f of asistencia) {
    if (!mapa.has(f.empleadoId)) mapa.set(f.empleadoId, { id: f.empleadoId, codigo: f.codigo, nombre: f.nombre, puesto: f.puesto, dias: new Set(), horas: 0, jornadas: 0, incompletas: 0 });
    const r = mapa.get(f.empleadoId);
    r.dias.add(claveDia(f.referencia));
    r.jornadas += 1;
    if (f.horas != null) r.horas += f.horas;
    else r.incompletas += 1;
  }
  return [...mapa.values()]
    .map((r) => ({ ...r, dias: r.dias.size }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

// ---------- Excel ----------

// ExcelJS guarda las fechas en UTC; esto las "congela" en la hora local para que Excel muestre la hora correcta.
const aExcel = (d) => (d ? new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds())) : null);

const AZUL = 'FF1F3A5F';
const NARANJA_SUAVE = 'FFFDEBD3';
const borde = { style: 'thin', color: { argb: 'FFD0D5DD' } };

function prepararHoja(hoja, { titulo, subtitulo, columnas }) {
  hoja.columns = columnas.map((c) => ({ key: c.key, width: c.width }));
  hoja.mergeCells(1, 1, 1, columnas.length);
  hoja.getCell(1, 1).value = titulo;
  hoja.getCell(1, 1).font = { bold: true, size: 14, color: { argb: AZUL } };
  hoja.mergeCells(2, 1, 2, columnas.length);
  hoja.getCell(2, 1).value = subtitulo;
  hoja.getCell(2, 1).font = { italic: true, size: 10, color: { argb: 'FF667085' } };

  const encabezado = hoja.getRow(4);
  columnas.forEach((c, i) => {
    const celda = encabezado.getCell(i + 1);
    celda.value = c.header;
    celda.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
    celda.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    celda.border = { top: borde, left: borde, bottom: borde, right: borde };
  });
  encabezado.height = 22;
  hoja.views = [{ state: 'frozen', ySplit: 4 }];
  hoja.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: columnas.length } };
}

function agregarFila(hoja, valores, formatos = {}, resaltar = false) {
  const row = hoja.addRow(valores);
  row.eachCell({ includeEmpty: true }, (celda, col) => {
    celda.border = { top: borde, left: borde, bottom: borde, right: borde };
    const key = hoja.columns[col - 1]?.key;
    if (formatos[key]) celda.numFmt = formatos[key];
    if (resaltar) celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NARANJA_SUAVE } };
  });
  return row;
}

/** Crea el archivo Excel del periodo y devuelve { buffer, resumen } */
export async function generarExcel({ inicio, fin, titulo, empleadoId = null }) {
  const ajustes = await leerAjustes();
  const asistencia = await calcularAsistencia({ inicio, fin, empleadoId });
  const resumen = await calcularResumen(asistencia, empleadoId);
  const detalle = await listarMarcajes({ inicio, fin, empleadoId });

  const libro = new ExcelJS.Workbook();
  libro.creator = 'Sistema de Marcaje Facial';
  libro.created = new Date();
  const ultimoDia = sumarDias(fin, -1);
  const rangoTexto = inicioDelDia(inicio).getTime() === inicioDelDia(ultimoDia).getTime()
    ? fmtFecha(inicio)
    : `${fmtFecha(inicio)} al ${fmtFecha(ultimoDia)}`;
  const subtitulo = `Periodo: ${rangoTexto}   ·   Generado: ${new Date().toLocaleString('es-GT')}`;

  // Hoja 1: Asistencia (una fila por jornada)
  const h1 = libro.addWorksheet('Asistencia');
  prepararHoja(h1, {
    titulo: `${ajustes.empresa} — Reporte de asistencia${titulo ? ` (${titulo})` : ''}`,
    subtitulo,
    columnas: [
      { key: 'fecha', header: 'Fecha', width: 12 },
      { key: 'codigo', header: 'Código', width: 10 },
      { key: 'nombre', header: 'Empleado', width: 28 },
      { key: 'puesto', header: 'Puesto', width: 18 },
      { key: 'entrada', header: 'Hora entrada', width: 13 },
      { key: 'salida', header: 'Hora salida', width: 13 },
      { key: 'tiempo', header: 'Tiempo trabajado', width: 15 },
      { key: 'horas', header: 'Horas (decimal)', width: 14 },
      { key: 'observacion', header: 'Observación', width: 24 },
    ],
  });
  const fmt1 = { fecha: 'dd/mm/yyyy', entrada: 'h:mm AM/PM', salida: 'h:mm AM/PM', tiempo: '[h]:mm', horas: '0.00' };
  for (const f of asistencia) {
    agregarFila(h1, {
      fecha: aExcel(inicioDelDia(f.referencia)),
      codigo: f.codigo,
      nombre: f.nombre,
      puesto: f.puesto,
      entrada: aExcel(f.entrada),
      salida: aExcel(f.salida),
      tiempo: f.horas != null ? f.horas / 24 : null,
      horas: f.horas != null ? Math.round(f.horas * 100) / 100 : null,
      observacion: f.observacion,
    }, fmt1, f.observacion !== 'Completa');
  }
  if (!asistencia.length) h1.addRow(['Sin marcajes en este periodo']);

  // Hoja 2: Resumen por empleado
  const h2 = libro.addWorksheet('Resumen');
  prepararHoja(h2, {
    titulo: `${ajustes.empresa} — Resumen por empleado`,
    subtitulo,
    columnas: [
      { key: 'codigo', header: 'Código', width: 10 },
      { key: 'nombre', header: 'Empleado', width: 28 },
      { key: 'puesto', header: 'Puesto', width: 18 },
      { key: 'dias', header: 'Días trabajados', width: 14 },
      { key: 'jornadas', header: 'Jornadas', width: 11 },
      { key: 'tiempo', header: 'Tiempo total', width: 14 },
      { key: 'horas', header: 'Horas (decimal)', width: 14 },
      { key: 'incompletas', header: 'Jornadas incompletas', width: 18 },
    ],
  });
  const fmt2 = { tiempo: '[h]:mm', horas: '0.00' };
  for (const r of resumen) {
    agregarFila(h2, {
      codigo: r.codigo, nombre: r.nombre, puesto: r.puesto, dias: r.dias, jornadas: r.jornadas,
      tiempo: r.horas / 24, horas: Math.round(r.horas * 100) / 100, incompletas: r.incompletas,
    }, fmt2, r.incompletas > 0);
  }

  // Hoja 3: Detalle de cada marcaje
  const h3 = libro.addWorksheet('Detalle');
  prepararHoja(h3, {
    titulo: `${ajustes.empresa} — Detalle de marcajes`,
    subtitulo,
    columnas: [
      { key: 'fecha', header: 'Fecha', width: 12 },
      { key: 'hora', header: 'Hora', width: 12 },
      { key: 'codigo', header: 'Código', width: 10 },
      { key: 'nombre', header: 'Empleado', width: 28 },
      { key: 'tipo', header: 'Tipo', width: 11 },
      { key: 'similitud', header: 'Coincidencia', width: 13 },
      { key: 'dispositivo', header: 'Dispositivo', width: 20 },
    ],
  });
  const fmt3 = { fecha: 'dd/mm/yyyy', hora: 'h:mm:ss AM/PM', similitud: '0%' };
  for (const m of detalle) {
    const d = new Date(m.fechaHora);
    const row = agregarFila(h3, {
      fecha: aExcel(inicioDelDia(d)), hora: aExcel(d), codigo: m.codigo, nombre: m.nombre,
      tipo: m.tipo, similitud: m.similitud, dispositivo: m.dispositivo,
    }, fmt3);
    row.getCell('tipo').font = { bold: true, color: { argb: m.tipo === 'ENTRADA' ? 'FF067647' : 'FFB54708' } };
  }

  const buffer = Buffer.from(await libro.xlsx.writeBuffer());
  const totales = {
    marcajes: detalle.length,
    empleadosConMarcaje: resumen.filter((r) => r.jornadas > 0).length,
    horas: Math.round(resumen.reduce((s, r) => s + r.horas, 0) * 100) / 100,
    incompletas: resumen.reduce((s, r) => s + r.incompletas, 0),
  };
  return { buffer, resumen, totales, rangoTexto };
}
