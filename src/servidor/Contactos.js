// Palabras que no cuentan al comparar nombres ("Hna. Irene de Arango" = "Irene Arango").
var PALABRAS_IGNORADAS = ['hno', 'hna', 'hermano', 'hermana', 'pr', 'pastor', 'pastora', 'anc', 'anciano', 'anciana',
  'dr', 'dra', 'lic', 'ing', 'prof', 'sr', 'sra', 'srta', 'don', 'dona', 'de', 'del', 'la', 'las', 'los', 'y',
  'iglesia', 'iasd', 'adventista'];

/** Menú: Junta → Importar teléfonos y correos de mis contactos */
function importarContactos() {
  asegurarEsquema_();
  var ui = SpreadsheetApp.getUi();
  var cargos = leerCargos_();
  leerContactos_(cargos.orden); // crea la pestaña y agrega nombres que falten

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

  var r = { seguros: [], dudosos: [], varios: [], ninguno: [], sinDatos: [], completos: 0 };

  contactosFilas_().forEach(function (fila) {
    var nombre = fila.nombre, tel = fila.telefono, correo = fila.correo;
    if (tel && correo) { r.completos++; return; }

    var b = buscarContacto_(nombre, google);
    if (b.tipo === 'ninguno') { r.ninguno.push(nombre); return; }
    if (b.tipo === 'varios') {
      r.varios.push(nombre + ' (' + b.candidatos.slice(0, 3).map(function (c) { return c.nombre; }).join(', ') + ')');
      return;
    }

    var c = b.contacto, dudoso = b.tipo === 'dudoso', puso = [];
    var nota = 'Importado de sus contactos de Google: "' + c.nombre + '"' +
      (dudoso ? '. Verifique que sea la persona correcta.' : '');
    var t = mejorTelefono_(c), m = mejorCorreo_(c);
    if (!tel && t) { contactoPoner_(fila._fila, 'telefono', t, nota, dudoso); puso.push('teléfono'); }
    if (!correo && m) { contactoPoner_(fila._fila, 'correo', m, nota, dudoso); puso.push('correo'); }
    if (!puso.length) { r.sinDatos.push(nombre); return; }

    var linea = nombre + ': ' + puso.join(' y ');
    if (dudoso) r.dudosos.push(linea + ' (contacto "' + c.nombre + '")');
    else r.seguros.push(linea);
  });

  if (juntaActual_()) escribirEnlaces_();
  libro_().setActiveSheet(hojaContactos_());

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
