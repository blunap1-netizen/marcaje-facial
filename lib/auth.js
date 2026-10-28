// Sesión del administrador y permisos de marcaje con firma digital (HMAC).
// No se guarda nada en memoria: funciona aunque Netlify use varias copias de la función.
import crypto from 'node:crypto';
import { config } from './config.js';
import { leer, crearSiNoExiste } from './almacen.js';

let secretoCache = null;
async function secreto() {
  if (secretoCache) return secretoCache;
  let s = await leer('secreto', null);
  if (!s) s = await crearSiNoExiste('secreto', crypto.randomBytes(32).toString('hex'));
  secretoCache = s;
  return s;
}

const hmac = (clave, texto) => crypto.createHmac('sha256', clave).update(texto).digest('base64url');

export async function firmar(datos) {
  const cuerpo = Buffer.from(JSON.stringify(datos)).toString('base64url');
  return `${cuerpo}.${hmac(await secreto(), cuerpo)}`;
}

export async function verificar(token) {
  const [cuerpo, firma] = String(token || '').split('.');
  if (!cuerpo || !firma) return null;
  const esperada = hmac(await secreto(), cuerpo);
  const a = Buffer.from(firma);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const datos = JSON.parse(Buffer.from(cuerpo, 'base64url').toString());
    if (!datos.exp || datos.exp < Date.now()) return null;
    return datos;
  } catch {
    return null;
  }
}

export function claveCorrecta(clave) {
  const a = crypto.createHash('sha256').update(String(clave ?? '')).digest();
  const b = crypto.createHash('sha256').update(config.claveAdmin).digest();
  return crypto.timingSafeEqual(a, b);
}

const DURACION_SESION_MS = 12 * 3600e3;

function leerCookie(req, nombre) {
  for (const c of String(req.headers.get('cookie') || '').split(';')) {
    const [k, ...v] = c.trim().split('=');
    if (k === nombre) return decodeURIComponent(v.join('='));
  }
  return null;
}

export async function cookieSesion(req) {
  const token = await firmar({ t: 'admin', exp: Date.now() + DURACION_SESION_MS });
  const seguro = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `sesion_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${DURACION_SESION_MS / 1000}${seguro}`;
}

export const cookieCerrar = 'sesion_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';

export async function sesionValida(req) {
  const datos = await verificar(leerCookie(req, 'sesion_admin'));
  return datos?.t === 'admin';
}

// Permiso de un solo uso para marcar (vence en 60 segundos)
const usados = new Map();
export async function crearPermisoMarcaje(empleadoId, similitud) {
  return firmar({ t: 'marcar', e: empleadoId, s: similitud, n: crypto.randomBytes(8).toString('hex'), exp: Date.now() + 60_000 });
}
export async function usarPermisoMarcaje(token) {
  const datos = await verificar(token);
  if (datos?.t !== 'marcar' || usados.has(datos.n)) return null;
  usados.set(datos.n, datos.exp);
  for (const [n, exp] of usados) if (exp < Date.now()) usados.delete(n);
  return { empleadoId: datos.e, similitud: datos.s };
}
