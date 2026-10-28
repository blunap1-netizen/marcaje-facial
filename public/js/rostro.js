// Módulo compartido: cámara + detección facial con la librería Human (corre en el dispositivo).
import { Human } from '/human/dist/human.esm.js';

const configHuman = {
  modelBasePath: '/human/models/',
  cacheSensitivity: 0,
  debug: false,
  filter: { enabled: true, equalization: true }, // mejora imágenes con poca luz
  face: {
    enabled: true,
    detector: { rotation: true, maxDetected: 2, minConfidence: 0.5 },
    mesh: { enabled: true },
    iris: { enabled: true },
    description: { enabled: true }, // genera el "descriptor" (huella numérica del rostro)
    emotion: { enabled: false },
    antispoof: { enabled: true },   // ¿es una foto o pantalla?
    liveness: { enabled: true },    // ¿es una persona viva?
  },
  body: { enabled: false },
  hand: { enabled: false },
  object: { enabled: false },
  segmentation: { enabled: false },
  gesture: { enabled: true },       // parpadeo, mirar de frente
};

let human = null;

/** Carga los modelos de inteligencia artificial (solo la primera vez tarda unos segundos) */
export async function cargarModelos() {
  if (human) return human;
  human = new Human(configHuman);
  await human.load();
  await human.warmup();
  return human;
}

/** Enciende la cámara frontal y la muestra en el <video> */
export async function encenderCamara(video) {
  if (!window.isSecureContext) {
    throw new Error('La cámara solo funciona con HTTPS. Abre la dirección https:// que aparece en la ventana del servidor.');
  }
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador no permite usar la cámara.');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  } catch (e) {
    if (e.name === 'NotAllowedError') throw new Error('No se dio permiso para usar la cámara. Permítelo en el candado de la barra de direcciones y recarga.');
    if (e.name === 'NotFoundError') throw new Error('No se encontró ninguna cámara en este dispositivo.');
    throw new Error(`No se pudo abrir la cámara (${e.name}).`);
  }
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await new Promise((ok) => { video.onloadeddata = ok; });
  await video.play();
  return stream;
}

export function apagarCamara(video) {
  const s = video.srcObject;
  if (s) s.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
}

/** Analiza un cuadro del video y devuelve datos simples del rostro */
export async function analizar(video) {
  const r = await human.detect(video);
  const caras = r.face.filter((f) => (f.boxScore || 0) >= 0.5);
  const gestos = r.gesture.map((g) => g.gesture);
  if (caras.length !== 1) return { cantidad: caras.length, gestos };
  const f = caras[0];
  // Giro de la cabeza: diferencia de profundidad entre los ojos (0 = totalmente de frente)
  let giro = 1;
  if (f.mesh?.length > 450) {
    const dz = (f.mesh[33][2] || 0) - (f.mesh[263][2] || 0);
    const dx = f.mesh[33][0] - f.mesh[263][0];
    giro = Math.abs(dz / (dx || 1));
  }
  return {
    cantidad: 1,
    gestos,
    tamano: Math.min(f.box[2], f.box[3]),
    confianza: f.faceScore || f.boxScore || 0,
    real: f.real ?? 0,
    vivo: f.live ?? 0,
    giro,
    ojosCerrados: gestos.includes('blink left eye') || gestos.includes('blink right eye'),
    descriptor: f.embedding?.length ? Array.from(f.embedding) : null,
  };
}

/** Detector de parpadeo: ojos cerrados entre 10 y 800 ms y luego abiertos */
export function crearDetectorParpadeo() {
  let inicio = 0;
  let detectado = false;
  return {
    actualizar(ojosCerrados) {
      const ahora = performance.now();
      if (ojosCerrados && !inicio) inicio = ahora;
      if (!ojosCerrados && inicio) {
        const dur = ahora - inicio;
        if (dur > 10 && dur < 800) detectado = true;
        inicio = 0;
      }
      return detectado;
    },
    get detectado() { return detectado; },
    reiniciar() { inicio = 0; detectado = false; },
  };
}
