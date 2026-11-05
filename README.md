# Puntos para la Junta Directiva

Aplicación web hecha con Google Apps Script para que los oficiales de la iglesia envíen los puntos de la agenda de la Junta Directiva. Se ve como Google Forms. Las respuestas se guardan en una hoja de Google Sheets y las cotizaciones en una carpeta de Google Drive.

## Qué hace

- **Un enlace por persona y por junta.** En el menú **Junta → Nueva junta** se elige la fecha y se crean enlaces nuevos para cada persona de la pestaña *Cargos*, más un enlace general para miembros. Los enlaces de la junta anterior dejan de funcionar.
- **Pestaña "Enlaces":** primero aparecen los directores, después los asociados y miembros, y al final el enlace general.
- **Compartir los enlaces:** cada persona tiene un botón **Enviar por WhatsApp** que abre el chat con el mensaje ya escrito, y se le puede enviar un **correo automático** con su enlace y una explicación completa.
- **El formulario se adapta a cada respuesta:**
  - *Informativo*: solo pide los datos del punto y la descripción del informe.
  - *Para votación*: pregunta si es una actividad (fechas, horas, lugar, responsable) y si se pide dinero de la iglesia. Las actividades de varios días, como un campamento o una campaña, llevan fecha de inicio y de término.
  - *Presupuesto*: costo total y monto que se pide a la iglesia, que no puede ser mayor. Si no cubre todo, pregunta cómo se conseguirá el resto. El costo se explica con una descripción, un enlace o un archivo (PDF, Word o imagen de hasta 5 MB).
- **Agenda automática:** **Junta → Generar agenda** arma una pestaña con los puntos ordenados: devocional, evangelismo y misión, acta anterior, tesorería, departamentos, feligresía, asuntos generales y oración de clausura.
- **Puntos del enlace general:** llegan como *Por revisar* y entran en la agenda cuando su Estado se cambia a *Aprobado*.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `Codigo.gs` | El servidor: menú de la hoja, enlaces, validación, guardado y agenda |
| `Formulario.html` | La página que ven los hermanos |
| `appsscript.json` | Configuración del proyecto de Apps Script: zona horaria y permisos de la aplicación web |
| `tests/` | Pruebas automáticas (no se suben a Google) |
| `.github/workflows/desplegar.yml` | Actualización automática: prueba y publica cada cambio (ver *Actualización automática*) |
| `.claspignore` | Indica que solo `Codigo.gs`, `Formulario.html` y `appsscript.json` se suben a Apps Script |

## Instalación

Se trabaja en dos lugares. Cada paso dice dónde:

- 📊 **La hoja de cálculo**, en Google Sheets: donde quedan los puntos, los enlaces y las agendas.
- 🛠️ **El editor de Apps Script**: donde va el código. **Siempre se abre desde la hoja**, con el menú **Extensiones → Apps Script**. No cree el proyecto en script.google.com ni en Drive: si el código no está dentro de la hoja, no funciona.

### Paso 1 · Crear la hoja (📊 Google Sheets)

1. Entre a [sheets.google.com](https://sheets.google.com) y cree una **hoja de cálculo en blanco**.
2. Póngale nombre arriba a la izquierda, por ejemplo **Junta Directiva**.

### Paso 2 · Pegar el código (🛠️ Apps Script)

1. 📊 En la hoja, vaya al menú **Extensiones → Apps Script**. Se abre el editor en otra pestaña.
2. 🛠️ A la izquierda, en *Archivos*, está `Código.gs`. Ábralo, borre todo lo que tenga y pegue el contenido de **`Codigo.gs`**.
3. 🛠️ Junto a *Archivos*, haga clic en **+ → HTML**. Escriba el nombre **`Formulario`**, exactamente así, sin `.html`. Borre lo que trae y pegue el contenido de **`Formulario.html`**.
4. 🛠️ Presione el ícono de **guardar** (💾) arriba.

### Paso 3 · Configurar (🛠️ Apps Script)

1. 🛠️ Arriba, al lado del botón **Ejecutar**, hay una lista con nombres de funciones. Elija **`configurar`**.
2. 🛠️ Presione **Ejecutar**.
3. La primera vez, Google pide permisos:
   - Presione **Revisar permisos** y elija su cuenta.
   - Aparecerá *"Google no ha verificado esta aplicación"*. Es normal en scripts propios: presione **Configuración avanzada → Ir a … (no seguro)**.
   - Presione **Permitir**. El acceso a Drive se usa para guardar las cotizaciones.
4. 🛠️ Abajo, en el *Registro de ejecución*, debe aparecer **"Configuración lista"** en pocos segundos.
5. 📊 En la hoja aparecen las pestañas **Cargos**, **Juntas**, **Puntos** y **Contactos**. En su Google Drive aparece la carpeta **"Cotizaciones – Junta Directiva"**.

### Paso 4 · Publicar la aplicación (🛠️ Apps Script)

1. 🛠️ Arriba a la **derecha**, presione el botón azul **Implementar → Nueva implementación**.
2. 🛠️ Al lado de *"Seleccionar tipo"*, presione el **engranaje ⚙️** y elija **Aplicación web**.
3. 🛠️ Complete:
   - **Descripción:** por ejemplo *Versión 1*
   - **Ejecutar como:** *Yo (su correo)*
   - **Quién tiene acceso:** *Cualquier usuario*
4. 🛠️ Presione **Implementar**. Si pide permisos otra vez, acéptelos.
5. 🛠️ Copie la **URL de la aplicación web**, la que termina en `/exec`. La hoja se la pedirá en el paso 6.

### Paso 5 · Completar los contactos (📊 Google Sheets)

1. 📊 Vuelva a la pestaña de la hoja y **recárguela** (F5). Arriba aparece un menú nuevo: **Junta**.
2. 📊 En la pestaña **Contactos** ya están los nombres. Complete el **Teléfono** (celular) y el **Correo** de cada persona. Si no tiene alguno de los dos, déjelo vacío.
   - Los números de Panamá se escriben normal, por ejemplo `6123-4567`; el código +507 se agrega solo. Da igual si usa guiones, espacios o nada (`61234567`), y si ya escribió `+507` o `507` delante tampoco se repite.
   - Un número de otro país se escribe con `+` y su código, por ejemplo `+1 555 123 4567`.
   - Si el número no es válido, la pestaña *Enlaces* lo indica con *Teléfono no válido · elegir contacto*.

Los teléfonos y correos quedan **solo en su hoja**: no están en el código ni en GitHub.

### Paso 6 · Crear la primera junta (📊 Google Sheets)

1. 📊 Vaya a **Junta → Nueva junta…** La primera vez pide la URL de la aplicación: pegue la del paso 4. Después escriba la fecha, por ejemplo `14/03/2027`.
2. 📊 Se abre la pestaña **Enlaces** con el enlace de cada persona, y la hoja pregunta si quiere **enviar los correos** ahora.
3. 📊 Para WhatsApp, siga la sección *Compartir los enlaces*.

## Uso diario (📊 Google Sheets)

Todo se hace desde el menú **Junta** de la hoja:

| Opción | Para qué sirve |
|---|---|
| **Nueva junta…** | Elegir la fecha de la próxima junta y crear enlaces nuevos. Los anteriores dejan de funcionar. Al final ofrece enviar los correos. |
| **Generar agenda…** | Crear la pestaña *Agenda dd-mm-aaaa* con los puntos ordenados. Se puede generar varias veces: se reemplaza. |
| **Enviar enlaces por correo…** | Enviar el correo a quienes aún no lo recibieron. Si todos ya lo recibieron, ofrece reenviarlo. |
| **Actualizar la pestaña Enlaces** | Después de editar *Contactos*, para que se actualicen los botones de WhatsApp y el estado del correo. |
| **Cambiar el enlace de una persona…** | Si un enlace se filtró. Escriba el nombre, o `GENERAL` para el enlace general. Ofrece enviarle el enlace nuevo por correo. |
| **Cerrar recepción de puntos** | Dejar de recibir puntos antes del día de la junta. |
| **Cambiar la URL de la aplicación…** | Si los enlaces abren una página de error, o si creó una implementación nueva en vez de actualizar la existente. Muestra la URL guardada y le deja pegar la correcta. |
| **Cambiar el código de país…** | El código que se agrega a los teléfonos sin `+`. Viene con +507 (Panamá). |

**Puntos del enlace general:** en la pestaña **Puntos**, cambie su columna *Estado* de *Por revisar* a *Aprobado* (o *Rechazado*) y vuelva a generar la agenda.

## Compartir los enlaces (📊 Google Sheets)

La pestaña **Enlaces** tiene dos columnas para compartir:

**WhatsApp** (un clic por persona):
1. 📊 Haga clic en **Enviar por WhatsApp** junto a la persona y abra el enlace que aparece.
2. Se abre WhatsApp, en el celular o en WhatsApp Web, con el chat de esa persona y el mensaje ya escrito: su nombre, la fecha de la junta y su enlace. Si la persona tiene correo en *Contactos*, el mensaje también le pide revisar el correo con las instrucciones y la guía. Por eso conviene **enviar los correos primero**.
3. Presione **Enviar**.

Si la persona no tiene teléfono en *Contactos*, el botón dice **Elegir contacto**: WhatsApp abre el mensaje ya escrito y usted elige a quién enviarlo. El enlace general siempre funciona así, para enviarlo al miembro que lo necesite.

**Correo** (automático):
- El correo explica con más detalle: los cargos de la persona, cómo usar el formulario, cuándo deja de funcionar el enlace y por qué, cómo cuidarlo y qué hacer si no abre.
- Sale desde su cuenta de Google, con el nombre *Junta Directiva*. Si alguien responde, la respuesta le llega a usted.
- La columna **Correo** muestra *Enviado* (con fecha y hora), *Pendiente*, *Sin correo* o *Correo no válido*.
- La primera vez que envíe correos, Google pide un permiso nuevo para **enviar correo en su nombre**: acéptelo igual que en el paso 3.
- Google permite unos 100 correos por día en cuentas gratuitas, más que suficiente para la junta.

## Cambiar los cargos (📊 Google Sheets)

Edite la pestaña **Cargos**: departamento, nombre, cargo y si es director (*Sí* o *No*). Agregue o borre filas según haga falta. Los cambios se aplican en la siguiente **Junta → Nueva junta**.

Si agrega a una persona nueva, aparece sola en **Contactos** la próxima vez que se actualice la pestaña Enlaces. Complete ahí su teléfono y correo. El nombre debe escribirse igual en *Cargos* y en *Contactos*.

## Actualizar el código (🛠️ Apps Script)

> Si configuró la **Actualización automática** (siguiente sección), no necesita hacer esto: cada cambio en GitHub se publica solo. Solo recargue la hoja.

Cuando haya una versión nueva de `Codigo.gs` o `Formulario.html`:

1. 📊 En la hoja, vaya a **Extensiones → Apps Script**.
2. 🛠️ Abra el archivo que cambió (`Código.gs` o `Formulario`), borre todo, pegue la versión nueva y presione **guardar** (💾).
3. 🛠️ Vaya a **Implementar → Gestionar implementaciones**.
4. 🛠️ Presione el **lápiz ✏️** (editar). En **Versión**, elija **Nueva versión** y presione **Implementar**.

> ⚠️ **No use "Nueva implementación" para actualizar.** Eso crea un enlace de aplicación distinto y los enlaces que ya envió dejarían de funcionar. Si ya lo hizo, use **Junta → Cambiar la URL de la aplicación…** y luego **Junta → Nueva junta**.

**No hace falta ejecutar `configurar` otra vez** al actualizar, salvo que el cambio lo indique. Si lo ejecuta, no pasa nada: no borra ni duplica pestañas ni la carpeta.

## Actualización automática con GitHub Actions (opcional)

Con esto, cada cambio que llega a la rama `main` de GitHub:
1. corre las pruebas;
2. si pasan, sube `Codigo.gs`, `Formulario.html` y `appsscript.json` a su proyecto de Apps Script;
3. publica una **nueva versión en la misma implementación**, así que la URL y los enlaces no cambian.

Se configura una sola vez. Necesita una computadora con [Node.js](https://nodejs.org) instalado (versión LTS) para el paso 3.

### Paso 1 · Activar la API de Apps Script (navegador)

1. Entre a [script.google.com/home/usersettings](https://script.google.com/home/usersettings) con la misma cuenta de Google de la hoja.
2. Active **API de Google Apps Script**.

### Paso 2 · Copiar los dos ID (🛠️ Apps Script)

1. 📊 En la hoja, vaya a **Extensiones → Apps Script**.
2. 🛠️ A la izquierda, presione el **engranaje ⚙️ (Configuración del proyecto)**. Copie el **ID de secuencia de comandos**.
3. 🛠️ Arriba a la derecha, vaya a **Implementar → Gestionar implementaciones**. Elija la aplicación web activa y copie el **ID de implementación** (es largo y empieza con `AKfy…`).

### Paso 3 · Autorizar a clasp (💻 su computadora)

1. Abra una terminal: en Windows, *PowerShell*; en Mac, *Terminal*.
2. Ejecute:
   ```bash
   npx @google/clasp@2.4.2 login
   ```
3. Se abre el navegador. Elija su cuenta de Google y presione **Permitir**.
4. Se crea el archivo **`.clasprc.json`** en su carpeta de usuario: en Windows `C:\Users\SU_USUARIO\.clasprc.json`, en Mac `~/.clasprc.json`. Ábralo con el Bloc de notas o TextEdit y copie **todo** su contenido.

> ⚠️ Ese archivo da acceso a sus proyectos de Apps Script y a archivos de su Drive. No lo comparta ni lo suba al repositorio: va solo como secreto de GitHub (paso 4). Después puede borrarlo de su computadora.

### Paso 4 · Guardar los secretos (🐙 GitHub)

1. En el repositorio, vaya a **Settings → Secrets and variables → Actions → New repository secret**.
2. Cree estos tres secretos:

| Nombre | Valor |
|---|---|
| `CLASPRC_JSON` | Todo el contenido de `.clasprc.json` (paso 3) |
| `SCRIPT_ID` | El ID de secuencia de comandos (paso 2) |
| `DEPLOYMENT_ID` | El ID de implementación (paso 2) |

### Paso 5 · Probar (🐙 GitHub)

1. Vaya a la pestaña **Actions → Probar y desplegar → Run workflow**.
2. Al terminar en verde, en 🛠️ **Implementar → Gestionar implementaciones** debe aparecer una versión nueva con la descripción *GitHub …*.

### Tenga en cuenta

- **No edite el código en el editor de Apps Script.** Cada despliegue reemplaza el código con el de GitHub, y los cambios hechos a mano se pierden.
- La primera vez, el archivo `Código.gs` del editor pasa a llamarse `Codigo.gs`, igual que en GitHub. Es normal.
- Mientras falten los secretos, GitHub solo corre las pruebas y avisa que no despliega.
- Si cambia la contraseña de Google o quita el permiso de clasp, repita los pasos 3 y 4.
- Mantenga el repositorio **privado**.

## Novedades

Qué hacer en una instalación que ya funciona, versión por versión (la más reciente primero):

**Noviembre 2026 · Actividades de varios días**
- Las actividades tienen **fecha de inicio** y una **fecha de término** opcional, para campamentos, campañas y otras actividades de varios días. En ese caso, las horas son del primer y del último día. La agenda muestra, por ejemplo, *"Del 20/03/2027 al 22/03/2027 (3 días)"*.
- En la pestaña **Puntos** aparece sola una columna nueva al final, *Fecha de término de la actividad*, cuando llegue el primer punto. Las filas anteriores no cambian.
- Con la actualización automática no hay que hacer nada. Si actualiza a mano: cambian `Codigo.gs` y `Formulario.html`, y hay que publicar una nueva versión.

**Noviembre 2026 · Actualización automática (opcional)**
- Se agregó la actualización automática con GitHub Actions (ver la sección anterior). Si no la configura, todo sigue igual: actualice a mano como siempre.
- El código no cambió, así que no hace falta actualizar nada en Apps Script.

**Noviembre 2026 · Compartir por WhatsApp y correo**
1. 🛠️ Actualice solo `Código.gs`, como dice *Actualizar el código*, y publique una **nueva versión**. `Formulario.html` no cambió.
2. 📊 Recargue la hoja (F5) y use **Junta → Actualizar la pestaña Enlaces**. Se crea la pestaña **Contactos** con los nombres, y en *Enlaces* aparecen las columnas *WhatsApp* y *Correo*. Los enlaces actuales siguen funcionando.
3. 📊 Complete teléfonos y correos en **Contactos** y vuelva a usar **Junta → Actualizar la pestaña Enlaces**.
4. 📊 Para enviar los correos: **Junta → Enviar enlaces por correo…**. La primera vez pide un permiso nuevo.

No hace falta ejecutar `configurar` ni crear una junta nueva.

## Problemas comunes

| Mensaje | Causa y solución |
|---|---|
| *Este script no está dentro de una hoja de cálculo* o *Cannot read properties of null (reading 'getId')* | El proyecto se creó en script.google.com o en Drive. Créelo desde la hoja: **Extensiones → Apps Script** (paso 2). |
| *Excedió el tiempo máximo de ejecución* al ejecutar `configurar` | Pasaba con una versión anterior que esperaba un clic en la hoja. Actualice `Código.gs` y ejecute `configurar` de nuevo. |
| No aparece el menú **Junta** | Recargue la hoja (F5). Si sigue sin aparecer, revise que el código esté pegado en el editor que se abre desde **Extensiones → Apps Script**. |
| Al abrir un enlace sale una página de Google Drive: *"No se pudo abrir el archivo en este momento"* | Casi siempre es porque el navegador tiene **varias cuentas de Google abiertas**. Abra el enlace en una ventana de incógnito o en el celular. Si tampoco funciona: 🛠️ en **Implementar → Gestionar implementaciones**, copie la URL de la aplicación web (termina en `/exec`), compárela con la parte del enlace antes de `?t=` en la pestaña *Enlaces* y, si es distinta, use 📊 **Junta → Cambiar la URL de la aplicación…**. Revise también que *Quién tiene acceso* diga *Cualquier usuario*. |
| El enlace dice *"Este enlace no es válido"* | La junta ya pasó, se cerró la recepción o el enlace se cambió. Cree una junta nueva o cambie el enlace de esa persona. |
| Los cambios en el código no se ven en la página | Falta publicar la versión nueva: **Implementar → Gestionar implementaciones → ✏️ → Nueva versión**. |

## Seguridad

- Cada enlace lleva una clave aleatoria. Solo funciona para la junta abierta y vence al terminar el día de la junta.
- El servidor vuelve a revisar todos los datos: que el departamento sea de esa persona, los montos, el tipo de archivo (revisando su contenido, no solo la extensión) y el tamaño.
- La página solo envía datos: nadie puede ver los puntos de otros desde el enlace.
- Hay un límite de envíos por enlace para evitar abusos.
- Los textos se guardan de forma que la hoja no los interprete como fórmulas.

## Pruebas

Las pruebas revisan las reglas de validación del servidor y el comportamiento de la página en un navegador. No prueban la parte que corre dentro de Google: hoja, Drive y menú.

```bash
npm install
npx playwright install chromium
npm test
```
