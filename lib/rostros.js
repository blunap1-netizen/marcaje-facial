// Comparación de rostros en el servidor (el navegador manda el descriptor; aquí se compara).
import { leer, modificar, leerEmpleados, nuevoId, ahoraISO, errorHttp } from './almacen.js';

// Mismo cálculo que la librería Human (modelo faceres): distancia euclidiana normalizada a 0..1
const OPC = { multiplicador: 25, min: 0.2, max: 0.8 };

export function similitud(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let suma = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    suma += d * d;
  }
  const distancia = Math.round(100 * OPC.multiplicador * suma) / 100;
  if (distancia === 0) return 1;
  const norm = (1 - Math.sqrt(distancia) / 100 - OPC.min) / (OPC.max - OPC.min);
  return Math.round(100 * Math.max(Math.min(norm, 1), 0)) / 100;
}

export function descriptorValido(d) {
  return Array.isArray(d) && d.length >= 64 && d.length <= 4096 && d.every((n) => typeof n === 'number' && Number.isFinite(n));
}

// El descriptor se guarda compacto: números de 32 bits en base64
const aTexto = (arr) => Buffer.from(new Float32Array(arr).buffer).toString('base64');
const deTexto = (txt) => {
  const b = Buffer.from(txt, 'base64');
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

/** Rostros de empleados activos (o de todos si se indica) ya convertidos a números */
async function rostrosActivos() {
  const [rostros, empleados] = await Promise.all([leer('rostros', []), leerEmpleados()]);
  const activos = new Set(empleados.filter((e) => e.activo).map((e) => e.id));
  return rostros.filter((r) => activos.has(r.empleado_id)).map((r) => ({ empleadoId: r.empleado_id, descriptor: deTexto(r.d) }));
}

/** Devuelve el empleado más parecido: { empleadoId, similitud } o null */
export async function buscarCoincidencia(descriptor, excluirEmpleadoId = null) {
  let mejor = null;
  for (const r of await rostrosActivos()) {
    if (r.empleadoId === excluirEmpleadoId) continue;
    const s = similitud(descriptor, r.descriptor);
    if (!mejor || s > mejor.similitud) mejor = { empleadoId: r.empleadoId, similitud: s };
  }
  return mejor;
}

/** Guarda varias muestras del rostro. Revisa que esa cara no sea de otro empleado. */
export async function guardarRostros(empleadoId, descriptores, umbral) {
  for (const d of descriptores) {
    const otro = await buscarCoincidencia(d, empleadoId);
    if (otro && otro.similitud >= umbral) {
      const emp = (await leerEmpleados()).find((e) => e.id === otro.empleadoId);
      throw errorHttp(409, `Este rostro se parece mucho al de "${emp?.nombre}" (${Math.round(otro.similitud * 100)}%). No se guardó para evitar confusiones.`);
    }
  }
  const fecha = ahoraISO();
  await modificar('rostros', [], (lista) => {
    for (const d of descriptores) lista.push({ id: nuevoId(), empleado_id: empleadoId, d: aTexto(d), creado_en: fecha });
  });
}

export async function contarRostros() {
  const rostros = await leer('rostros', []);
  const conteo = {};
  for (const r of rostros) conteo[r.empleado_id] = (conteo[r.empleado_id] || 0) + 1;
  return conteo;
}

export async function borrarRostros(empleadoId) {
  await modificar('rostros', [], (lista) => {
    const quedan = lista.filter((r) => r.empleado_id !== empleadoId);
    lista.length = 0;
    lista.push(...quedan);
  });
}
