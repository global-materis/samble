# El CLI de samble

Todo lo que `samble` escribe, y nada más. Para lo que el framework *hace* con lo
que escribe, mirá [la guía](./guide.md).

El CLI hace dos cosas y se niega a hacer más: escribe archivos, y corre
compilaciones y migraciones.

Los generadores no saben nada de tu aplicación — ni base de datos, ni archivo de
configuración, ni registro de lo que existe. Leen argumentos y escriben archivos.
Los cuatro que SÍ llegan a la base (`migrate`, `migrate:status`,
`migration:generate`, y ninguno más) llegan de la misma forma: importan tu punto
de entrada y le piden la aplicación, que ya sabe dónde viven sus datos.

```bash
npx @samble/core@alpha init my-app     # la única vez que necesitás @alpha
cd my-app
npx samble module billing
npm run dev
```

Después de `init`, samble queda instalado en el proyecto, así que `npx samble`
resuelve el binario local. La etiqueta `@alpha` es sólo para la primera llamada,
mientras samble se publique bajo ella.

---

## De un vistazo

| Comando | Qué escribe o hace |
| --- | --- |
| [`init [name]`](#samble-init-name) | Un proyecto que corre: `package.json`, `tsconfig.json`, `.env`, punto de entrada |
| [`module <name>`](#samble-module-name) | Un módulo: su manifiesto, sus permisos y un primer endpoint |
| [`endpoint <module>/<name>`](#samble-endpoint-modulename) | Un endpoint HTTP |
| [`routine <module>/<name>`](#samble-routine-modulename) | Trabajo con horario |
| [`table <module>/<name>`](#samble-table-modulename) | Una tabla, con sus tipos de fila |
| [`migration <module>/<name>`](#samble-migration-modulename) | Una migración con sello de tiempo |
| [`migration:generate <module>/<name>`](#samble-migrationgenerate-modulename) | La misma, escrita desde tus tablas |
| [`token <module>/<name> <kind>`](#samble-token-modulename-kind) | Lo que este módulo comparte: un contrato o un slot |
| [`provider <module>/<name>`](#samble-provider-modulename) | La clase que responde un contrato |
| [`strategy <module>/<name> <slot>`](#samble-strategy-modulename-slot) | La clase que llena el slot de otro módulo |
| [`doctor`](#samble-doctor) | ¿Está esta máquina lista para correr esto? No cambia nada |
| [`migrate`](#samble-migrate) | Corre las migraciones pendientes |
| [`migrate:status`](#samble-migratestatus) | Qué declara cada módulo, y qué ya corrió |
| [`build`](#samble-build) | Compila, opcionalmente a bytecode de V8 |

Todos los generadores toman las mismas tres banderas:

| Bandera | Por defecto | Qué es |
| --- | --- | --- |
| `--dir <path>` | `src/modules` | dónde viven los módulos |
| `--from <specifier>` | `samble` | de dónde importa samble el código generado |
| `--force` | apagada | sobrescribir archivos que ya existen |

`--from` existe para un repositorio que trae samble adentro en vez de instalarlo:
pasá `--from ../../lib` y los imports generados apuntan ahí. El resto no la
toca.

---

## Por qué casi ningún comando edita nada

Un generador escribe su archivo y para. No hay una lista en `module.ts` que
mantener sincronizada, porque **la carpeta es lo que registra el archivo**:

```
billing/
├── module.ts                   ← el cableado, y las claves de permiso
├── tables/*.table.ts           migrations/*.ts
├── endpoints/*.endpoint.ts     routines/*.routine.ts
├── providers/*.provider.ts     strategies/*.strategy.ts
└── tokens/*.token.ts           (contratos, slots y horarios)
```

Las primeras filas son globs que samble lee al arrancar. La última no: un token
se importa por nombre, así que no hay nada que descubrir — esa carpeta existe
para que la encuentres, y el CLI es lo que la mantiene consistente.

Sólo dos ediciones tocan un archivo que el generador no escribió, y las dos
tienen una forma lo bastante segura como para hacerlas sin parsear TypeScript:

- `samble module` agrega el módulo a `modules: [ ]` en `src/index.ts`, y le añade
  un bloque a `src/config/permissions.ts`.
- `samble endpoint --permission` agrega la clave al `permissions: []` del
  manifiesto del módulo.

Cualquier cosa menos segura se imprime como instrucción. Un andamiaje que
destroza en silencio un archivo que escribiste es peor que uno que te dice qué
agregar.

---

## Lo que genera no lleva comentarios

Un archivo generado es código y nada más. El único que explica es `samble init`, y
es el único que se escribe una vez.

Un generador corre todos los días. Su explicación termina copiada en el décimo
endpoint, en el quinto token y en la tercera migración, donde ya no le enseña
nada a nadie: es texto para leer de largo o borrar a mano, y se vuelve mentira el
día que el framework cambia y los archivos viejos siguen ahí.

Lo que hay que saber se dice una vez, cuando es nuevo — el comando lo imprime al
terminar:

```bash
$ npx samble token catalog/product-badges slot

  created  src/modules/catalog/tokens/product-badges.token.ts

  next     ProductBadge is the shape of ONE contribution; ProductBadges is the collection.
  next     Read it: const filled = this.all(ProductBadges). An empty array is a normal answer — a slot nobody filled is a feature nobody installed.
  next     Fill it from another module: samble strategy <module>/<name> product-badges
  next     Note the direction: "catalog" opens it and knows nothing about who fills it, which is what keeps the host independent of its own extensions.
```

Y el porqué vive en esta página y en [wiring.md](wiring.md): un solo lugar, que
se puede corregir.

---

## `samble init [name]`

```bash
npx @samble/core@alpha init my-app                 # dentro de ./my-app
npx @samble/core@alpha init                        # en la carpeta actual
npx @samble/core@alpha init my-app --skip-install  # escribe los archivos, el npm install lo corrés vos
npx @samble/core@alpha init my-app --dir src/bc    # los módulos viven en otro lado
npx @samble/core@alpha init my-app --no-git        # sin repositorio ni primer commit
```

| Bandera | Efecto |
| --- | --- |
| `--skip-install` | escribe los archivos y para |
| `--no-git` | no crea el repositorio, ni el primer commit |
| `--dir <path>` | dónde van a vivir los módulos (por defecto `src/modules`) |

Escribe:

```
package.json          scripts, y las dependencias que el framework necesita
tsconfig.json         las dos banderas de decoradores, y el alias @/
.gitattributes        el árbol de trabajo es LF, en cualquier máquina
.editorconfig         la forma de un archivo, para editores sin herramientas
.prettierrc           .prettierignore
eslint.config.mjs     flat config; el formato queda para Prettier
.vscode/              formatear al guardar, y las extensiones que lo hacen
.env  .env.template   NODE_ENV, puertos, orígenes CORS, base de datos
.gitignore
src/index.ts          createApp() separado de main()
src/config/permissions.ts
src/config/auth.ts
src/config/session.ts sesión por cookie, y qué lleva adentro
test/app.spec.ts      la app entera, arrancada sobre un Postgres en proceso
test/tsconfig.json    para que el editor y el linter vean las pruebas
```

Tres cosas de ahí conviene conocerlas, porque equivocarse en cualquiera cuesta
una tarde.

**Las banderas de decoradores.** `experimentalDecorators` y
`emitDecoratorMetadata`. Sacá cualquiera de las dos y cada ruta y cada entidad
pasan a no hacer nada, en silencio — nada falla, nada contesta.

**`strictPropertyInitialization: false`.** Los DTO
validados declaran campos que el constructor nunca asigna; los llena el ORM. Con
la bandera encendida, cada uno de ellos es un error.

**`createApp()` está separado de `main()`**, y `main()` sólo corre bajo
`if (require.main === module)`. Importar el archivo de entrada no tiene que
levantar un servidor — eso es lo que le permite a una prueba, a un script y a
`samble migrate` construir la aplicación sin escuchar en un puerto.

**Permisos y `auth` vienen escritos, no comentados.** `src/config/auth.ts` tiene
un resolutor que deja pasar a **todos** con todos los permisos, y `src/index.ts`
se lo pasa. Eso no es autenticación — es lo que hace que `this.auth`,
`this.auth.assert(...)` y las claves de permiso chequeadas por el compilador
funcionen en la primera petición, así reemplazarlo después es un archivo y no una
migración de todos los endpoints que escribiste mientras tanto. Lo dice en el
log, una vez, la primera vez que deja pasar una petición.

**La sesión viene puesta.** `src/config/session.ts` monta `express-session` con
la cookie `httpOnly` y sin entregarle una a quien nunca inicia sesión, declara
qué lleva la sesión adentro —`userId`, para empezar— y `src/index.ts` la monta
antes de las rutas. `.env` recibe un `SESSION_SECRET` generado para ese
proyecto. Sin esto, el resolutor que se genera no podría leer
`request.session?.userId` ni un login escribir `this.request.session`: el tipo
no existe hasta que el paquete **y** sus tipos están instalados.

> Sin store viven en memoria: se pierden en cada reinicio y un segundo proceso
> no ve las del primero. Cuando esto tenga usuarios, pasá el store de
> `express-session` de tu motor, armado sobre la conexión que abrió samble
> (`app.db.$client`) para no abrir otro pool. samble no instala ninguno: cuál
> depende del motor, y el motor lo elegís vos. Mirá
> [Sesiones](./guide.md#sesiones).

**Y trae una prueba que arranca la aplicación.** `test/app.spec.ts` llama al
mismo `createApp()` que corre un despliegue, pasándole `openTestDatabase()` — un
Postgres de verdad dentro del proceso (PGlite) — así que `npm test` no necesita
servidor ni `.env`. La configuración de jest va en el `package.json`, y
`test/tsconfig.json` deja que el editor y las reglas de lint con tipos lean las
pruebas mientras el `tsconfig.json` raíz conserva `rootDir: src` para el build.
Mirá [Pruebas](./guide.md#pruebas).

**Y nace versionado.** Corre `git init` en la rama `main` y deja el andamiaje
como primer commit, después del `npm install` para que el lockfile entre. El
punto es el commit: dieciocho archivos que nadie tipeó no son trabajo tuyo, y sin
un commit propio terminan adentro del primero de verdad, donde quien lo revise no
puede distinguir una cosa de la otra. Con él, tu primer `git diff` es sólo lo que
escribiste vos, y `git checkout .` tiene a dónde volver desde el minuto uno.

Tres cosas lo detienen, ninguna es un error, y las tres se dicen en una línea: no
hay git instalado; la carpeta **ya** está adentro de un repositorio (`samble init
my-app` en un monorepo es normal, y anidar uno esconde el proyecto del que ya lo
versiona); o el commit falla, casi siempre porque git no tiene identidad en esa
máquina — ahí el repositorio queda igual y el porqué lo dice git, no nosotros.
`--no-git` lo saltea del todo.

`src/config/permissions.ts` arranca con su bloque `declare global` ya abierto.
Está vacío hasta el primer módulo; `samble module` le añade un bloque por módulo y
la fusión de interfaces los junta, así que ninguna línea de ese archivo se vuelve
a abrir. Cada bloque **lee** las claves del manifiesto de ese módulo en vez de
repetirlas, así que una clave se escribe una sola vez.

### La forma de un archivo, decidida una vez

Cuatro archivos, y cada uno existe porque lo lee alguien distinto. Los cuatro
llevan los mismos valores, y esos valores son los que emiten los generadores —
así el primer `npm run format` no reescribe un archivo que `samble module` acaba
de escribir.

| Archivo | Lo lee |
| --- | --- |
| `.editorconfig` | cualquier editor, incluidos los que no corren nada. Prettier también |
| `.prettierrc` | Prettier, que **gana** sobre `.editorconfig` donde se solapan |
| `eslint.config.mjs` | ESLint: lo que el código SIGNIFICA |
| `.gitattributes` | git, cuando escribe los archivos en disco |

**El que todo el mundo se saltea es `.gitattributes`.** `* text=auto eol=lf` hace
que el árbol de trabajo sea LF en cualquier máquina. Sin eso, git en Windows saca
los archivos con CRLF mientras `.editorconfig` y `.prettierrc` piden LF: el
formateador quiere reescribir todas las líneas de la mitad del proyecto, y cada
diff es ruido. `eol=lf` gana sobre lo que tenga `core.autocrlf` localmente, así
que dos máquinas coinciden sin que nadie configure git.

**Prettier no corre como regla de ESLint**, que es lo que
[Prettier mismo recomienda](https://prettier.io/docs/integrating-with-linters):
correrlo como regla es más lento, llena el editor de subrayados rojos por cosas
que se arreglan solas al guardar, y agrega una capa que se puede romper.
`eslint-config-prettier/flat` sólo APAGA las reglas de estilo que discutirían con
el formateador, y va última en el arreglo porque así es como funciona. El que
formatea es `npm run format`.

`eslint.config.mjs` es flat config, porque `.eslintrc` se eliminó en ESLint 10 —
y el `package.json` declara `node >=22.13`. Ese piso no es de ESLint: Node 20
llegó a fin de vida en abril de 2026, y 22 es la línea más vieja que todavía
recibe parches de seguridad. Corré 24, que es el LTS activo.

TypeScript queda en `^6`, no en `^7`. TypeScript 7 existe, pero
`typescript-eslint` — la única forma de tener reglas con tipos — pide como peer
`typescript <6.1.0`, así que ir a 7 significaría resignar
`no-floating-promises`. El `tsconfig.json` generado igual queda escrito pensando
en la mudanza: sin `baseUrl` (deprecado en 6, eliminado en 7), `paths` relativo
al propio archivo, y `rootDir` explícito. `moduleResolution` sigue en `node10`
detrás de un `ignoreDeprecations`, porque cambiar el resolver cambia cómo se
resuelve cada paquete y eso es una tarea aparte.

Tres reglas quedan puestas a mano en vez de dejarlas al preset, y cada una es una
decisión:

- **`no-namespace` con `allowDeclarations: true`.** `declare global { namespace
  SambleAuth { ... } }` es como una aplicación dice qué es un actor y qué claves
  de permiso existen. Las declaraciones ambiente siguen permitidas; un namespace
  usado como valor, no.
- **`no-empty-object-type` con `allowInterfaces: 'with-single-extends'`.**
  `interface Permissions extends PermissionsOf<typeof mod> {}` está vacía
  *porque* las claves vienen del `extends`, y hay un bloque así por módulo.
  Configurar la regla es mejor que apagarla: un `{}` de verdad se sigue
  reportando.
- **`no-floating-promises` como error.** La única regla que necesita información
  de tipos y vale lo que cuesta: una llamada al repositorio cuya promesa nadie
  esperó son datos que en silencio no se escribieron, y no hay otra cosa que lo
  vea. `await-thenable` viene por lo mismo. Todo el resto de lo que mira tipos
  está en `tseslint.configs.recommendedTypeChecked`, comentado en el archivo,
  para cuando el código esté listo para responder por los `any` que devuelve un
  ORM.

`no-explicit-any` y `no-unused-vars` son **advertencias**. Un build que falla por
un `any` enseña a escribir `as unknown as T`, que es peor que el `any`.

Cuatro scripts: `lint`, `lint:fix`, `format`, `format:check`.

También deja cableadas tres cosas que todo backend termina necesitando, para que
no sean tarea para después:

| | Dónde |
| --- | --- |
| **Chequeo de salud** | `/health` |
| **Documentación de la API** | `/docs`, la especificación en `/docs.json` |
| **Archivos de log** | `logs/` — `app`, `info`, `warn`, `error`, `router` |

Las tres quedan **encendidas**, en todos los entornos. Apagar una es una decisión
que tomás mirando `src/index.ts`, no una que venga tomada de fábrica y te
sorprenda el día que despliegues.

**`/health`** contesta 200 mientras la aplicación puede atender y 503 mientras no
— que es lo que lee un balanceador, un runtime de contenedores o un chequeo de
disponibilidad. Queda fuera de `basePath`, no necesita credenciales (un
balanceador no puede iniciar sesión) y se mantiene fuera del log de accesos,
porque si no una sonda cada pocos segundos entierra cada petición real.

Dos detalles que hace bien y que uno escrito a mano suele no hacer: el chequeo de
la base es un **viaje de ida y vuelta**, no `isInitialized` — esa bandera sigue
en true después de que se cae la conexión, así que un chequeo que la lee reporta
`pass` durante la única caída para la que existe. Y pasa a 503 **apenas empieza
el apagado**, antes de que el servidor deje de aceptar, que es la ventana que un
balanceador necesita para drenar.

El cuerpo es deliberadamente flaco: `{ status, uptime }`, más `checks`
nombrando qué falló. Versiones y cantidades de módulos son el mapa de tu
instalación para quien lo encuentre; `details: true` los agrega, para cuando está
detrás de una puerta.

samble sólo puede responder por el proceso y la base. Cualquier otra cosa que esta
aplicación necesite para atender va en `health.checks` — el `index.ts` generado
muestra dónde:

```typescript
health: { path: '/health', checks: { queue: () => bridge.isConnected() } }
```

**`/docs`** se genera de los mismos decoradores que montan las rutas, así que no
puede separarse de lo que la API hace. Conviene saberlo antes de desplegar:
publica la forma completa de tu API a cualquiera que encuentre la URL. Ponelo
detrás de tu propia puerta, o sacá la opción, si no es lo que querés.

Cada línea de esos logs — y cada respuesta fallida — lleva el id de la petición a
la que pertenece, leído de `x-request-id` o generado. No hay nada que configurar;
es lo que ata a un usuario diciendo "falló" con las líneas que dicen por qué.

**`logs/`** tiene los archivos rotativos, y todos existen desde el primer
arranque, vacíos — un `error.log` vacío dice que no pasó nada malo, mientras que
uno que falta no dice nada:

```
logs/
├─ app.log        todos los niveles, en un solo hilo cronológico
├─ info.log
├─ warn.log
├─ error.log
└─ router.log     el mapa de rutas — el único con algo adentro al arrancar
```

`router.log` es el que vale la pena conocer: el mapa de qué contesta dónde, en
orden de registro — la respuesta más rápida a "por qué mi ruta da 404".
`app.log` es donde se lee qué pasó; los archivos separados son para grepear una
clase de cosa.

Esto viene encendido, así que la opción es sólo para moverlo (`dir`), renombrar o
sacar un archivo (`files: { error: 'errores' }`, `files: { info: false }`) o no
escribir ninguno con `dir: null` — que es lo que quiere un contenedor, donde el
disco no es donde nadie lee logs y los archivos se van con el contenedor.

### El alias `@/`

`init` lo escribe:

```jsonc
// tsconfig.json
"baseUrl": ".",
"paths": { "@/*": ["src/modules/*"] },
"ts-node": { "require": ["tsconfig-paths/register"] }
```

Para que el único import que cruza módulos deje de ser una escalera:

```typescript
import { UserDirectory } from '@/identity/tokens/user-directory.token';
//                            ^ src/modules/, sin importar qué tan hondo esté el archivo
```

Sólo los imports entre módulos lo necesitan. Dentro de un módulo,
`../tables/charge.table` es más corto y dice más.

**Un alias de `paths` existe sólo en tiempo de compilación.** `tsc` lo
typechequea y después emite `require("@/…")` tal cual, algo de lo que Node nunca
oyó hablar — una compilación que typechequea y se muere en su primer require.
samble lo cierra de los dos lados:

- `npm run dev` — `ts-node` lo resuelve, por la línea `ts-node.require` de
  arriba.
- `samble build` — reescribe los especificadores con alias a rutas relativas **en
  la salida**, así la aplicación compilada no necesita ni un loader, ni un
  envoltorio, ni una bandera.

Si cambiás el alias en `tsconfig.json`, eso es todo lo que cambiás: la
compilación lo lee de ahí.

---

## `samble module <name>`

```bash
npx samble module billing
npx samble module reports --label "Reports"
```

| Bandera | Efecto |
| --- | --- |
| `--label <text>` | nombre para personas, para una pantalla de "módulos" |
| `--entry <file>` | el archivo con `Samble.create({ modules: [...] })` (por defecto `src/index.ts`) |

Escribe `module.ts` y un primer endpoint que contesta en `/api/<name>`, después
registra el módulo en el punto de entrada y le añade a
`src/config/permissions.ts` un bloque que lleva sus claves al sistema de tipos.

Las claves viven en el manifiesto, como cadenas:
`permissions: ['billing.view']`. Una clave puede llevar texto para una pantalla
de roles cuando no lo puede decir sola —
`{ key: 'billing.void', label: 'Anular un cargo ya cobrado' }` — y el `label` es
opcional justamente porque la mayoría sí puede.

El endpoint generado trae su línea `this.auth.assert(...)` **viva**. Funciona
desde la primera petición porque `init` escribió un resolutor que deja pasar a
todos — la puerta está puesta y abierta, que es el único orden en el que cerrarla
es un cambio de una línea. Pasá `--public` para los que sí tienen que estar
abiertos.

---

## `samble endpoint <module>/<name>`

```bash
npx samble endpoint billing/issue-charge --method post
npx samble endpoint billing/find-one --path ":id"
npx samble endpoint billing/list --permission billing.view
npx samble endpoint public/health --public
```

| Bandera | Efecto |
| --- | --- |
| `--method <verb>` | `get`, `post`, `put`, `patch`, `delete`, `query` (por defecto `get`) |
| `--path <path>` | ruta bajo el grupo, p. ej. `:id` |
| `--group <name>` | prefijo de ruta (`@Group`); por defecto el id del módulo |
| `--permission <key>` | asertar esta clave desde el principio |
| `--public` | sin línea de permiso |

La URL es `<basePath>/<group>/<path>`, y **el grupo por defecto es el id del
módulo**, así que el andamiaje no escribe ningún `@Group`. Pasá `--group` sólo
cuando la URL no tiene que llevar el nombre del módulo — un módulo que sirve dos
recursos, o dos módulos que aportan a un mismo prefijo.

La aserción se escribe **viva** de las dos formas. Sin `--permission` aserta
`<module>.view`, la clave con la que arranca un módulo; con ella, aserta esa clave
y **la agrega** al arreglo `permissions` del manifiesto en la misma pasada — una
clave que ningún módulo declara es un 500 y no un 403, a propósito, porque es un
typo y no una concesión faltante.

Un endpoint que ESCRIBE quiere su propia clave, así que pasá `--permission`.
`--public` deja la línea afuera del todo.

---

## `samble routine <module>/<name>`

```bash
npx samble routine billing/nightly
npx samble routine billing/hourly --cron "0 * * * *"
```

| Bandera | Efecto |
| --- | --- |
| `--cron <expression>` | expresión de node-cron (por defecto `0 7 * * *`) |

Trabajo que la aplicación hace por su cuenta, con reloj. Una rutina vive y muere
con el módulo que la declara, y se detiene en el apagado ordenado.

Dos cosas que el archivo generado te recuerda: poné una `timezone` en `@Cron`, o
la expresión se lee en la zona horaria de la máquina donde haya terminado el
proceso; y `now` no siempre es un `Date` — es `'init'` cuando la rutina se
declaró con `{ runOnInit: true }`.

---

## `samble table <module>/<name>`

```bash
npx samble table billing/charge
npx samble table billing/charge --name facturacion_cargos
```

| Bandera | Efecto |
| --- | --- |
| `--name <name>` | nombre en SQL (por defecto `<module>_<name>`, en snake_case) |

Escribe la tabla y los dos tipos de fila que van con ella, y no edita nada:
`tables/*.table.ts` es donde samble mira.

```typescript
export const charge = pgTable('billing_charge', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
});

export type Charge = typeof charge.$inferSelect;
export type NewCharge = typeof charge.$inferInsert;
```

Los tipos van escritos porque son lo que el resto del módulo se pasa entre
funciones: una función que recibe una fila quiere el tipo, y derivarlo en cada
lugar es como dos de ellos terminan en desacuerdo.

**El prefijo no es adorno.** Las tablas de todos los módulos comparten un
namespace, y `billing_charge` es lo que evita que dos módulos quieran `charge`.
También es lo que hace que una base se lea por módulo de un vistazo.

**Un enum va exportado acá también**, no sólo usado por una columna. Una tabla
con columna de enum genera `"status" "billing_status" NOT NULL`, que
**referencia** el tipo: si el enum no está en el esquema, la migración sale
creando una tabla que apunta a un tipo que nada creó, y falla al correr.

**Declarar una tabla no la crea.** Cada tabla sale de una migración, que es lo
que una instalación es. Seguile con `samble migration:generate`.

---

## `samble migration <module>/<name>`

```bash
npx samble migration billing/create-charges
```

Escribe `migrations/<timestamp>-<name>.ts`. Nada la lista.

**El sello de tiempo al final del nombre de la clase es el orden**, dentro de ese
módulo — samble rechaza una clase de migración sin uno, porque el orden de
declaración no es un contrato. Entre módulos el orden es el de dependencias, así
que las tablas de un módulo existen antes de que un dependiente las toque. El
runner de un ORM no puede hacer eso: ordena todas las migraciones que conoce
globalmente, y un módulo escrito el año pasado migraría antes que la dependencia
que necesita.

**LANZA hasta que le escribas su SQL**, y eso no es cortesía. Una migración vacía
TIENE ÉXITO: una consulta que es sólo un comentario corre bien, así que samble la
anota como aplicada y desde ahí no tiene razón para volver a correrla — el SQL
que escribas después no se ejecuta nunca, y `samble migrate` sigue contestando
*nothing to migrate* sobre una tabla que jamás se creó. Fallar, en cambio,
revierte todo y no deja ninguna fila. Borrá el `throw` cuando el SQL esté.

---

## `samble migration:generate <module>/<name>`

```bash
npx samble migration:generate billing/add-due-date
npx samble migration:generate billing/add-due-date --print
```

| Bandera | Efecto |
| --- | --- |
| `--entry <file>` | archivo que exporta `createApp()` |
| `--dir <path>` | dónde viven los módulos (por defecto `src/modules`) |
| `--print` | muestra el SQL y no escribe nada |
| `--check` | además dice qué le falta a la base viva |
| `--force` | sobrescribe un archivo que ya existe |

**No se conecta a la base**, pero sí construye la aplicación con `createApp()`
para saber qué módulos tiene — así que las variables que `createApp()` exige
tienen que estar en el entorno (alcanza con el `.env`). Compara las tablas del
módulo contra el **snapshot** de ese módulo, que es un archivo:

```
src/modules/billing/
├── tables/*.table.ts
└── migrations/
    ├── 1790000000000-add-due-date.ts
    └── meta/snapshot.json        ← contra esto se compara la próxima
```

Escribe **dos** archivos: la migración y el snapshot nuevo. **Commiteá los dos**
— sin el snapshot, la próxima migración se escribe contra un esquema que ya no
corresponde y sale creando lo que existe.

Comparar dos descripciones de un esquema y escribir el SQL lo hace Drizzle Kit,
mejor que cualquier cosa a mano. Lo que decide samble es **qué** se compara, y es
por módulo: las tablas de un módulo contra el snapshot de ese módulo. Eso hace
que no haya nada que atribuir — un diff de todo el esquema habría que repartirlo,
y de ese reparto sale en qué orden corre la migración.

Un statement puede **nombrar** la tabla de otro módulo, porque una foreign key
apunta a algún lado, y eso está bien: la constraint es de quien la declara, y
samble migra en orden de dependencias, así que para cuando se aplica la tabla
apuntada ya existe.

**Sale también el `down()`**, que es la misma pregunta al revés — y por eso es
confiable en la misma medida que el `up`.

Con `--check` además conecta y dice si la base viva se separó del código: una
migración aplicada a mano, una columna borrada desde una consola o un snapshot
que nadie commiteó aparecen ahí y en ningún otro lado.

> **Leé lo que escribe.** Un diff no distingue un rename de un drop más un add,
> así que una columna renombrada sale como perder una y ganar otra — y sobre una
> tabla con filas, eso son los datos.

---

## `samble token <module>/<name> <kind>`

```bash
npx samble token identity/directory contract            # lo responde exactamente uno
npx samble token catalog/product-badges slot            # lo llenan los que haya
npx samble token catalog/product-restocked slot --reaction  # el anfitrión anuncia
```

| Bandera | Efecto |
| --- | --- |
| `--reaction` | para un slot: el anfitrión **anuncia** y no lee nada de vuelta |

Lo único que dos módulos comparten. Escribe `tokens/<name>.token.ts`, y el
segundo argumento es el mismo que lleva `token(id, kind)` adentro del archivo.

| kind | Quién responde | Cómo se lee | De quién es la falla |
| --- | --- | --- | --- |
| `contract` | exactamente uno | `this.get(Token)`, y espera la respuesta | de quien llama |
| `slot` | los que estén desplegados | `this.all(Token)`; un arreglo vacío es normal | del anfitrión |
| `slot --reaction` | los que estén desplegados | `this.notify(Token, carga)`; sin nadie, no hace nada | **de ellos** |

El token de un **horario** no sale de acá: lo escribe
[`samble routine`](#samble-routine-modulename), al lado de su clase.

Con **`contract`**, la interfaz y el token comparten nombre a propósito:
TypeScript tiene tipos y valores en espacios de nombres separados, así que un
import te da tanto la forma que el compilador chequea como la identidad que el
contenedor resuelve. El consumidor importa este archivo y nada más de tu módulo.

Con **`slot`** hay **dos** nombres: la interfaz es la forma de UNA contribución
y el token nombra la colección. Y mirá la dirección — el módulo que abre el slot
es del que dependen las extensiones: no sabe nada de quién lo llena, que es lo
que mantiene al anfitrión independiente de sus propias extensiones.

Con **`--reaction`** el módulo declara la **carga** y `Reaction<T>` aporta el
método, así que nadie tiene que inventarle un nombre. Esa carga tiene que llevar
lo que una reacción necesita: las reacciones leen en su propia conexión, así que
no pueden ver filas que una transacción todavía no confirmó — anunciá **después**
de que confirme. Y una reacción que lanza no hace fallar a quien anunció: se
loguea con su módulo y las demás corren igual.

Es la misma ranura en los dos casos; lo único que cambia es el **verbo** con que
el anfitrión la lee. Hubo un tercer tipo de token, `'event'`, con su propio bus y
su propia clase base, y lo único que agregaba sobre una ranura era esa última
columna — así que la garantía quedó y el mecanismo se fue.

Los dos caen en la **misma** carpeta a propósito. Separarlos en `contracts/` y
`slots/` pedía archivar una decisión que ya está tomada adentro del archivo, en
el segundo argumento.

---

## `samble provider <module>/<name>`

```bash
npx samble provider identity/directory
```

La clase que cumple la promesa de un contrato. Escribe
`providers/<name>.provider.ts` con `@Provides(Token)`.

Llenar el punto de extensión de otro módulo es
[otro comando](#samble-strategy-modulename-slot), porque es otra relación.

`this.db`, `this.get(Contract)`, `this.all(Slot)` y `this.notify(Slot, carga)` se
inyectan **antes** de construir la instancia, así que un inicializador de campo
ya puede alcanzar un repositorio:

```typescript
@Provides(UserDirectory)
export class UserDirectoryProvider extends Provider implements UserDirectory {
  private readonly users = () => this.db.select().from(users);
}
```

Se construye la primera vez que alguien lo pide, y después se reutiliza — un
contrato que nadie llama no cuesta nada.

---

## `samble strategy <module>/<name> <slot>`

```bash
npx samble strategy reports/low-stock product-badges
```

Una implementación de la interfaz de dominio que **otro** módulo abrió. Escribe
`strategies/<name>.strategy.ts` con `@Fills(Token)` sobre una clase que extiende
`Strategy`.

Carpeta propia, decorador propio y clase base propia, porque no es la cara
pública de tu módulo: nadie la pide por nombre, el anfitrión es el que la corre, y
la interfaz que `implements` es de él.

```typescript
@Fills(ProductBadges)
export class LowStock extends Strategy implements ProductBadge {
  public readonly id = 'low-stock';
}
```

- **El segundo argumento es el nombre del SLOT, no el del aporte.** De ahí salen
  el archivo (`tokens/product-badges.token`), el token (`ProductBadges`) y la
  interfaz (`ProductBadge`); el `<module>/<name>` de adelante sigue siendo tu
  módulo y tu clase.
- El import generado es un marcador que apunta a `@/<module>/tokens/…`: el slot
  pertenece al módulo que lo **abrió**, y una extensión importa ese token, nunca
  al revés.
- **De quién es la falla depende de cómo lea el anfitrión.** Con `all()` te llama
  derecho, así que tirar una excepción voltea su petición. Con `notify()` se
  loguea con el id de tu módulo y el anfitrión responde igual — que es lo que
  elige cuando la ranura es para efectos.

---

## `samble migrate`

```bash
npx samble migrate
npx samble migrate --dry-run
npx samble migrate --entry src/main.ts
```

| Bandera | Efecto |
| --- | --- |
| `--entry <file>` | archivo que exporta `createApp()` (por defecto `src/index.ts`) |
| `--dry-run` | dice qué correría, no cambia nada |

Corre las migraciones pendientes de cada módulo, en orden de
dependencias, sin levantar un servidor. El CLI nunca necesita saber dónde está tu
base de datos: le pide la aplicación a **tu** punto de entrada, que es por lo que
la plantilla de `init` separa `createApp()` de `main()`.

La base en sí tiene que existir. samble crea tablas, no bases de datos.

---

## `samble migrate:status`

```bash
npx samble migrate:status
```

| Bandera | Efecto |
| --- | --- |
| `--entry <file>` | archivo que exporta `createApp()` |

Lista qué declara cada módulo y qué de eso ya corrió, en el orden en que van a
migrar.

Leer el estado nunca crea nada: en una base que nunca migró, la tabla de registro
no existe y la respuesta es sencillamente que todo está pendiente.

---

## `samble doctor`

```bash
npx samble doctor
npx samble doctor --entry build/index.js   # contra el build, no contra el fuente
```

**No cambia nada.** No corre migraciones, no crea tablas, no activa nada. Se
puede correr antes, durante y después de una instalación, y dos veces.

Existe para el momento en que nadie está mirando los logs: un servidor que armó
otro, un contenedor que reinicia, un `.env` que alguien llenó desde la plantilla.
Cada cosa que reporta es una que, si no, aparece más tarde y **disfrazada de otro
problema** — una variable que falta como error del driver, un Node viejo como un
error de sintaxis, una migración que nadie corrió como un 500 en la primera
petición que toca la columna.

```
[ok]  Node  v22.14.0
[!!]  Environment (application)  Missing environment variables: DB_PORT, DB_NAME. …
[--]  Environment (modules)  the application did not load
[--]  Database  the application did not load
[--]  Migrations  the application did not load

1 check failed: this installation will not start as it is.
```

| Fila | Qué mira |
| --- | --- |
| `Node` | La versión que corre contra el `engines.node` de samble |
| `Environment (application)` | El `ConfigService.require()` de tu `createApp()` |
| `Environment (modules)` | El `env` que declara cada módulo instalado en su manifiesto |
| `Database` | Que la base conteste de verdad, con las credenciales que hay |
| `Migrations` | Cuántas quedan pendientes |

**El orden no es casual: cada fila es la razón por la que se puede confiar en la
siguiente.** Node antes de cargar el código, el entorno antes de la conexión, la
conexión antes de preguntar qué migraciones faltan. Y cuando una falla, las que
dependían de ella salen como **salteadas** (`[--]`), no como aprobadas: «no
llegamos a preguntar» no es «está bien».

Las migraciones pendientes son un **aviso** (`[ ~]`), no un fallo: en una
instalación nueva es el estado normal. Lo que estaría mal es no saberlo.

**Sale con código 1 si algo falló**, que es el punto: está hecho para correr
dentro de un script de instalación, donde nadie lee la salida salvo que se
detenga.

```bash
npx samble doctor && npx samble migrate && node build/index.js
```

---

## `samble build`

```bash
npx samble build
npx samble build --out dist
npx samble build --bytecode
npx samble build --bytecode --only modules/billing
```

| Bandera | Efecto |
| --- | --- |
| `--project <file>` | tsconfig con el que compilar (por defecto `tsconfig.json`) |
| `--out <dir>` | dónde va la compilación (por defecto `build`) |
| `--assets <dir>` | carpeta con lo que nunca fue TypeScript (por defecto `src`) |
| `--bytecode` | compila a `.jsc` y borra el `.js` legible |
| `--only <dir>` | limita el paso de bytecode a esta parte de la salida |

Tres pasos, y dos de ellos son la razón por la que este comando existe en vez de
un `tsc` pelado:

1. **Compilar** con el TypeScript del propio proyecto.
2. **Copiar lo que nunca fue TypeScript** — plantillas, archivos estáticos, JSON.
   `tsc` los deja atrás, y una compilación a la que le faltan sus vistas es una
   compilación que arranca y después tira 500.
3. **Resolver los alias de rutas.** `tsc` emite `require("@/…")` tal cual; esto
   los reescribe a rutas relativas para que la salida corra bajo `node` a secas.

### `--bytecode`

Compila la salida a bytecode de V8 y borra el `.js` legible. Dos cosas que te
toca a vos aceptar:

- **Un `.jsc` queda atado al Node/V8 que lo produjo.** Enviá el runtime con la
  compilación, o no va a cargar en el destino.
- **Es opacidad, no cifrado.** Las cadenas, los identificadores y los nombres de
  clase sobreviven, y las plantillas, el SQL y los archivos estáticos nunca
  fueron bytecode.

La aplicación tiene que hacer `require('bytenode')` antes de `start()`. samble no
depende de eso: qué es un archivo `.jsc` depende del Node que lo produjo, y un
framework no tiene por qué decidir eso por su consumidor.

---

## Lo que el CLI no va a hacer

- **No conoce tu aplicación.** Ni conexión a base de datos, ni archivo de
  configuración, ni registro. `migrate` es la excepción, y aun ahí le pregunta a
  tu punto de entrada en vez de leer tu `.env` por su cuenta.
- **No reescribe código que no escribió**, más allá de las dos ediciones listadas
  arriba. Cuando no puede estar seguro, imprime la línea para que la agregues.
- **No crea bases de datos.** Sólo tablas, y sólo a través de migraciones.

> Las plantillas guardadas como assets sueltos que nadie compila se van separando
> hasta generar decoradores que el framework ya no tiene. Estas plantillas son parte de la misma compilación que todo lo demás,
> y `test/cli.spec.ts` anda un módulo y lo **arranca** — una plantilla que deja
> de coincidir con el framework hace fallar la suite.
