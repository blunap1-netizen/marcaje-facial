// Configuración general. Este módulo se importa primero para fijar la zona horaria.
// En Netlify se puede cambiar con variables de entorno (Site configuration → Environment variables).

process.env.TZ = process.env.ZONA_HORARIA || 'America/Guatemala';

export const config = {
  claveAdmin: process.env.CLAVE_ADMIN || 'Luna2006',
  zonaHoraria: process.env.TZ,
  smtp: {
    host: process.env.SMTP_HOST || '',
    puerto: Number(process.env.SMTP_PUERTO || 465),
    seguro: (process.env.SMTP_SEGURO || 'si').toLowerCase() !== 'no',
    usuario: process.env.SMTP_USUARIO || '',
    clave: process.env.SMTP_CLAVE || '',
    remitente: process.env.SMTP_REMITENTE || '',
  },
};
