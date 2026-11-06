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

  // ---------- Eventos ----------
  $('junta').addEventListener('change', cargarPuntos);
  ['f-estado', 'f-categoria', 'f-depto'].forEach(function (id) { $(id).addEventListener('change', mostrar); });
  $('f-texto').addEventListener('input', mostrar);
})();
