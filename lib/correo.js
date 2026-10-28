// Envío de correos con Nodemailer (SMTP). Funciona con Gmail, Outlook, Zoho, etc.
import nodemailer from 'nodemailer';
import { leerAjustes } from './almacen.js';

export function smtpConfigurado(ajustes) {
  return Boolean(ajustes.smtp_host && ajustes.smtp_usuario && ajustes.smtp_clave);
}

export function separarCorreos(texto) {
  return String(texto || '')
    .split(/[,;\s]+/)
    .map((c) => c.trim())
    .filter(Boolean);
}

export const correoValido = (c) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c);

export async function enviarCorreo({ para, asunto, html, adjuntos = [] }) {
  const a = await leerAjustes();
  if (!smtpConfigurado(a)) {
    throw new Error('El correo de salida (SMTP) no está configurado. Ve a Ajustes → Correo de salida.');
  }
  const transporte = nodemailer.createTransport({
    host: a.smtp_host,
    port: Number(a.smtp_puerto) || 465,
    secure: a.smtp_seguro === '1',
    auth: { user: a.smtp_usuario, pass: a.smtp_clave },
    connectionTimeout: 20_000,
  });
  const info = await transporte.sendMail({
    from: a.smtp_remitente || `"${a.empresa} - Marcaje" <${a.smtp_usuario}>`,
    to: para.join(', '),
    subject: asunto,
    html,
    attachments: adjuntos,
  });
  return info.messageId;
}
