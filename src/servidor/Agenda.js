function generarAgenda() {
  exigirAdmin_();
  asegurarEsquema_();
  var ui = SpreadsheetApp.getUi();
  var ss = libro_();

  var juntas = juntasLeer_();
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

  var r2 = generarAgendaHoja_(junta);
  ui.alert('Agenda lista: ' + r2.puntos + ' punto(s).' +
    (r2.pendientes ? '\n\nHay ' + r2.pendientes + ' punto(s) del enlace general por revisar. ' +
      'Apruébelos en el panel (o cambie su Estado a "Aprobado" en la pestaña Puntos) y genere la agenda otra vez.' : ''));
}

/**
 * Arma la agenda de una junta: { secciones: [{ categoria, puntos }], pendientes }.
 * Incluye los puntos Recibidos y Aprobados; los Por revisar van aparte y los Rechazados no van.
 * Dentro de cada sección, el orden lo da "Orden en agenda" y luego la fecha de envío.
 */
function agendaDeJunta_(junta) {
  var todos = puntosLeer_().filter(function (p) { return textoFecha_(p['Junta']) === junta.fecha; });
  var orden = function (p) { var n = Number(p['Orden en agenda']); return p['Orden en agenda'] === '' || isNaN(n) ? 1e9 : n; };
  todos.sort(function (a, b) { return (orden(a) - orden(b)) || (a['Fecha de envío'] - b['Fecha de envío']); });
  var incluidos = todos.filter(function (p) { return ['Por revisar', 'Rechazado'].indexOf(p['Estado']) < 0; });
  return {
    secciones: CATEGORIAS.map(function (cat) {
      return { categoria: cat, puntos: incluidos.filter(function (p) { return categoriaVigente_(p['Categoría']) === cat; }) };
    }),
    pendientes: todos.filter(function (p) { return p['Estado'] === 'Por revisar'; })
  };
}

/** Crea (o reemplaza) la pestaña "Agenda dd-mm-aaaa". Devuelve { hoja, puntos, pendientes, minutos }. */
function generarAgendaHoja_(junta) {
  var ss = libro_();
  var agenda = agendaDeJunta_(junta);
  var v = function (punto, col) { return punto[col] == null ? '' : punto[col]; };
  var COLS = ['#', 'Punto', 'Presenta', 'Tipo', 'Tiempo asignado', 'Descripción y propuesta', 'Actividad', 'Presupuesto'];
  var filas = [], estilos = [], n = 0, solicitado = 0, minutos = 0, incluidos = 0;

  function agregar(fila, estilo) {
    while (fila.length < COLS.length) fila.push('');
    filas.push(fila); estilos.push(estilo);
  }
  function fijo(texto) { agregar([++n, texto], 'fijo'); }
  function filaPunto(f, numerar) {
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
    var descripcion = String(v(f, 'Descripción y propuesta'));
    if (v(f, 'Material de apoyo (archivo)')) descripcion += '\n\nMaterial (archivo): ' + v(f, 'Material de apoyo (archivo)');
    if (v(f, 'Material de apoyo (enlace)')) descripcion += '\n' + (v(f, 'Material de apoyo (archivo)') ? '' : '\n') +
      'Material (enlace): ' + v(f, 'Material de apoyo (enlace)');
    var min = Number(v(f, 'Tiempo asignado (min)')) || 0;
    if (numerar) { minutos += min; incluidos++; }
    return [numerar ? ++n : '', v(f, 'Título'), v(f, 'Presenta') + '\n(' + v(f, 'Departamento') + ')',
      v(f, 'Tipo'), min ? min + ' min' : '', descripcion, actividad, presupuesto];
  }
  function seccion(sec) {
    agregar(['', sec.categoria.toUpperCase()], 'seccion');
    if (!sec.puntos.length) agregar(['', 'Sin puntos presentados'], 'vacio');
    sec.puntos.forEach(function (f) { agregar(filaPunto(f, true), 'punto'); });
  }

  fijo(FIJO_APERTURA);
  seccion(agenda.secciones[0]); // Evangelismo primero, según el Manual de la Iglesia
  fijo(FIJO_ACTA);
  agenda.secciones.slice(1).forEach(seccion);
  fijo(FIJO_CIERRE);

  if (agenda.pendientes.length) {
    agregar(['', 'PENDIENTES DE REVISIÓN (enviados por el enlace general, no incluidos)'], 'seccion');
    agenda.pendientes.forEach(function (f) { agregar(filaPunto(f, false), 'vacio'); });
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
    ['Tiempo asignado a los puntos: ' + minutos + ' min'],
    ['Total solicitado a la iglesia: ' + solicitado]
  ]).setFontWeight('bold');

  [40, 220, 190, 120, 100, 320, 210, 280].forEach(function (w, i) { h.setColumnWidth(i + 1, w); });
  h.setFrozenRows(3);
  try { ss.setActiveSheet(h); } catch (e) { /* desde el panel no hay hoja abierta */ }
  return { hoja: nombreHoja, puntos: incluidos, pendientes: agenda.pendientes.length, minutos: minutos };
}
