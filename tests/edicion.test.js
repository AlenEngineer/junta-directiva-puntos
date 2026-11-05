// Pruebas de enviar y editar puntos con una hoja de cálculo simulada en memoria.
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, '..', 'Codigo.gs'), 'utf8');

// ---- Hoja de cálculo simulada (solo lo que usa el código) ----
class Hoja {
  constructor(nombre) { this.nombre = nombre; this.celdas = []; }
  getLastRow() { return this.celdas.length; }
  getLastColumn() { return Math.max(0, ...this.celdas.map(f => f.length)); }
  appendRow(fila) { this.celdas.push(fila.map(guardar)); }
  getDataRange() { return this.getRange(1, 1, this.getLastRow(), this.getLastColumn()); }
  getRange(fila, col, nf = 1, nc = 1) {
    const h = this;
    return {
      getValues: () => Array.from({ length: nf }, (_, i) =>
        Array.from({ length: nc }, (_, j) => ((h.celdas[fila - 1 + i] || [])[col - 1 + j] ?? ''))),
      setValues(v) {
        v.forEach((f, i) => f.forEach((x, j) => {
          const r = fila - 1 + i; while (h.celdas.length <= r) h.celdas.push([]);
          h.celdas[r][col - 1 + j] = guardar(x);
        }));
        return this;
      },
      setValue(x) { return this.setValues([[x]]); },
      setFontWeight() { return this; }, setBackground() { return this; }
    };
  }
  setFrozenRows() {}
}
// Como Sheets: un texto que empieza con ' se guarda sin el apóstrofo.
const guardar = (x) => (typeof x === 'string' && x[0] === "'" ? x.slice(1) : x);

const hojas = {};
const libro = {
  getSheetByName: (n) => hojas[n] || null,
  insertSheet: (n) => (hojas[n] = new Hoja(n))
};

const g = new Function(code + `;
  libro_ = function () { return __libro; };
  limitar_ = function () {};
  LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
  Session = { getScriptTimeZone: () => 'America/Panama' };
  Utilities = { getUuid: () => require('crypto').randomUUID(),
                formatDate: (d) => d.toISOString().slice(0, 10) };
  guardarArchivo_ = function (a) { return 'https://drive.google.com/archivo/' + a.nombre; };
  contexto_ = function (clave) { return __contextos[clave] || null; };
  return { enviarPunto, editarPunto, misPuntos, obtenerPunto, crearHoja_, COLS_PUNTOS };`
  .replace('require(', '__require('));
global.__libro = libro;
global.__require = require;
const junta = { fecha: '26/11/2026', dia: 'jueves 26 de noviembre de 2026' };
global.__contextos = {
  daniel: { clave: 'daniel', junta, general: false, nombre: 'Daniel Rivas',
    cargos: [{ departamento: 'Escuela Sabática', cargo: 'Director' }, { departamento: 'Ancianos', cargo: 'Anciano' }] },
  luis: { clave: 'luis', junta, general: false, nombre: 'Luis Rivas', cargos: [{ departamento: 'Comunicación', cargo: 'Director' }] },
  general: { clave: 'general', junta, general: true, nombre: '', cargos: [] },
  otraJunta: { clave: 'otraJunta', junta: { fecha: '10/12/2026', dia: '…' }, general: false, nombre: 'Daniel Rivas',
    cargos: [{ departamento: 'Escuela Sabática', cargo: 'Director' }] }
};
const api = g();
api.crearHoja_(libro, 'Puntos', api.COLS_PUNTOS, []);

let fails = 0;
const check = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fails++; };
const falla = (fn, texto, m) => { try { fn(); check(false, m); } catch (e) { check(e.message.includes(texto), m + ' → ' + e.message); } };
const filaDe = (id) => {
  const h = hojas.Puntos, enc = h.celdas[0];
  const f = h.celdas.find(r => r[enc.indexOf('ID')] === id);
  return Object.fromEntries(enc.map((c, j) => [c, f[j]]));
};

const base = { departamento: 'Escuela Sabática', categoria: 'Evangelismo y misión', titulo: 'Campaña de primavera',
  descripcion: 'Votar la campaña', tipo: 'Para votación', esActividad: 'Sí', actFecha: '2027-03-20', actInicio: '09:00',
  lugar: 'Templo', responsable: 'Daniel', pideDinero: 'Sí', costo: '500', monto: '500',
  archivo: { nombre: 'cotizacion.pdf', base64: 'x' }, material: { nombre: 'plan.pptx', base64: 'x' } };

// 1. Enviar
const r1 = api.enviarPunto('daniel', { ...base });
check(/^[0-9a-f]{32}$/.test(r1.id) && /^[0-9a-f]{32}$/.test(r1.codigo) && !r1.editado, 'enviar devuelve ID y código');
let f = filaDe(r1.id);
check(f['Enviado por'] === 'Daniel Rivas' && f['Ediciones'] === 0 && f['Estado'] === 'Recibido', 'la fila guarda quién lo envió');
check(f['Archivo de la cotización'].endsWith('cotizacion.pdf') && f['Material de apoyo (archivo)'].endsWith('plan.pptx'), 'guarda los archivos');

// 2. Mis puntos
api.enviarPunto('luis', { ...base, departamento: 'Comunicación', titulo: 'Punto de Luis' });
let lista = api.misPuntos('daniel');
check(lista.length === 1 && lista[0].titulo === 'Campaña de primavera', 'mis puntos: solo los propios');
check(api.misPuntos('general').length === 0, 'el enlace general no lista puntos');

// 3. Obtener para editar
const o = api.obtenerPunto('daniel', r1.id, '');
check(o.datos.actFecha === '2027-03-20' && o.datos.actInicio === '09:00' && o.datos.costo === '500', 'obtener devuelve los datos para el formulario');
check(o.datos.archivoActual === true && o.datos.materialActual === true && !('Código de edición' in o.datos), 'indica los archivos anteriores sin exponer el código');
falla(() => api.obtenerPunto('luis', r1.id, ''), 'No se encontró', 'otra persona no puede abrir el punto');
falla(() => api.obtenerPunto('otraJunta', r1.id, ''), 'No se encontró', 'no se puede editar un punto de otra junta');

// 4. Editar conservando archivos
const r2 = api.editarPunto('daniel', r1.id, '', { ...base, archivo: null, material: null,
  mantenerArchivo: true, mantenerMaterial: true, titulo: 'Campaña de primavera (corregida)', monto: '300', estrategia: 'Aportes' });
f = filaDe(r1.id);
check(r2.editado && f['Título'] === 'Campaña de primavera (corregida)' && f['Monto solicitado a la iglesia'] === 300, 'editar actualiza la misma fila');
check(f['Archivo de la cotización'].endsWith('cotizacion.pdf') && f['Material de apoyo (archivo)'].endsWith('plan.pptx'), 'conserva los archivos');
check(f['Ediciones'] === 1 && f['Última edición'] instanceof Date && f['ID'] === r1.id, 'cuenta la edición y conserva el ID');
check(hojas.Puntos.celdas.length === 3, 'no agrega filas nuevas al editar');
const hist = hojas.Historial;
const encH = hist.celdas[0];
check(hist.celdas.length === 2 && hist.celdas[1][encH.indexOf('Título')] === 'Campaña de primavera' &&
  hist.celdas[1][encH.indexOf('Fecha de la edición')] instanceof Date, 'el historial guarda la versión anterior');

// 5. Editar quitando el archivo de la cotización sin otra explicación
falla(() => api.editarPunto('daniel', r1.id, '', { ...base, archivo: null, mantenerArchivo: false }), 'Explique el costo',
  'quitar la cotización sin otra explicación se rechaza');
// Cambiar a informativo borra actividad y presupuesto
api.editarPunto('daniel', r1.id, '', { ...base, tipo: 'Informativo', archivo: null, material: null, mantenerMaterial: true });
f = filaDe(r1.id);
check(f['Tipo'] === 'Informativo' && f['Costo total'] === '' && f['Archivo de la cotización'] === '' &&
  f['Material de apoyo (archivo)'].endsWith('plan.pptx') && f['Ediciones'] === 2, 'pasar a informativo quita actividad y presupuesto');
check(hist.celdas.length === 3, 'cada edición queda en el historial');

// 6. Enlace general: solo con el código de edición
const rg = api.enviarPunto('general', { ...base, nombre: 'María Torres', tipo: 'Informativo' });
check(filaDe(rg.id)['Estado'] === 'Por revisar', 'el punto del enlace general llega por revisar');
falla(() => api.obtenerPunto('general', rg.id, ''), 'No se encontró', 'general sin código no puede abrir el punto');
falla(() => api.obtenerPunto('general', rg.id, 'f'.repeat(32)), 'No se encontró', 'general con código equivocado no puede');
falla(() => api.obtenerPunto('daniel', rg.id, ''), 'No se encontró', 'una persona no puede abrir un punto del enlace general');
// La secretaría lo aprueba; al editarlo vuelve a revisión
const h = hojas.Puntos, iEstado = h.celdas[0].indexOf('Estado');
h.celdas.find(r => r[h.celdas[0].indexOf('ID')] === rg.id)[iEstado] = 'Aprobado';
api.editarPunto('general', rg.id, rg.codigo, { ...base, nombre: 'María Torres', tipo: 'Informativo', titulo: 'Corregido' });
check(filaDe(rg.id)['Estado'] === 'Por revisar' && filaDe(rg.id)['Título'] === 'Corregido', 'general editado vuelve a "Por revisar"');
// Un punto personal conserva su estado al editarlo
h.celdas.find(r => r[h.celdas[0].indexOf('ID')] === r1.id)[iEstado] = 'Aprobado';
api.editarPunto('daniel', r1.id, '', { ...base, tipo: 'Informativo', archivo: null, material: null });
check(filaDe(r1.id)['Estado'] === 'Aprobado', 'un punto personal conserva su estado');

// 7. ID inválido
falla(() => api.editarPunto('daniel', 'abc', '', { ...base }), 'No se encontró', 'un ID inválido se rechaza');

// 8. Compatibilidad: puntos enviados con una versión anterior (sin ID ni columnas nuevas)
delete hojas.Puntos; delete hojas.Historial;
const p0 = api.crearHoja_(libro, 'Puntos', api.COLS_PUNTOS, []);
const viejo = (presenta, depto, junta, titulo) => { const enc = p0.celdas[0];
  const v = { 'Fecha de envío': new Date(), 'Junta': junta, 'Presenta': presenta, 'Departamento': depto, 'Estado': 'Recibido',
    'Categoría': 'Asuntos generales', 'Título': titulo, 'Descripción y propuesta': 'x', 'Tipo': 'Informativo' };
  p0.appendRow(enc.map(c => v[c] ?? '')); };
viejo('Daniel Rivas', 'Ancianos', '26/11/2026', 'Punto antiguo de Daniel');
viejo('María Torres', 'Miembro de la iglesia', '26/11/2026', 'Punto antiguo general');
viejo('Daniel Rivas', 'Ancianos', '12/11/2026', 'Punto de una junta pasada');
lista = api.misPuntos('daniel');
check(lista.length === 1 && lista[0].titulo === 'Punto antiguo de Daniel', 'compatibilidad: un punto anterior aparece en mis puntos');
const idViejo = lista[0].id;
const ed = api.editarPunto('daniel', idViejo, '', { ...base, departamento: 'Ancianos', tipo: 'Informativo', titulo: 'Punto antiguo corregido' });
check(ed.editado && filaDe(idViejo)['Título'] === 'Punto antiguo corregido' && filaDe(idViejo)['Ediciones'] === 1,
  'compatibilidad: un punto anterior se puede editar');
const enc0 = p0.celdas[0];
const general0 = p0.celdas.find(r => r[enc0.indexOf('Título')] === 'Punto antiguo general');
check(general0[enc0.indexOf('Enviado por')] === 'GENERAL' && !general0[enc0.indexOf('Código de edición')],
  'compatibilidad: un punto anterior del enlace general queda sin código (no editable)');
falla(() => api.obtenerPunto('general', general0[enc0.indexOf('ID')], ''), 'No se encontró', 'compatibilidad: nadie edita el punto general anterior');
const pasado = p0.celdas.find(r => r[enc0.indexOf('Título')] === 'Punto de una junta pasada');
check(!pasado[enc0.indexOf('ID')], 'compatibilidad: los puntos de juntas pasadas no se tocan');
check(p0.celdas.length === 4, 'compatibilidad: no se agregan filas');

console.log(fails ? fails + ' FALLAS' : 'TODO OK');
process.exitCode = fails ? 1 : 0;
