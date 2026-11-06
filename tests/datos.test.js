// Pruebas de la capa de datos: juntas, claves (enlaces) y validación de enlaces, con la hoja simulada.
const { cargarServidor } = require('./hoja-simulada');
const { api, hojas, libro } = cargarServidor(
  ['crearHoja_', 'juntasLeer_', 'juntaActual_', 'juntaAgregar_', 'cerrarTodas_', 'clavesReemplazarTodas_',
   'claveBuscar_', 'claveCambiar_', 'leerClaves_', 'claveMarcarCorreo_', 'contexto_', 'tablaLeer_', 'GENERAL', 'COLS_CLAVES'],
  // La "fecha de hoy" queda fija para que las juntas de prueba no venzan.
  "hoyClave_ = function () { return '20261101'; };");

let fails = 0;
const check = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fails++; };

api.crearHoja_(libro, 'Juntas', ['Fecha', 'Día', 'Estado'], []);
api.crearHoja_(libro, '_Claves', api.COLS_CLAVES, []);
api.crearHoja_(libro, 'Cargos', ['Departamento', 'Nombre', 'Cargo', '¿Es director?'], [
  ['Escuela Sabática', 'Daniel Rivas', 'Director', 'Sí'],
  ['Ancianos', 'Daniel Rivas', 'Anciano', 'No'],
  ['Comunicación', 'Luis Rivas', 'Director', 'Sí']
]);
api.crearHoja_(libro, 'Puntos', ['Fecha de envío'], []);

// Juntas
check(api.juntaActual_() === null, 'sin juntas no hay junta abierta');
api.juntaAgregar_('12/11/2026', 'jueves 12 de noviembre de 2026');
api.cerrarTodas_();
api.juntaAgregar_('26/11/2026', 'jueves 26 de noviembre de 2026');
const j = api.juntaActual_();
check(j && j.fecha === '26/11/2026' && j.dia.startsWith('jueves 26'), 'la junta abierta es la última');
check(api.juntasLeer_().map(x => x.estado).join(',') === 'Cerrada,Abierta', 'cerrar deja solo una abierta');
check(hojas.Juntas.celdas[2][0] === '26/11/2026', 'la fecha se guarda como texto (sin convertirse)');

// Claves
api.clavesReemplazarTodas_('26/11/2026', ['Daniel Rivas', 'Luis Rivas', api.GENERAL]);
let claves = api.leerClaves_(j);
check(Object.keys(claves).length === 3 && /^[0-9a-f]{32}$/.test(claves['Daniel Rivas'].clave), 'una clave por persona y la general');
const claveDaniel = claves['Daniel Rivas'].clave;
check(api.claveBuscar_(claveDaniel).persona === 'Daniel Rivas', 'buscar una clave');

// contexto_: valida el enlace
let ctx = api.contexto_(claveDaniel);
check(ctx && ctx.nombre === 'Daniel Rivas' && ctx.cargos.length === 2 && ctx.cargos[0].departamento === 'Escuela Sabática',
  'un enlace personal válido trae a la persona y sus cargos (director primero)');
check(api.contexto_(claves[api.GENERAL].clave).general === true, 'el enlace general');
check(api.contexto_('f'.repeat(32)) === null && api.contexto_('no-es-clave') === null, 'una clave inventada no sirve');

// Cambiar el enlace de una persona
api.claveCambiar_('26/11/2026', 'Daniel Rivas');
claves = api.leerClaves_(j);
check(claves['Daniel Rivas'].clave !== claveDaniel && api.contexto_(claveDaniel) === null, 'al cambiar el enlace, el anterior deja de servir');
check(api.contexto_(claves['Daniel Rivas'].clave).nombre === 'Daniel Rivas', 'el enlace nuevo funciona');
check(api.tablaLeer_('_Claves').length === 3, 'cambiar el enlace no agrega filas');

// Correo enviado
api.claveMarcarCorreo_(claves['Luis Rivas'].fila);
check(api.leerClaves_(j)['Luis Rivas'].enviado !== '' && api.leerClaves_(j)['Daniel Rivas'].enviado === '', 'marca el correo enviado');

// Una junta nueva reemplaza todas las claves
api.cerrarTodas_();
api.juntaAgregar_('10/12/2026', 'jueves 10 de diciembre de 2026');
api.clavesReemplazarTodas_('10/12/2026', ['Daniel Rivas', api.GENERAL]);
check(api.tablaLeer_('_Claves').filter(c => c['Clave']).length === 2, 'una junta nueva reemplaza las claves');
check(api.contexto_(claves['Luis Rivas'].clave) === null, 'los enlaces de la junta anterior dejan de servir');

// Una persona que ya no está en Cargos no puede usar su enlace
const k = api.leerClaves_(api.juntaActual_())['Daniel Rivas'].clave;
hojas.Cargos.celdas = hojas.Cargos.celdas.filter(f => f[1] !== 'Daniel Rivas');
check(api.contexto_(k) === null, 'quien sale de Cargos pierde el acceso');

console.log(fails ? fails + ' FALLAS' : 'TODO OK');
process.exitCode = fails ? 1 : 0;
