// =====================================================================
// SEGURIDAD: quién puede administrar
//
// En Apps Script, cualquier función cuyo nombre no termina en "_" se puede llamar
// desde la página pública (google.script.run). Por eso TODA función de
// administración (menú y panel) empieza con exigirAdmin_().
//
// Puede administrar quien puede EDITAR la hoja de cálculo: la dueña o dueño y
// sus editores. Así, el permiso se da compartiendo la hoja, no en el código.
// La página pública no tiene inicio de sesión: ahí no hay usuario y todo se rechaza.
// =====================================================================

/** Correo de quien está usando la aplicación, si puede administrar; si no, null. */
function usuarioAdmin_() {
  var email = '';
  try { email = String(Session.getActiveUser().getEmail() || '').toLowerCase(); } catch (e) { email = ''; }
  if (!email) return null;
  var libro = libro_();
  var permitidos = libro.getEditors().map(function (u) { return u.getEmail(); });
  try { if (libro.getOwner()) permitidos.push(libro.getOwner().getEmail()); } catch (e) { /* sin dueño visible */ }
  return permitidos.some(function (p) { return String(p || '').toLowerCase() === email; }) ? email : null;
}

/** Corta la ejecución si quien llama no puede administrar. Devuelve su correo. */
function exigirAdmin_() {
  var u = usuarioAdmin_();
  if (!u) throw new Error('No tiene permiso para esta acción. Solo pueden hacerla quienes pueden editar la hoja de la Junta Directiva.');
  return u;
}
