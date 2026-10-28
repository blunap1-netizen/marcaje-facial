// Almacenamiento en Netlify Blobs (base de datos clave-valor incluida en Netlify, no hay que configurar nada).
//
//  Clave                 Contenido
//  ─────────────────     ─────────────────────────────────────────────
//  empleados             [{ id, codigo, nombre, puesto, activo, creado_en }]
//  rostros               [{ id, empleado_id, d (descriptor en base64), creado_en }]
//  marcajes/AAAA-MM      [{ id, empleado_id, tipo, fecha_hora, similitud, dispositivo, ip }]  (uno por mes)
//  programaciones        [{ id, nombre, frecuencia, hora, dia_semana, destinatarios, activo, ... }]
//  ajustes               { clave: valor }
//  secreto               texto aleatorio para firmar sesiones
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';
import { config } from './config.js';

const tienda = () => getStore({ name: 'marcaje', consistency: 'strong' });

export const nuevoId = () => crypto.randomBytes(6).toString('base64url');
export const ahoraISO = () => new Date().toISOString();

export function errorHttp(status, mensaje) {
  return Object.assign(new Error(mensaje), { status });
}

export async function leer(clave, porDefecto) {
  const r = await tienda().getWithMetadata(clave, { type: 'json' });
  return r ? r.data : porDefecto;
}

/**
 * Lee un valor, lo modifica con `fn` y lo guarda solo si nadie más lo cambió mientras tanto.
 * Si dos dispositivos marcan al mismo tiempo, uno reintenta y no se pierde ningún dato.
 */
export async function modificar(clave, porDefecto, fn) {
  for (let intento = 0; intento < 8; intento++) {
    const r = await tienda().getWithMetadata(clave, { type: 'json' });
    const valor = r ? r.data : structuredClone(porDefecto);
    const resultado = await fn(valor);
    // Si existe se exige que no haya cambiado (etag); si no existe, que siga sin existir.
    // (El emulador local de Netlify no envía etag al leer: en ese caso se escribe sin condición.)
    const condicion = r ? (r.etag ? { onlyIfMatch: r.etag } : {}) : { onlyIfNew: true };
    const escritura = await tienda().setJSON(clave, valor, condicion);
    if (escritura.modified) return resultado;
    await new Promise((ok) => { setTimeout(ok, 40 + Math.random() * 160); });
  }
  throw errorHttp(503, 'El sistema está ocupado. Intenta de nuevo en un momento.');
}

/** Guarda un valor solo si la clave no existe todavía; devuelve el valor que quedó guardado */
export async function crearSiNoExiste(clave, valor) {
  await tienda().setJSON(clave, valor, { onlyIfNew: true });
  return leer(clave, valor);
}

export async function listarClaves(prefijo) {
  const { blobs } = await tienda().list({ prefix: prefijo });
  return blobs.map((b) => b.key);
}

// ---------- Ajustes ----------
export const AJUSTES_INICIALES = {
  empresa: 'Mi Empresa',
  umbral_similitud: '0.50',
  anti_foto: '1',
  umbral_anti_foto: '0.5',
  parpadeo: '1',
  tamano_min_rostro: '150',
  giro_max: '0.25',
  horas_max_turno: '16',
  minutos_entre_marcajes: '1',
  smtp_host: config.smtp.host,
  smtp_puerto: String(config.smtp.puerto),
  smtp_seguro: config.smtp.seguro ? '1' : '0',
  smtp_usuario: config.smtp.usuario,
  smtp_clave: config.smtp.clave,
  smtp_remitente: config.smtp.remitente,
};

export async function leerAjustes() {
  return { ...AJUSTES_INICIALES, ...(await leer('ajustes', {})) };
}

export async function guardarAjustes(cambios) {
  await modificar('ajustes', {}, (actual) => {
    for (const [clave, valor] of Object.entries(cambios)) {
      if (clave in AJUSTES_INICIALES) actual[clave] = String(valor ?? '');
    }
  });
}

// ---------- Empleados ----------
export const leerEmpleados = () => leer('empleados', []);

// ---------- Marcajes (un archivo por mes) ----------
const dosDig = (n) => String(n).padStart(2, '0');
export const claveMes = (d) => `marcajes/${d.getFullYear()}-${dosDig(d.getMonth() + 1)}`;

/** Claves de los meses que cubre un rango de fechas */
export function mesesDelRango(inicio, fin) {
  const claves = [];
  const d = new Date(inicio.getFullYear(), inicio.getMonth(), 1);
  while (d < fin) {
    claves.push(claveMes(d));
    d.setMonth(d.getMonth() + 1);
  }
  return claves;
}

export async function leerMarcajesRango(inicio, fin) {
  const meses = await Promise.all(mesesDelRango(inicio, fin).map((k) => leer(k, [])));
  const desde = inicio.toISOString();
  const hasta = fin.toISOString();
  return meses.flat()
    .filter((m) => m.fecha_hora >= desde && m.fecha_hora < hasta)
    .sort((a, b) => a.fecha_hora.localeCompare(b.fecha_hora));
}
