// =====================================================================
// CAPA DE DATOS
//
// Es la ÚNICA parte del código que lee o escribe las pestañas de datos:
// Puntos, Juntas, _Claves, Cargos, Contactos e Historial.
// El resto del código trabaja con objetos y no sabe que detrás hay una hoja.
// Si algún día se cambia Google Sheets por otra base de datos, se reescribe
// solo este archivo (ver ARQUITECTURA.md).
//
// Las pestañas que son "vistas" para leer (Enlaces y las Agendas) se
// generan en su propio módulo.
// =====================================================================

function libro_() {
  var id = PropertiesService.getScriptProperties().getProperty('HOJA_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActive();
}

function hoja_(nombre) {
  var h = libro_().getSheetByName(nombre);
  if (!h) throw new Error('Falta la pestaña "' + nombre + '". Use Junta → Configuración inicial.');
  return h;
}

function crearHoja_(ss, nombre, encabezado, filas) {
  var h = ss.getSheetByName(nombre);
  if (h) return h;
  h = ss.insertSheet(nombre);
  h.getRange(1, 1, 1, encabezado.length).setValues([encabezado])
    .setFontWeight('bold').setBackground('#ede7f6');
  if (filas.length) h.getRange(2, 1, filas.length, encabezado.length).setValues(filas);
  h.setFrozenRows(1);
  return h;
}

/** Agrega al final de la hoja las columnas que falten. Devuelve el encabezado completo. */
function asegurarColumnas_(h, columnas) {
  var enc = h.getRange(1, 1, 1, Math.max(h.getLastColumn(), 1)).getValues()[0]
    .map(function (c) { return String(c); });
  var faltan = columnas.filter(function (c) { return enc.indexOf(c) < 0; });
  if (faltan.length) {
    var desde = enc.filter(String).length ? enc.length + 1 : 1;
    h.getRange(1, desde, 1, faltan.length).setValues([faltan])
      .setFontWeight('bold').setBackground('#ede7f6');
    enc = (desde === 1 ? [] : enc).concat(faltan);
  }
  return enc;
}

/** Evita que un texto se interprete como fórmula o se convierta solo en fecha. */
function celdaSegura_(v) {
  if (typeof v === 'string' && v !== '') return "'" + v;
  return v;
}

function nuevaClave_() {
  return Utilities.getUuid().replace(/-/g, '');
}

/** Bloqueo para que dos personas no escriban la misma pestaña a la vez. */
function conBloqueo_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------
// Tablas: una pestaña leída y escrita por nombre de columna
// ---------------------------------------------------------------------

/** Lee una pestaña como objetos { columna: valor, _fila: número de fila }. */
function tablaLeer_(nombre) {
  var datos = hoja_(nombre).getDataRange().getValues();
  var enc = (datos[0] || []).map(String);
  return datos.slice(1).map(function (f, i) {
    var o = { _fila: i + 2 };
    enc.forEach(function (col, j) { if (col) o[col] = f[j]; });
    return o;
  });
}

/** Convierte un objeto en una fila según el encabezado (agrega las columnas que falten). */
function tablaFila_(h, columnas, obj) {
  var enc = asegurarColumnas_(h, columnas);
  return { enc: enc, fila: enc.map(function (col) { return col in obj ? celdaSegura_(obj[col]) : ''; }) };
}

function tablaAgregar_(nombre, columnas, obj) {
  var h = hoja_(nombre);
  h.appendRow(tablaFila_(h, columnas, obj).fila);
}

/** Reescribe una fila completa. Las columnas que el objeto no trae quedan vacías. */
function tablaReemplazar_(nombre, columnas, fila, obj) {
  var h = hoja_(nombre);
  var r = tablaFila_(h, columnas, obj);
  h.getRange(fila, 1, 1, r.enc.length).setValues([r.fila]);
}

/** Cambia una sola celda, buscando la columna por su nombre. */
function tablaCelda_(nombre, columnas, fila, columna, valor) {
  var h = hoja_(nombre);
  var enc = asegurarColumnas_(h, columnas);
  h.getRange(fila, enc.indexOf(columna) + 1).setValue(celdaSegura_(valor));
}

// ---------------------------------------------------------------------
// Puntos e Historial
// ---------------------------------------------------------------------

function columnasPuntos_() { return COLS_PUNTOS.concat(COLS_CONTROL); }

/** Todos los puntos, como objetos por nombre de columna. */
function puntosLeer_() {
  return tablaLeer_(HOJA_PUNTOS);
}

function puntoPorId_(id) {
  if (!id) return null;
  return puntosLeer_().filter(function (p) { return p['ID'] === id; })[0] || null;
}

function puntoAgregar_(obj) {
  conBloqueo_(function () { tablaAgregar_(HOJA_PUNTOS, columnasPuntos_(), obj); });
}

/** Reemplaza un punto por su ID y guarda la versión anterior en el Historial. */
function puntoReemplazar_(id, obj) {
  conBloqueo_(function () {
    var anterior = puntoPorId_(id); // se vuelve a buscar dentro del bloqueo
    if (!anterior) throw new Error('No se encontró el punto, o ya no se puede editar.');
    historialAgregar_(anterior);
    tablaReemplazar_(HOJA_PUNTOS, columnasPuntos_(), anterior._fila, obj);
  });
}

/** Copia una versión de un punto a la pestaña Historial. */
function historialAgregar_(punto) {
  var ss = libro_();
  if (!ss.getSheetByName(HOJA_HISTORIAL)) {
    crearHoja_(ss, HOJA_HISTORIAL, ['Fecha de la edición'], [])
      .protect().setDescription('Historial de ediciones. No lo cambie a mano.').setWarningOnly(true);
  }
  var v = { 'Fecha de la edición': new Date() };
  Object.keys(punto).forEach(function (k) { if (k !== '_fila') v[k] = punto[k]; });
  tablaAgregar_(HOJA_HISTORIAL, ['Fecha de la edición'].concat(columnasPuntos_()), v);
}

// ---------------------------------------------------------------------
// Juntas
// ---------------------------------------------------------------------

/** Todas las juntas: [{ fecha: 'dd/mm/aaaa', dia, estado, _fila }] */
function juntasLeer_() {
  return tablaLeer_(HOJA_JUNTAS)
    .filter(function (j) { return j['Fecha'] !== '' && j['Fecha'] != null; })
    .map(function (j) {
      return { fecha: textoFecha_(j['Fecha']), dia: String(j['Día']), estado: String(j['Estado']), _fila: j._fila };
    });
}

function juntaActual_() {
  var abiertas = juntasLeer_().filter(function (j) { return j.estado === 'Abierta'; });
  return abiertas.length ? abiertas[abiertas.length - 1] : null;
}

function juntaAgregar_(fecha, dia) {
  tablaAgregar_(HOJA_JUNTAS, ['Fecha', 'Día', 'Estado'], { 'Fecha': fecha, 'Día': dia, 'Estado': 'Abierta' });
}

function cerrarTodas_() {
  juntasLeer_().forEach(function (j) {
    if (j.estado === 'Abierta') tablaCelda_(HOJA_JUNTAS, ['Fecha', 'Día', 'Estado'], j._fila, 'Estado', 'Cerrada');
  });
}

// ---------------------------------------------------------------------
// Claves (enlaces personales)
// ---------------------------------------------------------------------

var COLS_CLAVES = ['Clave', 'Junta', 'Persona', 'Correo enviado'];

/** Claves de la junta: { persona: { clave, fila, enviado } } */
function leerClaves_(junta) {
  var claves = {};
  tablaLeer_(HOJA_CLAVES).forEach(function (c) {
    if (textoFecha_(c['Junta']) !== junta.fecha) return;
    var e = c['Correo enviado'];
    var enviado = e instanceof Date ? Utilities.formatDate(e, Session.getScriptTimeZone(), 'dd/MM HH:mm') : String(e || '');
    claves[c['Persona']] = { clave: c['Clave'], fila: c._fila, enviado: enviado };
  });
  return claves;
}

/** Busca una clave: { clave, junta: 'dd/mm/aaaa', persona } o null. */
function claveBuscar_(clave) {
  var c = tablaLeer_(HOJA_CLAVES).filter(function (x) { return x['Clave'] === clave; })[0];
  return c ? { clave: c['Clave'], junta: textoFecha_(c['Junta']), persona: String(c['Persona']) } : null;
}

/** Borra todas las claves y crea una nueva para cada persona de la junta. */
function clavesReemplazarTodas_(fecha, personas) {
  var h = hoja_(HOJA_CLAVES);
  var enc = asegurarColumnas_(h, COLS_CLAVES);
  if (h.getLastRow() > 1) h.getRange(2, 1, h.getLastRow() - 1, enc.length).clearContent();
  personas.forEach(function (p) {
    tablaAgregar_(HOJA_CLAVES, COLS_CLAVES, { 'Clave': nuevaClave_(), 'Junta': fecha, 'Persona': p });
  });
}

/** Crea una clave nueva para una persona (la anterior deja de servir). */
function claveCambiar_(fecha, persona) {
  var actual = tablaLeer_(HOJA_CLAVES).filter(function (c) {
    return textoFecha_(c['Junta']) === fecha && c['Persona'] === persona;
  })[0];
  var nueva = { 'Clave': nuevaClave_(), 'Junta': fecha, 'Persona': persona, 'Correo enviado': '' };
  if (actual) tablaReemplazar_(HOJA_CLAVES, COLS_CLAVES, actual._fila, nueva);
  else tablaAgregar_(HOJA_CLAVES, COLS_CLAVES, nueva);
}

function claveMarcarCorreo_(fila) {
  tablaCelda_(HOJA_CLAVES, COLS_CLAVES, fila, 'Correo enviado', new Date());
}

// ---------------------------------------------------------------------
// Cargos
// ---------------------------------------------------------------------

function leerCargos_() {
  var filas = hoja_(HOJA_CARGOS).getDataRange().getValues().slice(1);
  var personas = {}, orden = [];
  filas.forEach(function (f) {
    var depto = String(f[0]).trim(), nombre = String(f[1]).trim(), cargo = String(f[2]).trim();
    if (!depto || !nombre) return;
    var director = normalizar_(f[3]) === 'si';
    if (!personas[nombre]) {
      personas[nombre] = { nombre: nombre, cargos: [], director: false };
      orden.push(nombre);
    }
    personas[nombre].cargos.push({ departamento: depto, cargo: cargo, director: director });
    if (director) personas[nombre].director = true;
  });
  // Los departamentos donde la persona es director van primero.
  orden.forEach(function (n) {
    var c = personas[n].cargos;
    personas[n].cargos = c.filter(function (x) { return x.director; })
      .concat(c.filter(function (x) { return !x.director; }));
  });
  return { personas: personas, orden: orden };
}

// ---------------------------------------------------------------------
// Contactos
// ---------------------------------------------------------------------

function hojaContactos_() {
  var ss = libro_();
  var h = ss.getSheetByName(HOJA_CONTACTOS);
  if (!h) {
    h = crearHoja_(ss, HOJA_CONTACTOS, ['Nombre', 'Teléfono', 'Correo'], []);
    h.getRange('B:B').setNumberFormat('@'); // para que "+507…" no se tome como fórmula
    [210, 170, 260].forEach(function (w, i) { h.setColumnWidth(i + 1, w); });
    h.getRange('E1').setValue('Teléfono: el número de celular. Si es de otro país, escríbalo con + y el código, por ejemplo +1 555 123 4567.')
      .setFontColor('#5f6368');
  }
  return h;
}

/** Contactos como se ven en la hoja: [{ nombre, telefono, correo, _fila }] */
function contactosFilas_() {
  return hojaContactos_().getDataRange().getDisplayValues().slice(1).map(function (f, i) {
    return { nombre: String(f[0]).trim(), telefono: String(f[1]).trim(), correo: String(f[2]).trim(), _fila: i + 2 };
  }).filter(function (c) { return c.nombre; });
}

/** Lee la pestaña Contactos. La crea si falta y agrega a las personas nuevas de Cargos. */
function leerContactos_(orden) {
  var h = hojaContactos_();
  var mapa = {};
  contactosFilas_().forEach(function (c) { mapa[c.nombre] = { telefono: c.telefono, correo: c.correo }; });
  var faltan = orden.filter(function (n) { return !mapa[n]; });
  if (faltan.length) {
    var ultima = Math.max(h.getLastRow(), 1);
    // Buscar la última fila con nombre para no dejar huecos.
    var col = h.getRange(1, 1, ultima, 1).getValues();
    while (ultima > 1 && !col[ultima - 1][0]) ultima--;
    h.getRange(ultima + 1, 1, faltan.length, 1).setValues(faltan.map(function (n) { return [n]; }));
    faltan.forEach(function (n) { mapa[n] = { telefono: '', correo: '' }; });
  }
  return mapa;
}

/** Escribe un teléfono o correo importado, con una nota y en amarillo si hay que verificarlo. */
function contactoPoner_(fila, campo, valor, nota, verificar) {
  var celda = hojaContactos_().getRange(fila, campo === 'telefono' ? 2 : 3);
  celda.setNumberFormat('@').setValue("'" + valor).setNote(nota);
  if (verificar) celda.setBackground('#fff4ce');
}

// ---------------------------------------------------------------------
// Saldos de tesorería
// ---------------------------------------------------------------------

/** Convierte un monto del reporte ("B/.1,234.56", "0.00" o un número) en número. */
function montoTesoreria_(v) {
  if (typeof v === 'number') return v;
  var s = String(v == null ? '' : v).replace(/B\/\.?/gi, '').replace(/,/g, '').replace(/[^0-9.\-]/g, '');
  var n = Number(s);
  return s && !isNaN(n) ? n : 0;
}

/**
 * Lee la pestaña Saldos: { periodo, fondos: [{ fondo, departamentos: [...], saldoAnterior,
 * ingresos, egresos, transferencias, saldo }] }. Sin la pestaña, devuelve una lista vacía.
 */
function saldosLeer_() {
  if (!libro_().getSheetByName(HOJA_SALDOS)) return { periodo: '', fondos: [] };
  var filas = tablaLeer_(HOJA_SALDOS);
  var periodo = '';
  filas.forEach(function (f) {
    var p = f['Periodo del reporte'];
    if (!periodo && p) periodo = p instanceof Date ? textoFecha_(p) : String(p).trim();
  });
  var fondos = filas.filter(function (f) {
    var nombre = String(f['Departamento (tesorería)'] || '').trim();
    return nombre && !/^totales?:?$/i.test(nombre);
  }).map(function (f) {
    var m = function (col) { return montoTesoreria_(f[col]); };
    return {
      fondo: String(f['Departamento (tesorería)']).trim(),
      departamentos: String(f['Departamento en Cargos'] || '').split(/[,;]/)
        .map(function (d) { return d.trim(); }).filter(Boolean),
      saldoAnterior: m('Saldo anterior'),
      ingresos: m('Ingresos por ofrenda') + m('Ingresos directos'),
      egresos: m('Egresos'),
      transferencias: m('Transferencias entrantes') - m('Transferencias salientes'),
      saldo: m('Saldo a la fecha')
    };
  });
  return { periodo: periodo, fondos: fondos };
}
