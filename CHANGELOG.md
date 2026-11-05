# Historial de cambios

Todas las versiones de *Puntos para la Junta Directiva*. La más reciente va primero.

Las versiones siguen el formato `MAYOR.MENOR.PARCHE` ([versionado semántico](https://semver.org/lang/es/)), adaptado a esta aplicación:

- **PARCHE** (1.0.**1**): correcciones. No cambia cómo se usa y no requiere nada de su parte.
- **MENOR** (1.**1**.0): funciones nuevas. Puede pedir un permiso nuevo de Google; la nota de la versión dice qué hacer.
- **MAYOR** (**2**.0.0): cambios que exigen pasos manuales en una instalación que ya funciona, por ejemplo cambiar la estructura de la hoja.

Cada versión explica, en **Qué hacer**, los pasos para una instalación existente. Con la actualización automática configurada, el código se publica solo; en ese caso, solo siga los pasos marcados con 📊 (en la hoja).

## [Sin publicar]

Cambios que ya están en `main` pero todavía no forman parte de una versión.

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

[Sin publicar]: https://github.com/AlenEngineer/junta-directiva-puntos/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/AlenEngineer/junta-directiva-puntos/compare/v0.6.0...v1.0.0
[0.6.0]: https://github.com/AlenEngineer/junta-directiva-puntos/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/AlenEngineer/junta-directiva-puntos/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/AlenEngineer/junta-directiva-puntos/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/AlenEngineer/junta-directiva-puntos/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/AlenEngineer/junta-directiva-puntos/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/AlenEngineer/junta-directiva-puntos/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/AlenEngineer/junta-directiva-puntos/releases/tag/v0.1.0
