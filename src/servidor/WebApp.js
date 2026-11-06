function doGet(e) {
  if (e && e.parameter && e.parameter.vista === 'panel') return panelPagina_();
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
  return guardarPunto_(clave, d || {}, null);
}

/** La llama la página al presionar "Guardar cambios" en un punto ya enviado. */
function editarPunto(clave, id, codigo, d) {
  return guardarPunto_(clave, d || {}, { id: String(id || ''), codigo: String(codigo || '') });
}

/** Puntos que la persona envió para la junta abierta (solo enlaces personales). */
function misPuntos(clave) {
  var ctx = contexto_(String(clave || ''));
  if (!ctx || ctx.general) return [];
  var tz = Session.getScriptTimeZone();
  return puntosLeer_().filter(function (p) {
    return p['ID'] && String(p['Enviado por']) === ctx.nombre && textoFecha_(p['Junta']) === ctx.junta.fecha;
  }).map(function (p) {
    return {
      id: String(p['ID']),
      titulo: String(p['Título']),
      tipo: String(p['Tipo']),
      departamento: String(p['Departamento']),
      enviado: p['Fecha de envío'] instanceof Date ? Utilities.formatDate(p['Fecha de envío'], tz, 'dd/MM HH:mm') : '',
      ediciones: Number(p['Ediciones']) || 0
    };
  });
}

/** Devuelve un punto ya enviado, con los datos para llenar el formulario. */
function obtenerPunto(clave, id, codigo) {
  var ctx = contexto_(String(clave || ''));
  if (!ctx) throw new Error('Este enlace ya no es válido. Pida el enlace actualizado a la secretaría de la iglesia.');
  var r = buscarPuntoEditable_(ctx, String(id || ''), String(codigo || ''));
  if (!r) throw new Error('No se encontró el punto, o ya no se puede editar.');
  var v = r.valores, tz = Session.getScriptTimeZone();
  var iso = function (x) {
    var m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(textoFecha_(x));
    return m ? m[3] + '-' + m[2] + '-' + m[1] : '';
  };
  var hora = function (x) { return x instanceof Date ? Utilities.formatDate(x, tz, 'HH:mm') : String(x || ''); };
  var t = function (x) { return x == null ? '' : String(x); };
  return {
    id: t(v['ID']),
    titulo: t(v['Título']),
    datos: {
      nombre: ctx.general ? t(v['Presenta']) : '', departamento: t(v['Departamento']),
      categoria: categoriaVigente_(v['Categoría']), titulo: t(v['Título']), descripcion: t(v['Descripción y propuesta']),
      tipo: t(v['Tipo']), materialEnlace: t(v['Material de apoyo (enlace)']),
      esActividad: t(v['¿Es actividad?']), actFecha: iso(v['Fecha de la actividad']),
      actFechaFin: iso(v['Fecha de término de la actividad']),
      actInicio: hora(v['Hora de inicio']), actFin: hora(v['Hora de término']),
      lugar: t(v['Lugar']), responsable: t(v['Responsable']), asistencia: t(v['Asistencia esperada']),
      pideDinero: t(v['¿Solicita dinero?']), costo: t(v['Costo total']), monto: t(v['Monto solicitado a la iglesia']),
      estrategia: t(v['Estrategia para el resto']), descCosto: t(v['Descripción del costo']),
      enlace: t(v['Enlace a la cotización']),
      archivoActual: !!v['Archivo de la cotización'], materialActual: !!v['Material de apoyo (archivo)']
    }
  };
}

function contexto_(clave) {
  if (!/^[0-9a-f]{32}$/.test(clave)) return null;
  asegurarEsquema_();
  var junta = juntaActual_();
  if (!junta || claveFecha_(junta.fecha) < hoyClave_()) return null;

  var c = claveBuscar_(clave);
  if (!c || c.junta !== junta.fecha) return null;
  if (c.persona === GENERAL) return { clave: clave, junta: junta, general: true, nombre: '', cargos: [] };
  var p = leerCargos_().personas[c.persona];
  if (!p) return null;
  return { clave: clave, junta: junta, general: false, nombre: c.persona, cargos: p.cargos };
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
    // Categorías para la lista: las comunes, y las de cada departamento de la persona.
    categorias: ctx.general ? categoriasPara_('', true) : CATEGORIAS.filter(function (c) { return !CATEGORIAS_RESTRINGIDAS[c]; }),
    categoriasPorDepartamento: ctx.general ? null : ctx.cargos.reduce(function (m, c) {
      m[c.departamento] = categoriasPara_(c.departamento, false);
      return m;
    }, {}),
    saldos: saldosPublicos_(ctx),
    ayuda: ayudaPublica_(),
    version: VERSION
  };
}

/**
 * Saldos de tesorería de los departamentos de la persona (solo enlaces personales).
 * Nunca se envían los de otros departamentos.
 */
function saldosPublicos_(ctx) {
  if (ctx.general) return null;
  var s;
  try { s = saldosLeer_(); } catch (e) { return null; } // un error en la pestaña no debe romper el formulario
  var porDepartamento = {}, hay = false;
  ctx.cargos.forEach(function (c) {
    var fondos = s.fondos.filter(function (f) {
      return f.departamentos.some(function (d) { return normalizar_(d) === normalizar_(c.departamento); });
    }).map(function (f) {
      return { fondo: f.fondo, saldoAnterior: f.saldoAnterior, ingresos: f.ingresos,
        egresos: f.egresos, transferencias: f.transferencias, saldo: f.saldo };
    });
    if (fondos.length) { porDepartamento[c.departamento] = fondos; hay = true; }
  });
  return hay ? { periodo: s.periodo, moneda: MONEDA, porDepartamento: porDepartamento } : null;
}

/** Limita cuántos puntos se pueden enviar con un mismo enlace en 6 horas. */
function limitar_(clave, max) {
  var cache = CacheService.getScriptCache();
  var k = 'lim_' + clave;
  var n = Number(cache.get(k)) || 0;
  if (n >= max) throw new Error('Se enviaron demasiados puntos con este enlace en poco tiempo. Intente más tarde.');
  cache.put(k, String(n + 1), 21600);
}

/** El contacto de ayuda para la página. Un error aquí no debe romper el formulario. */
function ayudaPublica_() {
  try { return contactoAyuda_(); } catch (e) { return null; }
}
