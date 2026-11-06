// Pruebas de seguridad y del servidor del panel, con la hoja simulada.
const { cargarServidor } = require('./hoja-simulada');
const funcionesMenu = ['acercaDe', 'actualizarEnlaces', 'cambiarCodigoPais', 'cambiarContactoAyuda', 'cambiarEnlace', 'cambiarUrl',
  'cerrarRecepcion', 'configurar', 'enviarCorreos', 'generarAgenda', 'importarContactos', 'nuevaJunta', 'abrirPanel', 'cambiarUrlPanel'];
const { api, hojas, libro, sesion } = cargarServidor(
  ['usuarioAdmin_', 'panelDatos', 'panelPuntos', 'panelCambiarEstado', 'enviarPunto', 'crearHoja_', 'juntaAgregar_', 'COLS_PUNTOS',
   'panelPagina_'].concat(funcionesMenu),
  `contexto_ = function () { return { clave: 'x', junta: { fecha: '26/11/2026', dia: 'jueves 26' }, general: false,
     nombre: 'Daniel Rivas', cargos: [{ departamento: 'Ancianos', cargo: 'Anciano' }] }; };
   HtmlService = { createTemplateFromFile: () => { const t = { evaluate: () => ({ setTitle() { return this; }, addMetaTag() { return this; }, datos: t.datosJson }) }; return t; } };`);

let fails = 0;
const check = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fails++; };
const rechaza = (fn, m) => { try { fn(); check(false, m); } catch (e) { check(/No tiene permiso/.test(e.message), m); } };

api.crearHoja_(libro, 'Juntas', ['Fecha', 'Día', 'Estado'], []);
api.crearHoja_(libro, 'Puntos', api.COLS_PUNTOS, []);
api.crearHoja_(libro, '_Claves', ['Clave', 'Junta', 'Persona', 'Correo enviado'], []);
api.juntaAgregar_('26/11/2026', 'jueves 26 de noviembre de 2026');

// Quién es administrador
check(api.usuarioAdmin_() === 'admin@ejemplo.org', 'la dueña de la hoja es administradora');
sesion.usuario = 'SECRETARIA@ejemplo.org';
check(api.usuarioAdmin_() === 'secretaria@ejemplo.org', 'una editora de la hoja también (sin importar mayúsculas)');
sesion.usuario = 'alguien@otro.com';
check(api.usuarioAdmin_() === null, 'alguien sin acceso a la hoja no lo es');
sesion.usuario = '';
check(api.usuarioAdmin_() === null, 'la página pública (sin inicio de sesión) no lo es');

// Desde la página pública, ninguna función de administración se puede ejecutar
funcionesMenu.forEach((f) => rechaza(() => api[f](), 'sin sesión se rechaza ' + f + '()'));
rechaza(() => api.panelDatos(), 'sin sesión se rechaza panelDatos()');
rechaza(() => api.panelPuntos('26/11/2026'), 'sin sesión se rechaza panelPuntos()');
sesion.usuario = 'alguien@otro.com';
rechaza(() => api.panelCambiarEstado('a'.repeat(32), 'Aprobado'), 'alguien sin acceso no puede aprobar puntos');

// La página del panel solo entrega datos a quien tiene permiso
const pag = (u) => { sesion.usuario = u; return JSON.parse(api.panelPagina_().datos); };
check(pag('') === null && pag('alguien@otro.com') === null, 'la página del panel no entrega datos sin permiso');
check(pag('admin@ejemplo.org').usuario === 'admin@ejemplo.org', 'con permiso, la página del panel abre');

// Panel: datos, puntos y cambio de estado
sesion.usuario = 'admin@ejemplo.org';
const d = api.panelDatos();
check(d.juntas.length === 1 && d.seleccionada === '26/11/2026' && d.estados.includes('Aprobado') && d.moneda === 'B/.',
  'panelDatos trae juntas, estados y moneda');
const base = { departamento: 'Ancianos', categoria: 'Otros asuntos', titulo: 'Punto de prueba', descripcion: 'x', tipo: 'Para votación',
  esActividad: 'Sí', actFecha: '2027-03-20', actInicio: '09:00', lugar: 'Templo', responsable: 'Daniel', pideDinero: 'Sí',
  costo: '100', monto: '80', estrategia: 'Aportes', descCosto: 'Sillas', materialEnlace: 'https://youtu.be/x' };
const r = api.enviarPunto('x', base);
const lista = api.panelPuntos('26/11/2026');
check(lista.length === 1 && lista[0].id === r.id && lista[0].estado === 'Recibido' && lista[0].dinero.monto === 80 &&
  lista[0].actividad.inicio === '20/03/2026'.replace('2026', '2027') && lista[0].material.enlace === 'https://youtu.be/x',
  'panelPuntos trae el punto con su detalle');
check(!JSON.stringify(lista).includes('Código de edición') && !('codigo' in lista[0]), 'el panel no expone códigos de edición');
check(api.panelPuntos('01/01/2020').length === 0, 'otra junta no trae puntos');
api.panelCambiarEstado(r.id, 'Aprobado');
check(api.panelPuntos('26/11/2026')[0].estado === 'Aprobado', 'aprobar cambia el estado en la hoja');
try { api.panelCambiarEstado(r.id, 'Borrado'); check(false, 'estado inventado'); } catch (e) { check(/Estado no válido/.test(e.message), 'un estado inventado se rechaza'); }
try { api.panelCambiarEstado('abc', 'Aprobado'); check(false, 'id inválido'); } catch (e) { check(/no válido/.test(e.message), 'un ID inválido se rechaza'); }

// Toda función pública (que la página puede llamar) debe empezar con exigirAdmin_(),
// salvo las que son de la página pública a propósito y validan la clave del enlace.
const codigo = require('fs').readFileSync(require('path').join(__dirname, '..', 'dist', 'Codigo.gs'), 'utf8');
const PUBLICAS = ['doGet', 'onOpen', 'enviarPunto', 'editarPunto', 'misPuntos', 'obtenerPunto', 'validarPunto'];
const sinProteger = [];
const re = /^function ([A-Za-z0-9]+[^_\W])\(([^)]*)\) \{\n([^\n]*)/gm;
let m, total = 0;
while ((m = re.exec(codigo))) {
  if (PUBLICAS.includes(m[1])) continue;
  total++;
  if (!/^\s*(var \w+ = )?exigirAdmin_\(\);/.test(m[3])) sinProteger.push(m[1]);
}
check(total >= 17 && sinProteger.length === 0, 'todas las funciones de administración (' + total + ') empiezan con exigirAdmin_()' +
  (sinProteger.length ? ' — faltan: ' + sinProteger.join(', ') : ''));

console.log(fails ? fails + ' FALLAS' : 'TODO OK');
process.exitCode = fails ? 1 : 0;
