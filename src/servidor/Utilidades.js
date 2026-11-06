function parseFecha_(texto) {
  var m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(String(texto));
  if (!m) return null;
  var d = Number(m[1]), mes = Number(m[2]), a = Number(m[3]);
  var fecha = new Date(a, mes - 1, d);
  if (fecha.getFullYear() !== a || fecha.getMonth() !== mes - 1 || fecha.getDate() !== d) return null;
  return { fecha: fecha, texto: ('0' + d).slice(-2) + '/' + ('0' + mes).slice(-2) + '/' + a };
}

function textoFecha_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  return String(v).trim();
}

/** Días de una actividad, contando el primero y el último. */
function diasEntre_(desde, hasta) {
  var a = String(desde).split('/'), b = String(hasta).split('/');
  if (a.length !== 3 || b.length !== 3) return '';
  return Math.round((Date.UTC(b[2], b[1] - 1, b[0]) - Date.UTC(a[2], a[1] - 1, a[0])) / 86400000) + 1;
}

function claveFecha_(ddmmaaaa) {
  var p = String(ddmmaaaa).split('/');
  return p.length === 3 ? p[2] + p[1] + p[0] : '';
}

function hoyClave_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');
}

function diaLegible_(fecha) {
  var dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
    'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return dias[fecha.getDay()] + ' ' + fecha.getDate() + ' de ' + meses[fecha.getMonth()] + ' de ' + fecha.getFullYear();
}

function normalizar_(texto) {
  return String(texto).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** "octubre 2026" a partir de una fecha. */
function mesAnio_(fecha) {
  var meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
    'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return meses[fecha.getMonth()] + ' ' + fecha.getFullYear();
}
