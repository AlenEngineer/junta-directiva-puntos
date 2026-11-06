function correoValido_(c) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(c || ''));
}

function personasConCorreo_(nombres) {
  var contactos = leerContactos_(leerCargos_().orden);
  return nombres.filter(function (n) { return contactos[n] && correoValido_(contactos[n].correo); });
}

/** Menú: Junta → Enviar enlaces por correo… */
function enviarCorreos() {
  exigirAdmin_();
  asegurarEsquema_();
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

function enviarCorreosA_(personas) {
  var ui = SpreadsheetApp.getUi();
  var junta = juntaActual_();
  var url = urlApp_(true);
  if (!junta || !url) return;
  var r;
  try { r = enviarCorreosNucleo_(junta, url, personas); } catch (e) { ui.alert(e.message); return; }
  escribirEnlaces_();
  ui.alert('Correos enviados: ' + r.enviados +
    (r.errores.length ? '\n\nNo se pudo enviar a:\n' + r.errores.join('\n') : ''));
}

/** Envía los correos sin mostrar cuadros (lo usan el menú y el panel). Devuelve { enviados, errores }. */
function enviarCorreosNucleo_(junta, url, personas) {
  var cuota = MailApp.getRemainingDailyQuota();
  if (cuota < personas.length) {
    throw new Error('Google solo permite enviar ' + cuota + ' correo(s) más hoy. Intente mañana o envíe por WhatsApp.');
  }
  var cargos = leerCargos_();
  var contactos = leerContactos_(cargos.orden);
  var claves = leerClaves_(junta);
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
      claveMarcarCorreo_(c.fila);
      enviados++;
    } catch (e) {
      errores.push(n + ': ' + e.message);
    }
  });
  return { enviados: enviados, errores: errores };
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
