# La API, nombre por nombre

Lo que escribe una aplicación: los 101 nombres que vas a usar, y cómo se llama
cada uno. El por qué está en [la guía](./guide.md), las reglas de permisos en
[Autorización](./authorization.md), y los comandos en [el CLI](./cli.md).

Con las primeras cuatro secciones ya podés construir algo.

> Sacado del `.d.ts` emitido con la API de TypeScript, así que las firmas son las
> que ve el compilador, acortadas sólo donde un genérico por defecto no aporta
> nada.
>
> `samble` exporta 41 nombres más — el registro de módulos, el migrador, los
> cargadores, la metadata que guardan los decoradores. Son públicos porque el CLI
> es otro proceso y tiene que alcanzarlos, no porque una aplicación los necesite.
> Están en los tipos si alguna vez te hacen falta.

---

## 1. Poner la aplicación de pie

| Nombre | Tipado | Qué es |
| --- | --- | --- |
| `Samble` | clase | La aplicación. Se construye con `Samble.create()`, nunca con `new`. |
| `Samble.create` | `(options: SambleOptions) => Promise<Samble>` | Resuelve los módulos, abre la base, reconcilia lo instalado, y devuelve una aplicación que todavía no escucha. |
| `SambleOptions` | interface | Todo lo que decide una aplicación: `db`, `modules`, `basePath`, `version`, `auth`, `cors`, `requestId`, `docs`, `health`, `logs`. |
| `DocsConfig` | interface | `{ path?, info? }` — dónde contesta `/docs` y qué dice el documento OpenAPI de sí mismo. |
| `ConfigService` | clase | El entorno, con el fallo en el lugar correcto. `.require(names)` va primero en `createApp()` y nombra TODAS las que faltan; `.get(name)` lanza si falta; `.number(name)` / `.boolean(name)` validan el formato; `.optional(name)` devuelve `string \| undefined`; `.whichMissing(names)` informa sin lanzar; `.all()`, `.mode()`. Una variable vacía cuenta como ausente. |
| `ConfigError` | clase | Lo que lanzan los métodos de `ConfigService`. Lleva `names` con las variables involucradas, aparte del mensaje. |
| `openTestDatabase` | `(options?: TestDatabaseOptions) => Promise<Database>` | Una base nueva del motor de la app, para `createApp({ db })` en una prueba: PGlite, memoria para SQLite, una base propia en `SAMBLE_TEST_MYSQL_URL` para MySQL. |
| `TestDatabaseOptions` | interface | `{ dialect?, modules? }` — lo que recibe `openTestDatabase()`. |
| `DialectName` | `'postgres' \| 'mysql' \| 'sqlite'` | Los motores sobre los que corre samble; `db: { dialect }` en `Samble.create()`. |
| `closeTestDatabase` | `(db: Database) => Promise<void>` | Cierra lo que abrió `openTestDatabase()`. samble no cierra una conexión que no abrió. |
| `MODE` | `'production' \| 'development'` | Lo que devuelve `ConfigService.mode()`. |

### Lo que te da un `Samble`

| Miembro | Tipado | Qué hace |
| --- | --- | --- |
| `start` | `(port: number) => Promise<void>` | Monta las rutas, arranca las rutinas, escucha. |
| `close` | `(options?: { database?: boolean }) => Promise<void>` | Para sin terminar el proceso: rutinas, después el servidor, después la conexión. Lo que llama una prueba. |
| `shutdown` | `(signal?: string) => Promise<void>` | `close()` y salir. Lo que llama un manejador de señales. |
| `connect` | `() => Promise<void>` | Abre la conexión sin montar nada, para un comando que sólo toca la base. |
| `migrate` | `(options?: { dryRun?: boolean }) => Promise<AppliedMigration[]>` | Corre todas las migraciones pendientes, por módulo, en orden de dependencias. `dryRun` contesta qué correría. |
| `migrationStatus` | `() => Promise<ModuleMigrationStatus[]>` | Qué declara cada módulo y qué de eso ya corrió. |
| `pendingSchema` | `(moduleId, previous?) => Promise<SchemaDiff>` | El SQL que un módulo necesita para pasar de `previous` a lo que dice su código. No necesita base de datos. Sobre esto se construye `migration:generate`. |
| `snapshotOf` | `(moduleId, previous?) => SchemaSnapshot` | Lo que describen las tablas de ese módulo ahora, para guardar al lado de la migración. |
| `schemaDrift` | `() => Promise<string[]>` | Lo que le falta a la base VIVA para coincidir con todos los módulos. La pregunta que el snapshot no contesta. |
| `tableOwners` | `() => Map<string, string>` | Qué módulo es dueño de cada tabla, leído de las tablas que cada uno declara. |
| `permissions` | `() => RegisteredPermission[]` | Todas las claves que declaran los módulos instalados, con su módulo. El catálogo que dibuja una pantalla de roles. |
| `getApp` | `() => Express` | La aplicación de Express, para todo lo que samble no envuelve. |
| `dialect` | `Dialect` | El motor de esta app, leído de su conexión. `dialect.name` es el `DialectName`. |
| `db` | `Database` (getter) | La conexión que samble abrió o recibió, para lo que la app enchufa al lado — un store de sesiones sobre el mismo pool. `$client` es el objeto del driver. |
| `use` | `(middleware) => void` | Agrega middleware a esa aplicación. |
| `static` | `(pathname: string, root: string) => void` | Sirve un directorio de archivos bajo un prefijo de URL. |
| `setTemplates` | `(engine: 'ejs' \| 'pug', root: string \| string[]) => Promise<void>` | Configura el motor con el que renderiza `view()`. |

---

## 2. Lo que escribís vos

Cuatro clases base. Un archivo que exporta una se encuentra por la carpeta donde
está — ver [la disposición estándar](./cli.md#por-qué-casi-ningún-comando-edita-nada).

| Nombre | Tipado | Qué es |
| --- | --- | --- |
| `Endpoint<B, P, Q>` | clase | Un endpoint HTTP. Los genéricos son el body, los params y el query ya validados. |
| `Routine` | clase | Trabajo con reloj. `@Cron` dice sobre qué horario corre y cuándo. |
| `Provider` | clase | Responde un contrato — exactamente uno. Se marca con `@Provides`. |
| `Strategy` | clase | Llena un punto de extensión de OTRO módulo, que es quien la corre. Se marca con `@Fills`. |
| `DataJson` | `Record<string, any> \| Response \| Output \| null` | Lo que puede devolver el `main()` de un endpoint. |
| `UploadedFile` | interface | Un archivo de una petición multipart. Tipo propio de samble, no un global. |

### Adentro de un `Endpoint`

| Miembro | Tipado | Qué es |
| --- | --- | --- |
| `main` | `() => DataJson \| Promise<DataJson>` | El endpoint. El único método que tenés que escribir. |
| `previous` | `() => void \| Promise<void>` | Corre antes de `main`, en la misma instancia. |
| `body` `params` `query` | `B` `P` `Q` | La entrada validada. `null` salvo que un esquema `@Body` / `@Params` / `@Query` diga otra cosa. |
| `auth` | `Auth` | Quién pregunta y qué puede hacer. |
| `db` | `Database` | La conexión, inyectada. |
| `container` | `Container` | Los contratos que proveen otros módulos. |
| `scheduler` | `Scheduler` | Para `this.schedule(Token)`: prender, parar o correr un horario. |
| `file` / `files` | `UploadedFile` / `UploadedFile[]` o un mapa | Las subidas multipart. |
| `request` / `response` | `Request` / `Response` de Express | El par crudo, para lo que samble no cubre. |
| `httpStatus` | `HttpStatus` | Asignalo para contestar algo distinto de 200. |
| `requestId` | `string` | El id que va en el header `x-request-id` y en cada línea de log de esta petición. |

`Routine` tiene `start(now: Date \| 'manual' \| 'init')` y una `Reaction<T>`
tiene `on(payload: T)`. Todas reciben `db`, `container` y `scheduler` igual, y
todas tienen `get()`, `all()` y `notify()`.

---

## 3. Decoradores

| Nombre | Tipado | Qué hace |
| --- | --- | --- |
| `HttpGet` `HttpPost` `HttpPut` `HttpPatch` `HttpDelete` `HttpQuery` | `(path?: string) => ClassDecorator` | Método y ruta. Sin ruta, el endpoint contesta en la raíz de su grupo. |
| `Group` | `(name: string, options?: GroupOptions) => ClassDecorator` | El segmento de URL antes de la ruta. Por defecto es el id del módulo, así que el andamiaje no escribe ninguno. |
| `Priority` | `(number: number) => ClassDecorator` | Orden de montaje, para una ruta literal que si no se la comería un hermano `:param`. |
| `Use` | `(middleware: MiddlewareFn) => ClassDecorator` | Middleware de Express sólo para este endpoint. |
| `Body` `Params` `Query` | `(Schema: new () => object) => ClassDecorator` | Valida esa parte de la petición contra un DTO de class-validator, y la tipa. |
| `Cron` | `(token: ScheduleToken, expression: string, options?: CronOptions) => ClassDecorator` | Sobre qué horario corre una rutina, y cuándo. `{ autostart: false }` la deja registrada y quieta. |
| `Provides` | `<T>(token: Contract<T>) => ClassDecorator` | El contrato que responde un proveedor. |
| `Fills` | `<T>(token: Slot<T>) => ClassDecorator` | El punto de extensión que llena una estrategia. |
| `ApiTag` `ApiSummary` `ApiDescription` `ApiResponse` `ApiHidden` | decoradores de clase | Qué dice `/docs` de este endpoint, o que no diga nada. |
| `Deprecated` | `(options?: { sunset?, use?, note? }) => ClassDecorator` | Marca la ruta como que se va SIN apagarla: `deprecated: true` en el spec, cabeceras `Deprecation` / `Sunset` / `Link` en cada respuesta, y un aviso por ruta la primera vez que la llaman. |
| `MiddlewareFn` | `(req, res, next) => void` | Lo que recibe `@Use`. |
| `GroupOptions` | interface | Lo que recibe `@Group` además del nombre. |

---

## 4. Módulos, permisos y autorización

### Declarar un módulo

| Nombre | Tipado | Qué es |
| --- | --- | --- |
| `defineModule` | `<const P>(manifest: ModuleManifest<P>) => ResolvedModule<PermissionKeysOf<P>>` | Declara un módulo y lo valida al importarse. El parámetro `const` es lo que mantiene las claves de permiso como literales. |
| `ModuleManifest<P>` | interface | Lo que un módulo dice de sí mismo: `id`, `label`, `requires`, `dir`, `permissions`, `consumes` y los campos de glob. |
| `ResolvedModule<K>` | interface | El manifiesto con todos los defaults aplicados. Trae además `permissionKeys: K[]`. |
| `ModulePermission<K>` | interface | `{ key, label? }`. El label es opcional porque una clave normalmente ya lo dice. |
| `PermissionDeclaration<K>` | `K \| ModulePermission<K>` | Una entrada de `permissions`: una clave, o una clave con texto. |
| `ModulePattern` | `string \| string[]` | El valor de un campo de glob. |
| `ModuleTable` | `PgTable \| PgEnum \| PgSequence \| PgView \| ...` | Algo que el módulo pone en el esquema. Un enum va en esta lista: sin él, una tabla con columna de enum genera DDL que referencia un tipo que nada crea. |
| `ModuleMigrations` | `Function[] \| Record<string, unknown>` | Una lista de clases de migración, o un import de namespace de ellas. |
| `ModuleDefinitionError` | clase | La lanza `defineModule` cuando el manifiesto está mal. Al importar, antes de que arranque nada. |

### Enseñarle las claves al compilador

| Nombre | Tipado | Qué es |
| --- | --- | --- |
| `PermissionsOf<M>` | tipo condicional | Lee las claves de un módulo hacia la forma que quiere `SambleAuth.Permissions`. Un bloque `declare global` por módulo. |
| `RegisteredPermission` | interface | Un `ModulePermission` más el `moduleId` que lo declaró. Lo que devuelve `app.permissions()`. |
| `PermissionKey` | tipo condicional | Una clave declarada, o cualquier cadena mientras la aplicación no declaró ninguna. Lo que reciben `assert` y `can`. |

### Convertir una petición en un actor

| Nombre | Tipado | Qué es |
| --- | --- | --- |
| `defineAuth` | `(resolver: AuthResolver, ...fallbacks: AuthResolver[]) => AuthResolver` | El resolutor de `auth`. Varias estrategias se prueban en orden, gana la primera que reconoce a quien llama. |
| `cacheAuth` | `(resolver: AuthResolver, options: AuthCacheOptions) => CachedAuthResolver` | Recuerda la respuesta por llamante. Cambia frescura por la consulta, así que `ttl` es obligatorio. |
| `AuthCacheOptions` | interface | `{ key, ttl, max? }`. La key es de la aplicación: qué parte de la petición es la credencial es justo lo que el resolutor esconde. |
| `CachedAuthResolver` | `AuthResolver & { invalidate(key), clear() }` | `invalidate` no es opcional — el TTL es el piso, no el contrato. |
| `AuthResolver` | `(request, context) => AuthResult \| null \| undefined \| Promise<…>` | La costura. `null` significa anónimo. |
| `AuthResult` | interface | `{ actor, permissions? }`. |
| `AuthContext` | interface | `{ db, get }` — lo que recibe un resolutor además de la petición. |
| `Actor` | `SambleAuth.Actor` | Quien llama, como lo declaró la aplicación. Vacío hasta que lo haga. |
| `Auth` | clase | `this.auth`: `isAuthenticated`, `optional`, `actor`, `permissions`, `can(...)`, `assert(...)`. `actor` y `assert` lanzan; `optional` y `can` no. |

---

## 5. Cableado entre módulos

| Nombre | Tipado | Qué es |
| --- | --- | --- |
| `token` | `<T>(id, kind) => Contract<T> \| Slot<T> \| ScheduleToken` | Declara lo único que dos módulos comparten. La clase que le pases decide qué tipo vuelve. |
| `TokenKind` | `'contract' \| 'slot' \| 'schedule'` | Qué relación es. Vive en el token y en ningún otro lado. |
| `Contract<T>` | interface | Una capacidad con exactamente un proveedor: `token(id, 'contract')`. |
| `Slot<T>` | interface | Un punto de extensión al que aportan los módulos que haya: `token(id, 'slot')`. `container.all()` contesta un arreglo, y vacío es una respuesta normal. |
| `Reaction<T>` | interface | La forma de un aporte cuando el anfitrión **anuncia** en vez de preguntar: un solo `on(payload)`. Es lo que acepta `notify()`. |
| `ScheduleToken` | interface | Un reloj que se puede prender y parar: `token(id, 'schedule')`. No lleva tipo, porque no se entrega nada. |
| `Container` | clase | Los resuelve: `.get(contract)`, `.all(slot)`, `.notify(slot, payload)`, `.has()`, `.providerOf()`, `.ids()`. Se alcanza como `this.container`. |
| `ContractError` | clase | Nadie provee ese contrato, lo proveen dos módulos, o una reacción quiso anunciar otra cosa. |
| `Scheduler` | clase | `.handle(token)`, `.startAll()`, `.stopAll()`, `.ids()`. Se alcanza como `app.schedule(token)` o `this.schedule(token)`. |
| `ScheduleHandle` | interface | `.start()`, `.stop()`, `.isScheduled()`, `.isExecuting()`, `.runNow()`. |
| `ScheduleError` | clase | Ese horario no existe, o dos clases lo reclaman. |

---

## 6. Contestar con algo que no sea JSON

| Nombre | Tipado | Qué es |
| --- | --- | --- |
| `view` | `(template: string, data?: object) => Output` | Renderiza una plantilla con el motor que configuró `setTemplates`. |
| `pdf` | `(content: Buffer \| Uint8Array \| Readable, options?: PdfOptions) => Output` | Manda un PDF, en línea o como descarga. |
| `csv` | `(rows: readonly object[], options?: CsvOptions) => Output` | Convierte filas en un CSV, con las columnas que nombres. |
| `file` | `(content: FileContent, options?: FileOptions) => Output` | Cualquier archivo: bytes, una cadena o un stream. |
| `Output` | clase abstracta | Lo que devuelven las cuatro, y lo que puede devolver `main()`. Extendela para un formato que samble no tenga. |
| `FileContent` | `Buffer \| Uint8Array \| string \| Readable` | Lo que acepta `file()`. |
| `FileOptions` `PdfOptions` `CsvOptions` `CsvColumn` | interfaces / tipos | Nombre de archivo, descarga o en línea, content type; y para CSV, las columnas y sus encabezados. |

---

## 7. Fallar

Lanzá una de estas en cualquier parte y el framework contesta el status
correcto, en una sola forma — RFC 9457 `application/problem+json`. Las seis
extienden `Error`.

| Nombre | Tipado | Contesta |
| --- | --- | --- |
| `SchemaError<T>` | `(message, fieldsError?)` | 422, diciendo qué campo falló. |
| `CustomerError<T>` | `(message, fieldsError?)` | 406 — la petición se entiende y se rechaza. |
| `NotFoundError` | `(message)` | 404. |
| `AuthError` | `(message)` | 401 — autenticate y volvé a intentar. |
| `ForbiddenError` | `(message, missing?)` | 403 — no te molestes. `missing` nombra las claves y llega al cliente. |
| `CustomError` | `(status, message, response?)` | El status que le pases, con un payload. |
| `ProblemBody` | interface | El cuerpo: `type`, `title`, `status`, `detail`, `code`, `errors`, `requestId?`, `missing?`, `response?`. |
| `ErrorIdentifier` | enum | El `code` legible por máquina. Ramificá sobre esto, no sobre `title`. |
| `HttpStatus` | enum | Los códigos de estado, por nombre. |

---

## 8. Logs, health, CORS, docs

| Nombre | Tipado | Qué es |
| --- | --- | --- |
| `Logger` | clase | `.info()`, `.warn()`, `.error()`, `.router()`, `.configure()`, `.flush()`, `.clear(category)`. Escribe en `logs/` por archivo y nivel. |
| `LoggerOptions` | interface | `{ dir?, level?, files? }` — dónde van los logs, y cuáles apagar. |
| `LogFiles` | interface | Los cinco archivos (`app`, `info`, `warn`, `error`, `router`), cada uno renombrable o `false`. |
| `HealthConfig` | interface | `{ path?, details?, checks?, timeout? }`. Sin esto no existe la ruta `/health`. |
| `HealthCheck` | `() => boolean \| Promise<boolean>` | Un chequeo que es de la aplicación. Se puede llamar cualquier cosa menos `server` y `database`. |
| `HealthReport` | interface | Lo que contesta `/health`. |
| `HealthStatus` | `'pass' \| 'fail'` | Por chequeo, y en total. |
| `RequestIdConfig` | interface | `{ header?, generate? }` — confiar en un id que llega, o fabricar uno. |
| `currentRequestId` | `() => string` | El id de la petición que se está atendiendo, desde cualquier punto de la pila. |
| `CorsConfig` | interface | Orígenes, métodos, headers, credenciales. |
| `CorsConfigError` | clase | Las opciones de CORS se contradicen; se rechaza al arrancar. |
| `OpenAPIInfo` | interface | El título y la versión que reporta `/docs`, que se pasan como `docs.info`. |

---

## Lo que NO se exporta, a propósito

`SambleAuth` es un **namespace global**, no un export: una interface
re-exportada desde un paquete no se puede fusionar desde afuera, y fusionarla es
todo el punto. Una aplicación ensancha `SambleAuth.Actor` y
`SambleAuth.Permissions` con `declare global`, que es para lo que están
`src/config/auth.ts` y `src/config/permissions.ts`.
