// Función programada de Netlify: cada 5 minutos revisa si toca enviar algún reporte por correo.
import '../../lib/config.js'; // primero: zona horaria
import { revisarProgramaciones } from '../../lib/planificador.js';

export default async () => {
  const enviados = await revisarProgramaciones();
  if (enviados.length) console.log('Reportes enviados:', enviados.join(', '));
  return new Response('ok');
};

export const config = { schedule: '*/5 * * * *' };
