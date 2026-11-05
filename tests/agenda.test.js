// Prueba de la agenda: genera una agenda con datos de ejemplo y revisa su contenido.
const { cargarServidor } = require('./hoja-simulada');
// Una hoja de salida que acepta cualquier formato (merge, colores…) y guarda los valores.
const salida = { valores: [] };
const cadena = new Proxy({}, { get: (_, k) => k === 'setValues' ? (v) => { salida.valores.push(...v); return cadena; }
  : k === 'setValue' ? (v) => { salida.valores.push([v]); return cadena; } : () => cadena });
const { api, libro } = cargarServidor(['generarAgenda', 'crearHoja_', 'enviarPunto', 'COLS_PUNTOS'], `
  contexto_ = function () { return { clave: 'x', junta: { fecha: '26/11/2026', dia: 'jueves 26' }, general: false,
    nombre: 'Daniel Rivas', cargos: [{ departamento: 'Ancianos', cargo: 'Anciano' }] }; };
  SpreadsheetApp = { getUi: () => ({ prompt: () => ({ getSelectedButton: () => 'OK', getResponseText: () => '' }),
    Button: { OK: 'OK' }, ButtonSet: {}, alert: (m) => { __alertas.push(m); } }) };
`);
global.__alertas = [];
const insertar = libro.insertSheet;
libro.insertSheet = (n) => n.startsWith('Agenda') ? cadena : insertar(n);
libro.setActiveSheet = () => {}; libro.deleteSheet = () => {};
api.crearHoja_(libro, 'Juntas', ['Fecha', 'Día', 'Estado'], [["'26/11/2026", 'jueves 26 de noviembre de 2026', 'Abierta']]);
api.crearHoja_(libro, 'Puntos', api.COLS_PUNTOS, []);
const base = { departamento: 'Ancianos', categoria: 'Tesorería y finanzas', titulo: 'Compra de sillas', descripcion: 'Votar compra',
  tipo: 'Para votación', esActividad: 'Sí', actFecha: '2027-03-20', actFechaFin: '2027-03-22', actInicio: '09:00', actFin: '12:00',
  lugar: 'Templo', responsable: 'Daniel', pideDinero: 'Sí', costo: '500', monto: '300', estrategia: 'Aportes', descCosto: 'Sillas',
  materialEnlace: 'https://youtu.be/x' };
api.enviarPunto('x', base);
api.enviarPunto('x', { ...base, categoria: 'Evangelismo y misión', titulo: 'Campaña', tipo: 'Informativo' });
api.generarAgenda();
const texto = salida.valores.map(f => f.join(' | ')).join('\n');
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fails++; };
ok(texto.indexOf('EVANGELISMO Y MISIÓN') < texto.indexOf('Campaña') && texto.indexOf('Campaña') < texto.indexOf('TESORERÍA'), 'evangelismo primero, con su punto');
ok(texto.includes('Fechas: del 20/03/2027 al 22/03/2027 (3 días)') && texto.includes('Término: 12:00 (último día)'), 'actividad de varios días');
ok(texto.includes('Solicitado a la iglesia: 300') && texto.includes('Total solicitado a la iglesia: 300'), 'presupuesto y total');
ok(texto.includes('Material (enlace): https://youtu.be/x'), 'material de apoyo');
ok(texto.includes('Daniel Rivas\n(Ancianos)'), 'quién presenta y su departamento');
ok(__alertas[0] && __alertas[0].startsWith('Agenda lista: 2 punto(s)'), 'aviso final: ' + __alertas[0]);

console.log(fails ? fails + ' FALLAS' : 'TODO OK');
process.exitCode = fails ? 1 : 0;
