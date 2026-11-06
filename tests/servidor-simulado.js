// Simula google.script.run en las pruebas de la página. Cada función del servidor
// se define en window.__srv; las llamadas responden de forma asíncrona, como en Apps Script.
module.exports = `<script>
window.__envios = [];
window.__srv = Object.assign({
  enviarPunto: function (clave, d) { window.__envios.push(d); return { ok: true, id: 'a'.repeat(32), codigo: 'c'.repeat(32), titulo: d.titulo }; },
  editarPunto: function (clave, id, codigo, d) { window.__envios.push(Object.assign({ __edicion: { id: id, codigo: codigo } }, d)); return { ok: true, id: id, codigo: codigo, titulo: d.titulo, editado: true }; },
  misPuntos: function () { return window.__lista || []; },
  obtenerPunto: function (clave, id, codigo) { window.__abierto = { id: id, codigo: codigo }; return { id: id, titulo: (window.__punto || {}).titulo, datos: window.__punto || {} }; }
}, window.__srvExtra || {}); // cada prueba puede agregar o reemplazar funciones en window.__srvExtra
window.google = { script: { run: new Proxy({}, { get: function (_, nombre) {
  var exito, fallo;
  var r = new Proxy({}, { get: function (_, m) {
    if (m === 'withSuccessHandler') return function (f) { exito = f; return r; };
    if (m === 'withFailureHandler') return function (f) { fallo = f; return r; };
    return function () { var a = arguments; setTimeout(function () {
      try { var v = window.__srv[m].apply(null, a); exito && exito(v); } catch (e) { fallo && fallo(e); }
    }, 20); };
  } });
  return r[nombre];
} }) } };
</script>`;
