/**
 * PUNTOS PARA LA JUNTA DIRECTIVA – aplicación web
 *
 * Las instrucciones completas, paso a paso, están en README.md.
 *
 * Resumen de la instalación (una sola vez):
 * 1. [Google Sheets] Cree una hoja de cálculo en blanco, por ejemplo "Junta Directiva".
 * 2. [Google Sheets] Menú Extensiones → Apps Script. IMPORTANTE: el código debe
 *    abrirse desde la hoja; no cree el proyecto en script.google.com ni en Drive.
 * 3. [Apps Script] En "Código.gs", borre todo y pegue este código.
 * 4. [Apps Script] "+" (Archivos) → HTML, nombre exacto: Formulario
 *    Borre lo que trae y pegue el contenido de Formulario.html. Guarde (💾).
 * 5. [Apps Script] Elija la función "configurar" → Ejecutar. Acepte los permisos.
 * 6. [Apps Script] Botón azul arriba a la derecha: Implementar → Nueva implementación →
 *    engranaje ⚙️ → Aplicación web. Ejecutar como: Yo · Acceso: Cualquier usuario.
 * 7. [Google Sheets] Recargue la hoja (F5) y use el menú Junta → Nueva junta.
 *
 * Para actualizar este código más adelante:
 * [Apps Script] pegue la versión nueva, guarde, y vaya a Implementar →
 * Gestionar implementaciones → lápiz ✏️ → Versión: "Nueva versión" → Implementar.
 * NO use "Nueva implementación": cambiaría el enlace de la aplicación.
 */

var HOJA_CARGOS = 'Cargos';
var HOJA_JUNTAS = 'Juntas';
var HOJA_PUNTOS = 'Puntos';
var HOJA_ENLACES = 'Enlaces';
var HOJA_CLAVES = '_Claves';
var HOJA_CONTACTOS = 'Contactos';
var GENERAL = 'GENERAL';
var CODIGO_PAIS_INICIAL = '507'; // Panamá. Se cambia con Junta → Cambiar el código de país…

var CATEGORIAS = [
  'Evangelismo y misión',
  'Tesorería y finanzas',
  'Departamentos',
  'Feligresía (traslados, recepción de miembros)',
  'Asuntos generales'
];
var TIPOS = ['Para votación', 'Informativo'];
var TIEMPOS = ['5 minutos', '10 minutos', '15 minutos', '20 minutos', '30 minutos o más'];

var MAX_ARCHIVO = 5 * 1024 * 1024;   // cotizaciones: 5 MB
var MAX_MATERIAL = 10 * 1024 * 1024; // material de apoyo: 10 MB (los videos van por enlace)
var TIPOS_ARCHIVO = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic'
};

var COLS_PUNTOS = [
  'Fecha de envío', 'Junta', 'Presenta', 'Departamento', 'Estado',
  'Categoría', 'Título', 'Descripción y propuesta', 'Tipo', 'Tiempo estimado',
  'Material de apoyo (archivo)', 'Material de apoyo (enlace)',
  '¿Es actividad?', 'Fecha de la actividad', 'Fecha de término de la actividad', 'Hora de inicio', 'Hora de término',
  'Lugar', 'Responsable', 'Asistencia esperada',
  '¿Solicita dinero?', 'Costo total', 'Monto solicitado a la iglesia',
  'Estrategia para el resto', 'Descripción del costo', 'Enlace a la cotización',
  'Archivo de la cotización'
];

var ESTADOS = ['Recibido', 'Por revisar', 'Aprobado', 'Rechazado'];

// Lista de EJEMPLO con nombres ficticios: solo se usa para crear la pestaña "Cargos" la primera vez.
// Los nombres reales se escriben en la hoja, nunca aquí, para que no queden en el repositorio.
var CARGOS_INICIALES = [
  ['Ancianos', 'Luis Rivas', 'Primer anciano', 'Sí'],
  ['Ancianos', 'Mario Arango', 'Segundo anciano', 'No'],
  ['Ancianos', 'Daniel Rivas', 'Anciano', 'No'],
  ['Secretaría', 'Olga Nieto', 'Secretaria', 'Sí'],
  ['Secretaría', 'Ana Cedeño', 'Asociada', 'No'],
  ['Tesorería', 'Mario Arango', 'Tesorero', 'Sí'],
  ['Tesorería', 'Ernesto Molina', 'Asociado', 'No'],
  ['Diáconos', 'Raúl Gallardo', 'Jefe', 'Sí'],
  ['Diáconos', 'Ernesto Molina', 'Asociado', 'No'],
  ['Diaconisas', 'Irene de Arango', 'Jefa', 'Sí'],
  ['Diaconisas', 'Diana Robles', 'Asociada', 'No'],
  ['Diaconisas', 'Julia Guzmán', 'Asociada', 'No'],
  ['Diaconisas', 'Amalia Campos', 'Asociada', 'No'],
  ['Escuela Sabática', 'Daniel Rivas', 'Director', 'Sí'],
  ['Escuela Sabática', 'Zoila Mendoza', 'Asociada', 'No'],
  ['Escuela Sabática', 'Ernesto Molina', 'Secretario', 'No'],
  ['Escuela Sabática', 'Adriana Paredes', 'Primarios', 'No'],
  ['Escuela Sabática', 'Yolanda Valdés', 'Menores', 'No'],
  ['Ministerio Personal', 'Daniel Rivas', 'Director', 'Sí'],
  ['Ministerio Personal', 'Zoila Mendoza', 'Asociada', 'No'],
  ['Ministerio Infantil', 'Adriana Paredes', 'Directora', 'Sí'],
  ['Ministerio Infantil', 'Yolanda Valdés', 'Asociada', 'No'],
  ['Ministerio Infantil', 'Ana Cedeño', 'Asociada', 'No'],
  ['Ministerio de la Familia', 'Daniel Rivas', 'Director', 'Sí'],
  ['Ministerio de la Familia', 'Luis Rivas', 'Miembro', 'No'],
  ['Ministerio de la Familia', 'Yolanda Valdés', 'Miembro', 'No'],
  ['Ministerio de la Mujer', 'Julia Guzmán', 'Directora', 'Sí'],
  ['Ministerio de la Mujer', 'Irene de Arango', 'Asociada', 'No'],
  ['Mayordomía Cristiana', 'Daniel Rivas', 'Director', 'Sí'],
  ['Mayordomía Cristiana', 'Luis Rivas', 'Miembro', 'No'],
  ['Mayordomía Cristiana', 'Mario Arango', 'Miembro', 'No'],
  ['Mayordomía Cristiana', 'Olga Nieto', 'Miembro', 'No'],
  ['Mayordomía Cristiana', 'Raúl Gallardo', 'Miembro', 'No'],
  ['Ministerio de la Salud', 'Karla Nieto', 'Directora', 'Sí'],
  ['Ministerio de la Salud', 'Olga Nieto', 'Asociada', 'No'],
  ['Servicio de Canto', 'Luis Rivas', 'Director', 'Sí'],
  ['Servicio de Canto', 'Daniel Rivas', 'Asociado', 'No'],
  ['Servicio de Canto', 'Olga Nieto', 'Asociada', 'No'],
  ['Servicio de Canto', 'Julia Guzmán', 'Asociada', 'No'],
  ['Servicio de Canto', 'Helena Arango', 'Asociada', 'No'],
  ['Club de Conquistadores', 'Daniel Rivas', 'Director', 'Sí'],
  ['Club de Conquistadores', 'Luis Rivas', 'Subdirector', 'No'],
  ['Club de Conquistadores', 'Ernesto Molina', 'Asociado', 'No'],
  ['Acción Solidaria Adventista (Dorcas)', 'Yolanda Valdés', 'Directora', 'Sí'],
  ['Acción Solidaria Adventista (Dorcas)', 'Zoila Mendoza', 'Asociada', 'No'],
  ['Acción Solidaria Adventista (Dorcas)', 'Alicia Salas', 'Asociada', 'No'],
  ['Acción Solidaria Adventista (Dorcas)', 'Domingo Vidal', 'Asociado', 'No'],
  ['Ministerio de Publicaciones', 'Ernesto Molina', 'Director', 'Sí'],
  ['Ministerio de Publicaciones', 'Ana Cedeño', 'Asociada', 'No'],
  ['Educación', 'Daniel Rivas', 'Director', 'Sí'],
  ['Educación', 'Adriana Paredes', 'Miembro', 'No'],
  ['Ministerio Joven Adventista', 'Ernesto Molina', 'Director', 'Sí'],
  ['Ministerio Joven Adventista', 'Ana Cedeño', 'Asociada', 'No'],
  ['Ministerio Joven Adventista', 'Mario Arango', 'Asociado', 'No'],
  ['Ministerio Joven Adventista', 'Karla Nieto', 'Asociada', 'No'],
  ['Comunicación', 'Luis Rivas', 'Director', 'Sí'],
  ['Comunicación', 'Mario Arango', 'Asociado', 'No'],
  ['Comunicación', 'Julia Guzmán', 'Asociada', 'No'],
  ['Equipo de Sonido', 'Mario Arango', 'Director', 'Sí'],
  ['Equipo de Sonido', 'Daniel Rivas', 'Asociado', 'No'],
  ['Equipo de Sonido', 'Luis Rivas', 'Asociado', 'No'],
  ['Equipo de Sonido', 'Julia Guzmán', 'Asociada', 'No']
];

// =====================================================================
// MENÚ DE LA HOJA
// =====================================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Junta')
    .addItem('Nueva junta…', 'nuevaJunta')
    .addItem('Generar agenda…', 'generarAgenda')
    .addItem('Enviar enlaces por correo…', 'enviarCorreos')
    .addItem('Importar teléfonos y correos de mis contactos', 'importarContactos')
    .addItem('Actualizar la pestaña Enlaces', 'actualizarEnlaces')
    .addItem('Cambiar el enlace de una persona…', 'cambiarEnlace')
    .addItem('Cerrar recepción de puntos', 'cerrarRecepcion')
    .addSeparator()
    .addItem('Configuración inicial', 'configurar')
    .addItem('Cambiar la URL de la aplicación…', 'cambiarUrl')
    .addItem('Cambiar el código de país…', 'cambiarCodigoPais')
    .addToUi();
}

function configurar() {
  var ss = SpreadsheetApp.getActive();
  if (!ss) {
    throw new Error('Este script no está dentro de una hoja de cálculo. ' +
      'Abra su hoja de Google Sheets, vaya a Extensiones → Apps Script y pegue el código ahí.');
  }
  var props = PropertiesService.getScriptProperties();
  props.setProperty('HOJA_ID', ss.getId());

  var hCargos = crearHoja_(ss, HOJA_CARGOS, ['Departamento', 'Nombre', 'Cargo', '¿Es director?'], CARGOS_INICIALES);
  hCargos.getRange('D2:D300').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['Sí', 'No'], true).build());
  [260, 200, 160, 110].forEach(function (w, i) { hCargos.setColumnWidth(i + 1, w); });

  crearHoja_(ss, HOJA_JUNTAS, ['Fecha', 'Día', 'Estado'], []);

  var hPuntos = crearHoja_(ss, HOJA_PUNTOS, COLS_PUNTOS, []);
  var colEstado = COLS_PUNTOS.indexOf('Estado') + 1;
  hPuntos.getRange(2, colEstado, 2000, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(ESTADOS, true).build());

  crearHoja_(ss, HOJA_CLAVES, ['Clave', 'Junta', 'Persona', 'Correo enviado'], []).hideSheet();
  leerContactos_(leerCargos_().orden); // crea la pestaña Contactos con los nombres

  // Borrar la pestaña vacía que trae una hoja nueva.
  ss.getSheets().forEach(function (h) {
    if (/^(Hoja|Sheet) ?1$/.test(h.getName()) && h.getLastRow() === 0 && ss.getSheets().length > 1) {
      ss.deleteSheet(h);
    }
  });

  if (!props.getProperty('CARPETA')) {
    props.setProperty('CARPETA', DriveApp.createFolder('Cotizaciones – Junta Directiva').getId());
  }

  // Se ejecuta desde el editor: un mensaje con botón "Aceptar" dejaría el script
  // esperando en la hoja. Por eso solo se escribe en el registro y en un aviso breve.
  var listo = 'Configuración lista. Se crearon las pestañas Cargos, Juntas y Puntos, ' +
    'y la carpeta "Cotizaciones – Junta Directiva" en su Drive. ' +
    'Siguiente paso: Implementar → Nueva implementación → Aplicación web ' +
    '(Ejecutar como: Yo · Acceso: Cualquier usuario). Luego use Junta → Nueva junta.';
  Logger.log(listo);
  ss.toast('Siguiente paso: Implementar → Nueva implementación → Aplicación web.', 'Configuración lista', 15);
}

function nuevaJunta() {
  var ui = SpreadsheetApp.getUi();
  if (!urlApp_(true)) return;

  var r = ui.prompt('Nueva junta', 'Fecha de la junta (día/mes/año). Ejemplo: 15/03/2027', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var f = parseFecha_(r.getResponseText());
  if (!f) { ui.alert('Fecha no válida. Use día/mes/año, por ejemplo 15/03/2027.'); return; }
  if (claveFecha_(f.texto) < hoyClave_()) { ui.alert('Esa fecha ya pasó.'); return; }

  var actual = juntaActual_();
  if (actual) {
    var ok = ui.alert('Nueva junta',
      'La junta del ' + actual.dia + ' sigue abierta. Si continúa, se cierra y sus enlaces dejan de funcionar.\n\n¿Continuar?',
      ui.ButtonSet.YES_NO);
    if (ok !== ui.Button.YES) return;
  }
  cerrarTodas_();

  var dia = diaLegible_(f.fecha);
  hoja_(HOJA_JUNTAS).appendRow(["'" + f.texto, dia, 'Abierta']);

  // Claves nuevas para cada persona y para el enlace general.
  var cargos = leerCargos_();
  var hc = hoja_(HOJA_CLAVES);
  if (hc.getLastRow() > 1) hc.getRange(2, 1, hc.getLastRow() - 1, 4).clearContent();
  var filas = cargos.orden.map(function (n) { return [nuevaClave_(), "'" + f.texto, n, '']; });
  filas.push([nuevaClave_(), "'" + f.texto, GENERAL, '']);
  hc.getRange(2, 1, filas.length, 4).setValues(filas);

  escribirEnlaces_();
  var conCorreo = personasConCorreo_(cargos.orden).length;
  if (conCorreo && ui.alert('Junta creada',
    'Junta del ' + dia + '. Los enlaces están en la pestaña "Enlaces".\n\n' +
    '¿Enviar ahora los enlaces por correo a las ' + conCorreo + ' personas que tienen correo en la pestaña Contactos?',
    ui.ButtonSet.YES_NO) === ui.Button.YES) {
    enviarCorreosA_(personasConCorreo_(cargos.orden));
  } else if (!conCorreo) {
    aviso_('Junta creada',
      'Junta del ' + dia + '.\n\nLos enlaces están en la pestaña "Enlaces", con un botón para enviarlos por WhatsApp. ' +
      'Para enviarlos también por correo, complete la pestaña Contactos y use Junta → Enviar enlaces por correo.');
  }
}

function cambiarEnlace() {
  var ui = SpreadsheetApp.getUi();
  var junta = juntaActual_();
  if (!junta) { ui.alert('No hay una junta abierta.'); return; }

  var r = ui.prompt('Cambiar enlace',
    'Escriba el nombre de la persona como aparece en la pestaña Cargos.\nPara el enlace general, escriba: GENERAL',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;

  var buscado = normalizar_(r.getResponseText());
  var persona = buscado === 'general' ? GENERAL :
    leerCargos_().orden.filter(function (n) { return normalizar_(n) === buscado; })[0];
  if (!persona) { ui.alert('No encontré a "' + r.getResponseText() + '" en la pestaña Cargos.'); return; }

  var hc = hoja_(HOJA_CLAVES);
  var datos = hc.getDataRange().getValues();
  var fila = -1;
  for (var i = 1; i < datos.length; i++) {
    if (textoFecha_(datos[i][1]) === junta.fecha && datos[i][2] === persona) { fila = i + 1; break; }
  }
  var nueva = [[nuevaClave_(), "'" + junta.fecha, persona, '']];
  if (fila > 0) hc.getRange(fila, 1, 1, 4).setValues(nueva);
  else hc.getRange(hc.getLastRow() + 1, 1, 1, 4).setValues(nueva);

  escribirEnlaces_();
  var texto = 'Se creó un enlace nuevo para ' + (persona === GENERAL ? 'el enlace general' : persona) +
    '. El anterior ya no funciona. Está en la pestaña "Enlaces".';
  if (persona !== GENERAL && personasConCorreo_([persona]).length) {
    if (ui.alert('Enlace cambiado', texto + '\n\n¿Enviarle el enlace nuevo por correo?', ui.ButtonSet.YES_NO) === ui.Button.YES) {
      enviarCorreosA_([persona]);
    }
  } else {
    aviso_('Enlace cambiado', texto);
  }
}

function cerrarRecepcion() {
  var ui = SpreadsheetApp.getUi();
  var junta = juntaActual_();
  if (!junta) { ui.alert('No hay una junta abierta.'); return; }
  var ok = ui.alert('Cerrar recepción',
    '¿Cerrar la recepción de puntos para la junta del ' + junta.dia + '? Los enlaces dejarán de funcionar.',
    ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  cerrarTodas_();
  ui.alert('Recepción cerrada. Ya puede generar la agenda.');
}

function cambiarUrl() {
  var actual = PropertiesService.getScriptProperties().getProperty('URL_APP') || '(ninguna)';
  if (pedirUrl_('URL guardada ahora:\n' + actual + '\n\n')) {
    if (juntaActual_()) escribirEnlaces_();
    SpreadsheetApp.getUi().alert('URL guardada. Los enlaces de la pestaña "Enlaces" se actualizaron.');
  }
}

// =====================================================================
// APLICACIÓN WEB
// =====================================================================

function doGet(e) {
  var clave = e && e.parameter ? String(e.parameter.t || '') : '';
  var ctx = null;
  try { ctx = contexto_(clave); } catch (err) { ctx = null; }

  var t = HtmlService.createTemplateFromFile('Formulario');
  t.datosJson = JSON.stringify(ctx ? publico_(ctx) : null).replace(/</g, '\\u003c');
  return t.evaluate()
    .setTitle('Puntos para la Junta Directiva')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** La llama la página al presionar "Enviar". */
function enviarPunto(clave, d) {
  var ctx = contexto_(String(clave || ''));
  if (!ctx) throw new Error('Este enlace ya no es válido. Pida el enlace actualizado a la secretaría de la iglesia.');
  limitar_(clave, ctx.general ? 10 : 25);

  d = d || {};
  var p = validarPunto(d, {
    general: ctx.general,
    departamentos: ctx.cargos.map(function (c) { return c.departamento; })
  });
  if (p.error) throw new Error(p.error);

  var presenta = ctx.general ? p.nombre : ctx.nombre;
  var departamento = ctx.general ? 'Miembro de la iglesia' : p.departamento;

  var archivoUrl = '';
  if (p.pideDinero === 'Sí' && d.archivo) {
    archivoUrl = guardarArchivo_(d.archivo, ctx.junta.fecha, presenta);
  }
  var materialUrl = '';
  if (d.material) {
    materialUrl = guardarArchivo_(d.material, ctx.junta.fecha, presenta, {
      tipos: tiposMaterial_(), max: MAX_MATERIAL,
      textoTipos: 'PDF, PowerPoint, Word o una imagen', prefijo: 'Material'
    });
  }

  var valores = {
    'Fecha de envío': new Date(), 'Junta': ctx.junta.fecha, 'Presenta': presenta,
    'Departamento': departamento, 'Estado': ctx.general ? 'Por revisar' : 'Recibido',
    'Categoría': p.categoria, 'Título': p.titulo, 'Descripción y propuesta': p.descripcion,
    'Tipo': p.tipo, 'Tiempo estimado': p.tiempo,
    'Material de apoyo (archivo)': materialUrl, 'Material de apoyo (enlace)': p.materialEnlace,
    '¿Es actividad?': p.esActividad, 'Fecha de la actividad': p.actFecha,
    'Fecha de término de la actividad': p.actFechaFin,
    'Hora de inicio': p.actInicio, 'Hora de término': p.actFin, 'Lugar': p.lugar,
    'Responsable': p.responsable, 'Asistencia esperada': p.asistencia,
    '¿Solicita dinero?': p.pideDinero, 'Costo total': p.costo, 'Monto solicitado a la iglesia': p.monto,
    'Estrategia para el resto': p.estrategia, 'Descripción del costo': p.descCosto,
    'Enlace a la cotización': p.enlace, 'Archivo de la cotización': archivoUrl
  };

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var h = hoja_(HOJA_PUNTOS);
    // Se escribe por nombre de columna: si falta alguna columna nueva, se agrega al final.
    var enc = asegurarColumnas_(h, COLS_PUNTOS);
    h.appendRow(enc.map(function (col) { return col in valores ? celdaSegura_(valores[col]) : ''; }));
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

/**
 * Revisa y limpia los datos enviados. Devuelve el punto limpio,
 * o { error: 'mensaje' } si algo no es válido.
 */
function validarPunto(d, opc) {
  var txt = function (v, max) { return String(v == null ? '' : v).trim().slice(0, max); };
  var err = function (m) { return { error: m }; };
  var p = {
    nombre: '', departamento: '', esActividad: '', actFecha: '', actFechaFin: '', actInicio: '', actFin: '',
    lugar: '', responsable: '', asistencia: '', pideDinero: '', costo: '', monto: '',
    estrategia: '', descCosto: '', enlace: '', materialEnlace: ''
  };

  if (opc.general) {
    p.nombre = txt(d.nombre, 100);
    if (p.nombre.length < 3) return err('Escriba su nombre completo.');
  } else {
    p.departamento = txt(d.departamento, 200);
    if (opc.departamentos.indexOf(p.departamento) < 0) return err('Elija el departamento por el que presenta el punto.');
  }

  p.categoria = txt(d.categoria, 100);
  if (CATEGORIAS.indexOf(p.categoria) < 0) return err('Elija la categoría del punto.');
  p.titulo = txt(d.titulo, 150);
  if (!p.titulo) return err('Escriba el título del punto.');
  p.descripcion = txt(d.descripcion, 5000);
  if (!p.descripcion) return err('Escriba la descripción y propuesta.');
  p.tipo = txt(d.tipo, 50);
  if (TIPOS.indexOf(p.tipo) < 0) return err('Indique si el punto es para votación o informativo.');
  p.tiempo = txt(d.tiempo, 50);
  if (TIEMPOS.indexOf(p.tiempo) < 0) return err('Elija el tiempo estimado.');

  // Material de apoyo (opcional, para cualquier tipo de punto): el archivo se revisa al guardarlo.
  p.materialEnlace = txt(d.materialEnlace, 1000);
  if (p.materialEnlace && !/^https?:\/\/\S+$/i.test(p.materialEnlace)) {
    return err('El enlace del material de apoyo debe empezar con https://');
  }

  // Un punto informativo no lleva actividad ni presupuesto.
  if (p.tipo === 'Informativo') return p;

  p.esActividad = txt(d.esActividad, 2);
  if (['Sí', 'No'].indexOf(p.esActividad) < 0) return err('Indique si el punto es una actividad.');
  if (p.esActividad === 'Sí') {
    var f = /^(\d{4})-(\d{2})-(\d{2})$/.exec(txt(d.actFecha, 10));
    if (!f) return err('Indique la fecha de inicio de la actividad.');
    p.actFecha = f[3] + '/' + f[2] + '/' + f[1];
    // Fecha de término: solo para actividades de varios días (campamentos, campañas…).
    var ff = txt(d.actFechaFin, 10);
    if (ff) {
      var g = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ff);
      if (!g) return err('La fecha de término no es válida.');
      if (ff < f[0]) return err('La fecha de término no puede ser antes de la fecha de inicio.');
      if (ff !== f[0]) p.actFechaFin = g[3] + '/' + g[2] + '/' + g[1];
    }
    var hora = /^([01]\d|2[0-3]):[0-5]\d$/;
    p.actInicio = txt(d.actInicio, 5);
    if (!hora.test(p.actInicio)) return err('Indique la hora de inicio de la actividad.');
    p.actFin = txt(d.actFin, 5);
    if (p.actFin && !hora.test(p.actFin)) return err('La hora de término no es válida.');
    if (!p.actFechaFin && p.actFin && p.actFin <= p.actInicio) {
      return err('La hora de término debe ser después de la hora de inicio.');
    }
    p.lugar = txt(d.lugar, 200);
    if (!p.lugar) return err('Indique el lugar de la actividad.');
    p.responsable = txt(d.responsable, 100);
    if (!p.responsable) return err('Indique el responsable de la actividad.');
    var asis = txt(d.asistencia, 6);
    if (asis) {
      if (!/^\d{1,5}$/.test(asis)) return err('La asistencia esperada debe ser un número.');
      p.asistencia = Number(asis);
    }
  }

  p.pideDinero = txt(d.pideDinero, 2);
  if (['Sí', 'No'].indexOf(p.pideDinero) < 0) return err('Indique si se solicita dinero de la iglesia.');
  if (p.pideDinero === 'Sí') {
    p.costo = monto_(d.costo);
    if (!(p.costo > 0)) return err('Escriba el costo total, solo con números.');
    p.monto = monto_(d.monto);
    if (!(p.monto > 0)) return err('Escriba el monto que se solicita a la iglesia, solo con números.');
    if (p.monto > p.costo) return err('Lo que se pide a la iglesia no puede ser mayor que el costo total.');
    if (p.monto < p.costo) {
      p.estrategia = txt(d.estrategia, 2000);
      if (!p.estrategia) return err('Explique cómo se conseguirá el resto del dinero.');
    }
    p.descCosto = txt(d.descCosto, 2000);
    p.enlace = txt(d.enlace, 1000);
    if (p.enlace && !/^https?:\/\/\S+$/i.test(p.enlace)) return err('El enlace a la cotización debe empezar con https://');
    if (!p.descCosto && !p.enlace && !d.archivo) {
      return err('Explique el costo: escriba una descripción, pegue un enlace o adjunte la cotización.');
    }
  }
  return p;
}

function monto_(v) {
  var s = String(v == null ? '' : v).trim().replace(/\s/g, '').replace(',', '.');
  return /^\d{1,9}(\.\d{1,2})?$/.test(s) ? Number(s) : NaN;
}

/** Tipos permitidos para el material de apoyo: los de la cotización más PowerPoint. */
function tiposMaterial_() {
  var t = {};
  Object.keys(TIPOS_ARCHIVO).forEach(function (k) { t[k] = TIPOS_ARCHIVO[k]; });
  t.ppt = 'application/vnd.ms-powerpoint';
  t.pptx = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  return t;
}

/**
 * Guarda un archivo enviado desde el formulario en la carpeta de Drive.
 * opc: { tipos, max, textoTipos, prefijo }
 */
function guardarArchivo_(a, junta, presenta, opc) {
  opc = opc || { tipos: TIPOS_ARCHIVO, max: MAX_ARCHIVO, textoTipos: 'PDF, Word o una imagen', prefijo: 'Cotización' };
  var mb = Math.round(opc.max / 1024 / 1024);
  var nombre = String(a.nombre || 'archivo').slice(0, 120).replace(/[\\\/:*?"<>|]/g, '_');
  var ext = nombre.indexOf('.') >= 0 ? nombre.split('.').pop().toLowerCase() : '';
  var mime = opc.tipos[ext];
  if (!mime) throw new Error('Tipo de archivo no permitido. Use ' + opc.textoTipos + '.');

  var base64 = String(a.base64 || '');
  if (base64.length > Math.ceil(opc.max / 3) * 4 + 8) throw new Error('El archivo pesa más de ' + mb + ' MB.');
  var bytes = Utilities.base64Decode(base64);
  if (bytes.length > opc.max) throw new Error('El archivo pesa más de ' + mb + ' MB.');
  if (!firmaValida_(bytes, ext)) throw new Error('El archivo no parece ser un ' + ext.toUpperCase() + ' válido.');

  var carpeta = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('CARPETA'));
  var archivo = carpeta.createFile(Utilities.newBlob(bytes, mime,
    junta.replace(/\//g, '-') + ' – ' + opc.prefijo + ' – ' + presenta + ' – ' + nombre));
  return archivo.getUrl();
}

/** Revisa los primeros bytes para confirmar que el archivo es lo que dice ser. */
function firmaValida_(b, ext) {
  if (b.length < 12) return false;
  var es = function (bytes, desde) {
    return bytes.every(function (x, i) { return (b[(desde || 0) + i] & 0xff) === x; });
  };
  switch (ext) {
    case 'pdf': return es([0x25, 0x50, 0x44, 0x46]);
    case 'doc': return es([0xD0, 0xCF, 0x11, 0xE0]);
    case 'docx': case 'pptx': return es([0x50, 0x4B, 0x03, 0x04]);
    case 'ppt': return es([0xD0, 0xCF, 0x11, 0xE0]);
    case 'jpg': case 'jpeg': return es([0xFF, 0xD8, 0xFF]);
    case 'png': return es([0x89, 0x50, 0x4E, 0x47]);
    case 'webp': return es([0x52, 0x49, 0x46, 0x46]) && es([0x57, 0x45, 0x42, 0x50], 8);
    case 'heic': return es([0x66, 0x74, 0x79, 0x70], 4);
  }
  return false;
}

/** Limita cuántos puntos se pueden enviar con un mismo enlace en 6 horas. */
function limitar_(clave, max) {
  var cache = CacheService.getScriptCache();
  var k = 'lim_' + clave;
  var n = Number(cache.get(k)) || 0;
  if (n >= max) throw new Error('Se enviaron demasiados puntos con este enlace en poco tiempo. Intente más tarde.');
  cache.put(k, String(n + 1), 21600);
}

/** Evita que un texto se interprete como fórmula o se convierta solo en fecha. */
function celdaSegura_(v) {
  if (typeof v === 'string' && v !== '') return "'" + v;
  return v;
}

function contexto_(clave) {
  if (!/^[0-9a-f]{32}$/.test(clave)) return null;
  var junta = juntaActual_();
  if (!junta || claveFecha_(junta.fecha) < hoyClave_()) return null;

  var filas = hoja_(HOJA_CLAVES).getDataRange().getValues();
  for (var i = 1; i < filas.length; i++) {
    if (filas[i][0] === clave && textoFecha_(filas[i][1]) === junta.fecha) {
      var persona = String(filas[i][2]);
      if (persona === GENERAL) return { clave: clave, junta: junta, general: true, nombre: '', cargos: [] };
      var p = leerCargos_().personas[persona];
      if (!p) return null;
      return { clave: clave, junta: junta, general: false, nombre: persona, cargos: p.cargos };
    }
  }
  return null;
}

/** Solo lo que la página necesita mostrar. */
function publico_(ctx) {
  return {
    clave: ctx.clave,
    general: ctx.general,
    nombre: ctx.nombre,
    junta: ctx.junta.dia,
    departamentos: ctx.cargos.map(function (c) {
      return { valor: c.departamento, texto: c.departamento + ' (' + c.cargo + ')' };
    }),
    categorias: CATEGORIAS,
    tiempos: TIEMPOS
  };
}

// =====================================================================
// AGENDA
// =====================================================================

function generarAgenda() {
  var ui = SpreadsheetApp.getUi();
  var ss = libro_();

  var juntas = hoja_(HOJA_JUNTAS).getDataRange().getValues().slice(1)
    .filter(function (f) { return f[0] !== ''; })
    .map(function (f) { return { fecha: textoFecha_(f[0]), dia: String(f[1]) }; });
  if (!juntas.length) { ui.alert('Todavía no hay juntas. Use Junta → Nueva junta.'); return; }

  var r = ui.prompt('Generar agenda',
    'Fecha de la junta (día/mes/año).\nDeje vacío para usar la última junta (' + juntas[juntas.length - 1].fecha + ').',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;

  var junta;
  var txt = r.getResponseText().trim();
  if (!txt) {
    junta = juntas[juntas.length - 1];
  } else {
    var f = parseFecha_(txt);
    if (!f) { ui.alert('Fecha no válida. Use día/mes/año.'); return; }
    junta = juntas.filter(function (j) { return j.fecha === f.texto; }).pop();
    if (!junta) { ui.alert('No hay una junta registrada para el ' + f.texto + '.'); return; }
  }

  var datos = hoja_(HOJA_PUNTOS).getDataRange().getValues();
  var enc = datos[0];
  var v = function (fila, col) { var i = enc.indexOf(col); return i < 0 ? '' : fila[i]; };

  var todos = datos.slice(1)
    .filter(function (f) { return textoFecha_(v(f, 'Junta')) === junta.fecha; })
    .sort(function (a, b) { return a[0] - b[0]; });
  var pendientes = todos.filter(function (f) { return v(f, 'Estado') === 'Por revisar'; });
  var puntos = todos.filter(function (f) { return ['Por revisar', 'Rechazado'].indexOf(v(f, 'Estado')) < 0; });

  var COLS = ['#', 'Punto', 'Presenta', 'Tipo', 'Tiempo', 'Descripción y propuesta', 'Actividad', 'Presupuesto'];
  var filas = [], estilos = [], n = 0, minutos = 0, solicitado = 0;

  function agregar(fila, estilo) {
    while (fila.length < COLS.length) fila.push('');
    filas.push(fila); estilos.push(estilo);
  }
  function fijo(texto) { agregar([++n, texto], 'fijo'); }
  function filaPunto(f, numerar) {
    var tiempo = String(v(f, 'Tiempo estimado'));
    var actividad = '';
    if (v(f, '¿Es actividad?') === 'Sí') {
      var ini = textoFecha_(v(f, 'Fecha de la actividad'));
      var finA = textoFecha_(v(f, 'Fecha de término de la actividad'));
      var hi = v(f, 'Hora de inicio'), ht = v(f, 'Hora de término');
      actividad = finA ?
        'Fechas: del ' + ini + ' al ' + finA + ' (' + diasEntre_(ini, finA) + ' días)' +
          '\nInicio: ' + hi + ' (primer día)' + (ht ? '\nTérmino: ' + ht + ' (último día)' : '') :
        'Fecha: ' + ini + '\nHora: ' + hi + (ht ? ' – ' + ht : '');
      actividad += '\nLugar: ' + v(f, 'Lugar') +
        '\nResponsable: ' + v(f, 'Responsable') +
        (v(f, 'Asistencia esperada') !== '' ? '\nAsistencia: ' + v(f, 'Asistencia esperada') : '');
    }
    var presupuesto = '';
    if (v(f, '¿Solicita dinero?') === 'Sí') {
      presupuesto = 'Costo total: ' + v(f, 'Costo total') +
        '\nSolicitado a la iglesia: ' + v(f, 'Monto solicitado a la iglesia');
      if (v(f, 'Estrategia para el resto')) presupuesto += '\nEl resto: ' + v(f, 'Estrategia para el resto');
      if (v(f, 'Descripción del costo')) presupuesto += '\n\nDescripción: ' + v(f, 'Descripción del costo');
      if (v(f, 'Enlace a la cotización')) presupuesto += '\nCotización (enlace): ' + v(f, 'Enlace a la cotización');
      if (v(f, 'Archivo de la cotización')) presupuesto += '\nCotización (archivo): ' + v(f, 'Archivo de la cotización');
      if (numerar) solicitado += Number(v(f, 'Monto solicitado a la iglesia')) || 0;
    }
    if (numerar) minutos += parseInt(tiempo, 10) || 0;
    var descripcion = String(v(f, 'Descripción y propuesta'));
    if (v(f, 'Material de apoyo (archivo)')) descripcion += '\n\nMaterial (archivo): ' + v(f, 'Material de apoyo (archivo)');
    if (v(f, 'Material de apoyo (enlace)')) descripcion += '\n' + (v(f, 'Material de apoyo (archivo)') ? '' : '\n') +
      'Material (enlace): ' + v(f, 'Material de apoyo (enlace)');
    return [numerar ? ++n : '', v(f, 'Título'), v(f, 'Presenta') + '\n(' + v(f, 'Departamento') + ')',
      v(f, 'Tipo'), tiempo, descripcion, actividad, presupuesto];
  }
  function seccion(cat) {
    agregar(['', cat.toUpperCase()], 'seccion');
    var deCat = puntos.filter(function (f) { return v(f, 'Categoría') === cat; });
    if (!deCat.length) agregar(['', 'Sin puntos presentados'], 'vacio');
    deCat.forEach(function (f) { agregar(filaPunto(f, true), 'punto'); });
  }

  fijo('Devocional y oración de apertura');
  seccion(CATEGORIAS[0]); // Evangelismo primero, según el Manual de la Iglesia
  fijo('Lectura y aprobación del acta anterior');
  CATEGORIAS.slice(1).forEach(seccion);
  fijo('Oración de clausura');

  if (pendientes.length) {
    agregar(['', 'PENDIENTES DE REVISIÓN (enviados por el enlace general, no incluidos)'], 'seccion');
    pendientes.forEach(function (f) { agregar(filaPunto(f, false), 'vacio'); });
  }

  var nombreHoja = 'Agenda ' + junta.fecha.replace(/\//g, '-');
  var vieja = ss.getSheetByName(nombreHoja);
  if (vieja) ss.deleteSheet(vieja);
  var h = ss.insertSheet(nombreHoja);

  h.getRange(1, 1, 1, COLS.length).merge()
    .setValue('Agenda de la Junta Directiva – ' + junta.dia)
    .setFontSize(14).setFontWeight('bold');
  h.getRange(3, 1, 1, COLS.length).setValues([COLS])
    .setFontWeight('bold').setBackground('#673ab7').setFontColor('#ffffff');
  h.getRange(4, 1, filas.length, COLS.length).setValues(filas.map(function (f) {
    return f.map(function (x) { return typeof x === 'string' && /^[=+\-@]/.test(x) ? "'" + x : x; });
  })).setWrap(true).setVerticalAlignment('top');

  estilos.forEach(function (e, i) {
    var fila = h.getRange(4 + i, 1, 1, COLS.length);
    if (e === 'seccion') fila.setFontWeight('bold').setBackground('#ede7f6');
    if (e === 'fijo') fila.setFontStyle('italic');
    if (e === 'vacio') fila.setFontColor('#80868b');
  });

  var pie = 4 + filas.length + 1;
  h.getRange(pie, 2, 2, 1).setValues([
    ['Tiempo estimado de los puntos: ' + minutos + ' minutos'],
    ['Total solicitado a la iglesia: ' + solicitado]
  ]).setFontWeight('bold');

  [40, 220, 190, 120, 100, 320, 210, 280].forEach(function (w, i) { h.setColumnWidth(i + 1, w); });
  h.setFrozenRows(3);
  ss.setActiveSheet(h);

  ui.alert('Agenda lista: ' + puntos.length + ' punto(s).' +
    (pendientes.length ? '\n\nHay ' + pendientes.length + ' punto(s) del enlace general por revisar. ' +
      'En la pestaña Puntos, cambie su Estado a "Aprobado" y genere la agenda otra vez.' : ''));
}

// =====================================================================
// AUXILIARES
// =====================================================================

function escribirEnlaces_() {
  var junta = juntaActual_();
  var url = urlApp_(false);
  var cargos = leerCargos_();
  var contactos = leerContactos_(cargos.orden);
  var cp = codigoPais_();
  var claves = leerClaves_(junta);
  var enlace = function (persona) {
    return claves[persona] ? url + '?t=' + claves[persona].clave : '';
  };

  var ss = libro_();
  var h = ss.getSheetByName(HOJA_ENLACES) || ss.insertSheet(HOJA_ENLACES, 0);
  h.clear();
  h.getRange(1, 1, h.getMaxRows(), h.getMaxColumns()).breakApart();

  var ANCHO = 5;
  var filas = [], estilos = [], whatsapp = [];
  var poner = function (fila, estilo, wa) {
    while (fila.length < ANCHO) fila.push('');
    filas.push(fila); estilos.push(estilo); whatsapp.push(wa || null);
  };
  var cargosTexto = function (p) {
    return p.cargos.map(function (c) { return c.cargo + ' – ' + c.departamento; }).join('\n');
  };
  var estadoCorreo = function (n) {
    var correo = (contactos[n] || {}).correo;
    if (!correo) return 'Sin correo';
    if (!correoValido_(correo)) return 'Correo no válido';
    return claves[n] && claves[n].enviado ? 'Enviado ' + claves[n].enviado : 'Pendiente';
  };
  var filaPersona = function (n) {
    var e = enlace(n);
    if (!e) {
      poner([n, cargosTexto(cargos.personas[n]), 'Sin enlace: use Junta → Cambiar el enlace de una persona'], '');
      return;
    }
    var tel = telefonoWa_((contactos[n] || {}).telefono, cp);
    var correo = (contactos[n] || {}).correo;
    var wa = linkWhatsApp_(tel, mensajeWhatsApp_(n, junta, e, correoValido_(correo) ? correo : ''));
    var etiqueta = tel ? 'Enviar por WhatsApp' : (tel === null ? 'Teléfono no válido · elegir contacto' : 'Elegir contacto');
    poner([n, cargosTexto(cargos.personas[n]), e, etiqueta, estadoCorreo(n)], '', { texto: etiqueta, url: wa });
  };

  poner(['Enlaces para la junta del ' + junta.dia], 'titulo');
  poner(['Envíe cada enlace en privado a su dueño. Dejan de funcionar al terminar el día de la junta, ' +
    'al cerrar la recepción o al crear una junta nueva. Los teléfonos y correos se editan en la pestaña Contactos.'], 'nota');
  poner([''], '');
  poner(['Nombre', 'Cargos', 'Enlace', 'WhatsApp', 'Correo'], 'encabezado');

  poner(['DIRECTORES'], 'seccion');
  cargos.orden.filter(function (n) { return cargos.personas[n].director; }).forEach(filaPersona);
  poner(['ASOCIADOS Y MIEMBROS (participan si el director no puede)'], 'seccion');
  cargos.orden.filter(function (n) { return !cargos.personas[n].director; }).forEach(filaPersona);
  poner(['ENLACE GENERAL'], 'seccion');
  var eg = enlace(GENERAL);
  if (eg) {
    poner(['Miembros de la iglesia', 'Sus puntos llegan como "Por revisar"', eg, 'Elegir contacto', ''], '',
      { texto: 'Elegir contacto', url: linkWhatsApp_('', mensajeGeneral_(junta, eg)) });
  } else {
    poner(['Miembros de la iglesia', '', 'Sin enlace: use Junta → Cambiar el enlace de una persona (GENERAL)'], '');
  }

  h.getRange(1, 1, filas.length, ANCHO).setValues(filas).setWrap(true).setVerticalAlignment('top');
  whatsapp.forEach(function (wa, i) {
    if (!wa) return;
    h.getRange(i + 1, 4).setRichTextValue(
      SpreadsheetApp.newRichTextValue().setText(wa.texto).setLinkUrl(wa.url).build());
  });
  estilos.forEach(function (e, i) {
    var r = h.getRange(i + 1, 1, 1, ANCHO);
    if (e === 'titulo') r.setFontSize(14).setFontWeight('bold');
    if (e === 'nota') { r.merge(); r.setFontColor('#5f6368'); }
    if (e === 'encabezado') r.setFontWeight('bold').setBackground('#673ab7').setFontColor('#ffffff');
    if (e === 'seccion') r.setFontWeight('bold').setBackground('#ede7f6');
  });
  [210, 290, 430, 190, 150].forEach(function (w, i) { h.setColumnWidth(i + 1, w); });
  ss.setActiveSheet(h);
}

// =====================================================================
// CONTACTOS, WHATSAPP Y CORREO
// =====================================================================

/** Lee la pestaña Contactos. La crea si falta y agrega a las personas nuevas de Cargos. */
function leerContactos_(orden) {
  var ss = libro_();
  var h = ss.getSheetByName(HOJA_CONTACTOS);
  if (!h) {
    h = crearHoja_(ss, HOJA_CONTACTOS, ['Nombre', 'Teléfono', 'Correo'], []);
    h.getRange('B:B').setNumberFormat('@'); // para que "+507…" no se tome como fórmula
    [210, 170, 260].forEach(function (w, i) { h.setColumnWidth(i + 1, w); });
    h.getRange('E1').setValue('Teléfono: el número de celular. Si es de otro país, escríbalo con + y el código, por ejemplo +1 555 123 4567.')
      .setFontColor('#5f6368');
  }
  var datos = h.getDataRange().getDisplayValues();
  var mapa = {};
  datos.slice(1).forEach(function (f) {
    var n = String(f[0]).trim();
    if (n) mapa[n] = { telefono: String(f[1]).trim(), correo: String(f[2]).trim() };
  });
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

/** Claves de la junta: { persona: { clave, fila, enviado } } */
function leerClaves_(junta) {
  var hc = hoja_(HOJA_CLAVES);
  if (hc.getRange(1, 4).getValue() !== 'Correo enviado') hc.getRange(1, 4).setValue('Correo enviado');
  var claves = {};
  hc.getDataRange().getValues().forEach(function (f, i) {
    if (i === 0 || textoFecha_(f[1]) !== junta.fecha) return;
    var enviado = f[3] instanceof Date ?
      Utilities.formatDate(f[3], Session.getScriptTimeZone(), 'dd/MM HH:mm') : String(f[3] || '');
    claves[f[2]] = { clave: f[0], fila: i + 1, enviado: enviado };
  });
  return claves;
}

function codigoPais_() {
  return PropertiesService.getScriptProperties().getProperty('CODIGO_PAIS') || CODIGO_PAIS_INICIAL;
}

function cambiarCodigoPais() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Código de país',
    'Código actual: +' + codigoPais_() + '\n\nEscriba el código de país de los teléfonos, solo números (por ejemplo 507):',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var cp = r.getResponseText().replace(/\D/g, '');
  if (!/^\d{1,3}$/.test(cp)) { ui.alert('Código no válido. Use de 1 a 3 números, por ejemplo 507.'); return; }
  PropertiesService.getScriptProperties().setProperty('CODIGO_PAIS', cp);
  if (juntaActual_()) escribirEnlaces_();
  ui.alert('Código de país guardado: +' + cp);
}

/**
 * Convierte un teléfono al formato de WhatsApp (solo números con código de país).
 * Devuelve '' si está vacío y null si no es válido.
 */
function telefonoWa_(tel, cp) {
  var s = String(tel || '').trim();
  if (!s) return '';
  var internacional = /^(\+|00)/.test(s);
  var d = s.replace(/\D/g, '');
  if (/^00/.test(s)) d = d.slice(2);
  // Si ya trae el código de país sin "+" (por ejemplo 50761234567), no se repite.
  var yaTraeCodigo = d.indexOf(cp) === 0 && d.length >= cp.length + 7;
  if (!internacional && !yaTraeCodigo) d = cp + d.replace(/^0+/, '');
  return d.length >= 8 && d.length <= 15 ? d : null;
}

function linkWhatsApp_(tel, mensaje) {
  return 'https://wa.me/' + (tel || '') + '?text=' + encodeURIComponent(mensaje);
}

function mensajeWhatsApp_(nombre, junta, enlace, correo) {
  return 'Hola, ' + nombre.split(' ')[0] + '. Este es su enlace personal para enviar puntos a la ' +
    'Junta Directiva del ' + junta.dia + ':\n\n' + enlace + '\n\n' +
    'Es solo para usted y deja de funcionar al terminar el día de la junta. Por favor no lo reenvíe. ' +
    'Si no abre, pruebe desde el celular o en una ventana de incógnito.' +
    (correo ? '\n\nTambién le enviamos un correo a ' + correo + ' con las instrucciones y una guía para usar el ' +
      'formulario. Por favor revíselo, y si no lo ve, busque en la carpeta de spam o correo no deseado.' : '');
}

function mensajeGeneral_(junta, enlace) {
  return 'Hola. Este es el enlace para que los miembros de la iglesia envíen puntos a la ' +
    'Junta Directiva del ' + junta.dia + ':\n\n' + enlace + '\n\n' +
    'Los puntos serán revisados antes de incluirse en la agenda.';
}

function correoValido_(c) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(c || ''));
}

function personasConCorreo_(nombres) {
  var contactos = leerContactos_(leerCargos_().orden);
  return nombres.filter(function (n) { return contactos[n] && correoValido_(contactos[n].correo); });
}

/** Menú: Junta → Enviar enlaces por correo… */
function enviarCorreos() {
  var ui = SpreadsheetApp.getUi();
  var junta = juntaActual_();
  if (!junta) { ui.alert('No hay una junta abierta. Use Junta → Nueva junta.'); return; }
  var claves = leerClaves_(junta);
  var con = personasConCorreo_(leerCargos_().orden).filter(function (n) { return claves[n]; });
  if (!con.length) {
    ui.alert('Nadie tiene correo todavía. Complete la columna Correo en la pestaña Contactos.');
    return;
  }
  var pendientes = con.filter(function (n) { return !claves[n].enviado; });
  var lista = pendientes;
  if (pendientes.length) {
    if (ui.alert('Enviar por correo',
      'Se enviará el enlace a ' + pendientes.length + ' persona(s) que aún no lo recibieron.\n\n¿Continuar?',
      ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  } else {
    if (ui.alert('Enviar por correo',
      'Las ' + con.length + ' personas con correo ya recibieron su enlace.\n\n¿Reenviarlo a todas?',
      ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
    lista = con;
  }
  enviarCorreosA_(lista);
}

/** Menú: Junta → Actualizar la pestaña Enlaces (después de editar Contactos). */
function actualizarEnlaces() {
  if (!juntaActual_()) { SpreadsheetApp.getUi().alert('No hay una junta abierta.'); return; }
  escribirEnlaces_();
}

function enviarCorreosA_(personas) {
  var ui = SpreadsheetApp.getUi();
  var junta = juntaActual_();
  var url = urlApp_(true);
  if (!junta || !url) return;
  var cuota = MailApp.getRemainingDailyQuota();
  if (cuota < personas.length) {
    ui.alert('Google solo permite enviar ' + cuota + ' correo(s) más hoy. Intente mañana o envíe por WhatsApp.');
    return;
  }
  var cargos = leerCargos_();
  var contactos = leerContactos_(cargos.orden);
  var claves = leerClaves_(junta);
  var hc = hoja_(HOJA_CLAVES);
  var enviados = 0, errores = [];

  personas.forEach(function (n) {
    var c = claves[n];
    if (!c) return;
    var enlace = url + '?t=' + c.clave;
    try {
      MailApp.sendEmail({
        to: contactos[n].correo,
        subject: 'Su enlace para enviar puntos – Junta Directiva del ' + junta.dia,
        body: correoTexto_(n, cargos.personas[n], junta, enlace),
        htmlBody: correoHtml_(n, cargos.personas[n], junta, enlace),
        name: 'Junta Directiva'
      });
      hc.getRange(c.fila, 4).setValue(new Date());
      enviados++;
    } catch (e) {
      errores.push(n + ': ' + e.message);
    }
  });

  escribirEnlaces_();
  ui.alert('Correos enviados: ' + enviados +
    (errores.length ? '\n\nNo se pudo enviar a:\n' + errores.join('\n') : ''));
}

function correoPartes_(nombre, persona, junta, enlace) {
  var cargos = persona.cargos.map(function (c) { return c.cargo + ' – ' + c.departamento; });
  var fecha = junta.fecha;
  return {
    saludo: 'Hola, ' + nombre + ':',
    intro: 'Se convocó la Junta Directiva para el ' + junta.dia + '. Este es su enlace personal para enviar los puntos que desee presentar:',
    cargos: cargos,
    uso: [
      'Abra el enlace, complete el formulario y presione "Enviar".',
      'Puede enviar varios puntos: después de cada envío aparece "Enviar otro punto".',
      cargos.length > 1 ? 'Como tiene más de un cargo, el formulario le preguntará por cuál departamento presenta cada punto.' : '',
      'Los puntos deben llegar ya definidos. Si es para votación, escriba la propuesta tal como se votaría.',
      'Si va a presentar con material de apoyo, puede adjuntar una presentación de PowerPoint, un PDF, un Word o una imagen de hasta 10 MB. Los videos se comparten con un enlace de YouTube o Google Drive.',
      'Si el punto pide dinero de la iglesia, tenga a mano el costo total y la cotización. Puede describirla, pegar un enlace o adjuntar un PDF, Word o imagen de hasta 5 MB.',
      persona.director ? '' : 'Como asociado o miembro, normalmente presenta puntos cuando el director de su departamento no puede hacerlo.'
    ].filter(Boolean),
    vence: [
      'al terminar el día de la junta (' + fecha + ');',
      'si la secretaría cierra la recepción de puntos antes de esa fecha;',
      'cuando se convoca una junta nueva, porque cada junta tiene enlaces nuevos;',
      'si se cambia por seguridad, por ejemplo si se compartió por error. En ese caso recibirá uno nuevo.'
    ],
    cuidado: 'Es personal: los puntos enviados con él quedan a su nombre. Por favor no lo reenvíe. ' +
      'Si otra persona necesita presentar un punto, la secretaría puede darle el enlace general para miembros.',
    problemas: [
      'Si aparece una página de Google Drive que dice "No se pudo abrir el archivo", ábralo desde el celular o en una ventana de incógnito. Pasa cuando el navegador tiene varias cuentas de Google abiertas.',
      'Si dice "Este enlace no es válido", la recepción ya cerró o el enlace cambió. Pida uno nuevo a la secretaría.'
    ],
    pie: 'Este correo se envió automáticamente desde la hoja de la Junta Directiva. Si tiene dudas, responda a este correo.'
  };
}

function correoTexto_(nombre, persona, junta, enlace) {
  var p = correoPartes_(nombre, persona, junta, enlace);
  var lista = function (items) { return items.map(function (x) { return '• ' + x; }).join('\n'); };
  return [
    p.saludo, '', p.intro, '', enlace, '',
    'SUS CARGOS', lista(p.cargos), '',
    'CÓMO USARLO', lista(p.uso), '',
    'CUÁNDO DEJA DE FUNCIONAR EL ENLACE', 'El enlace es solo para esta junta. Deja de funcionar:', lista(p.vence), '',
    'CUIDE SU ENLACE', p.cuidado, '',
    'SI EL ENLACE NO ABRE', lista(p.problemas), '',
    '—', p.pie
  ].join('\n');
}

function correoHtml_(nombre, persona, junta, enlace) {
  var p = correoPartes_(nombre, persona, junta, enlace);
  var e = escHtml_;
  var lista = function (items) {
    return '<ul style="margin:4px 0 0;padding-left:20px">' +
      items.map(function (x) { return '<li style="margin:4px 0">' + e(x) + '</li>'; }).join('') + '</ul>';
  };
  var titulo = function (t) { return '<h3 style="font-size:16px;font-weight:500;margin:24px 0 4px;color:#673ab7">' + e(t) + '</h3>'; };
  return '<div style="font-family:Roboto,Arial,sans-serif;font-size:14px;line-height:1.5;color:#202124;max-width:600px">' +
    '<div style="border-top:8px solid #673ab7;border-radius:4px 4px 0 0;padding-top:16px">' +
    '<h2 style="font-size:24px;font-weight:400;margin:0 0 16px">Puntos para la Junta Directiva</h2></div>' +
    '<p>' + e(p.saludo) + '</p><p>' + e(p.intro) + '</p>' +
    '<p style="margin:20px 0"><a href="' + e(enlace) + '" style="background:#673ab7;color:#ffffff;text-decoration:none;' +
    'padding:10px 24px;border-radius:4px;display:inline-block;font-weight:500">Enviar un punto</a></p>' +
    '<p style="font-size:12px;color:#5f6368">Si el botón no funciona, copie este enlace en su navegador:<br>' +
    '<a href="' + e(enlace) + '" style="color:#673ab7;word-break:break-all">' + e(enlace) + '</a></p>' +
    titulo('Sus cargos') + lista(p.cargos) +
    titulo('Cómo usarlo') + lista(p.uso) +
    titulo('Cuándo deja de funcionar el enlace') + '<p style="margin:4px 0">El enlace es solo para esta junta. Deja de funcionar:</p>' + lista(p.vence) +
    titulo('Cuide su enlace') + '<p style="margin:4px 0">' + e(p.cuidado) + '</p>' +
    titulo('Si el enlace no abre') + lista(p.problemas) +
    '<p style="font-size:12px;color:#5f6368;border-top:1px solid #dadce0;margin-top:24px;padding-top:12px">' + e(p.pie) + '</p>' +
    '</div>';
}

function escHtml_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// =====================================================================
// IMPORTAR DESDE LOS CONTACTOS DE GOOGLE
// =====================================================================

// Palabras que no cuentan al comparar nombres ("Hna. Irene de Arango" = "Irene Arango").
var PALABRAS_IGNORADAS = ['hno', 'hna', 'hermano', 'hermana', 'pr', 'pastor', 'pastora', 'anc', 'anciano', 'anciana',
  'dr', 'dra', 'lic', 'ing', 'prof', 'sr', 'sra', 'srta', 'don', 'dona', 'de', 'del', 'la', 'las', 'los', 'y',
  'iglesia', 'iasd', 'adventista'];

/** Menú: Junta → Importar teléfonos y correos de mis contactos */
function importarContactos() {
  var ui = SpreadsheetApp.getUi();
  var cargos = leerCargos_();
  leerContactos_(cargos.orden); // crea la pestaña y agrega nombres que falten
  var h = hoja_(HOJA_CONTACTOS);

  var google;
  try {
    google = leerContactosGoogle_();
  } catch (e) {
    ui.alert('No se pudieron leer sus contactos de Google.\n\n' + e.message);
    return;
  }
  if (!google.length) {
    ui.alert('No encontré contactos en su cuenta de Google. Revise en contacts.google.com que estén guardados ahí.');
    return;
  }

  var datos = h.getDataRange().getDisplayValues();
  var r = { seguros: [], dudosos: [], varios: [], ninguno: [], sinDatos: [], completos: 0 };

  for (var i = 1; i < datos.length; i++) {
    var nombre = String(datos[i][0]).trim();
    if (!nombre) continue;
    var tel = String(datos[i][1]).trim(), correo = String(datos[i][2]).trim();
    if (tel && correo) { r.completos++; continue; }

    var b = buscarContacto_(nombre, google);
    if (b.tipo === 'ninguno') { r.ninguno.push(nombre); continue; }
    if (b.tipo === 'varios') {
      r.varios.push(nombre + ' (' + b.candidatos.slice(0, 3).map(function (c) { return c.nombre; }).join(', ') + ')');
      continue;
    }

    var c = b.contacto, dudoso = b.tipo === 'dudoso', puso = [];
    var nota = 'Importado de sus contactos de Google: "' + c.nombre + '"' +
      (dudoso ? '. Verifique que sea la persona correcta.' : '');
    var poner = function (col, valor) {
      var celda = h.getRange(i + 1, col);
      celda.setNumberFormat('@').setValue("'" + valor).setNote(nota);
      if (dudoso) celda.setBackground('#fff4ce');
    };
    var t = mejorTelefono_(c), m = mejorCorreo_(c);
    if (!tel && t) { poner(2, t); puso.push('teléfono'); }
    if (!correo && m) { poner(3, m); puso.push('correo'); }
    if (!puso.length) { r.sinDatos.push(nombre); continue; }

    var linea = nombre + ': ' + puso.join(' y ');
    if (dudoso) r.dudosos.push(linea + ' (contacto "' + c.nombre + '")');
    else r.seguros.push(linea);
  }

  if (juntaActual_()) escribirEnlaces_();
  libro_().setActiveSheet(h);

  var lista = function (titulo, items) {
    return items.length ? '\n\n' + titulo + ' (' + items.length + '):\n• ' + items.join('\n• ') : '';
  };
  ui.alert('Importación terminada',
    'Se completaron ' + r.seguros.length + ' persona(s).' +
    (r.completos ? ' ' + r.completos + ' ya tenían teléfono y correo.' : '') +
    lista('PARA VERIFICAR (en amarillo)', r.dudosos) +
    lista('VARIOS CONTACTOS POSIBLES, complete a mano', r.varios) +
    lista('ENCONTRADOS, PERO EL CONTACTO NO TIENE DATOS NUEVOS', r.sinDatos) +
    lista('NO ENCONTRADOS', r.ninguno) +
    '\n\nLo que ya estaba escrito no se cambió.',
    ui.ButtonSet.OK);
}

/** Lee "Contactos" y "Otros contactos" (personas a las que les escribió por Gmail). */
function leerContactosGoogle_() {
  var personas = [], token;
  do {
    var r = People.People.Connections.list('people/me', {
      personFields: 'names,phoneNumbers,emailAddresses', pageSize: 1000, pageToken: token
    });
    personas = personas.concat(r.connections || []);
    token = r.nextPageToken;
  } while (token);

  try {
    token = undefined;
    do {
      var o = People.OtherContacts.list({ readMask: 'names,emailAddresses,phoneNumbers', pageSize: 1000, pageToken: token });
      personas = personas.concat(o.otherContacts || []);
      token = o.nextPageToken;
    } while (token);
  } catch (e) { /* "Otros contactos" es opcional */ }

  return prepararContactosGoogle_(personas);
}

/** Convierte las personas de Google a {nombre, tokens, telefonos, correos}, juntando las de igual nombre. */
function prepararContactosGoogle_(personas) {
  var porNombre = {}, lista = [];
  personas.forEach(function (p) {
    var nombre = p.names && p.names.length ? String(p.names[0].displayName || '') : '';
    var tokens = tokensNombre_(nombre);
    if (!tokens.length) return;
    var clave = tokens.join(' ');
    var c = porNombre[clave];
    if (!c) {
      c = porNombre[clave] = { nombre: nombre, tokens: tokens, telefonos: [], correos: [] };
      lista.push(c);
    }
    (p.phoneNumbers || []).forEach(function (t) {
      var valor = t.canonicalForm || t.value;
      if (valor) c.telefonos.push({ valor: String(valor), movil: /mobile|móvil|celular/i.test((t.type || '') + (t.formattedType || '')) });
    });
    (p.emailAddresses || []).forEach(function (e) {
      if (e.value) c.correos.push({ valor: String(e.value), primario: !!(e.metadata && e.metadata.primary) });
    });
  });
  return lista;
}

function tokensNombre_(s) {
  return normalizar_(s).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter(function (t) { return t && PALABRAS_IGNORADAS.indexOf(t) < 0; });
}

/**
 * Busca a un hermano entre los contactos.
 * seguro: el contacto tiene todas las palabras del nombre (ej. "Hna. Irene Arango").
 * dudoso: solo coincide el primer nombre y el contacto no tiene apellido (ej. "Daniel").
 * varios: más de un contacto posible. ninguno: no se encontró.
 */
function buscarContacto_(nombre, contactos) {
  var t = tokensNombre_(nombre);
  if (!t.length) return { tipo: 'ninguno' };
  var tiene = function (c, x) { return c.tokens.indexOf(x) >= 0; };

  var seguros = contactos.filter(function (c) { return t.every(function (x) { return tiene(c, x); }); });
  if (seguros.length > 1) {
    var exactos = seguros.filter(function (c) { return c.tokens.length === t.length; });
    if (exactos.length === 1) seguros = exactos;
  }
  if (seguros.length === 1) return { tipo: 'seguro', contacto: seguros[0] };
  if (seguros.length > 1) return { tipo: 'varios', candidatos: seguros };

  var dudosos = contactos.filter(function (c) {
    return tiene(c, t[0]) && (c.tokens.length === 1 || t.slice(1).some(function (x) { return tiene(c, x); }));
  });
  if (dudosos.length === 1) return { tipo: 'dudoso', contacto: dudosos[0] };
  if (dudosos.length > 1) return { tipo: 'varios', candidatos: dudosos };
  return { tipo: 'ninguno' };
}

function mejorTelefono_(c) {
  var t = c.telefonos.filter(function (x) { return x.movil; })[0] || c.telefonos[0];
  return t ? t.valor : '';
}

function mejorCorreo_(c) {
  var e = c.correos.filter(function (x) { return x.primario; })[0] || c.correos[0];
  return e ? e.valor : '';
}

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

function juntaActual_() {
  var filas = hoja_(HOJA_JUNTAS).getDataRange().getValues();
  for (var i = filas.length - 1; i >= 1; i--) {
    if (filas[i][2] === 'Abierta') return { fila: i + 1, fecha: textoFecha_(filas[i][0]), dia: String(filas[i][1]) };
  }
  return null;
}

function cerrarTodas_() {
  var h = hoja_(HOJA_JUNTAS);
  var filas = h.getDataRange().getValues();
  for (var i = 1; i < filas.length; i++) {
    if (filas[i][2] === 'Abierta') h.getRange(i + 1, 3).setValue('Cerrada');
  }
}

function urlApp_(preguntar) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('URL_APP');
  if (url) return url;
  // No se usa ScriptApp.getService().getUrl(): puede devolver la URL de otra
  // implementación y los enlaces no abrirían. Siempre se pide a la persona.
  return preguntar ? pedirUrl_('') : '';
}

/** Siempre muestra el cuadro para pegar la URL. Devuelve la URL guardada o ''. */
function pedirUrl_(textoAntes) {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('URL de la aplicación',
    textoAntes + 'Pegue la URL de la aplicación web. Está en Apps Script → ' +
    'Implementar → Gestionar implementaciones, y termina en /exec',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return '';
  var url = r.getResponseText().trim().replace(/\?.*$/, '');
  if (!/^https:\/\/script\.google\.com\/\S+\/exec$/.test(url)) {
    ui.alert('Esa URL no parece correcta. Debe empezar con https://script.google.com/ y terminar en /exec');
    return '';
  }
  PropertiesService.getScriptProperties().setProperty('URL_APP', url);
  return url;
}

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

function aviso_(titulo, texto) {
  try { SpreadsheetApp.getUi().alert(titulo, texto, SpreadsheetApp.getUi().ButtonSet.OK); }
  catch (e) { Logger.log(titulo + ': ' + texto); }
}

function nuevaClave_() {
  return Utilities.getUuid().replace(/-/g, '');
}

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
