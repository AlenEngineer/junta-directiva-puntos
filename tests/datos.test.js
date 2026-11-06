// Pruebas de la capa de datos: juntas, claves (enlaces) y validación de enlaces, con la hoja simulada.
const { cargarServidor } = require('./hoja-simulada');
const { api, hojas, libro } = cargarServidor(
  ['crearHoja_', 'juntasLeer_', 'juntaActual_', 'juntaAgregar_', 'cerrarTodas_', 'clavesReemplazarTodas_',
   'claveBuscar_', 'claveCambiar_', 'leerClaves_', 'claveMarcarCorreo_', 'contexto_', 'tablaLeer_', 'GENERAL', 'COLS_CLAVES',
   'saldosLeer_', 'publico_', 'COLS_SALDOS'],
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

// Saldos de tesorería (montos inventados)
check(hojas.Saldos && hojas.Saldos.celdas.length === 1, 'la migración ya creó la pestaña Saldos, vacía');
check(api.saldosLeer_().fondos.length === 0, 'con la pestaña vacía no hay saldos (y no falla)');
const filasSaldos = [
  // Encabezados repetidos, como quedan al importar un archivo debajo de los existentes: deben ignorarse.
  api.COLS_SALDOS.slice(),
  ['FONDO DE PRUEBA A', 'B/.10.00', 'B/.1.50', 'B/.0.50', 'B/.2.00', '0.00', '0.00', 'B/.10.00', 'Escuela Sabática', 'octubre 2026'],
  ['FONDO DE PRUEBA B', 'B/.1,000.25', 'B/.0.00', 'B/.0.00', 'B/.0.00', '30.00', '10.00', 'B/.1,020.25', 'Ancianos, Comunicación', ''],
  ['OTRO GASTO', 'B/.5.00', 'B/.0.00', 'B/.0.00', 'B/.0.00', '0.00', '0.00', 'B/.5.00', '', ''],
  ['TOTALES:', 'B/.1,015.25', '', '', '', '', '', 'B/.1,035.25', '', '']
];
hojas.Saldos.getRange(2, 1, filasSaldos.length, 10).setValues(filasSaldos);
const s = api.saldosLeer_();
check(s.periodo === 'octubre 2026' && s.fondos.length === 3, 'lee el periodo y los fondos, sin totales ni encabezados repetidos');
// Sheets convierte "octubre 2026" en fecha: debe mostrarse igual
hojas.Saldos.getRange(3, 10).setValue(new Date(2026, 9, 1));
check(api.saldosLeer_().periodo === 'octubre 2026', 'un periodo convertido en fecha se muestra como "octubre 2026"');
hojas.Saldos.getRange(3, 10).setValue('octubre 2026');
const b = s.fondos[1];
check(b.saldoAnterior === 1000.25 && b.saldo === 1020.25 && b.transferencias === 20 && b.departamentos.join('|') === 'Ancianos|Comunicación',
  'entiende "B/." y comas, y una fila con dos departamentos');
check(s.fondos[0].ingresos === 2, 'suma ingresos por ofrenda y directos');
// Lo que recibe cada persona en la página
const cargosDaniel = [{ departamento: 'Escuela Sabática', cargo: 'Director' }, { departamento: 'Ancianos', cargo: 'Anciano' }];
const pub = api.publico_({ clave: 'x', junta: { dia: '…' }, general: false, nombre: 'Daniel Rivas', cargos: cargosDaniel });
check(JSON.stringify(pub.categorias) === JSON.stringify(['Evangelismo y misión', 'Planes y actividades del departamento', 'Otros asuntos']),
  'categorías comunes para la página');
check(pub.categoriasPorDepartamento['Ancianos'].includes('Feligresía (traslados, recepción de miembros)') &&
  !pub.categoriasPorDepartamento['Escuela Sabática'].includes('Feligresía (traslados, recepción de miembros)') &&
  !pub.categoriasPorDepartamento['Ancianos'].includes('Tesorería y finanzas'), 'categorías por departamento');
check(pub.saldos && pub.saldos.moneda === 'B/.' && Object.keys(pub.saldos.porDepartamento).sort().join('|') === 'Ancianos|Escuela Sabática',
  'una persona recibe los saldos de sus departamentos');
check(!JSON.stringify(pub.saldos).includes('OTRO GASTO') && !('departamentos' in pub.saldos.porDepartamento['Ancianos'][0]),
  'no recibe fondos de otros departamentos ni datos internos');
const pubLuis = api.publico_({ clave: 'x', junta: { dia: '…' }, general: false, nombre: 'Luis Rivas',
  cargos: [{ departamento: 'Comunicación', cargo: 'Director' }] });
check(pubLuis.saldos.porDepartamento['Comunicación'][0].fondo === 'FONDO DE PRUEBA B', 'una fila compartida aparece en ambos departamentos');
check(api.publico_({ clave: 'x', junta: { dia: '…' }, general: true, nombre: '', cargos: [] }).saldos === null, 'el enlace general no recibe saldos');
check(api.publico_({ clave: 'x', junta: { dia: '…' }, general: false, nombre: 'Ana', cargos: [{ departamento: 'Secretaría', cargo: 'Secretaria' }] }).saldos === null,
  'un departamento sin fondo no recibe nada');

console.log(fails ? fails + ' FALLAS' : 'TODO OK');
process.exitCode = fails ? 1 : 0;
