// Funciones de apoyo para fechas (todas en la zona horaria configurada en .env)

const LOCALE = 'es-GT';

export const fmtFecha = (d) => new Date(d).toLocaleDateString(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric' });
export const fmtHora = (d) => new Date(d).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: true });
export const fmtFechaHora = (d) => `${fmtFecha(d)} ${fmtHora(d)}`;

export function inicioDelDia(d) {
  const x = new Date(d);
  return new Date(x.getFullYear(), x.getMonth(), x.getDate());
}

export function sumarDias(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export const ultimoDiaDelMes = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

const dosDig = (n) => String(n).padStart(2, '0');
/** 'YYYY-MM-DD' en hora local */
export const claveDia = (d) => `${d.getFullYear()}-${dosDig(d.getMonth() + 1)}-${dosDig(d.getDate())}`;

/** Convierte 'YYYY-MM-DD' (de un input type=date) a Date local a las 00:00 */
export function desdeClaveDia(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export const NOMBRES_DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const NOMBRES_MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
