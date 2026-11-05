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
