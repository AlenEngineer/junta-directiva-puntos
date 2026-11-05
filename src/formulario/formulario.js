// Lógica del formulario. DATOS lo pone el servidor (ver WebApp.js → doGet).
(function () {
  var D = DATOS;
  var $ = function (id) { return document.getElementById(id); };
  if (!D) { $('invalido').classList.remove('oculto'); return; }
  if (D.version) $('version').textContent = ' · v' + D.version;

  var OBLIG = 'Esta pregunta es obligatoria';
  var EXT = ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png', 'webp', 'heic'];
  var adjuntos = {};       // 'archivo' (cotización) y 'material': { nombre, base64 }
  var existentes = {};     // archivos ya enviados que se conservan al editar
  var edicion = null;      // { id, codigo, titulo } del punto que se está editando
  var ultimo = null;       // { id, codigo, titulo } del último punto enviado
  var actual = 'pag1';

  // ---------- Preparar la página ----------
  var desc = 'Junta del ' + D.junta + '\n';
  if (D.general) {
    desc += 'Para miembros de la iglesia. Su punto será revisado antes de incluirse en la agenda.';
    $('q-nombre').classList.remove('oculto');
  } else {
    desc += 'Hola, ' + D.nombre + '.';
    if (D.departamentos.length === 1) desc += '\nDepartamento: ' + D.departamentos[0].texto;
    else $('q-depto').classList.remove('oculto');
  }
  $('desc').textContent = desc;

  function llenar(sel, items) {
    sel.appendChild(new Option('Elegir', ''));
    items.forEach(function (it) {
      if (typeof it === 'string') sel.appendChild(new Option(it, it));
      else sel.appendChild(new Option(it.texto, it.valor));
    });
  }
  llenar($('depto'), D.departamentos);
  llenar($('categoria'), D.categorias);

  // Ícono y texto de error en cada pregunta, como en Google Forms.
  document.querySelectorAll('.pregunta').forEach(function (q) {
    var m = document.createElement('div');
    m.className = 'msg-error';
    m.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
      '<path d="M11 15h2v2h-2zm0-8h2v6h-2zm1-5C6.47 2 2 6.5 2 12a10 10 0 1 0 10-10zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16z"/></svg><span></span>';
    q.appendChild(m);
  });
  $('form').classList.remove('oculto');

  // ---------- Utilidades ----------
  function val(id) { return $(id).value.trim(); }
  function radio(nombre) {
    var r = document.querySelector('input[name="' + nombre + '"]:checked');
    return r ? r.value : '';
  }
  function numero(s) {
    s = String(s).replace(/\s/g, '').replace(',', '.');
    return /^\d{1,9}(\.\d{1,2})?$/.test(s) ? Number(s) : NaN;
  }
  function visible(el) { return !el.closest('.oculto'); }
  function variosDias() { return !!val('actFechaFin') && val('actFechaFin') !== val('actFecha'); }

  // ---------- Mostrar u ocultar según las respuestas ----------
  function actualizar() {
    document.querySelector('.actividad').classList.toggle('oculto', radio('esActividad') !== 'Sí');
    $('ayuda-inicio').classList.toggle('oculto', !variosDias());
    $('ayuda-fin').classList.toggle('oculto', !variosDias());
    if (val('actFecha')) $('actFechaFin').min = val('actFecha');
    var c = numero(val('costo')), m = numero(val('monto'));
    $('q-estrategia').classList.toggle('oculto', !(c > 0 && m > 0 && m < c));

    var tipo = radio('tipo'), dinero = radio('dinero');
    $('desc-titulo').textContent = tipo === 'Informativo' ? 'Descripción del informe' :
      tipo === 'Para votación' ? 'Descripción y propuesta de voto' : 'Descripción y propuesta';
    $('desc-ayuda').textContent = tipo === 'Informativo' ? 'Explique lo que se va a informar a la junta.' :
      tipo === 'Para votación' ? 'Explique el punto y escriba la propuesta tal como se votaría.' :
      'Explique el punto. Si es para votación, escriba la propuesta tal como se votaría.';
    var total = 1 + (tipo !== 'Informativo' ? 1 : 0) + (tipo !== 'Informativo' && dinero !== 'No' ? 1 : 0);
    var num = Number(actual.slice(3));
    $('siguiente').textContent = hayMas() ? 'Siguiente' : (edicion ? 'Guardar cambios' : 'Enviar');
    $('atras').classList.toggle('oculto', actual === 'pag1');
    $('relleno').style.width = Math.round(num / total * 100) + '%';
    $('pagina-texto').textContent = 'Página ' + num + ' de ' + total;
  }
  function hayMas() {
    if (actual === 'pag1') return radio('tipo') !== 'Informativo';
    if (actual === 'pag2') return radio('dinero') !== 'No';
    return false;
  }
  function anterior() {
    if (actual === 'pag3') return 'pag2';
    return 'pag1';
  }

  // ---------- Validación ----------
  var reglas = {
    nombre: function () { return val('nombre').length >= 3 ? '' : OBLIG; },
    depto: function () { return val('depto') ? '' : OBLIG; },
    categoria: function () { return val('categoria') ? '' : OBLIG; },
    titulo: function () { return val('titulo') ? '' : OBLIG; },
    descripcion: function () { return val('descripcion') ? '' : OBLIG; },
    tipo: function () { return radio('tipo') ? '' : OBLIG; },
    esActividad: function () { return radio('esActividad') ? '' : OBLIG; },
    actFecha: function () { return val('actFecha') ? '' : OBLIG; },
    actFechaFin: function () {
      return val('actFechaFin') && val('actFecha') && val('actFechaFin') < val('actFecha') ?
        'No puede ser antes de la fecha de inicio' : '';
    },
    actInicio: function () { return val('actInicio') ? '' : OBLIG; },
    actFin: function () {
      return !variosDias() && val('actFin') && val('actInicio') && val('actFin') <= val('actInicio') ?
        'Debe ser después de la hora de inicio' : '';
    },
    lugar: function () { return val('lugar') ? '' : OBLIG; },
    responsable: function () { return val('responsable') ? '' : OBLIG; },
    asistencia: function () { return !val('asistencia') || /^\d{1,5}$/.test(val('asistencia')) ? '' : 'Escriba solo un número'; },
    dinero: function () { return radio('dinero') ? '' : OBLIG; },
    costo: function () {
      if (!val('costo')) return OBLIG;
      return numero(val('costo')) > 0 ? '' : 'Escriba solo números. Ejemplo: 150 o 150.50';
    },
    monto: function () {
      if (!val('monto')) return OBLIG;
      var m = numero(val('monto'));
      if (!(m > 0)) return 'Escriba solo números. Ejemplo: 150 o 150.50';
      return m > numero(val('costo')) ? 'No puede ser mayor que el costo total' : '';
    },
    estrategia: function () { return val('estrategia') ? '' : OBLIG; },
    cotizacion: function () {
      var e = val('enlace');
      if (e && !/^https?:\/\/\S+$/i.test(e)) return 'El enlace debe empezar con https://';
      return val('descCosto') || e || adjuntos.archivo || existentes.archivo ? '' : 'Complete al menos una de las tres opciones';
    },
    material: function () {
      var e = val('materialEnlace');
      return e && !/^https?:\/\/\S+$/i.test(e) ? 'El enlace debe empezar con https://' : '';
    }
  };

  function validar(pagina) {
    var primera = null;
    $(pagina).querySelectorAll('.pregunta').forEach(function (q) {
      if (!visible(q)) return;
      var msg = reglas[q.dataset.v]();
      q.classList.toggle('error', !!msg);
      q.querySelector('.msg-error span').textContent = msg;
      if (msg && !primera) primera = q;
    });
    if (primera) primera.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return !primera;
  }

  // Vuelve a revisar todas las preguntas marcadas en rojo: algunas dependen de otras
  // (por ejemplo, la hora de término depende de si la actividad dura varios días).
  function limpiarError() {
    document.querySelectorAll('.pregunta.error').forEach(function (q) {
      if (q.dataset.errorArchivo) return; // el aviso del archivo se quita al elegir otro
      var msg = reglas[q.dataset.v]();
      if (!msg) q.classList.remove('error');
      else q.querySelector('.msg-error span').textContent = msg;
    });
  }

  // ---------- Navegación ----------
  function ir(pagina) {
    $(actual).classList.add('oculto');
    actual = pagina;
    $(actual).classList.remove('oculto');
    $('error-envio').classList.add('oculto');
    actualizar();
    window.scrollTo(0, 0);
  }

  $('siguiente').addEventListener('click', function () {
    if (!validar(actual)) return;
    if (hayMas()) ir(actual === 'pag1' ? 'pag2' : 'pag3');
    else enviar();
  });
  $('atras').addEventListener('click', function () { ir(anterior()); });

  // ---------- Archivos adjuntos (cotización y material de apoyo) ----------
  function configurarAdjunto(id, exts, maxMB, textoTipos) {
    $(id + '-btn').addEventListener('click', function () { $(id).click(); });
    $(id).addEventListener('change', function () {
      var f = this.files[0];
      this.value = '';
      if (!f) return;
      var q = this.closest('.pregunta');
      var ext = f.name.indexOf('.') >= 0 ? f.name.split('.').pop().toLowerCase() : '';
      var msg = exts.indexOf(ext) < 0 ? 'Tipo de archivo no permitido. Use ' + textoTipos + '.' :
        f.size > maxMB * 1024 * 1024 ? 'El archivo pesa más de ' + maxMB + ' MB.' : '';
      if (msg) {
        q.classList.add('error');
        q.dataset.errorArchivo = '1';
        q.querySelector('.msg-error span').textContent = msg;
        return;
      }
      var lector = new FileReader();
      lector.onload = function () {
        adjuntos[id] = { nombre: f.name, base64: String(lector.result).split(',')[1] };
        existentes[id] = false;
        $(id + '-nombre').textContent = f.name;
        $(id + '-chip').classList.remove('oculto');
        $(id + '-btn').classList.add('oculto');
        delete q.dataset.errorArchivo;
        q.classList.remove('error');
        limpiarError();
      };
      lector.readAsDataURL(f);
    });
    $(id + '-quitar').addEventListener('click', function () { quitarAdjunto(id); });
  }
  function quitarAdjunto(id) {
    delete adjuntos[id];
    existentes[id] = false;
    $(id + '-chip').classList.add('oculto');
    $(id + '-btn').classList.remove('oculto');
  }
  configurarAdjunto('archivo', EXT, 5, 'PDF, Word o una imagen');
  configurarAdjunto('material', EXT.concat(['ppt', 'pptx']), 10, 'PowerPoint, PDF, Word o una imagen');

  // ---------- Enviar ----------
  function datos() {
    var dep = D.general ? '' : (D.departamentos.length === 1 ? D.departamentos[0].valor : val('depto'));
    var d = {
      nombre: val('nombre'), departamento: dep,
      categoria: val('categoria'), titulo: val('titulo'), descripcion: val('descripcion'),
      tipo: radio('tipo'),
      material: adjuntos.material || null, materialEnlace: val('materialEnlace'),
      mantenerMaterial: !!existentes.material && !adjuntos.material
    };
    if (d.tipo === 'Para votación') {
      d.esActividad = radio('esActividad');
      if (d.esActividad === 'Sí') {
        d.actFecha = val('actFecha'); d.actFechaFin = val('actFechaFin');
        d.actInicio = val('actInicio'); d.actFin = val('actFin');
        d.lugar = val('lugar'); d.responsable = val('responsable'); d.asistencia = val('asistencia');
      }
      d.pideDinero = radio('dinero');
      if (d.pideDinero === 'Sí') {
        d.costo = val('costo'); d.monto = val('monto'); d.estrategia = val('estrategia');
        d.descCosto = val('descCosto'); d.enlace = val('enlace'); d.archivo = adjuntos.archivo || null;
        d.mantenerArchivo = !!existentes.archivo && !adjuntos.archivo;
      }
    }
    return d;
  }

  function enviar() {
    var b = $('siguiente');
    b.disabled = true;
    b.textContent = edicion ? 'Guardando…' : 'Enviando…';
    $('error-envio').classList.add('oculto');
    var runner = google.script.run
      .withSuccessHandler(function (res) {
        res = res || {};
        ultimo = { id: res.id, codigo: res.codigo, titulo: res.titulo };
        $('form').classList.add('oculto');
        $('hecho-texto').textContent = (res.editado ? 'Sus cambios se guardaron. Gracias.' : 'Su punto fue recibido. Gracias.') +
          (D.general ? '\nSerá revisado antes de incluirse en la agenda.' : '');
        $('editar-ultimo').classList.toggle('oculto', !res.id);
        $('hecho').classList.remove('oculto');
        edicion = null;
        cargarMisPuntos();
        window.scrollTo(0, 0);
      })
      .withFailureHandler(function (e) {
        b.disabled = false;
        actualizar();
        var msg = String((e && e.message) || e).replace(/^(Exception|Error):\s*/, '');
        $('error-envio-texto').textContent = (edicion ? 'No se pudieron guardar los cambios: ' : 'No se pudo enviar: ') + msg;
        $('error-envio').classList.remove('oculto');
      });
    if (edicion) runner.editarPunto(D.clave, edicion.id, edicion.codigo, datos());
    else runner.enviarPunto(D.clave, datos());
  }

  // ---------- Editar un punto ya enviado ----------
  function mensajeError(e) { return String((e && e.message) || e).replace(/^(Exception|Error):\s*/, ''); }

  function abrirParaEditar(id, codigo) {
    google.script.run
      .withSuccessHandler(function (p) {
        $('hecho').classList.add('oculto');
        $('form').classList.remove('oculto');
        reiniciar();
        cargar(p.datos);
        edicion = { id: p.id, codigo: codigo || '', titulo: p.titulo };
        $('banner-titulo').textContent = p.titulo;
        $('banner-edicion').classList.remove('oculto');
        $('mis-puntos').classList.add('oculto');
        actualizar();
        window.scrollTo(0, 0);
      })
      .withFailureHandler(function (e) { alert('No se pudo abrir el punto: ' + mensajeError(e)); })
      .obtenerPunto(D.clave, id, codigo || '');
  }

  function cargar(p) {
    if (D.general) $('nombre').value = p.nombre || '';
    if (!D.general && D.departamentos.length > 1) $('depto').value = p.departamento || '';
    ['categoria', 'titulo', 'descripcion', 'materialEnlace', 'actFecha', 'actFechaFin', 'actInicio', 'actFin',
      'lugar', 'responsable', 'asistencia', 'costo', 'monto', 'estrategia', 'descCosto', 'enlace']
      .forEach(function (k) { $(k).value = p[k] || ''; });
    [['tipo', p.tipo], ['esActividad', p.esActividad], ['dinero', p.pideDinero]].forEach(function (x) {
      var r = document.querySelector('input[name="' + x[0] + '"][value="' + x[1] + '"]');
      if (r) r.checked = true;
    });
    if (p.archivoActual) mostrarExistente('archivo');
    if (p.materialActual) mostrarExistente('material');
    document.querySelectorAll('textarea').forEach(function (t) {
      t.style.height = 'auto';
      t.style.height = t.scrollHeight + 'px';
    });
  }

  function mostrarExistente(id) {
    existentes[id] = true;
    $(id + '-nombre').textContent = 'Archivo enviado anteriormente';
    $(id + '-chip').classList.remove('oculto');
    $(id + '-btn').classList.add('oculto');
  }

  // La lista va debajo del encabezado que esté a la vista: el del formulario o el de "recibido".
  function ubicarLista() {
    var enHecho = !$('hecho').classList.contains('oculto');
    var ancla = enHecho ? $('hecho') : document.querySelector('#form .encabezado');
    ancla.parentNode.insertBefore($('mis-puntos'), ancla.nextSibling);
  }

  function cargarMisPuntos() {
    if (D.general) return;
    google.script.run
      .withSuccessHandler(function (lista) {
        var cont = $('mis-puntos-lista');
        cont.innerHTML = '';
        (lista || []).forEach(function (p) {
          var item = document.createElement('div');
          item.className = 'punto-item';
          var txt = document.createElement('div');
          var tit = document.createElement('div');
          tit.textContent = p.titulo;
          var meta = document.createElement('div');
          meta.className = 'meta';
          meta.textContent = p.tipo + ' · ' + p.departamento + (p.enviado ? ' · enviado ' + p.enviado : '') +
            (p.ediciones ? ' · editado ' + p.ediciones + (p.ediciones === 1 ? ' vez' : ' veces') : '');
          txt.appendChild(tit);
          txt.appendChild(meta);
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'btn btn-secundario';
          b.textContent = 'Editar';
          b.addEventListener('click', function () { abrirParaEditar(p.id, ''); });
          item.appendChild(txt);
          item.appendChild(b);
          cont.appendChild(item);
        });
        ubicarLista();
        $('mis-puntos').classList.toggle('oculto', !(lista || []).length || !!edicion);
      })
      .withFailureHandler(function () { /* la lista es opcional */ })
      .misPuntos(D.clave);
  }

  $('editar-ultimo').addEventListener('click', function () {
    if (ultimo && ultimo.id) abrirParaEditar(ultimo.id, ultimo.codigo);
  });
  $('cancelar-edicion').addEventListener('click', function () {
    if (!confirm('¿Cancelar la edición? Los cambios que no guardó se perderán.')) return;
    reiniciar();
    cargarMisPuntos();
  });

  // ---------- Borrar y enviar otro ----------
  function reiniciar() {
    $('form').reset();
    edicion = null;
    existentes = {};
    $('banner-edicion').classList.add('oculto');
    quitarAdjunto('archivo');
    quitarAdjunto('material');
    document.querySelectorAll('.pregunta.error').forEach(function (q) {
      q.classList.remove('error');
      delete q.dataset.errorArchivo;
    });
    document.querySelectorAll('textarea').forEach(function (t) { t.style.height = ''; });
    $('siguiente').disabled = false;
    ir('pag1');
  }
  $('borrar').addEventListener('click', function () {
    if (confirm('¿Borrar todas las respuestas del formulario?')) reiniciar();
  });
  $('otro').addEventListener('click', function (e) {
    e.preventDefault();
    $('hecho').classList.add('oculto');
    $('form').classList.remove('oculto');
    reiniciar();
    ubicarLista();
  });

  // ---------- Eventos ----------
  $('form').addEventListener('input', function (e) {
    if (e.target.tagName === 'TEXTAREA') {
      e.target.style.height = 'auto';
      e.target.style.height = e.target.scrollHeight + 'px';
    }
    actualizar();
    limpiarError(e);
  });
  $('form').addEventListener('change', function (e) { actualizar(); limpiarError(e); });
  actualizar();
  cargarMisPuntos();
})();
