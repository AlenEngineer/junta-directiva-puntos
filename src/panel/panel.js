// Lógica del panel. DATOS lo pone el servidor (Panel.js → panelPagina_): { usuario, version } o null sin permiso.
(function () {
  var D = DATOS;
  var $ = function (id) { return document.getElementById(id); };
  if (!D) { $('sin-acceso').classList.remove('oculto'); return; }

  $('usuario').textContent = D.usuario;
  $('version').textContent = 'v' + D.version;
  $('panel').classList.remove('oculto');

  var info = null;        // respuesta de panelDatos
  var puntos = [];        // puntos de la junta elegida
  var abiertos = {};      // id → detalle abierto
  var ORDEN_ESTADO = { 'Por revisar': 0, 'Recibido': 1, 'Aprobado': 2, 'Rechazado': 3 };

  // ---------- Servidor ----------
  function llamar(funcion, args, ok) {
    var r = google.script.run
      .withSuccessHandler(ok)
      .withFailureHandler(function (e) {
        avisar(mensajeError(e), true);
        $('cargando').classList.add('oculto');
        if (info && puntos.length) mostrar(); // vuelve a habilitar los botones
        if (vista === 'enlaces' && enlaces) mostrarEnlaces();
      });
    r[funcion].apply(r, args);
  }
  function mensajeError(e) { return String((e && e.message) || e).replace(/^(Exception|Error):\s*/, ''); }
  var avisoTimer = null;
  function avisar(texto, esError) {
    var a = $('aviso');
    a.textContent = texto;
    a.classList.toggle('error', !!esError);
    a.classList.remove('oculto');
    clearTimeout(avisoTimer);
    avisoTimer = setTimeout(function () { a.classList.add('oculto'); }, esError ? 8000 : 3000);
  }

  // ---------- Inicio ----------
  function opcion(sel, valor, texto) { var o = document.createElement('option'); o.value = valor; o.textContent = texto; sel.appendChild(o); }
  llamar('panelDatos', [], function (d) {
    info = d;
    if (!d.juntas.length) { opcion($('junta'), '', 'Todavía no hay juntas'); $('cargando').textContent = 'Todavía no hay juntas. Cree una desde la hoja: Junta → Nueva junta.'; return; }
    d.juntas.forEach(function (j) { opcion($('junta'), j.fecha, j.dia + (j.estado === 'Abierta' ? ' (abierta)' : '')); });
    $('junta').value = d.seleccionada;
    d.estados.forEach(function (e) { opcion($('f-estado'), e, e); });
    d.categorias.forEach(function (c) { opcion($('f-categoria'), c, c); });
    cargarPuntos();
  });

  function cargarPuntos() {
    $('cargando').classList.remove('oculto');
    $('cargando').textContent = 'Cargando…';
    $('lista').innerHTML = '';
    llamar('panelPuntos', [$('junta').value], function (lista) {
      puntos = lista || [];
      abiertos = {};
      // Departamentos presentes en esta junta
      var sel = $('f-depto'), actual = sel.value;
      sel.innerHTML = '';
      opcion(sel, '', 'Todos');
      puntos.map(function (p) { return p.departamento; })
        .filter(function (d, i, a) { return d && a.indexOf(d) === i; }).sort()
        .forEach(function (d) { opcion(sel, d, d); });
      sel.value = actual;
      if (sel.value !== actual) sel.value = '';
      $('cargando').classList.add('oculto');
      mostrar();
    });
  }

  // ---------- Lista ----------
  function normal(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function filtrados() {
    var fe = $('f-estado').value, fc = $('f-categoria').value, fd = $('f-depto').value, ft = normal($('f-texto').value.trim());
    return puntos.filter(function (p) {
      if (fe && p.estado !== fe) return false;
      if (fc && p.categoria !== fc) return false;
      if (fd && p.departamento !== fd) return false;
      if (ft && normal([p.titulo, p.presenta, p.departamento, p.descripcion].join(' ')).indexOf(ft) < 0) return false;
      return true;
    }).sort(function (a, b) {
      return (ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado]) ||
        (info.categorias.indexOf(a.categoria) - info.categorias.indexOf(b.categoria)) ||
        (a.enviado < b.enviado ? -1 : a.enviado > b.enviado ? 1 : 0);
    });
  }

  function claseEstado(e) { return normal(e).replace(/\s+/g, '-'); }
  function dinero(n) { return info.moneda + ' ' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function el(tag, clase, texto) {
    var e = document.createElement(tag);
    if (clase) e.className = clase;
    if (texto != null) e.textContent = texto;
    return e;
  }
  function enlace(url, texto) {
    var a = el('a', '', texto);
    a.href = url; a.target = '_blank'; a.rel = 'noopener';
    return a;
  }

  function mostrar() {
    var lista = filtrados();
    var porRevisar = puntos.filter(function (p) { return p.estado === 'Por revisar'; }).length;
    var res = $('resumen');
    res.innerHTML = '';
    res.appendChild(el('span', '', puntos.length + (puntos.length === 1 ? ' punto' : ' puntos') +
      (lista.length !== puntos.length ? ' · mostrando ' + lista.length : '')));
    if (porRevisar) {
      var b = el('button', 'chip filtro', porRevisar + ' por revisar');
      b.type = 'button';
      b.addEventListener('click', function () { $('f-estado').value = 'Por revisar'; mostrar(); });
      res.appendChild(b);
    }
    var cont = $('lista');
    cont.innerHTML = '';
    if (!lista.length) {
      cont.appendChild(el('div', 'tarjeta vacio', puntos.length ? 'Ningún punto coincide con los filtros.' : 'Todavía no hay puntos para esta junta.'));
      return;
    }
    lista.forEach(function (p) { cont.appendChild(tarjeta(p)); });
  }

  function tarjeta(p) {
    var t = el('article', 'tarjeta punto' + (p.estado === 'Por revisar' ? ' por-revisar' : ''));
    t.dataset.id = p.id;
    var cabeza = el('div', 'punto-cabeza');
    cabeza.setAttribute('role', 'button');
    cabeza.tabIndex = 0;
    cabeza.setAttribute('aria-expanded', String(!!abiertos[p.id]));
    var chips = el('div', 'punto-chips');
    chips.appendChild(el('span', 'chip ' + claseEstado(p.estado), p.estado));
    chips.appendChild(el('span', 'chip categoria', p.categoria));
    cabeza.appendChild(chips);
    cabeza.appendChild(el('div', 'punto-titulo', p.titulo));
    var meta = [p.presenta + ' (' + p.departamento + ')', p.tipo];
    if (p.dinero) meta.push('pide ' + dinero(p.dinero.monto));
    if (p.actividad) meta.push('actividad ' + p.actividad.inicio + (p.actividad.fin ? ' al ' + p.actividad.fin : ''));
    meta.push('enviado ' + p.enviado + (p.ediciones ? ' · editado ' + p.ediciones + (p.ediciones === 1 ? ' vez' : ' veces') : ''));
    cabeza.appendChild(el('div', 'punto-meta', meta.join(' · ')));
    var alternar = function () { abiertos[p.id] = !abiertos[p.id]; mostrar(); };
    cabeza.addEventListener('click', alternar);
    cabeza.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alternar(); } });
    t.appendChild(cabeza);
    if (abiertos[p.id]) t.appendChild(detalle(p));
    return t;
  }

  function bloque(titulo, contenido) {
    var b = el('div', 'bloque');
    b.appendChild(el('h3', '', titulo));
    b.appendChild(contenido);
    return b;
  }
  function datos(pares) {
    var dl = el('dl', 'datos');
    pares.forEach(function (x) {
      if (x[1] == null || x[1] === '') return;
      dl.appendChild(el('dt', '', x[0]));
      var dd = el('dd');
      if (x[1].nodeType) dd.appendChild(x[1]); else dd.textContent = x[1];
      dl.appendChild(dd);
    });
    return dl;
  }

  function detalle(p) {
    var d = el('div', 'punto-detalle');
    d.appendChild(bloque(p.tipo === 'Informativo' ? 'Descripción del informe' : 'Descripción y propuesta', el('p', '', p.descripcion)));
    if (p.actividad) {
      var a = p.actividad;
      d.appendChild(bloque('Actividad', datos([
        ['Fecha', a.fin ? a.inicio + ' al ' + a.fin : a.inicio],
        ['Hora', a.horaInicio + (a.horaFin ? ' a ' + a.horaFin : '')],
        ['Lugar', a.lugar], ['Responsable', a.responsable], ['Asistencia', a.asistencia]])));
    }
    if (p.dinero) {
      var m = p.dinero;
      d.appendChild(bloque('Presupuesto', datos([
        ['Costo total', dinero(m.costo)], ['Pide a la iglesia', dinero(m.monto)],
        ['El resto', m.estrategia], ['Explicación', m.descripcion],
        ['Cotización', m.archivo ? enlace(m.archivo, 'Abrir el archivo') : (m.enlace ? enlace(m.enlace, 'Abrir el enlace') : '')]])));
    }
    if (p.material.archivo || p.material.enlace) {
      var f = el('div', 'acciones');
      if (p.material.archivo) f.appendChild(enlace(p.material.archivo, 'Abrir el archivo'));
      if (p.material.enlace) f.appendChild(enlace(p.material.enlace, 'Abrir el enlace'));
      d.appendChild(bloque('Material de apoyo', f));
    }
    if (p.general) d.appendChild(bloque('Origen', el('p', '', 'Enviado por el enlace general (miembro de la iglesia).')));
    if (p.ultimaEdicion) d.appendChild(bloque('Última edición', el('p', '', p.ultimaEdicion)));

    var acciones = el('div', 'acciones');
    var boton = function (texto, clase, estado) {
      if (p.estado === estado) return;
      var b = el('button', 'btn ' + clase, texto);
      b.type = 'button';
      b.addEventListener('click', function () { cambiarEstado(p, estado, acciones); });
      acciones.appendChild(b);
    };
    boton('✓ Aprobar', 'btn-aprobar', 'Aprobado');
    boton('✕ Rechazar', 'btn-rechazar', 'Rechazado');
    boton(p.general ? 'Volver a "Por revisar"' : 'Volver a "Recibido"', 'btn-neutro', p.general ? 'Por revisar' : 'Recibido');
    d.appendChild(bloque('Estado', acciones));
    return d;
  }

  function cambiarEstado(p, estado, acciones) {
    if (estado === 'Rechazado' && !confirm('¿Rechazar "' + p.titulo + '"? No aparecerá en la agenda.')) return;
    acciones.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
    llamar('panelCambiarEstado', [p.id, estado], function () {
      p.estado = estado;
      avisar('"' + p.titulo + '": ' + estado.toLowerCase() + '.');
      mostrar();
    });
  }

  // ---------- Pestañas ----------
  var vista = 'puntos';
  document.querySelectorAll('.pestana[data-vista]').forEach(function (b) {
    b.addEventListener('click', function () { cambiarVista(b.dataset.vista); });
  });
  function cambiarVista(nueva) {
    guardarPendiente();
    vista = nueva;
    document.querySelectorAll('.pestana[data-vista]').forEach(function (b) {
      var activa = b.dataset.vista === nueva;
      b.classList.toggle('activa', activa);
      if (activa) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    var de = { puntos: ['filtros', 'resumen', 'lista'], agenda: ['agenda-barra', 'agenda'], enlaces: ['enlaces-barra', 'enlaces'] };
    Object.keys(de).forEach(function (v) { de[v].forEach(function (id) { $(id).classList.toggle('oculto', v !== nueva); }); });
    // Los enlaces son solo de la junta abierta: no se elige junta.
    $('junta-grupo').classList.toggle('oculto', nueva === 'enlaces');
    recargar();
  }
  function recargar() {
    guardarPendiente();
    if (vista === 'agenda') cargarAgenda(); else if (vista === 'enlaces') cargarEnlaces(); else cargarPuntos();
  }
  // Si quedan cambios de la agenda esperando, se guardan ya (antes de cambiar de junta o de pestaña).
  function guardarPendiente() {
    if (agenda && Object.keys(sucias).length) { clearTimeout(guardarTimer); guardarAgenda(); }
  }

  // ---------- Agenda ----------
  var agenda = null;          // respuesta de panelAgenda
  var sucias = {};            // categorías con cambios sin guardar
  var guardarTimer = null;

  function cargarAgenda() {
    if (!$('junta').value) return;
    $('cargando').classList.remove('oculto');
    $('cargando').textContent = 'Cargando…';
    $('agenda').innerHTML = '';
    llamar('panelAgenda', [$('junta').value], function (a) {
      agenda = a;
      sucias = {};
      $('cargando').classList.add('oculto');
      $('agenda-estado').textContent = '';
      mostrarAgenda();
    });
  }

  function totalMinutos() {
    return agenda.secciones.reduce(function (t, s) {
      return t + s.puntos.reduce(function (u, p) { return u + (p.minutos || 0); }, 0);
    }, 0);
  }
  function textoMinutos(m) {
    var h = Math.floor(m / 60), r = m % 60;
    return h ? h + ' h' + (r ? ' ' + r + ' min' : '') : m + ' min';
  }

  function mostrarAgenda() {
    var cont = $('agenda');
    cont.innerHTML = '';
    var n = 0;
    var cuenta = agenda.secciones.reduce(function (t, s) { return t + s.puntos.length; }, 0);
    $('agenda-total').textContent = cuenta + (cuenta === 1 ? ' punto' : ' puntos') + ' · tiempo asignado: ' + textoMinutos(totalMinutos());
    var fijo = function (texto) {
      var t = el('div', 'tarjeta fijo-agenda', (++n) + '. ' + texto);
      cont.appendChild(t);
    };
    var seccion = function (s) {
      var t = el('section', 'tarjeta seccion-agenda');
      t.appendChild(el('h2', '', s.categoria));
      if (!s.puntos.length) t.appendChild(el('div', 'sin-puntos', 'Sin puntos presentados'));
      s.puntos.forEach(function (p, i) { t.appendChild(filaAgenda(s, p, i, ++n)); });
      cont.appendChild(t);
    };
    fijo(agenda.fijos.apertura);
    seccion(agenda.secciones[0]);
    fijo(agenda.fijos.acta);
    agenda.secciones.slice(1).forEach(seccion);
    fijo(agenda.fijos.cierre);
    if (agenda.pendientes.length) {
      var t = el('section', 'tarjeta seccion-agenda');
      t.appendChild(el('h2', '', 'Por revisar (no entran en la agenda)'));
      agenda.pendientes.forEach(function (p) {
        var f = el('div', 'fila-agenda');
        var tx = el('div', 'texto');
        tx.appendChild(el('b', '', p.titulo));
        tx.appendChild(el('span', '', p.presenta + ' · apruébelo en la pestaña Puntos para incluirlo'));
        f.appendChild(tx);
        t.appendChild(f);
      });
      cont.appendChild(t);
    }
  }

  function filaAgenda(s, p, i, numero) {
    var f = el('div', 'fila-agenda');
    f.dataset.id = p.id;
    f.appendChild(el('span', 'num', numero + '.'));
    var tx = el('div', 'texto');
    tx.appendChild(el('b', '', p.titulo));
    tx.appendChild(el('span', '', p.presenta + ' (' + p.departamento + ') · ' + p.tipo));
    f.appendChild(tx);
    var sel = el('select');
    sel.setAttribute('aria-label', 'Tiempo para "' + p.titulo + '"');
    var o0 = el('option', '', 'Tiempo…'); o0.value = '0'; sel.appendChild(o0);
    agenda.tiempos.forEach(function (m) { var o = el('option', '', m + ' min'); o.value = String(m); sel.appendChild(o); });
    sel.value = String(p.minutos || 0);
    sel.addEventListener('change', function () { p.minutos = Number(sel.value); marcar(s); mostrarAgenda(); });
    f.appendChild(sel);
    var mover = el('div', 'mover');
    var boton = function (texto, etiqueta, delta, deshabilitado) {
      var b = el('button', '', texto);
      b.type = 'button';
      b.setAttribute('aria-label', etiqueta + ' "' + p.titulo + '"');
      b.disabled = deshabilitado;
      b.addEventListener('click', function () {
        var j = i + delta;
        var tmp = s.puntos[i]; s.puntos[i] = s.puntos[j]; s.puntos[j] = tmp;
        marcar(s);
        mostrarAgenda();
        var fila = document.querySelector('.fila-agenda[data-id="' + p.id + '"] .mover button:not(:disabled)');
        if (fila) fila.focus();
      });
      mover.appendChild(b);
    };
    boton('▲', 'Subir', -1, i === 0);
    boton('▼', 'Bajar', 1, i === s.puntos.length - 1);
    f.appendChild(mover);
    return f;
  }

  // Guardado automático: se envía la sección completa para que su orden quede fijo.
  function marcar(s) {
    sucias[s.categoria] = true;
    $('agenda-estado').textContent = 'Guardando…';
    clearTimeout(guardarTimer);
    guardarTimer = setTimeout(guardarAgenda, 800);
  }
  function guardarAgenda() {
    var cambios = [];
    agenda.secciones.forEach(function (s) {
      if (!sucias[s.categoria]) return;
      s.puntos.forEach(function (p, i) { cambios.push({ id: p.id, orden: i + 1, minutos: p.minutos || 0 }); });
    });
    if (!cambios.length) return;
    sucias = {};
    llamar('panelGuardarAgenda', [agenda.junta.fecha, cambios], function () {
      $('agenda-estado').textContent = 'Guardado ✓';
    });
  }

  $('agenda-hoja').addEventListener('click', function () {
    var b = $('agenda-hoja');
    b.disabled = true;
    var generar = function () {
      llamar('panelGenerarAgendaHoja', [agenda.junta.fecha], function (r) {
        b.disabled = false;
        avisar('Listo: pestaña "' + r.hoja + '" en la hoja, con ' + r.puntos + ' punto(s).' +
          (r.pendientes ? ' Hay ' + r.pendientes + ' por revisar.' : ''));
      });
    };
    // Si hay cambios esperando, se guardan antes de generar.
    if (Object.keys(sucias).length) { clearTimeout(guardarTimer); guardarAgenda(); setTimeout(generar, 300); } else generar();
  });

  $('agenda-imprimir').addEventListener('click', function () {
    var imp = $('imprimible');
    imp.innerHTML = '';
    imp.appendChild(el('h1', '', 'Agenda de la Junta Directiva'));
    imp.appendChild(el('p', 'sub', agenda.junta.dia + (totalMinutos() ? ' · tiempo asignado a los puntos: ' + textoMinutos(totalMinutos()) : '')));
    var ol = el('ol');
    var item = function (texto, min, quien) {
      var li = el('li');
      if (min) li.appendChild(el('span', 'min', min + ' min'));
      li.appendChild(document.createTextNode(texto));
      if (quien) { li.appendChild(el('br')); li.appendChild(el('span', 'quien', quien)); }
      ol.appendChild(li);
    };
    var seccion = function (s) {
      ol.appendChild(el('li', 'sec', s.categoria));
      if (!s.puntos.length) ol.appendChild(el('li', 'vacio-imp', 'Sin puntos presentados'));
      s.puntos.forEach(function (p) { item(p.titulo, p.minutos, p.presenta + ' (' + p.departamento + ') · ' + p.tipo); });
    };
    item(agenda.fijos.apertura);
    seccion(agenda.secciones[0]);
    item(agenda.fijos.acta);
    agenda.secciones.slice(1).forEach(seccion);
    item(agenda.fijos.cierre);
    imp.appendChild(ol);
    window.print();
  });

  // ---------- Enlaces ----------
  var enlaces = null;   // respuesta de panelEnlaces

  function cargarEnlaces() {
    $('cargando').classList.remove('oculto');
    $('cargando').textContent = 'Cargando…';
    $('enlaces').innerHTML = '';
    llamar('panelEnlaces', [], function (r) {
      enlaces = r;
      $('cargando').classList.add('oculto');
      mostrarEnlaces();
    });
  }
  function correoPendiente(p) { return p.correo && p.correoEstado === 'Pendiente'; }
  function filtrarPersonas() {
    var f = $('e-filtro').value, t = normal($('e-texto').value);
    return enlaces.personas.filter(function (p) {
      if (f === 'sin-puntos' && p.puntos) return false;
      if (f === 'correo' && !correoPendiente(p)) return false;
      if (f === 'sin-contacto' && (p.telefono === 'ok' || p.correo)) return false;
      return !t || normal(p.nombre + ' ' + p.cargos.join(' ')).indexOf(t) >= 0;
    });
  }
  function mostrarEnlaces() {
    var cont = $('enlaces');
    cont.innerHTML = '';
    if (!enlaces.junta) {
      $('enlaces-barra').classList.add('oculto');
      cont.appendChild(el('div', 'tarjeta vacio', 'No hay una junta abierta. Los enlaces se crean con Junta → Nueva junta, en la hoja.'));
      return;
    }
    $('enlaces-barra').classList.remove('oculto');
    $('enlaces-junta').textContent = 'Enlaces de la junta del ' + enlaces.junta.dia;
    var todos = enlaces.personas;
    var conPuntos = todos.filter(function (p) { return p.puntos; }).length;
    var pendientes = todos.filter(correoPendiente);
    var res = $('enlaces-resumen');
    res.innerHTML = '';
    res.appendChild(el('span', '', todos.length + ' personas'));
    res.appendChild(el('span', 'chip ok', conPuntos + ' enviaron puntos'));
    res.appendChild(el('span', 'chip gris', (todos.length - conPuntos) + ' aún no'));
    if (pendientes.length) res.appendChild(el('span', 'chip pendiente', pendientes.length + ' correo(s) pendiente(s)'));
    var bc = $('enlaces-correos');
    bc.textContent = pendientes.length ? 'Enviar correos pendientes (' + pendientes.length + ')' : 'No hay correos pendientes';
    bc.disabled = !pendientes.length;
    if (enlaces.sinUrl) cont.appendChild(el('div', 'tarjeta vacio',
      'Falta la URL del formulario. Guárdela en la hoja: Junta → Cambiar la URL de la aplicación…'));

    var lista = filtrarPersonas();
    var seccion = function (titulo, personas) {
      if (!personas.length) return;
      var t = el('section', 'tarjeta seccion-enlaces');
      t.appendChild(el('h2', '', titulo));
      personas.forEach(function (p) { t.appendChild(filaPersona(p)); });
      cont.appendChild(t);
    };
    seccion('Directores', lista.filter(function (p) { return p.director; }));
    seccion('Asociados y miembros', lista.filter(function (p) { return !p.director; }));
    if (!lista.length) cont.appendChild(el('div', 'tarjeta vacio', 'Nadie coincide con el filtro.'));
    if (!$('e-filtro').value && !$('e-texto').value) cont.appendChild(filaGeneral());
  }
  function botonEnlace(texto, clase, url) {
    var a = el('a', 'btn ' + clase, texto);
    a.href = url; a.target = '_blank'; a.rel = 'noopener';
    return a;
  }
  function botonAccion(texto, clase, fn) {
    var b = el('button', 'btn ' + clase, texto);
    b.type = 'button';
    b.addEventListener('click', function () { fn(b); });
    return b;
  }
  function copiar(url) {
    var manual = function () { window.prompt('Copie el enlace:', url); };
    try {
      navigator.clipboard.writeText(url).then(function () { avisar('Enlace copiado.'); }, manual);
    } catch (e) { manual(); }
  }
  function cambiarEnlace(nombre, quien) {
    if (!window.confirm('¿Crear un enlace nuevo para ' + quien + '? El enlace actual dejará de funcionar y habrá que enviarle el nuevo.')) return;
    llamar('panelCambiarEnlace', [nombre], function () {
      avisar('Enlace nuevo para ' + quien + '. Envíeselo de nuevo.');
      cargarEnlaces();
    });
  }
  function enviarCorreos(nombres, boton) {
    boton.disabled = true;
    boton.textContent = 'Enviando…';
    llamar('panelEnviarCorreos', [nombres], function (r) {
      avisar('Correos enviados: ' + r.enviados + (r.errores.length ? '. No se pudo enviar a: ' + r.errores.join('; ') : '.'), r.errores.length > 0);
      cargarEnlaces();
    });
  }
  function filaPersona(p) {
    var f = el('div', 'persona');
    f.dataset.nombre = p.nombre;
    f.appendChild(el('div', 'persona-nombre', p.nombre));
    f.appendChild(el('div', 'persona-cargos', p.cargos.join(' · ')));
    var chips = el('div', 'punto-chips');
    chips.appendChild(el('span', 'chip ' + (p.puntos ? 'ok' : 'gris'),
      p.puntos ? p.puntos + (p.puntos === 1 ? ' punto enviado' : ' puntos enviados') : 'Aún no envía puntos'));
    chips.appendChild(el('span', 'chip ' + (/^Enviado/.test(p.correoEstado) ? 'ok' : p.correoEstado === 'Pendiente' ? 'pendiente' : 'gris'),
      p.correoEstado === 'Pendiente' ? 'Correo sin enviar' : p.correoEstado.replace(/^Enviado/, 'Correo enviado')));
    if (p.telefono !== 'ok') chips.appendChild(el('span', 'chip gris', p.telefono === 'no válido' ? 'Teléfono no válido' : 'Sin teléfono'));
    f.appendChild(chips);
    var acc = el('div', 'acciones');
    if (p.enlace) {
      acc.appendChild(botonEnlace(p.telefono === 'ok' ? 'WhatsApp' : 'WhatsApp (elegir contacto)', 'btn-whatsapp', p.whatsapp));
      if (p.correo) acc.appendChild(botonAccion(/^Enviado/.test(p.correoEstado) ? 'Reenviar correo' : 'Enviar correo', 'btn-neutro',
        function (b) { enviarCorreos([p.nombre], b); }));
      acc.appendChild(botonAccion('Copiar enlace', 'btn-neutro', function () { copiar(p.enlace); }));
    } else if (!enlaces.sinUrl) {
      acc.appendChild(el('span', 'persona-cargos', 'Sin enlace todavía.'));
    }
    if (!enlaces.sinUrl) acc.appendChild(botonAccion(p.enlace ? 'Cambiar enlace' : 'Crear enlace', 'btn-rechazar',
      function () { cambiarEnlace(p.nombre, p.nombre); }));
    f.appendChild(acc);
    return f;
  }
  function filaGeneral() {
    var g = enlaces.general;
    var t = el('section', 'tarjeta seccion-enlaces');
    t.appendChild(el('h2', '', 'Enlace general (miembros de la iglesia)'));
    var f = el('div', 'persona');
    f.dataset.nombre = 'GENERAL';
    f.appendChild(el('div', 'persona-cargos', 'Para cualquier miembro. Sus puntos llegan como "Por revisar".'));
    var chips = el('div', 'punto-chips');
    chips.appendChild(el('span', 'chip ' + (g.puntos ? 'ok' : 'gris'), g.puntos + (g.puntos === 1 ? ' punto recibido' : ' puntos recibidos')));
    f.appendChild(chips);
    var acc = el('div', 'acciones');
    if (g.enlace) {
      acc.appendChild(botonEnlace('WhatsApp (elegir contacto)', 'btn-whatsapp', g.whatsapp));
      acc.appendChild(botonAccion('Copiar enlace', 'btn-neutro', function () { copiar(g.enlace); }));
    }
    if (!enlaces.sinUrl) acc.appendChild(botonAccion(g.enlace ? 'Cambiar enlace' : 'Crear enlace', 'btn-rechazar',
      function () { cambiarEnlace('GENERAL', 'el enlace general'); }));
    f.appendChild(acc);
    t.appendChild(f);
    return t;
  }
  $('enlaces-correos').addEventListener('click', function () {
    var nombres = enlaces.personas.filter(correoPendiente).map(function (p) { return p.nombre; });
    if (!nombres.length) return;
    if (!window.confirm('¿Enviar el enlace por correo a ' + nombres.length + ' persona(s) que aún no lo recibieron?')) return;
    enviarCorreos(nombres, $('enlaces-correos'));
  });
  $('e-filtro').addEventListener('change', mostrarEnlaces);
  $('e-texto').addEventListener('input', mostrarEnlaces);

  // ---------- Eventos ----------
  $('junta').addEventListener('change', recargar);
  ['f-estado', 'f-categoria', 'f-depto'].forEach(function (id) { $(id).addEventListener('change', mostrar); });
  $('f-texto').addEventListener('input', mostrar);
})();
