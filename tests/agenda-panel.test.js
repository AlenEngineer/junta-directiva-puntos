// Pruebas del servidor para la agenda del panel: orden, tiempos, validaciones y edición.
const { cargarServidor } = require('./hoja-simulada');
const { api, libro, sesion } = cargarServidor(
  ['panelAgenda', 'panelGuardarAgenda', 'enviarPunto', 'editarPunto', 'panelCambiarEstado', 'crearHoja_', 'juntaAgregar_', 'COLS_PUNTOS'],
  `contexto_ = function (clave) { return { clave: clave, junta: { fecha: clave === 'otra' ? '10/12/2026' : '26/11/2026', dia: '…' },
     general: false, nombre: 'Daniel Rivas', cargos: [{ departamento: 'Ancianos', cargo: 'Anciano' }] }; };`);

let fails = 0;
const check = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fails++; };
const falla = (fn, texto, m) => { try { fn(); check(false, m); } catch (e) { check(e.message.includes(texto), m + ' → ' + e.message); } };

api.crearHoja_(libro, 'Juntas', ['Fecha', 'Día', 'Estado'], []);
api.crearHoja_(libro, 'Puntos', api.COLS_PUNTOS, []);
api.juntaAgregar_('26/11/2026', 'jueves 26 de noviembre de 2026');
api.juntaAgregar_('10/12/2026', 'jueves 10 de diciembre de 2026');

const base = { departamento: 'Ancianos', categoria: 'Planes y actividades del departamento', descripcion: 'x', tipo: 'Informativo' };
const a = api.enviarPunto('x', { ...base, titulo: 'A' });
const b = api.enviarPunto('x', { ...base, titulo: 'B' });
const c = api.enviarPunto('x', { ...base, titulo: 'C' });
const e = api.enviarPunto('x', { ...base, titulo: 'Evangelismo', categoria: 'Evangelismo y misión' });
const otra = api.enviarPunto('otra', { ...base, titulo: 'De otra junta' });

let ag = api.panelAgenda('26/11/2026');
const titulos = (cat) => ag.secciones.find((s) => s.categoria === cat).puntos.map((p) => p.titulo).join(',');
check(ag.secciones.length === 5 && ag.secciones[0].categoria === 'Evangelismo y misión' && titulos('Evangelismo y misión') === 'Evangelismo',
  'agenda con las 5 secciones, evangelismo primero');
check(titulos('Planes y actividades del departamento') === 'A,B,C', 'sin orden asignado: por fecha de envío');
check(ag.fijos.apertura.startsWith('Devocional') && ag.tiempos.includes(15), 'trae los momentos fijos y los tiempos posibles');

// Reordenar y asignar tiempos
api.panelGuardarAgenda('26/11/2026', [{ id: c.id, orden: 1, minutos: 15 }, { id: a.id, orden: 2, minutos: 0 }, { id: b.id, orden: 3, minutos: 10 }]);
ag = api.panelAgenda('26/11/2026');
const plan = ag.secciones.find((s) => s.categoria === 'Planes y actividades del departamento').puntos;
check(titulos('Planes y actividades del departamento') === 'C,A,B' && plan[0].minutos === 15 && plan[1].minutos === 0 && plan[2].minutos === 10,
  'guarda el orden y los tiempos');

// Validaciones
falla(() => api.panelGuardarAgenda('26/11/2026', [{ id: otra.id, orden: 1, minutos: 5 }]), 'no pertenece', 'no acepta puntos de otra junta');
falla(() => api.panelGuardarAgenda('26/11/2026', [{ id: a.id, orden: 1, minutos: 7 }]), 'Tiempo no válido', 'no acepta tiempos fuera de la lista');
falla(() => api.panelGuardarAgenda('26/11/2026', [{ id: a.id, orden: -1, minutos: 5 }]), 'Orden no válido', 'no acepta un orden negativo');
falla(() => api.panelGuardarAgenda('01/01/2020', []), 'No se encontró esa junta', 'una junta inexistente se rechaza');
sesion.usuario = '';
falla(() => api.panelAgenda('26/11/2026'), 'No tiene permiso', 'sin sesión no se puede ver la agenda');
falla(() => api.panelGuardarAgenda('26/11/2026', []), 'No tiene permiso', 'sin sesión no se puede cambiar la agenda');
sesion.usuario = 'admin@ejemplo.org';

// Editar un punto conserva su orden y su tiempo
api.editarPunto('x', c.id, '', { ...base, titulo: 'C corregido' });
ag = api.panelAgenda('26/11/2026');
const c2 = ag.secciones.find((s) => s.categoria === 'Planes y actividades del departamento').puntos[0];
check(c2.titulo === 'C corregido' && c2.minutos === 15, 'editar un punto no borra su orden ni su tiempo en la agenda');

// Por revisar y rechazados
api.panelCambiarEstado(b.id, 'Por revisar');
api.panelCambiarEstado(a.id, 'Rechazado');
ag = api.panelAgenda('26/11/2026');
check(titulos('Planes y actividades del departamento') === 'C corregido' && ag.pendientes.map((p) => p.titulo).join() === 'B',
  'los "Por revisar" van aparte y los rechazados no aparecen');

console.log(fails ? fails + ' FALLAS' : 'TODO OK');
process.exitCode = fails ? 1 : 0;
