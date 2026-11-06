# Historial de cambios

Todas las versiones de *Puntos para la Junta Directiva*. La más reciente va primero.

Las versiones siguen el formato `MAYOR.MENOR.PARCHE` ([versionado semántico](https://semver.org/lang/es/)), adaptado a esta aplicación:

- **PARCHE** (1.0.**1**): correcciones. No cambia cómo se usa y no requiere nada de su parte.
- **MENOR** (1.**1**.0): funciones nuevas. Puede pedir un permiso nuevo de Google; la nota de la versión dice qué hacer.
- **MAYOR** (**2**.0.0): cambios que exigen pasos manuales en una instalación que ya funciona, por ejemplo cambiar la estructura de la hoja.

Cada versión explica, en **Qué hacer**, los pasos para una instalación existente. Con la actualización automática configurada, el código se publica solo; en ese caso, solo siga los pasos marcados con 📊 (en la hoja).

## [Sin publicar]

Cambios que ya están en `main` pero todavía no forman parte de una versión.

## [1.7.0] - 2026-11-06

### Agregado
- **Panel de administración**, sección **Puntos**: una página aparte, que también se puede usar desde el celular, para ver los puntos de cada junta.
  - Filtros por estado, categoría, departamento o texto.
  - El detalle completo, con la actividad, el presupuesto y los archivos.
  - **Aprobar o rechazar** con un clic. Los *Por revisar* aparecen primero.
- **Junta → Abrir el panel** y **Junta → Cambiar la URL del panel…** en el menú.

### Seguridad
- Todas las funciones de administración (las del menú y las del panel) verifican quién las llama: solo pueden ejecutarlas quienes pueden **editar la hoja**. Antes, en teoría, algunas se podían invocar desde la página pública. No había un daño real conocido, pero ahora está cerrado.
- Una prueba automática revisa que toda función pública nueva tenga esta verificación.

### Qué hacer
- 🛠️ **Crear la implementación del panel** (una sola vez): ver *Panel de administración* en el README. Luego guarde su ID como secreto `DEPLOYMENT_ID_PANEL` en GitHub, para que la actualización automática también la publique.
- 📊 La primera vez, **Junta → Abrir el panel** pide la URL del panel.
- Si actualiza a mano: cambia `Codigo.gs`, y hay un archivo nuevo, `Panel.html` (archivo HTML llamado `Panel`).

## [1.6.0] - 2026-11-06

Más fácil de usar para todos, especialmente para los hermanos mayores.

### Cambiado
- **Letra más grande y más contraste:** el texto pasa de 14 a 18 px, las preguntas a 20 px y las ayudas a 16 px; los grises son más oscuros.
- **Botones y opciones más grandes:** los botones tienen 52 px de alto y los círculos de selección 28 px, con más espacio entre opciones.
- **Campos en caja:** se ve claramente dónde escribir.
- **Preguntas en lenguaje más simple**, por ejemplo *"¿Cuánto le pide a la iglesia?"* o *"¿En qué se usará el dinero?"*.

### Agregado
- **Botón "A+ Letra más grande"**, que se recuerda en ese celular o computadora.
- **Resumen de errores arriba** (*"Faltan 2 respuestas por revisar"*), con un enlace a cada pregunta.
- **Pantalla final más clara:** un ✓ grande y un resumen de lo que se envió.
- **Borrador automático:** lo escrito se guarda en el celular o computadora. Si se cierra la página, al volver a abrir el enlace aparece *"Seguir donde lo dejé"*. Los archivos adjuntos no se guardan.
- **Consejo para dictar** con el micrófono del teclado, en la descripción.
- **Botón "¿Necesita ayuda?"**, que abre WhatsApp con un mensaje ya escrito. Por defecto le escribe a quien dirige Secretaría; se cambia en **Junta → Cambiar el contacto de ayuda…**.

### Qué hacer
- 📊 Para que el botón de ayuda le llegue a otra persona que no sea la secretaria: **Junta → Cambiar el contacto de ayuda…** y escriba su nombre como aparece en *Cargos*. Necesita tener teléfono en *Contactos*.
- Si actualiza a mano: cambian `Codigo.gs` y `Formulario.html`.

## [1.5.0] - 2026-11-06

### Cambiado
- **Categorías de los puntos:**
  - *Departamentos* pasa a llamarse **Planes y actividades del departamento**.
  - *Asuntos generales* pasa a llamarse **Otros asuntos**.
- **Cada departamento ve solo las categorías que le corresponden:**
  - **Tesorería y finanzas:** solo Tesorería.
  - **Feligresía:** Secretaría y Ancianos.
  - **Evangelismo y misión, Planes y actividades y Otros asuntos:** todos.
  - **Enlace general:** solo *Evangelismo y misión* y *Otros asuntos*.
- Si la persona tiene varios cargos, la lista cambia según el departamento por el que presenta el punto. El servidor también lo revisa.
- **Agenda:** devocional, evangelismo y misión, acta anterior, tesorería y finanzas, feligresía, planes y actividades, otros asuntos y oración de clausura.

### Compatibilidad
- Los puntos ya enviados se ubican solos en la agenda: *Departamentos* va a *Planes y actividades* y *Asuntos generales*, a *Otros asuntos*. Una categoría desconocida va a *Otros asuntos*, así que ningún punto se pierde.
- Al editar un punto viejo, su categoría se traduce a la nueva.

### Qué hacer
- Nada. Los nombres de departamento que habilitan categorías especiales son *Tesorería*, *Secretaría* y *Ancianos*, como en la pestaña *Cargos*.

## [1.4.1] - 2026-11-06

### Corregido
- Saldos: si Google Sheets convierte el periodo (por ejemplo *octubre 2026*) en una fecha, se muestra igual como *octubre 2026*, y no como *01/10/2026*.
- Saldos: se ignoran las filas que repiten los encabezados, algo que pasa al importar un archivo debajo de los encabezados existentes.

### Qué hacer
- Nada.

## [1.4.0] - 2026-11-06

### Agregado
- **Saldo de tesorería del departamento.** En la página de *Presupuesto*, cada persona ve el fondo de su departamento según el último reporte de tesorería: saldo a la fecha, saldo anterior, ingresos, egresos y transferencias. Si tiene varios cargos, ve el del departamento por el que presenta el punto.
- Pestaña **Saldos**, con las mismas columnas del *Reporte de saldos, ingresos y egresos* para pegarlo tal cual, más **Departamento en Cargos** (a qué departamento corresponde cada fila; puede ser más de uno, separados por coma) y **Periodo del reporte**.

### Seguridad
- Cada persona recibe solo los saldos de sus propios departamentos. El enlace general no muestra saldos. Las filas sin *Departamento en Cargos* (préstamos, seguro, construcción…) no se le muestran a nadie.

### Interno
- GitHub Actions: las pruebas ya no esperan en fila a otras ejecuciones; solo la publicación en Apps Script va de a una. En un pull request, un cambio nuevo cancela la ejecución anterior.

### Qué hacer
- 📊 La pestaña **Saldos** se crea sola la primera vez que se use la hoja. Cada mes: copie la tabla del reporte de tesorería (sin la fila de totales) y péguela desde la celda **A2**; complete **Departamento en Cargos** y el **Periodo del reporte** en la primera fila. Ver *Saldos de tesorería* en el README.
- Si actualiza a mano: cambian `Codigo.gs` y `Formulario.html`.

## [1.3.0] - 2026-11-05

Reestructuración interna para que la aplicación sea más fácil de mantener y de extender. Para los hermanos y para la hoja, todo funciona igual.

### Cambiado
- El código está dividido por tema en `src/servidor/` y `src/formulario/`. `scripts/empaquetar.js` lo une en `dist/Codigo.gs` y `dist/Formulario.html`, que es lo que se prueba y se publica.
- **Capa de datos** (`Datos.js`): es la única parte que lee o escribe las pestañas de datos, siempre por nombre de columna.
- **Migraciones** (`Esquema.js`): los cambios de estructura de la hoja se aplican solos, una vez y en orden. Reemplazan los arreglos sueltos de versiones anteriores.
- Cada *Release* incluye los archivos para instalar o actualizar a mano.

### Agregado
- `ARQUITECTURA.md`: cómo está hecha la aplicación, reglas para mantenerla y cuándo convendría migrar.
- Protección con advertencia en las columnas internas de *Puntos* (ID, Enviado por, Código de edición) y en las pestañas *_Claves* e *Historial*, para que no se borren sin querer.
- Los puntos de juntas pasadas también reciben ID (no se pueden editar, pero quedan identificados).
- Pruebas de la capa de datos: juntas, enlaces y migraciones.

### Compatibilidad
- Los enlaces ya enviados, los datos de la hoja y la URL de la aplicación no cambian.

### Qué hacer
- Nada. La primera vez que se use, la hoja aplica las migraciones sola. Si edita una columna interna, Google le mostrará una advertencia: puede continuar, pero no se recomienda.
- Si actualiza a mano: descargue los archivos de la *Release* (ver README).

## [1.2.0] - 2026-11-05

### Agregado
- **Editar un punto ya enviado.** Después de enviar aparece **Editar este punto**. Con un enlace personal, arriba del formulario aparece **Sus puntos enviados para esta junta**, con un botón **Editar** en cada uno. Se puede editar hasta que se cierre la recepción de puntos.
- Al editar, los archivos adjuntos se conservan, salvo que se quiten o se reemplacen.
- Pestaña **Historial**: cada vez que se edita un punto, la versión anterior se guarda ahí con la fecha.
- En *Puntos*, columnas **ID**, **Enviado por**, **Código de edición**, **Última edición** y **Ediciones**.

### Seguridad
- Con un enlace personal solo se pueden ver y editar los puntos propios de la junta abierta.
- Con el enlace general, que comparten varios miembros, solo se puede editar un punto desde la misma página donde se envió. Si estaba *Aprobado*, vuelve a *Por revisar*.

### Compatibilidad
- Los enlaces ya enviados siguen funcionando.
- Los puntos enviados antes de esta versión en la junta abierta reciben un ID la primera vez que su autor abre el enlace, y desde entonces se pueden editar. Los del enlace general enviados antes no se pueden editar.

### Qué hacer
- Nada. Las columnas nuevas y la pestaña *Historial* aparecen solas. Si actualiza a mano: cambian `Codigo.gs` y `Formulario.html`.

## [1.1.0] - 2026-11-05

### Cambiado
- El formulario ya no pregunta el **tiempo estimado**: el tiempo de cada punto lo decide la junta, no quien lo propone.
- En la agenda, la columna **Tiempo asignado** queda vacía para completarla en la junta, y ya no se muestra el total de minutos.

### Qué hacer
- Nada. En la pestaña *Puntos*, la columna *Tiempo estimado* queda con los datos anteriores; los puntos nuevos la dejan vacía. Puede borrarla si quiere.

## [1.0.0] - 2026-11-05

Primera versión pública.

### Agregado
- Número de versión visible en el pie del formulario y en **Junta → Acerca de / versión**.
- Este historial de cambios, y versiones con etiqueta y *Release* en GitHub.
- Licencia MIT.
- Sección *Privacidad* en el README: los nombres, cargos, teléfonos y correos viven solo en la hoja.

### Cambiado
- La actualización automática publica en Apps Script **solo cuando cambia el número de versión**, no con cada cambio. GitHub crea sola la etiqueta y la *Release* de cada versión. Permite volver a una versión anterior (ver *Volver a una versión anterior* en el README).
- La lista de cargos de `Codigo.gs` es de ejemplo, con nombres ficticios.

### Qué hacer
- Nada. Si actualiza a mano: cambian `Codigo.gs` y `Formulario.html`.

## [0.6.0] - 2026-11-05

### Agregado
- **Material de apoyo** en cualquier punto: un archivo de PowerPoint, PDF, Word o imagen de hasta 10 MB, o un enlace a un video o archivo grande (YouTube, Google Drive).
- La agenda muestra el material debajo de la descripción.
- El correo de instrucciones menciona el material de apoyo.

### Qué hacer
- Nada. En la pestaña *Puntos* aparecen solas dos columnas nuevas al final cuando llegue el primer punto. Los archivos se guardan en la carpeta *"Cotizaciones – Junta Directiva"*, con *"Material"* en el nombre.

## [0.5.0] - 2026-11-05

### Agregado
- **Junta → Importar teléfonos y correos de mis contactos**: llena la pestaña *Contactos* desde los contactos de Google y los "Otros contactos" de Gmail. Solo llena celdas vacías; las coincidencias dudosas quedan en amarillo.

### Qué hacer
- ⚠️ **Permiso nuevo**: justo después de publicarse, 📊 recargue la hoja y use **Junta → Importar teléfonos y correos de mis contactos** → **Continuar** → **Permitir**. Hasta entonces, los enlaces del formulario pueden mostrar un error de autorización. Luego abra un enlace para confirmar que carga.
- Si actualiza a mano: cambian `Codigo.gs` y `appsscript.json`.

## [0.4.0] - 2026-11-05

### Agregado
- **Actividades de varios días**: fecha de inicio y fecha de término opcional (campamentos, campañas). La agenda muestra *"Del … al … (N días)"*.

### Cambiado
- Los puntos se guardan por nombre de columna: las columnas nuevas se agregan solas al final de *Puntos* sin desordenar las filas existentes.

### Corregido
- Un error en rojo se quita cuando cambia la respuesta de la que depende.

## [0.3.0] - 2026-11-05

### Agregado
- **Actualización automática** con GitHub Actions y clasp (opcional): prueba y publica el código en Apps Script sin copiar ni pegar.

## [0.2.0] - 2026-11-05

### Agregado
- Pestaña **Contactos** con teléfono y correo de cada persona.
- En *Enlaces*, botón **Enviar por WhatsApp** con el mensaje ya escrito, y estado del correo.
- **Correo automático** con el enlace e instrucciones completas.
- Código de país +507 por defecto, configurable desde el menú.

### Corregido
- Un teléfono escrito con 507 pero sin `+` ya no repite el código de país.

### Qué hacer
- 📊 Recargue la hoja y use **Junta → Actualizar la pestaña Enlaces**: se crea la pestaña *Contactos*. Complétela y vuelva a usar esa opción.
- 📊 La primera vez que envíe correos, Google pide permiso para enviar correo en su nombre.

## [0.1.1] - 2026-11-05

### Corregido
- `configurar` ya no se queda esperando un clic en la hoja hasta agotar el tiempo.
- Mensaje claro si el código se pegó fuera de una hoja de cálculo.
- **Cambiar la URL de la aplicación** siempre pide la URL; la hoja ya no la detecta sola, porque podía guardar una equivocada.

## [0.1.0] - 2026-11-05

### Agregado
- Aplicación web con apariencia de Google Forms para enviar puntos a la Junta Directiva.
- Un enlace personal por persona y por junta, y un enlace general para miembros.
- Formulario por secciones: informativo o para votación, actividad, presupuesto con cotización.
- Agenda automática ordenada según el Manual de la Iglesia (evangelismo primero).

[Sin publicar]: https://github.com/AlenEngineer/junta-directiva-puntos/compare/v1.7.0...HEAD
[1.7.0]: https://github.com/AlenEngineer/junta-directiva-puntos/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/AlenEngineer/junta-directiva-puntos/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/AlenEngineer/junta-directiva-puntos/compare/v1.4.1...v1.5.0
[1.4.1]: https://github.com/AlenEngineer/junta-directiva-puntos/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/AlenEngineer/junta-directiva-puntos/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/AlenEngineer/junta-directiva-puntos/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/AlenEngineer/junta-directiva-puntos/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/AlenEngineer/junta-directiva-puntos/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/AlenEngineer/junta-directiva-puntos/compare/0d31e92...v1.0.0
[0.6.0]: https://github.com/AlenEngineer/junta-directiva-puntos/compare/6ace68b...0d31e92
[0.5.0]: https://github.com/AlenEngineer/junta-directiva-puntos/compare/66fea6f...6ace68b
[0.4.0]: https://github.com/AlenEngineer/junta-directiva-puntos/compare/008f40b...66fea6f
[0.3.0]: https://github.com/AlenEngineer/junta-directiva-puntos/compare/v0.2.0...008f40b
[0.2.0]: https://github.com/AlenEngineer/junta-directiva-puntos/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/AlenEngineer/junta-directiva-puntos/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/AlenEngineer/junta-directiva-puntos/releases/tag/v0.1.0
