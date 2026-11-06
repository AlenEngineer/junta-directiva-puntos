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
    .addItem('Cambiar el contacto de ayuda…', 'cambiarContactoAyuda')
    .addSeparator()
    .addItem('Acerca de / versión', 'acercaDe')
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
  asegurarEsquema_();

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
  asegurarEsquema_();
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
  juntaAgregar_(f.texto, dia);

  // Claves nuevas para cada persona y para el enlace general.
  var cargos = leerCargos_();
  clavesReemplazarTodas_(f.texto, cargos.orden.concat([GENERAL]));

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
  asegurarEsquema_();
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

  claveCambiar_(junta.fecha, persona);

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
  asegurarEsquema_();
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

/** Menú: quién recibe los mensajes de "¿Necesita ayuda?" del formulario. */
function cambiarContactoAyuda() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var actual = props.getProperty('CONTACTO_AYUDA');
  var r = ui.prompt('Contacto de ayuda',
    'Quien recibe por WhatsApp los mensajes de "¿Necesita ayuda?" del formulario.\n' +
    'Ahora: ' + (actual || 'quien dirige Secretaría') + '\n\n' +
    'Escriba el nombre como aparece en la pestaña Cargos.\n' +
    'Déjelo vacío para que sea quien dirige Secretaría.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var buscado = normalizar_(r.getResponseText());
  if (!buscado) {
    props.deleteProperty('CONTACTO_AYUDA');
  } else {
    var nombre = leerCargos_().orden.filter(function (n) { return normalizar_(n) === buscado; })[0];
    if (!nombre) { ui.alert('No encontré a "' + r.getResponseText() + '" en la pestaña Cargos.'); return; }
    props.setProperty('CONTACTO_AYUDA', nombre);
  }
  var c = contactoAyuda_();
  ui.alert(c ? 'Listo. Los mensajes de ayuda le llegarán a ' + c.nombre + ' por WhatsApp.'
    : 'Guardado, pero esa persona no tiene un teléfono válido en la pestaña Contactos: el botón de ayuda no se mostrará hasta que lo tenga.');
}

function acercaDe() {
  aviso_('Puntos para la Junta Directiva',
    'Versión ' + VERSION + '\n\n' +
    'Qué cambió en cada versión:\n' + REPOSITORIO + '/blob/main/CHANGELOG.md\n\n' +
    'Código abierto con licencia MIT.');
}

function cambiarUrl() {
  var actual = PropertiesService.getScriptProperties().getProperty('URL_APP') || '(ninguna)';
  if (pedirUrl_('URL guardada ahora:\n' + actual + '\n\n')) {
    if (juntaActual_()) escribirEnlaces_();
    SpreadsheetApp.getUi().alert('URL guardada. Los enlaces de la pestaña "Enlaces" se actualizaron.');
  }
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

/** Menú: Junta → Actualizar la pestaña Enlaces (después de editar Contactos). */
function actualizarEnlaces() {
  asegurarEsquema_();
  if (!juntaActual_()) { SpreadsheetApp.getUi().alert('No hay una junta abierta.'); return; }
  escribirEnlaces_();
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

function aviso_(titulo, texto) {
  try { SpreadsheetApp.getUi().alert(titulo, texto, SpreadsheetApp.getUi().ButtonSet.OK); }
  catch (e) { Logger.log(titulo + ': ' + texto); }
}
