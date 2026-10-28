# Sistema de Marcaje Facial — versión Netlify

Marcaje de **entrada y salida** con reconocimiento facial, desde cualquier celular, tablet o computadora con cámara. Guarda nombre, fecha y hora, y envía **reportes en Excel por correo** (diario, semanal o mensual). Esta versión está preparada para publicarse en **Netlify**: no necesitas tener una computadora encendida.

- **Pantalla de marcaje:** `https://TU-SITIO.netlify.app/`
- **Administración:** `https://TU-SITIO.netlify.app/admin`
- **Contraseña de administración:** `Luna2006`

## Publicar en Netlify

Tu sitio ya está creado en Netlify: **https://marcaje-facial-luna.netlify.app** (queda en blanco hasta la primera subida).

Necesitas **Node.js** instalado (https://nodejs.org).

**Opción rápida (sin iniciar sesión):** doble clic en `subir-a-netlify.bat` (Ubuntu/Mac: `./subir-a-netlify.sh`). Sube el código y Netlify lo construye solo. Tarda 1 a 3 minutos.

**Si la opción rápida dice que el permiso venció:** doble clic en `publicar.bat` (Ubuntu/Mac: `./publicar.sh`); pide iniciar sesión en Netlify una vez.

O a mano, desde una terminal dentro de esta carpeta:

```bash
npm install
npx netlify-cli deploy --prod --site-name marcaje-facial-luna
```

La primera vez se abre el navegador para que inicies sesión en Netlify y autorices la terminal.

Para publicar cambios después, vuelve a ejecutar el mismo comando.

## Primer uso

1. Entra a `/admin` con la contraseña `Luna2006`.
2. **Ajustes:** nombre de la empresa y correo de salida (Gmail con *contraseña de aplicación*).
3. **Empleados:** agrega a cada persona y registra su rostro (5 muestras con la cámara).
4. Abre la pantalla de marcaje (`/`) en el celular o tablet de la entrada. Como Netlify usa HTTPS, la cámara funciona directo, sin advertencias.

## Cómo está hecho en Netlify

| Parte | Dónde vive |
|---|---|
| Páginas (marcaje y administración) | Archivos estáticos en `public/` |
| API (`/api/...`) | Función de Netlify `netlify/functions/api.mjs` |
| Base de datos | **Netlify Blobs** (incluido en Netlify, no hay que configurar nada) |
| Reportes automáticos | Función programada `reportes-programados.mjs` que revisa **cada 5 minutos** si toca enviar |
| Reconocimiento facial | En el navegador del dispositivo con la librería Human (los modelos se publican junto al sitio) |

- No se guardan fotos, solo el descriptor numérico del rostro.
- La hora la pone el servidor (zona horaria de Guatemala).
- Las sesiones y los permisos de marcaje van firmados digitalmente.
- Si dos dispositivos marcan al mismo tiempo, el sistema reintenta para no perder datos.

## Variables de entorno (opcional)

En Netlify: **Site configuration → Environment variables**.

| Variable | Para qué |
|---|---|
| `CLAVE_ADMIN` | Cambia la contraseña de administración (si no existe, es `Luna2006`). |
| `ZONA_HORARIA` | Otra zona horaria (por defecto `America/Guatemala`). |
| `SMTP_HOST`, `SMTP_PUERTO`, `SMTP_USUARIO`, `SMTP_CLAVE`, `SMTP_REMITENTE` | Correo de salida (también se configura desde el panel). |

Después de cambiar una variable, vuelve a publicar.

## Correo (Gmail)

1. Activa la verificación en dos pasos en la cuenta de Google.
2. Crea una contraseña de aplicación en https://myaccount.google.com/apppasswords
3. En **Ajustes → Correo de salida**: *Llenar datos de Gmail*, tu correo y la contraseña de aplicación. Usa *Enviar prueba*.

## Reportes

| Frecuencia | Se envía | Incluye |
|---|---|---|
| Diario | Todos los días a la hora elegida | Ese día |
| Semanal | El día de la semana elegido | Los 7 días que terminan ese día |
| Mensual | El último día del mes | El mes completo |

El Excel trae 3 hojas: **Asistencia** (jornadas con horas trabajadas), **Resumen** por empleado y **Detalle** de cada marcaje. Los envíos salen como máximo 5 minutos después de la hora programada.

## Calibración

Abre la pantalla con `?depurar=1` (ej. `https://TU-SITIO.netlify.app/?depurar=1`) para ver lo que mide la cámara y ajustar en **Ajustes**: exigencia de reconocimiento (0.50), parpadeo (déjalo activado: es la mejor protección contra fotos), tolerancia de giro y tamaño mínimo del rostro.

## Probar en tu computadora (opcional)

```bash
npm install
npx netlify-cli dev
```

Abre `http://localhost:8888`.

## Estructura

```
netlify.toml                       Configuración de Netlify
netlify/functions/api.mjs          API (empleados, marcajes, reportes, ajustes)
netlify/functions/reportes-programados.mjs   Envíos automáticos cada 5 min
lib/                               Lógica: almacenamiento, rostros, reglas, Excel, correo
public/                            Pantalla de marcaje, panel y estilos
scripts/preparar.mjs               Copia la librería facial y las fuentes a public/
```
