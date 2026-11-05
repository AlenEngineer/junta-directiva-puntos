const fs = require('fs');
const code = fs.readFileSync(require('path').join(__dirname, '..', 'Codigo.gs'), 'utf8');
const { validarPunto, firmaValida_, parseFecha_, claveFecha_ } =
  new Function(code + '; return { validarPunto, firmaValida_, parseFecha_, claveFecha_ };')();
const opc = { general: false, departamentos: ['Escuela Sabática', 'Educación'] };
const base = { departamento: 'Escuela Sabática', categoria: 'Evangelismo y misión', titulo: 'Campaña',
  descripcion: 'Votar campaña', tiempo: '10 minutos' };
let fails = 0;
function t(nombre, d, o, esperaError) {
  const r = validarPunto(d, o || opc);
  const ok = esperaError ? (r.error || '').includes(esperaError) : !r.error;
  if (!ok) fails++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (r.error ? ' → ' + r.error : ''));
  return r;
}
let r = t('informativo simple', { ...base, tipo: 'Informativo', pideDinero: 'Sí', costo: '999' });
if (r.costo !== '' || r.pideDinero !== '') { fails++; console.log('FALLA informativo guardó presupuesto'); }
t('departamento ajeno', { ...base, departamento: 'Tesorería', tipo: 'Informativo' }, null, 'departamento');
t('categoría inventada', { ...base, categoria: 'X', tipo: 'Informativo' }, null, 'categoría');
t('tipo viejo rechazado', { ...base, tipo: 'Votación: decisión de la junta' }, null, 'votación o informativo');
t('votación sin actividad ni dinero', { ...base, tipo: 'Para votación', esActividad: 'No', pideDinero: 'No' });
t('votación falta actividad', { ...base, tipo: 'Para votación', pideDinero: 'No' }, null, 'actividad');
t('actividad sin lugar', { ...base, tipo: 'Para votación', esActividad: 'Sí', actFecha: '2027-03-20', actInicio: '15:00', responsable: 'Ana', pideDinero: 'No' }, null, 'lugar');
r = t('actividad completa', { ...base, tipo: 'Para votación', esActividad: 'Sí', actFecha: '2027-03-20', actInicio: '15:00', lugar: 'Templo', responsable: 'Ana', asistencia: '50', pideDinero: 'No' });
if (r.actFecha !== '20/03/2027') { fails++; console.log('FALLA formato fecha', r.actFecha); }
// Actividades de varios días
const act = { ...base, tipo: 'Para votación', esActividad: 'Sí', actFecha: '2027-03-20', actInicio: '09:00',
  lugar: 'Campamento', responsable: 'Ernesto', pideDinero: 'No' };
r = t('campamento de 3 días', { ...act, actFechaFin: '2027-03-22', actFin: '12:00' });
if (r.actFechaFin !== '22/03/2027') { fails++; console.log('FALLA fecha de término', r.actFechaFin); }
t('término antes del inicio', { ...act, actFechaFin: '2027-03-19' }, null, 'antes de la fecha de inicio');
r = t('término igual al inicio cuenta como un día', { ...act, actFechaFin: '2027-03-20', actFin: '12:00' });
if (r.actFechaFin !== '') { fails++; console.log('FALLA un día guardó fecha de término'); }
t('un día: hora de término antes del inicio', { ...act, actFin: '08:00' }, null, 'después de la hora de inicio');
t('varios días: hora de término menor está bien', { ...act, actFechaFin: '2027-03-22', actFin: '08:00' });
t('fecha de término inválida', { ...act, actFechaFin: '22/03/2027' }, null, 'no es válida');
const { diasEntre_, asegurarColumnas_ } =
  new Function(code + '; return { diasEntre_, asegurarColumnas_ };')();
console.log(diasEntre_('20/03/2027', '22/03/2027') === 3 && diasEntre_('28/02/2027', '01/03/2027') === 2 ?
  'OK    días entre fechas' : (fails++, 'FALLA días entre fechas'));
// Columnas: una hoja vieja sin la columna nueva la recibe al final, sin mover las demás.
const hoja = { enc: ['Fecha de envío', 'Junta', 'Hora de inicio'],
  getLastColumn() { return this.enc.length; },
  getRange(f, c, nf, nc) { const h = this; return {
    getValues: () => [h.enc.slice(c - 1, c - 1 + nc)],
    setValues(v) { v[0].forEach((x, i) => { h.enc[c - 1 + i] = x; }); return this; },
    setFontWeight() { return this; }, setBackground() { return this; } }; } };
const enc = asegurarColumnas_(hoja, ['Fecha de envío', 'Junta', 'Fecha de término de la actividad', 'Hora de inicio']);
console.log(JSON.stringify(enc) === JSON.stringify(['Fecha de envío', 'Junta', 'Hora de inicio', 'Fecha de término de la actividad']) ?
  'OK    columna nueva se agrega al final' : (fails++, 'FALLA columnas ' + JSON.stringify(enc)));

const dinero = { ...base, tipo: 'Para votación', esActividad: 'No', pideDinero: 'Sí' };
t('monto mayor que costo', { ...dinero, costo: '100', monto: '150', descCosto: 'x' }, null, 'mayor');
t('falta estrategia', { ...dinero, costo: '100', monto: '60', descCosto: 'x' }, null, 'resto');
t('sin explicación del costo', { ...dinero, costo: '100', monto: '100' }, null, 'Explique el costo');
t('solo con archivo', { ...dinero, costo: '100', monto: '100', archivo: { nombre: 'a.pdf', base64: 'x' } });
t('solo con enlace', { ...dinero, costo: '100,50', monto: '100.50', enlace: 'https://drive.google.com/x' });
t('enlace malo', { ...dinero, costo: '100', monto: '100', enlace: 'javascript:alert(1)' }, null, 'https');
t('costo con texto', { ...dinero, costo: '100 dólares', monto: '50', descCosto: 'x' }, null, 'costo total');
t('general sin nombre', { ...base, tipo: 'Informativo' }, { general: true, departamentos: [] }, 'nombre');
t('general con nombre', { ...base, nombre: 'María López', tipo: 'Informativo' }, { general: true, departamentos: [] });
// firmas de archivo
const pdf = [0x25,0x50,0x44,0x46,0x2d,0x31,0x2e,0x34,0,0,0,0];
const signed = pdf.map(b => b > 127 ? b - 256 : b);
console.log(firmaValida_(signed, 'pdf') && !firmaValida_(signed, 'png') ? 'OK    firmas de archivo' : (fails++, 'FALLA firmas'));
const png = [0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,0,0,0,0].map(b => b > 127 ? b - 256 : b);
console.log(firmaValida_(png, 'png') ? 'OK    firma png (bytes con signo)' : (fails++, 'FALLA png'));
console.log(parseFecha_('31/02/2027') === null && parseFecha_('5/3/2027').texto === '05/03/2027' &&
  claveFecha_('05/03/2027') === '20270305' ? 'OK    fechas' : (fails++, 'FALLA fechas'));
console.log(fails ? fails + ' FALLAS' : 'TODO OK'); process.exitCode = fails ? 1 : 0;
