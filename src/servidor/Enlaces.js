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

function codigoPais_() {
  return PropertiesService.getScriptProperties().getProperty('CODIGO_PAIS') || CODIGO_PAIS_INICIAL;
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

/**
 * Quién recibe los pedidos de ayuda del formulario: la persona configurada en
 * Junta → Cambiar el contacto de ayuda…, o si no hay, quien dirige Secretaría.
 * Devuelve { nombre, url } con un enlace de WhatsApp, o null si no tiene teléfono.
 */
function contactoAyuda_() {
  var cargos = leerCargos_();
  var nombre = PropertiesService.getScriptProperties().getProperty('CONTACTO_AYUDA');
  if (!nombre || !cargos.personas[nombre]) {
    nombre = cargos.orden.filter(function (n) {
      return cargos.personas[n].cargos.some(function (c) {
        return normalizar_(c.departamento) === normalizar_('Secretaría') && c.director;
      });
    })[0];
  }
  if (!nombre) return null;
  var contacto = contactosFilas_().filter(function (c) { return c.nombre === nombre; })[0];
  var tel = contacto && telefonoWa_(contacto.telefono, codigoPais_());
  if (!tel) return null;
  var primero = nombre.split(' ')[0];
  return {
    nombre: primero,
    url: linkWhatsApp_(tel, 'Hola, ' + primero + '. Necesito ayuda con el formulario de puntos para la Junta Directiva.')
  };
}
