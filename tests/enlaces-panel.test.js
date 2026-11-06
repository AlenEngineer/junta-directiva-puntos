// Pruebas del servidor para la sección Enlaces del panel: estado por persona, correos y cambio de enlace (datos ficticios).
const { cargarServidor } = require('./hoja-simulada');
const { api, libro, propiedades, sesion } = cargarServidor(
  ['panelEnlaces', 'panelEnviarCorreos', 'panelCambiarEnlace', 'enviarPunto', 'crearHoja_', 'juntaAgregar_',
    'clavesReemplazarTodas_', 'cerrarTodas_', 'COLS_PUNTOS', '__correos', '__hojaEnlaces'],
  `var __correos = [], __hojaEnlaces = { veces: 0 };
   MailApp = { getRemainingDailyQuota: () => 3, sendEmail: (m) => { if (m.to === 'falla@ejemplo.org') throw new Error('Rebotado'); __correos.push(m.to); } };
   escribirEnlaces_ = function () { __hojaEnlaces.veces++; };
   contexto_ = function (clave) { return { clave: clave, junta: { fecha: '26/11/2026', dia: '…' }, general: clave === 'g',
     nombre: clave === 'g' ? '' : 'Daniel Rivas',
     cargos: [{ departamento: 'Ancianos', cargo: 'Anciano' }] }; };`);

let fails = 0;
const check = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fails++; };
const falla = (fn, texto, m) => { try { fn(); check(false, m); } catch (e) { check(e.message.includes(texto), m + ' → ' + e.message); } };

api.crearHoja_(libro, 'Cargos', ['Departamento', 'Nombre', 'Cargo', '¿Es director?'], [
  ['Ancianos', 'Daniel Rivas', 'Anciano', 'Sí'],
  ['Jóvenes', 'Marta Ruiz', 'Directora', 'Sí'],
  ['Jóvenes', 'Pedro Gil', 'Asociado', 'No'],
  ['Música', 'Ana Soto', 'Asociada', 'No']
]);
api.crearHoja_(libro, 'Contactos', ['Nombre', 'Teléfono', 'Correo'], [
  ['Daniel Rivas', '6111-1111', 'daniel@ejemplo.org'],
  ['Marta Ruiz', '12', 'falla@ejemplo.org'],
  ['Pedro Gil', '', 'no es un correo'],
  ['Ana Soto', '', '']
]);
api.crearHoja_(libro, 'Juntas', ['Fecha', 'Día', 'Estado'], []);
api.crearHoja_(libro, 'Puntos', api.COLS_PUNTOS, []);
api.crearHoja_(libro, '_Claves', ['Clave', 'Junta', 'Persona', 'Correo enviado'], []);

check(api.panelEnlaces().junta === null, 'sin junta abierta: lo indica');

api.juntaAgregar_('26/11/2026', 'jueves 26 de noviembre de 2026');
api.clavesReemplazarTodas_('26/11/2026', ['Daniel Rivas', 'Marta Ruiz', 'Pedro Gil', 'Ana Soto', 'GENERAL']);
check(api.panelEnlaces().sinUrl === true && api.panelEnlaces().personas[0].enlace === '', 'sin la URL del formulario: lo indica y no arma enlaces');
propiedades.URL_APP = 'https://script.google.com/macros/s/x/exec';

const base = { departamento: 'Ancianos', categoria: 'Otros asuntos', descripcion: 'x', tipo: 'Informativo' };
api.enviarPunto('d', { ...base, titulo: 'A' });
api.enviarPunto('d', { ...base, titulo: 'B' });
api.enviarPunto('g', { ...base, titulo: 'C', nombre: 'María Torres', departamento: 'Miembro de la iglesia' });

let e = api.panelEnlaces();
const por = (n) => e.personas.find((p) => p.nombre === n);
check(e.junta.dia === 'jueves 26 de noviembre de 2026' && e.personas.map((p) => p.nombre).join() === 'Daniel Rivas,Marta Ruiz,Pedro Gil,Ana Soto',
  'lista a todas las personas de Cargos, en orden');
check(/^https:\/\/script\.google\.com\/macros\/s\/x\/exec\?t=[0-9a-f]{32}$/.test(por('Daniel Rivas').enlace), 'cada persona trae su enlace personal');
check(por('Daniel Rivas').whatsapp.startsWith('https://wa.me/50761111111?text=') && por('Daniel Rivas').telefono === 'ok', 'WhatsApp con el número de Panamá');
check(por('Marta Ruiz').telefono === 'no válido' && por('Ana Soto').telefono === 'sin teléfono' && por('Ana Soto').whatsapp.startsWith('https://wa.me/?text='),
  'teléfono no válido o vacío: WhatsApp para elegir el contacto');
check(por('Daniel Rivas').correoEstado === 'Pendiente' && por('Pedro Gil').correoEstado === 'Correo no válido' && por('Pedro Gil').correo === '' &&
  por('Ana Soto').correoEstado === 'Sin correo', 'estado del correo de cada persona');
check(por('Daniel Rivas').puntos === 2 && por('Marta Ruiz').puntos === 0 && e.general.puntos === 1, 'cuántos puntos envió cada uno y el enlace general');
check(por('Daniel Rivas').director && !por('Pedro Gil').director && por('Pedro Gil').cargos[0] === 'Asociado – Jóvenes', 'cargos y si es director');
check(e.general.enlace.includes('?t=') && e.general.whatsapp.startsWith('https://wa.me/?text='), 'enlace general con su WhatsApp');

// Correos
let r = api.panelEnviarCorreos(['Daniel Rivas', 'Marta Ruiz']);
e = api.panelEnlaces();
check(r.enviados === 1 && r.errores.length === 1 && r.errores[0].includes('Marta Ruiz: Rebotado'), 'envía los correos e informa los que fallan');
check(/^Enviado/.test(por('Daniel Rivas').correoEstado) && por('Marta Ruiz').correoEstado === 'Pendiente', 'marca el correo como enviado');
check(api.__hojaEnlaces.veces >= 1, 'actualiza la pestaña Enlaces de la hoja');
falla(() => api.panelEnviarCorreos(['Pedro Gil']), 'revise su correo', 'no envía a quien no tiene un correo válido');
falla(() => api.panelEnviarCorreos(['Alguien de afuera']), 'revise su correo', 'no envía a personas fuera de Cargos');
falla(() => api.panelEnviarCorreos([]), 'Elija a quién', 'una lista vacía se rechaza');
falla(() => api.panelEnviarCorreos(['Daniel Rivas', 'Daniel Rivas', 'Daniel Rivas', 'Daniel Rivas']), 'solo permite enviar 3', 'respeta el límite diario de Google');

// Cambiar enlace
const antes = por('Ana Soto').enlace;
api.panelCambiarEnlace('Ana Soto');
e = api.panelEnlaces();
check(por('Ana Soto').enlace !== antes && por('Ana Soto').enlace.includes('?t='), 'cambiar el enlace crea uno nuevo');
const gAntes = e.general.enlace;
api.panelCambiarEnlace('GENERAL');
check(api.panelEnlaces().general.enlace !== gAntes, 'también se puede cambiar el enlace general');
falla(() => api.panelCambiarEnlace('Alguien de afuera'), 'no está en la pestaña Cargos', 'no crea enlaces para personas fuera de Cargos');

// Permisos
sesion.usuario = 'otro@ejemplo.org';
falla(() => api.panelEnlaces(), 'No tiene permiso', 'quien no edita la hoja no ve los enlaces');
falla(() => api.panelEnviarCorreos(['Daniel Rivas']), 'No tiene permiso', 'ni puede enviar correos');
falla(() => api.panelCambiarEnlace('Ana Soto'), 'No tiene permiso', 'ni cambiar enlaces');
sesion.usuario = 'admin@ejemplo.org';

// Junta cerrada
api.cerrarTodas_();
falla(() => api.panelCambiarEnlace('Ana Soto'), 'No hay una junta abierta', 'con la recepción cerrada no se cambian enlaces');

console.log(fails ? fails + ' FALLAS' : 'TODO OK');
process.exitCode = fails ? 1 : 0;
