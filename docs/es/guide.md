# samble — la versión larga

> El README es el resumen. Esto es todo: el razonamiento detrás de cada
> decisión, el fallo que cada una evita, y las partes que sólo importan cuando
> ya estás adentro.

Samble es un framework de backend liviano y simple. Su objetivo principal es
facilitar el desarrollo de APIs modernas con una configuración mínima y sin
abandonar las buenas prácticas. Está inspirado en la arquitectura y la facilidad
de uso de frameworks como NestJS: organización modular, manejo intuitivo de
rutas, integración con la base de datos a través de Drizzle y soporte para
trabajo programado.

Con Samble podés definir rápido los módulos y los endpoints de tu API, asociar
middlewares y validaciones de esquema, y manejar trabajo recurrente. El framework
prioriza la facilidad de uso, el consumo bajo de recursos y una curva de
aprendizaje corta, sin resignar la potencia que hace falta para construir
aplicaciones robustas y escalables.

Este proyecto está pensado para quien busca una alternativa simple y rápida para
levantar servicios de backend sin el peso de configuraciones complejas,
manteniendo una estructura sólida y extensible.

## Requisitos

- **Node.js >= 22.13**
- Una base de datos: **PostgreSQL**, **MySQL / MariaDB** o **SQLite** — mirá
  [Bases de datos](#bases-de-datos)
- `reflect-metadata` lo carga el framework — no hace falta que lo importes

## Instalación

```bash
npx @samble/core@alpha init my-app   # pregunta qué base de datos
```

`samble` se apoya en unas pocas dependencias que ponés vos: `drizzle-orm`, `express`,
`class-validator`, `typescript` y el driver de tu motor (`pg`, `mysql2` o
`@libsql/client`). Agregá `express-session` sólo si tu resolutor
de autenticación usa sesiones por cookie — el framework ya no depende de él.

## Estado de las funciones

| Función                        | Estado |
| ------------------------------ | ------ |
| Ruteo                          | ✔      |
| Validación de esquema          | ✔      |
| Rutinas programadas            | ✔      |
| Documentación (Swagger/OpenAPI)| ✔      |
| Respuestas que no son JSON     | ✔      |
| Archivos estáticos             | ✔      |
| Manejo de cookies              | ✔      |
| Variables de entorno           | ✔      |
| Pruebas                        | ✔      |
| Logging configurable           | ✔      |
| Apagado ordenado               | ✔      |
| Módulos instalables            | ✔      |
| Contratos entre módulos        | ✔      |
| Migraciones por módulo         | ✔      |
| Costura de autenticación       | ✔      |
| Reacciones entre módulos       | ✔      |
| Puntos de extensión (slots)    | ✔      |
| CLI de andamiaje               | ✔      |

## Línea de comandos

```bash
npx @samble/core@alpha init my-app     # sólo el primer comando necesita la etiqueta:
                                # hasta 1.0.0 cada versión se publica
                                # bajo `alpha`, no `latest`.
npx samble module billing
npx samble endpoint billing/issue-charge --method post
npx samble table billing/charge
npx samble migration billing/create-charges
npx samble build --bytecode
```

Un módulo es una **forma**: un manifiesto, globs que tienen que coincidir, un
índice de migraciones, claves de permiso con el id del módulo por prefijo. Cada
una de esas cosas es un lugar donde estar a una convención de distancia y
enterarte al arrancar — o no enterarte nunca, porque un glob de `routes` que no
coincide con nada arranca limpio y contesta 404. El CLI escribe la forma; el
código lo escribís vos.

| Comando | Qué escribe |
| --- | --- |
| `init [name]` | Un proyecto que corre: `package.json`, `tsconfig.json`, `.env`, punto de entrada — y `npm install` (`--skip-install` para parar antes) |
| `module <name>` | `module.ts`, su archivo de permisos y un primer endpoint |
| `endpoint <module>/<name>` | Un endpoint (`--method`, `--path`, `--group`, `--public`) |
| `routine <module>/<name>` | Trabajo con horario (`--cron`) |
| `contract <module>/<name>` | Una capacidad que este módulo publica: token y forma |
| `provider <module>/<name>` | La clase que la responde |
| `strategy <module>/<name> <slot>` | Lo que este módulo aporta a un punto de extensión ajeno |
| `token <module>/<name> slot --reaction` | Algo que este módulo anuncia, para quien reaccione |
| `slot <module>/<name>` | Un punto de extensión que otros pueden llenar |
| `table <module>/<name>` | Una tabla y sus tipos de fila (`--name`) |
| `migration <module>/<name>` | Una migración con sello de tiempo |
| `migrate` | Corre las migraciones pendientes sin levantar el servidor (`--dry-run`, `--entry`) |
| `migrate:status` | Qué declara cada módulo, y qué de eso ya corrió |
| `build` | `tsc` + los archivos que nunca fueron TypeScript (`--bytecode`, `--out`, `--project`) |

Banderas compartidas: `--dir <path>` (dónde viven los módulos, `src/modules` por
defecto), `--from <specifier>` (de dónde importa samble el código generado) y
`--force`.

> Cada comando y cada bandera, con lo que escribe y por qué:
> [docs/cli.md](./cli.md).

Dos cosas que **no** hace, a propósito:

- No conoce tu aplicación: ni base de datos, ni archivo de configuración, ni
  registro de lo que existe. Lee argumentos y escribe archivos.
- Edita archivos que no escribió **sólo** donde la forma es segura — agregar el
  módulo a `modules: []` en el punto de entrada, agregar una clave al
  `permissions: []` del manifiesto. Cualquier cosa menos segura se imprime como
  instrucción. Un andamiaje que destroza en silencio un archivo que escribiste es
  peor que uno que te dice qué agregar.

Fijate qué pocas son. La mayoría de los generadores escribe un archivo y no edita
nada, porque la [disposición estándar](#la-disposición-estándar) es lo que lo
registra — no hay lista que mantener sincronizada.

> Las plantillas guardadas como assets sueltos que nadie compila se van separando
> hasta generar decoradores que el framework ya no tiene. Estas plantillas son parte de la misma compilación que todo lo demás,
> y `test/cli.spec.ts` anda un módulo y lo **arranca** — una plantilla que deja
> de coincidir con el framework hace fallar la suite.

## Definir endpoints

Cada endpoint es **su propia clase**, que extiende `Endpoint` e implementa
`main()`. Los metadatos de ruteo vienen de decoradores; la clase la descubre el
glob `routes` del módulo al que pertenece (ver [Módulos](#módulos)).

```typescript
import { Endpoint, Group, HttpGet, Params, NotFoundError } from '@samble/core';
import { IsUUID } from 'class-validator';

class UserParams {
  @IsUUID()
  id: string;
}

@Group('users')
@HttpGet(':id')
@Params(UserParams)
export class GetUserApi extends Endpoint<UserParams> {
  async main() {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, this.params.id))
      .limit(1);

    if (!user) throw new NotFoundError('User not found');
    return user; // se serializa como JSON con el estado `this.httpStatus` (200 por defecto)
  }
}
```

- **Ciclo de vida**: `previous()` → `main()`. `previous()` es opcional y corre
  sobre la misma instancia, con `params`, `body`, `query` y `auth` ya puestos —
  lanzar desde ahí saltea `main()`, que es lo que lo convierte en una guarda. No
  hay ganchos `error()` ni `final()`: lanzá la clase de error correcta y el
  framework la mapea, y envolvé en `this.db.transaction(cb)` el trabajo que tiene
  que confirmarse o revertirse entero.
- **El estado de la petición** (`this.params`, `this.body`, `this.query`,
  `this.request`, `this.response`, `this.file(s)`) se inyecta por petición.
- **Errores**: lanzá un error del framework para obtener un estado HTTP mapeado —
  `NotFoundError` (404), `AuthError` (401), `ForbiddenError` (403),
  `CustomerError` (406), `SchemaError` (422), `CustomError(status, ...)`.
  Cualquier otro valor lanzado se vuelve un 500. Las rutas sin coincidencia
  contestan la misma forma con 404. Ver [Fallos](#fallos).
- **Quién pregunta** está en `this.auth` (ver [Autenticación](#autenticación)).

### Transacciones

No hay gancho de transacción ni decorador de transacción. Usá el de Drizzle:

```typescript
async main() {
  return this.db.transaction(async (tx) => {
    const [charge] = await tx.insert(charges).values({ ... }).returning();
    await tx
      .update(subscriptions)
      .set({ lastChargeId: charge.id })
      .where(eq(subscriptions.id, id));
    return charge;
  });
}
```

`tx` es el mismo tipo que `this.db` menos una cosa: no lleva `$client`, que es
por donde abrirías una segunda conexión y te saldrías de la transacción que te
dieron.

Confirmar, revertir y liberar son el contrato del callback, así que no se pueden
olvidar. Repartirlos entre ganchos del ciclo de vida — `startTransaction` en un
método, `commit` en otro, `rollback` en un tercero — esconde los límites de la
transacción del código que depende de ellos; por eso esos ganchos ya no están.

### Decoradores de verbo HTTP

| Decorador     | Método HTTP |
| ------------- | ----------- |
| `@HttpGet`    | GET         |
| `@HttpPost`   | POST        |
| `@HttpPut`    | PUT         |
| `@HttpDelete` | DELETE      |
| `@HttpPatch`  | PATCH       |
| `@HttpQuery`  | QUERY       |

**Sobre `@HttpQuery`**: QUERY es un método seguro e idempotente que (a diferencia
de GET) permite cuerpo — útil para búsquedas cuyos criterios no entran en la
query string. Declará los criterios con `@Body`. Tené en cuenta que QUERY es un
borrador de la IETF (`draft-ietf-httpbis-safe-method-w-body`): necesita un Node
cuyo parser HTTP lo reconozca, puede no estar soportado por proxies o CDNs, y
queda fuera de la especificación OpenAPI. Si el runtime no soporta el verbo, la
ruta se saltea con una línea de log clara en vez de tirar abajo el arranque.

### El grupo: @Group

Una ruta cuelga del **id del módulo** que la cargó. No hace falta ningún
decorador para eso, que es el caso común:

```typescript
// module.ts declara id: 'catalog'
@HttpGet(':id')                            // /api/catalog/:id
```

`@Group` reemplaza el prefijo cuando la URL no tiene que llevar el id del módulo
— porque un módulo sirve más de un recurso (`identity` sirviendo `auth` **y**
`users`), o porque varios módulos aportan al mismo prefijo:

```typescript
@Group('products')                         // /api/products/:id
```

Las dos identidades están separadas a propósito: el id del módulo nombra la
UNIDAD INSTALABLE (permisos, `requires`, la fila en `_modules`), el grupo nombra
la URL. Renombrar una no tiene que renombrar la otra.

### Dónde se monta un grupo

`Samble.create({ basePath: '/api' })` prefija cada ruta. Un grupo puede decir que
cuelga de otro lado:

```typescript
@Group('products')                         // /api/products
@Group('products', { mount: '/' })         // /products
@Group('checkout', { mount: '/shop' })     // /shop/checkout
```

El reemplazo es por GRUPO — por decorador `@Group` — y no por aplicación ni por
módulo, porque ahí es donde cae la división de verdad: en un monolito que sirve
páginas y una API, el mismo módulo tiene endpoints JSON que van bajo `/api` y una
página que no. `/api/products/page` no es una URL que alguien enlazaría.

Dos consecuencias:

- Las rutas bajo prefijos distintos no se pueden tapar entre sí, así que no hace
  falta `@Priority` entre ellas.
- El mapa de rutas (`router.log`) imprime la URL real de cada una, así que un
  grupo que terminó en un lugar inesperado se ve al arrancar.

### Esquema, middleware y prioridad

```typescript
@Group('users')
@HttpPost()
@Body(CreateUserDto)          // validado con class-validator antes de main()
@Use(requireAuth)             // una función (req, res, next)
@Priority(1)                  // se registra antes que las rutas `:param` del mismo módulo
export class CreateUserApi extends Endpoint<null, CreateUserDto> {
  main() {
    return { created: this.body.name };
  }
}
```

`@Use` toma una **función** middleware `(req, res, next)` — una función puede
poner cabeceras y elegir el estado, y por eso no hay una clase base para eso.

## Módulos

Un módulo declara sus propias tablas, migraciones, rutas, rutinas, permisos y
los contratos que publica, y `_modules` registra qué está instalado y en qué
versión.

**Todo módulo presente en el código corre.** No hay encender ni apagar: lo que
limita quién alcanza qué son los **permisos** —un rol, un plan, lo que diga el
negocio—, que son política de la aplicación y no tienen nada que ver con lo
desplegado. Decidirlo dos veces, una por despliegue y otra por permiso, es como
una instalación termina en un estado que nadie sabe explicar.

```typescript
// modules/billing/module.ts
import { defineModule, token } from '@samble/core';

export interface BillingService {
  issueCharge(input: IssueChargeInput): Promise<Charge>;
}
export const BillingService = token<BillingService>(
  'billing.service',
  'contract',
);

export default defineModule({
  id: 'billing',
  requires: ['identity'], // se comprueba al arrancar
  dir: __dirname, // la carpeta desde la que se encuentra todo

  permissions: ['billing.view', 'billing.void'],
});
```

Un manifiesto es donde las piezas se **enlazan**, y nada más: sin rutas, porque
las carpetas son la disposición de abajo, y sin implementación, porque eso es una
clase en `providers/`.

### La disposición estándar

El manifiesto de arriba no lista ninguna ruta, y ese es el punto: lo que dice es
lo que tiene de particular **este** módulo. Las carpetas se encuentran desde
`dir`:

| Carpeta | Qué carga samble de ahí |
| --- | --- |
| `tables/*.table.ts` | las tablas, y los enums que usan |
| `migrations/*.ts` | las clases de migración |
| `endpoints/*.endpoint.ts` | los endpoints, montados bajo el id del módulo |
| `routines/*.routine.ts` | las rutinas programadas |
| `strategies/*.strategy.ts` | las clases `Strategy`: lo que aporta a puntos de extensión ajenos, reacciones incluidas |
| `providers/*.provider.ts` | las clases `Provider`: los contratos que este módulo responde |
| `strategies/*.strategy.ts` | las clases `Strategy`: lo que aporta a puntos de extensión ajenos |

Escribir el archivo es todo lo que hay que hacer. `samble table billing/charge`
escribe `tables/charge.table.ts` y no edita **nada**: la carpeta es lo que lo
declara.

Un **enum** tiene que estar exportado ahí, no sólo usado por una columna: una
tabla con columna de enum genera DDL que **referencia** el tipo, así que un
esquema sin el enum produce una migración que falla al correr.

Sólo se toman las entidades decoradas y las clases de migración. Un enum, un DTO
o un helper exportado del mismo archivo se ignoran, así que una carpeta puede
tener lo que va con ella.

Otras dos carpetas son convención sin ser globs, porque no hay nada que descubrir
en ellas — un token se importa por nombre:

| Carpeta | Qué va adentro |
| --- | --- |
| `tokens/*.token.ts` | cada contrato, punto de extensión y horario que este módulo comparte |

Juntas son la cara pública del módulo: los únicos archivos que otro módulo
importa alguna vez — y la razón por la que `samble init` escribe un alias de
rutas, porque esas son las rutas profundas:

```typescript
import { UserDirectory } from '@/identity/tokens/user-directory.token';
//                            ^ src/modules/, sin importar qué tan hondo estés
```

Un alias de `paths` existe **sólo en tiempo de compilación**: `tsc` lo
typechequea y después emite `require("@/…")` tal cual, algo de lo que Node nunca
oyó hablar. `samble build` los reescribe a rutas relativas en la salida, y
`npm run dev` los resuelve con `tsconfig-paths`. Si cambiás el alias en
`tsconfig.json`, cambiá el script `dev` con él.

**Nombrar un campo dice otra cosa**, y sólo para ese campo:

```typescript
export default defineModule({
  id: 'billing',
  dir: __dirname,

  // Una disposición DDD: los endpoints están en otro lado. Entidades,
  // migraciones, rutinas y estrategias siguen viniendo de las carpetas estándar.
  routes: './presentation/controllers/**/*.controller.ts',
});
```

Dos reglas que conviene conocer:

- **Todo cuelga de `dir`.** Sin él no hay contra qué resolver — un glob caería
  sobre el directorio de trabajo que el proceso haya tenido — así que samble no
  aplica ningún valor por defecto, y el módulo tiene que listar sus entidades a
  mano. Siempre `dir: __dirname`.
- **Un `[]` explícito significa "ninguno".** `entities: []` es un autor diciendo
  que este módulo no tiene entidades, así que no se aplica ningún valor por
  defecto.

Un glob que ESCRIBISTE y no encuentra nada se reporta al arrancar; uno por
defecto que no encuentra nada, no, porque un módulo sin rutinas es un módulo
común.

Arrancá la aplicación desde sus módulos. `Samble.create` es dueño de la conexión,
porque el esquema es la unión de lo que aporta cada módulo y la aplicación no
puede armarla a mano sin conocer las internas de cada uno:

```typescript
const app = await Samble.create({
  db: { host, database, user, password },
  modules: [identity, billing, inventory],
  version: '2.0.0', // la versión de ESTA app; la reporta /health
  basePath: '/api', // prefijo de las rutas de los módulos
});

await app.start(4000);
```

Cuatro opciones más, todas política que la aplicación posee y samble sólo monta:
`cors`, `auth`, `docs` (la interfaz OpenAPI generada) y `health`. Mirá
[la guía del CLI](./cli.md#samble-init-name) para lo que `samble init` deja
cableado.

### Fallos

Todo fallo contesta la misma forma, como `application/problem+json`
([RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)) — que además es cómo un
cliente distingue un fallo de una carga que por casualidad tiene un campo
`status`:

```json
{
  "type": "/problems/validation",
  "title": "Validation failed",
  "status": 422,
  "detail": "The request body is not valid",
  "code": "schema",
  "errors": { "email": "must be an email" },
  "requestId": "9f2c1a7b4e30"
}
```

- **`title` es estable y nombra el TIPO de problema; `detail` es sobre esta
  ocurrencia.** Mostrá `detail`, agrupá por `title`.
- **Ramificá sobre `code`**, no sobre `title` ni `type`. Sus valores son el enum
  `ErrorIdentifier`: `schema`, `customer`, `not_found`, `internal`,
  `unauthorized`, `forbidden`, `custom`.
- **`errors` dice de qué CAMPO es el problema**, así un formulario puede poner el
  mensaje debajo del input correcto en vez de en un cartel. Es un miembro de
  extensión, que la RFC permite justamente para esto, y es la razón por la que la
  forma existe.
- **`requestId`** es el mismo id que lleva la cabecera de la respuesta y con el
  que se escribió cada línea de log de esa petición.

`CustomError(status, message, payload)` pone `payload` bajo `response`, para el
caso en que el cliente necesita datos sobre el fallo y no sólo palabras.

### Un id por petición

Se lee de `x-request-id` o se genera, se devuelve en la respuesta, y está en
**cada línea de log escrita mientras se atiende esa petición** — la línea de
acceso, lo que registre un endpoint, lo que registre un proveedor o una reacción
bien adentro:

```
GET /api/products 200 4.4 ms - 139 [44e9e203a52f]
[44e9e203a52f] restock del producto 12 falló, revirtiendo
```

Llega a esas líneas internas por `AsyncLocalStorage` y no pasándolo hacia abajo,
porque las líneas que vale la pena correlacionar se escriben donde nadie recibió
nada. En un endpoint es `this.requestId`; en cualquier otro lado,
`currentRequestId()`.

Conviene ponerlo en lo que registres — una fila de auditoría, un trabajo que
encolás, una llamada a otro servicio — porque es lo que ata "un usuario dice que
falló" con las líneas que dicen por qué.

Una cabecera entrante es entrada del cliente: se acepta sólo si coincide con
`[A-Za-z0-9._:-]{1,128}` y si no, se reemplaza por un id generado, porque un
salto de línea en una cabecera se convertiría en una entrada de log falsificada.
Se reemplaza en vez de sanearse — un id a medio limpiar no es el que tiene quien
llama, así que no correlacionaría nada.

```typescript
requestId: { header: 'x-correlation-id' } // si tu gateway ya manda uno
```

### Salud

```typescript
health: { path: '/health' } // 200 mientras puede atender, 503 mientras no
```

Sin autenticación y fuera de `basePath`, porque eso es lo que puede leer un
balanceador, un runtime de contenedores o un chequeo de disponibilidad. Fuera del
log de accesos: una sonda cada pocos segundos si no entierra cada petición real.

El chequeo de la base es un **viaje de ida y vuelta**, no `isInitialized` — esa
bandera sigue en true después de que se cae la conexión, porque el pool sólo se
entera cuando alguien pregunta, así que un chequeo que la lee reporta `pass`
durante la única caída para la que existe. Y contesta 503 **apenas empieza el
apagado**, antes de que el servidor deje de aceptar, que es la ventana que un
balanceador necesita para drenar.

```json
{ "status": "pass", "uptime": 1284 }
{ "status": "fail", "uptime": 1284, "checks": { "database": "fail" } }
```

Flaco a propósito: una sonda no puede autenticarse, así que las versiones y las
cantidades de módulos serían el mapa de tu instalación para quien lo encuentre.
`details: true` los agrega, para cuando está detrás de una puerta.

#### Tus propios chequeos

samble sólo sabe lo suyo: que el proceso está arriba y que la base contesta. Si
una cola tiene que estar conectada, un proveedor de pagos alcanzable o una caché
caliente, eso es conocimiento que el framework no puede adivinar — así que lo
recibe:

```typescript
health: {
  path: '/health',
  checks: {
    queue: () => bridge.isConnected(),
    payments: async () => (await gateway.ping()).ok,
  },
}
```

`true` pasa. **Lanzar cuenta como `fail`**, porque una dependencia caída se suele
anunciar lanzando, y este es el único lugar donde una excepción es una respuesta
y no un fallo. Un solo `fail` pone todo el endpoint en 503 y nombra al culpable
en `checks`.

Corren todos en paralelo en cada petición, así que la sonda espera al más lento y
no la suma — igual, mantenelos baratos. Un chequeo que se cuelga se corta en
`timeout` (2 s por defecto) y cuenta como `fail`: una sonda que nunca contesta le
llega a un balanceador como un problema de red y no como una instancia enferma.
`server` y `database` son nombres de samble y se rechazan al arrancar, así que un
chequeo de la aplicación nunca puede reemplazar en silencio la respuesta de la
base.

Esta es la costura que `/readyz` iba a ser. No se parte en `/livez` y `/readyz`
porque esa división sólo rinde cuando una plataforma trata a las dos distinto
—reiniciar vs. sacar de rotación— y samble tiene una sola respuesta honesta para
dar en cualquiera de los dos casos.

Al arrancar lee `_modules`, resuelve el grafo de dependencias, corre las
migraciones pendientes de cada módulo **en orden de dependencias**, registra los
contratos, y monta las rutas. Cualquier fallo ahí detiene el
arranque: servir a medio montar es peor que no arrancar.

### Enviar un módulo compilado, o como paquete

Los globs de `routes` y `routines` son **agnósticos de la extensión**.
Escribilos como quieras — `'./endpoints/*.endpoint.ts'`,
`'./endpoints/*.endpoint.js'` o `'./endpoints/*.endpoint'` — y samble busca `.ts`,
`.js`, `.cjs`, `.mjs` y `.jsc`. Vos declarás *qué* archivos; la extensión no es
tu problema.

Eso es lo que hace que **un solo manifiesto** funcione en cuatro lugares:

- desde el código en desarrollo (`.ts`)
- desde una compilación que le enviás al servidor de un cliente (`.js`)
- desde `node_modules`, cuando el módulo se publica como paquete
- desde una compilación a **bytecode de V8** (`.jsc`), para una instalación que
  no controlás

```typescript
import billing from '@acme/samble-billing'; // un módulo que escribió otro

const app = await Samble.create({ db, modules: [identity, billing] });
```

Si un árbol de código y su compilación conviven, se carga sólo uno de cada
archivo (`.ts` gana, `.jsc` pierde contra cualquier cosa legible), así que las
rutas nunca se registran dos veces. Los archivos `*.d.ts` se saltean.

#### Cargar un módulo compilado a bytecode de V8

`npx samble build --bytecode` compila el proyecto, copia lo que nunca fue
TypeScript (plantillas, archivos estáticos) y convierte cada `.js` en un `.jsc`
con la caché de código de V8, borrando el archivo legible. samble los carga como
cualquier otro archivo de módulo — **siempre que la aplicación registre la
extensión primero**:

```javascript
require('bytenode'); // registra Module._extensions['.jsc']
const app = await Samble.create({ db, modules: [identity, catalog] });
```

samble **no** depende de bytenode, y no compila nada: qué es un archivo `.jsc`
depende de la compilación de Node que lo produjo, y esa es una decisión de la
aplicación, no del framework.

`npm run demo:bytecode` hace todo el recorrido sobre la app de ejemplo — la
compila, borra cada `.js`, arranca desde los `.jsc` e imprime el mapa de rutas —
así que lo que dice esta página es algo que podés correr. Conviene saber esto
antes de planificar alrededor:

- Un `.jsc` queda **atado a la versión de Node/V8 que lo produjo**. Otra versión
  falla con `Invalid or incompatible cached data`, así que el runtime tiene que
  viajar con la compilación.
- Es **opacidad, no cifrado**. La lógica deja de leerse como código fuente, pero
  los literales de cadena, los identificadores y los nombres de propiedades y
  clases sobreviven en la caché — y también todo lo que nunca fue JavaScript:
  plantillas, migraciones SQL, archivos estáticos, variables de entorno.

### Llamar a otro módulo

> Las tres formas en detalle — qué garantiza cada una, qué se rompe al arrancar
> y los antipatrones — están en [Cableado entre módulos](./wiring.md).

Un módulo alcanza a otro por su contrato, nunca importándolo — que es lo que
permite que el proveedor cambie o se reemplace sin tocar a quienes lo llaman.

> **Antes que nada, decidí si te hace falta.** Un módulo es la unidad de
> instalación, y la prueba es si puede estar **ausente**. Cuando la respuesta es
> "nunca" —todos se despliegan juntos y quién ve qué lo deciden los permisos y
> no la instalación— esos módulos son una organización del código, y un import
> directo entre ellos es más simple y mejor tipado. Contratos y slots
> son la **superficie de extensión**: lo que permite que participe algo que no
> escribiste, o que puede no estar instalado. No son el tejido por defecto entre
> carpetas del mismo producto. Un cableado que es la excepción se lee con
> atención; uno que está en todos lados deja de señalar un límite. Ver
> [cuándo un import directo sí va](./wiring.md#cuándo-un-import-directo-sí-va).

```typescript
@Group('sales')
@HttpPost('/')
export default class CreateSale extends Endpoint<never, CreateSaleDto> {
  async main() {
    const billing = this.get(BillingService);
    const charge = await billing.issueCharge({ ... });
    return { chargeId: charge.id };
  }
}
```

Declaralo en el manifiesto para que un proveedor faltante detenga el arranque en
vez de fallar en la primera petición que lo necesitó:

```typescript
consumes: [BillingService],
```

Las rutinas tienen el mismo `this.get()`.

#### Las dos mitades

Un contrato está partido en dos a propósito, y viven en carpetas distintas.

```typescript
// billing/tokens/billing-service.token.ts — la promesa
export interface BillingService {
  issueCharge(input: IssueChargeInput): Promise<Charge>;
}
export const BillingService = token<BillingService>(
  'billing.service',
  'contract',
);
```

```typescript
// billing/providers/billing-service.provider.ts — cómo se cumple
@Provides(BillingService)
export class BillingServiceProvider extends Provider implements BillingService {
  async issueCharge(input: IssueChargeInput) {
    const [charge] = await this.db.insert(charges).values(input).returning();
    return charge;
  }
}
```

El consumidor importa el **archivo del contrato** y nunca el proveedor. Nada
lista al proveedor: la carpeta es lo que lo registra y el decorador dice qué
contrato responde.

- **`this.db`, `this.get()`, `this.all()` y `this.notify()`** se inyectan antes de
  construir la instancia, así que un inicializador de campo ya puede alcanzar un
  repositorio — igual que un endpoint, una rutina o una estrategia.
- **Se construye al primer uso, y después se reutiliza.** Un contrato que nadie
  llama no cuesta nada, y el arranque no se cuelga por algo que necesita un solo
  endpoint.
- **Exactamente un proveedor.** Dos módulos respondiendo el mismo contrato es un
  error al arrancar, porque si no quien llama recibiría uno de los dos según el
  orden de carga.
- Dos implementaciones pidiéndose entre sí se reportan por nombre en vez de
  agotar la pila.
- Un `Provider` sin decorador se saltea con un aviso: un archivo a medio escribir
  no es una instalación rota.

### Puntos de extensión

Dos formas en que los módulos se encuentran, y no son intercambiables:

| | Quién responde | Quién lo corre | De quién es la falla |
| --- | --- | --- | --- |
| **Contrato** (`get`) | exactamente uno | quien llama, y espera la respuesta | de quien llama |
| **Slot** (`all`) | los aportes que haya | el anfitrión, y usa lo que devuelven | del anfitrión |
| el mismo slot, **anunciado** (`notify`) | los aportes que haya | el anfitrión, y descarta las respuestas | **de ellos** |

Las dos últimas filas son **la misma ranura**: lo único que cambia es el verbo con
que el anfitrión la lee, y con él de quién es la falla. Hubo un tercer mecanismo
—un evento, con su bus y su clase base— y eso era todo lo que agregaba.

Un slot es donde se enchufa una extensión de terceros: el anfitrión no sabe qué
va a existir, así que declara la forma y enumera lo que esté instalado.

```typescript
// catalog abre el punto
export interface ProductBadge {
  id: string;
  for(product: { id: number; stock: number }): string | null;
}
export const ProductBadges = token<ProductBadge>(
  'catalog.product-badges',
  'slot',
);
```

```typescript
// cualquier módulo lo llena, sin que catalog cambie — strategies/low-stock-badge.strategy.ts
@Fills(ProductBadges)
export class LowStockBadge extends Strategy implements ProductBadge {
  readonly id = 'low-stock';
  for(product) {
    return product.stock < 10 ? 'Low stock' : null;
  }
}
```

```typescript
// catalog lee a quien haya aparecido
const badges = this.all(ProductBadges);
```

**Mirá la dirección.** El módulo que ABRE el slot es del que dependen las
extensiones: `catalog` no sabe nada de quién lo llena, mientras que un
contribuyente importa su token. Al revés, el anfitrión dependería de sus propias
extensiones y ninguna se podría quitar.

- Un aporte es una **`Strategy`**, no un `Provider`: carpeta propia
  (`strategies/`), decorador propio (`@Fills`) y clase base propia. La interfaz
  que `implements` es del **anfitrión**, y el anfitrión es el único que la corre.
  Un `Provider` es otra cosa: la cara pública de tu módulo respondiendo un
  contrato que es tuyo.
  lo que agregó.
- Un arreglo vacío es una respuesta normal: un slot que nadie llenó es una función
  que nadie instaló.
- Se construyen en la primera lectura y se cachean, y una contribución que pide su
  propio slot se reporta en vez de agotar la pila.
- El orden es el de dependencias, así que es estable entre arranques.

### Permisos

Un módulo declara el vocabulario de lo que se puede gatear adentro:

```typescript
permissions: [
  'billing.view',
  'billing.void',
  // Texto sólo donde la clave no lo puede cargar sola — sobre todo para un
  // módulo instalado de otro lado, cuyo namespace el operador no escribió.
  { key: 'billing.impersonate', label: 'Actuar como otro operador' },
],
```

Éste es el ÚNICO lugar donde una clave se escribe.
`PermissionsOf<typeof billing>` lee las grafías de acá, así que un typo en un
endpoint no compila y no hay una segunda lista que mantener sincronizada — mirá
[Autorización](./authorization.md#2-declarar-las-claves-que-el-módulo-puede-gatear).

Las claves **tienen** que llevar el id del módulo por prefijo. Todos los módulos,
incluido uno que escribió otra persona, comparten un único espacio de permisos, y
el prefijo es lo que impide que dos reclamen la misma clave.

El `label` es opcional porque una clave como `billing.invoices.void` ya lo dice, y
un label que la repite es una cadena más que mantener verdadera. Lo lee una sola
cosa: la pantalla donde se arma un rol.

Después los endpoints las exigen (ver [Autenticación](#autenticación)), y la
aplicación arma su pantalla de "quién puede qué" desde el catálogo en vez de un
archivo central que alguien tiene que acordarse de editar:

```typescript
app.permissions();
// [{ key: 'billing.view', moduleId: 'billing' }, ...]
```

**Una clave que ningún módulo instalado declara se rechaza**, con un `Error`
común (500) y una sugerencia — no con un 403. Un 403 mandaría a quien depura a
mirar roles y concesiones cuando el problema es un typo:

```
Unknown permission "billing.veiw": no installed module declares it.
Add it to that module's "permissions" in defineModule().
Did you mean: billing.view, billing.void?
```

La comprobación corre **antes** del 401, así que una clave no declarada aparece
en la primera petición aunque sigas siendo anónimo.

### Anunciar algo, para quien reaccione

Un contrato es una llamada: le pedís algo a un módulo en particular y esperás.
Anunciar es lo otro: *esto pasó*, y reacciona quien le importe. Es la misma ranura
de arriba, leída con `notify()`.

```typescript
// catalog/tokens/product-restocked.token.ts — el anfitrión declara la CARGA
export interface RestockPayload {
  productId: number;
  quantity: number;
  userId: number;
}
export const ProductRestocked = token<Reaction<RestockPayload>>(
  'catalog.product.restocked',
  'slot',
);
```

`Reaction<T>` aporta el método, así que nadie tiene que inventarle un nombre.

```typescript
// en un endpoint o una rutina de `catalog`
await this.notify(ProductRestocked, { productId, quantity, userId });
```

```typescript
// reports/strategies/restock-log.strategy.ts
@Fills(ProductRestocked)
export class RestockLog extends Strategy implements Reaction<RestockPayload> {
  async on(payload: RestockPayload) {
    await this.get(UserDirectory).find(payload.userId);
  }
}
```

El archivo va en la carpeta `strategies/` del módulo, igual que una rutina va en
`routines/`. No hay nada que declarar.

Las reglas que evitan que anunciar se convierta en una llamada con pasos de más:

- **Una reacción que lanza no hace fallar a quien anunció.** El fallo se registra
  con el módulo y la ranura; la petición sigue. Si el resultado le importa a quien
  llama, lo que quiere es un contrato.
- **Una ranura que nadie llenó es normal**: `notify()` no hace nada.
- Las reacciones corren en paralelo y `notify()` resuelve cuando todas terminaron.
  **No es una cola**: una reacción lenta te frena igual.
- **Un salto y no más.** Una reacción que quiere anunciar otra cosa se rechaza por
  nombre, con las dos ranuras. Sin eso vuelve A → B → C y "por qué se mandó este
  correo" deja de tener respuesta.

**OJO:** las reacciones leen en su propia conexión. Anunciar dentro de
`db.transaction()` significa que no van a ver las filas sin confirmar — anunciá
*después* de que confirme, o poné lo que necesitan en la carga.

## Bases de datos

samble corre sobre **PostgreSQL**, **MySQL / MariaDB** y **SQLite**. Cuál es
decisión del operador, no del framework: tiene un adaptador por motor y carga
sólo el driver del que se usa.

| Motor | `dialect` | Driver a instalar | Base de pruebas |
| --- | --- | --- | --- |
| PostgreSQL | `postgres` (por defecto) | `pg` | PGlite, dentro del proceso |
| MySQL / MariaDB | `mysql` | `mysql2` | un servidor: `SAMBLE_TEST_MYSQL_URL` |
| SQLite | `sqlite` | `@libsql/client` | en memoria |

`samble init` pregunta cuál, o lo recibe con `--db <motor>`, y escribe el resto:
el driver, el `.env`, la base de pruebas, la plantilla de tablas y la sugerencia
de store de sesiones. Anota la elección en dos lugares, y cada uno lo lee
alguien distinto:

```typescript
// src/config/database.ts — lo que abre la conexión, y lo que tipa `this.db`
declare global {
  namespace SambleDatabase {
    interface Config {
      dialect: ReturnType<typeof databaseFromEnv>['dialect'];
    }
  }
}

export default function databaseFromEnv() {
  return { dialect: 'mysql', host, user, password, database } satisfies DatabaseOptions;
}
```

```json
// package.json — lo que escriben `samble table` y `samble migration`
"samble": { "dialect": "mysql" }
```

La declaración es lo que hace que `this.db` sea el tipo de Drizzle del motor: en
MySQL `.returning()` no compila, porque MySQL no tiene `RETURNING`. Sin
declaración el tipo es el de Postgres. El motor se LEE de las opciones en vez de
repetirse, así que el compilador y el driver no pueden recibir dos distintos.
Para eso las opciones tienen que decir UN motor: terminan en `satisfies
DatabaseOptions`. Anotar la función `: DatabaseOptions` ensancha `dialect` a los
tres, y entonces `this.db` es `DialectMustBeOneEngine`: el error lo dice donde se
use la base, en vez de compilar contra el motor equivocado.

`package.json` es el segundo lugar porque los generadores no cargan la
aplicación (crear una tabla no debe exigir un `.env`). Si queda desfasado, se
detecta al arrancar: un módulo con tablas escritas para otro motor se rechaza
por nombre. Una conexión pasada desde afuera
(`db: unDrizzle`) se reconoce sola: samble le lee el dialecto.

**Las tablas de un módulo se escriben para el motor en que corre la
aplicación.** Un `pgTable` en una aplicación sobre SQLite se rechaza al
arrancar, por nombre:

```
Module "billing" declares tables for postgres, and this application runs on sqlite.
```

### Lo que cambia según el motor

- **MySQL confirma cada sentencia DDL al ejecutarla**, dentro de una transacción
  o no. Una migración que crea dos tablas y falla en la segunda deja la primera,
  sin anotar, así que la siguiente corrida falla con "already exists". Postgres y
  SQLite revierten la migración entera. En MySQL, dejá una sentencia DDL por
  migración donde importe, o hacela re-ejecutable (`if not exists`).
- **MariaDB no es MySQL en todo.** Drizzle Kit escribe una columna `serial()`
  como `serial AUTO_INCREMENT`, que MySQL acepta y MariaDB rechaza; por eso la
  plantilla de tablas usa `int().autoincrement()`.
- **SQLite ejecuta con `run`**, no con `execute`: la base de Drizzle para SQLite
  no tiene `execute`. Las migraciones generadas ya lo usan.
- **Comparar el esquema vivo** (`schemaDrift()`, `migration:generate --check`)
  funciona **sólo en Postgres** por ahora. La comparación de Drizzle Kit para
  MySQL y SQLite toma la base entera y no se puede limitar a las tablas de los
  módulos, así que informaría el `_modules` de samble como diferencia; samble se
  niega antes que contestar mal. Generar migraciones funciona en los tres.

## Probar una compilación local

Para probar una versión sin publicar contra tu propio proyecto:

```bash
cd samble && npm run build && npm pack       # -> samble-<version>.tgz
cd ../tu-proyecto && npm install ../samble/samble-<version>.tgz
```

Un tarball se parece más a lo que npm instala de verdad que `npm link`, que
resuelve por enlaces simbólicos y puede esconder un archivo faltante o una
entrada `files` mal puesta.

## Autenticación

> Paso a paso, con recetas y una tabla de diagnóstico:
> [docs/authorization.md](./authorization.md).

`auth` es **obligatorio**. Es la única opción sin un valor por defecto sensato:
cualquiera que el framework eligiera sería el framework decidiendo quién puede
hacer qué. Una aplicación que no gatea nada igual escribe uno —

```typescript
auth: defineAuth(async () => ({
  actor: {} as SambleAuth.Actor,
  permissions: ['*'],
})),
```

— porque "pasan todos" es una respuesta que alguien eligió, y así se lee como
tal en vez de ser el silencio de una opción que nadie puso.

Un proyecto hecho con `samble init` ya lo trae escrito. `src/config/auth.ts` deja
pasar a TODOS con todos los permisos — no es autenticación, pero alcanza para que
`this.auth`, `this.auth.assert(...)` y las claves chequeadas por el compilador
funcionen desde la primera petición. Por eso el andamiaje escribe la línea
`this.auth.assert(...)` **viva**: la puerta está puesta y abierta, que es el único
orden en el que cerrarla es un cambio de una línea. Un andamiaje que entrega la
aserción comentada enseña que un endpoint es abierto por defecto, y el día que
alguien escriba autenticación de verdad, todos los endpoints escritos hasta ahí
siguen abiertos. `--public` deja la línea afuera para los que sí tienen que
estarlo.

Cuando sí la querés: los endpoints nunca se enteran de cómo se identificó a quien
llama. Un resolutor convierte una petición en un **actor**, y cada endpoint lo lee
como `this.auth`.

```typescript
const auth = defineAuth(async (request, { db }) => {
  const userId = request.session?.userId; // o un token bearer, o una API key
  if (!userId) return null; // anónimo

  const [user] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) return null; // borrado a mitad de la sesión

  return {
    actor: { userId },
    permissions: user.role === 'owner' ? ['*'] : ['billing.view'],
  };
});

const app = await Samble.create({ db, modules: [identity, billing], auth });
```

`defineAuth` tipa los argumentos del callback sin anotación y rechaza un
resultado que haría mentir a `this.auth` — un objeto sin `actor` reporta
`isAuthenticated` con `actor` en `undefined`, así que el 401 nunca pasa. Dale
varias estrategias y se prueban en orden, gana la primera que reconoce a quien
llama: `defineAuth(sessionAuth, bearerAuth, apiKeyAuth)`. El tipo `AuthResolver`
pelado también sigue sirviendo como `auth`.

El resolutor corre en cada petición y en la mayoría de las aplicaciones
consulta. Cuando eso aparezca en una medición, `cacheAuth` recuerda la respuesta
por llamante, con un `invalidate` explícito para los caminos que cambian lo que
alguien puede hacer — mirá
[Cachear lo que contestó el resolutor](./authorization.md#cachear-lo-que-contestó-el-resolutor).

Esa es toda la función. samble no guarda roles ni usuarios: recibe una lista de
claves por petición y compara cadenas. Qué claves tiene alguien es la regla de
**tu** aplicación, donde sea que la guardes.

El resolutor también recibe `get`, para resolver un contrato en vez de consultar:

```typescript
const auth = defineAuth(async (request, { get }) => {
  const userId = request.session?.userId;
  if (!userId) return null;
  const permissions = await get(UserDirectory).permissionsOf(userId);
  return permissions ? { actor: { userId }, permissions } : null;
});
```

Vale la pena por UNA razón, y sólo cuando aplica: el resolutor suele vivir fuera
de los módulos, así que consultar directo significa importar una entidad de las
entrañas de un módulo. Está bien mientras seas dueño de todos los módulos; deja
de estarlo cuando uno viene instalado de otro lado, o se supone que se puede
reemplazar. La demo bajo `src/` usa el contrato para mostrar esto, lo que hace
que el caso simple parezca más difícil de lo que es — empezá con `db`.

Declará la forma del actor **una vez**, en cualquier parte de tu app, y queda
tipada en todos lados:

```typescript
declare global {
  namespace SambleAuth {
    interface Actor {
      userId: number;
      tenant: string;
    }
  }
}
```

Después, dentro de un endpoint:

```typescript
this.auth.actor.userId; // tipado; lanza AuthError (401) si es anónimo
this.auth.optional; // Actor | null, para endpoints abiertos a todos
this.auth.isAuthenticated; // boolean
this.auth.can('billing.void'); // boolean, false si es anónimo
this.auth.assert('billing.void'); // 401 si es anónimo, 403 si tiene sesión y no alcanza
```

Notas:

- `this.auth.actor` **lanza a propósito**. Leer a quien llama y comprobar que
  existía eran dos pasos que había que escribir juntos todas las veces, y
  olvidarse del segundo fallaba en silencio. Usá `optional` donde anónimo es un
  caso válido.
- 401 y 403 no son intercambiables: 401 le dice a un cliente que se autentique,
  403 le dice que no se moleste. `assert()` elige el correcto.
- Las claves de permiso son las que los módulos declaran en su manifiesto. `*` da
  todo.
- El resolutor corre una vez por petición, antes de `previous()`, así que
  mantenelo barato. Lanzar desde ahí es legítimo — un token mal formado es un 401
  — y se mapea por el manejo de errores normal.
- Recibe `{ db, get }` como segundo argumento. Sin eso, una aplicación cuyos
  permisos viven en la base tenía que cerrar sobre un singleton de DataSource
  importado, o copiarlos a la sesión al iniciar y dejarlos envejecer — un rol
  revocado seguiría funcionando hasta el próximo ingreso.
- `this.auth` es **estado por petición**: como `params` y `body`, no se puede leer
  desde un constructor ni desde un inicializador de campo.
- Sin resolutor, leer `this.auth.actor` levanta un `Error` común (500), no un 401:
  una app que nunca cableó la autenticación tiene un bug, no un visitante no
  autorizado.

### Sesiones

samble no guarda sesiones: dónde viven depende del motor de base de datos, y el
motor lo elige la aplicación. Lo que te da es su conexión, para que el store que
elijas la comparta en vez de abrir un segundo pool:

```typescript
import connectPgSimple from 'connect-pg-simple';
import session from 'express-session';
import type { Pool } from 'pg';

const app = await createApp();
const PgStore = connectPgSimple(session);
app.use(buildSession(new PgStore({ pool: app.db.$client as Pool })));
```

- `app.db` es la conexión que samble abrió o recibió — la misma que los
  endpoints tienen como `this.db`. `$client` es el objeto del driver (acá, un
  Pool de `pg`).
- La tabla del store es del paquete del store, no de un módulo: es
  infraestructura, y no corresponde que la migre ningún módulo.
- Sin store, `express-session` guarda las sesiones en memoria: se pierden al
  reiniciar y un segundo proceso no las ve. Sirve sólo para desarrollo.

## Arranque

`Samble.create()` es la única forma de construir una aplicación, y **los módulos
son la única forma de montar algo**. No hay una API para montar por globs: una
ruta o una rutina pertenece a un módulo, o no existe.

```typescript
import { Samble } from '@samble/core';
import identity from './modules/identity/module';
import billing from './modules/billing/module';

const app = await Samble.create({
  db: { dialect: 'postgres' /* ... */ }, // o una conexión de Drizzle que ya tenés
  modules: [identity, billing],
  version: '3.0.0',
  basePath: '/api',
});

await app.start(5000);
```

`start()`:

- falla rápido si no se puede alcanzar la base (lanza, así que el proceso sale
  con código distinto de cero y tu orquestador lo reinicia);
- aborta si el grafo de módulos está roto o una migración falla — servir a medio
  montar es peor que no arrancar;
- registra manejadores de `SIGTERM`/`SIGINT` para un **apagado ordenado**
  (detiene las rutinas, drena las peticiones en vuelo, cierra la base). También
  lo podés disparar con `app.shutdown()`, o con `app.close()` para detener sin
  terminar el proceso.

Un arreglo `modules` vacío se permite pero avisa al arrancar: la app no va a
servir nada más allá de lo que hayas montado a mano por `getApp()`.

### CORS

samble es dueño del mecanismo CORS — las cabeceras, el preflight, el orden — y vos
sos dueño de la política, la misma división que con `auth`:

```typescript
Samble.create({
  cors: {
    origin: ['https://app.example.com'], // exacto, con esquema y puerto
    credentials: true, // cookies; obliga a una lista explícita
  },
});
```

Si se omite, no se manda ninguna cabecera CORS, que es lo correcto para una API a
la que ningún navegador llama entre orígenes.

`origin: true` permite a cualquiera y sólo es válido SIN credenciales — un
navegador rechaza `Access-Control-Allow-Origin: *` en una petición que lleva
cookies, así que samble rechaza esa combinación al arrancar en vez de dejar que te
la encuentres en una consola.

Un origen que no está en la lista sencillamente no recibe la cabecera, y la
petición pasa: eso es lo que dice el estándar, y mantiene funcionando a quienes
llaman servidor a servidor. Quien bloquea es el navegador, y samble registra el
rechazo para que quede rastro de este lado también. Se monta antes que todo lo
demás, así que un preflight nunca llega a una ruta y las cabeceras están también
en una respuesta con error.

### Versionado de la API

**La versión va en la URL, y es una convención, no un concepto del framework.**
Dos versiones del mismo recurso conviven con lo que ya existe, de dos formas:

```typescript
@Group('v1/productos')                     // → /api/v1/productos/:id
@Group('productos', { mount: '/api/v2' })  // → /api/v2/productos/:id
```

Son dos clases distintas, con sus propios DTO y su propio `main()`. Montan y
contestan en paralelo, y nada más hay que declarar.

Tener las dos arriba es la parte fácil. Lo que convierte eso en una
**migración** en vez de dos rutas que nadie se anima a borrar es
[`@Deprecated`](#deprecated-una-ruta-que-se-va).

#### `@Deprecated`: una ruta que se va

Marca la vieja **sin apagarla**:

```typescript
@Deprecated({
  sunset: '2027-01-31',
  use: '/api/v2/productos/:id',
  note: 'Devuelve el precio plano. v2 lo anida en `importe`.',
})
@Group('v1/productos')
@HttpGet(':id')
export class ProductoV1 extends Endpoint { ... }
```

Los tres parámetros son opcionales, y `@Deprecated()` pelado ya dice lo único
que no se puede omitir: que se va.

| | Qué es | Dónde aparece |
| --- | --- | --- |
| `sunset` | El día que **deja de contestar**, en `YYYY-MM-DD`. samble no la apaga ese día: borrar la clase sigue siendo tu decisión. Es una promesa que publicás, y publicarla es lo que la vuelve planificable para el que llama. | cabecera `Sunset` y la descripción |
| `use` | La ruta que la **reemplaza**. Sin esto, quien llama se entera de que vive de prestado pero no de adónde moverse — que es la mitad que te cuesta el ticket de soporte. | cabecera `Link` y la descripción |
| `note` | Una línea de **qué cambió**, para quien lee `/docs`. Sólo documentación. | la descripción |

Y hace tres cosas:

- **El spec lo dice.** `deprecated: true` en la operación, que Swagger UI tacha,
  más la fecha y la sucesora al principio de la descripción.
- **Quien llama se entera, en cada respuesta.** `Deprecation: true`, `Sunset`
  si hay fecha, y `Link: <...>; rel="successor-version"` si hay sucesora. Un
  cliente que nunca lee los docs recibe la señal igual. Los encabezados salen
  **conteste lo que conteste** la ruta —200, 404 o el 422 del DTO, que ni llega
  a `main()`—, porque una ruta que se está yendo no deja de irse porque una
  llamada vino mal.
- **Te enterás de quién la sigue llamando**, que es *la* pregunta que te bloquea
  para borrarla. El primer impacto deja un aviso en `warn.log`. **Una vez por
  ruta, no una por petición**: lo que querés saber es que el que llama existe, y
  una línea por pedido taparía todo lo demás. Cuántas veces y desde dónde ya lo
  registra el log de accesos.

> No es `@ApiHidden`. Esconder la versión vieja le quita al cliente el único
> lugar donde podía leer a cuál moverse: esto la marca y la deja a la vista.

`Sunset` es el RFC 8594 y la relación del `Link` es del RFC 8288. El encabezado
`Deprecation` todavía es un borrador de la IETF, y samble manda su forma booleana.

## Swagger / OpenAPI

> El detalle completo — cómo se arma cada URL, las dos trampas de
> `components.schemas`, lo que la especificación no sabe de tu aplicación y cómo
> tapar `/docs` — está en [Swagger y OpenAPI](./openapi.md).

Samble genera una especificación OpenAPI 3.0.3 directamente de los decoradores que
ya usás para rutear — sin anotaciones aparte, sin un paso de compilación extra.
Se activa con una sola opción:

```typescript
const app = await Samble.create({
  // ...
  docs: {
    path: '/docs',
    info: {
      title: 'My API',
      version: '1.0.0',
      description: 'Optional Markdown description',
    },
  },
});
```

Esto monta:

- `GET /docs` → la interfaz interactiva de Swagger
- `GET /docs.json` → el JSON OpenAPI 3 crudo

Si se omite, no se expone nada. `samble init` la enciende, y queda encendida en
todos los entornos — pero publica la forma completa de tu API a cualquiera que
encuentre la URL, así que ponela detrás de tu propia puerta, o sacá la opción, si
no es lo que querés. No hay una segunda forma de encenderla: es una opción de la
aplicación, decidida donde se deciden todas las demás.

### Qué se documenta automáticamente

| Fuente | Resultado en la especificación |
| --- | --- |
| `@Group(name)` o el id del módulo, + `@HttpGet`/`@HttpPost`/... | ruta + método HTTP |
| `@Body(Dto)` | `requestBody` (JSON) referenciando un esquema reutilizable |
| `@Params(Dto)` | parámetros de ruta tipados (siempre obligatorios) |
| `@Query(Dto)` | parámetros de query tipados (la obligatoriedad la decide `@IsOptional`) |
| `:foo` en la ruta sin `@Params` | se infiere como parámetro de ruta `string` |
| el grupo | etiqueta por defecto del endpoint |
| `@ApiHidden()` | excluido (montado, pero fuera de la especificación) |
| `@HttpQuery` | excluido (QUERY no es una operación de OpenAPI) |

Los DTO se convierten en JSON Schema con
[`class-validator-jsonschema`](https://github.com/epiphone/class-validator-jsonschema).
Decoradores como `@IsString`, `@IsEnum`, `@IsUUID`, `@IsOptional`, `@MinLength`,
etc. se mapean a sus equivalentes de OpenAPI sin configuración, así que lo que ya
validás también queda documentado.

### Documentación más rica (opcional)

Cuatro decoradores extra te dejan pulir la salida. Son totalmente opcionales —
sin ellos igual obtenés una especificación válida.

```typescript
import {
  Endpoint,
  Body,
  Group,
  HttpPost,
  ApiTag,
  ApiSummary,
  ApiDescription,
  ApiResponse,
} from '@samble/core';
import { IsEmail, IsString, MinLength } from 'class-validator';

class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}

class UserDto {
  @IsString()
  id: string;

  @IsEmail()
  email: string;
}

class ErrorDto {
  @IsString()
  message: string;
}

@Group('users')
@HttpPost()
@Body(CreateUserDto)
@ApiTag('users')
@ApiSummary('Create a user')
@ApiDescription('Creates a new user. Email must be unique.')
@ApiResponse(201, { description: 'Created', Schema: UserDto })
@ApiResponse(409, { description: 'Email already in use', Schema: ErrorDto })
export class CreateUserApi extends Endpoint<null, CreateUserDto> {
  async main() {
    // ...tu lógica
  }
}
```

| Decorador | Para qué |
| --- | --- |
| `@ApiTag(...names)` | Agrupa endpoints bajo una o más etiquetas (reemplaza la etiqueta por defecto del módulo). |
| `@ApiSummary(text)` | Resumen corto de una línea, que se ve en la lista de endpoints. |
| `@ApiDescription(text)` | Descripción más larga (soporta Markdown). |
| `@ApiResponse(status, { description?, Schema? })` | Documenta códigos de estado adicionales y la forma de su respuesta. Apilá los que necesites. |
| `@ApiHidden()` | Monta el endpoint pero lo deja fuera de la especificación — una página, un webhook, una ruta interna. |

### Limitaciones actuales

- Sólo se documentan cuerpos `application/json` — `multipart/form-data` y
  `application/x-www-form-urlencoded` todavía no se generan solos.
- No se emiten `securitySchemes`, así que los endpoints se muestran sin
  autenticación en la interfaz.
- La especificación se construye una vez cuando corre `start()` (no por
  petición).

## Logging

`Samble.create()` escribe `logs/` al lado del proceso, y la consola recibe todo de
cualquier manera. No hay nada que encender: quien tiene que descubrir una opción
antes de poder leer lo que hizo su aplicación, no la lee nunca.

```
logs/
├─ app.log        todos los niveles, en un solo hilo cronológico
├─ info.log
├─ warn.log
├─ error.log
└─ router.log     el mapa de rutas — el único con algo adentro al arrancar
```

Los cinco existen desde el primer arranque, vacíos. **Un `error.log` vacío dice
que no pasó nada malo; uno que falta no dice nada**, y te manda a averiguar por
qué nunca se creó.

`app.log` es el neutral y es donde se lee qué pasó — los archivos separados son
para grepear una clase de cosa. El mapa de rutas queda afuera: es un mapa, no una
cronología, y serían cincuenta líneas de arranque delante de lo primero que
importa.

La opción existe para moverlo, renombrar un archivo o sacar uno:

```typescript
logs: { dir: '/var/log/app' }         // a otro lado
logs: { dir: null }                   // sólo consola — lo que quiere un contenedor
logs: { files: { error: 'errores' } } // errores.log
logs: { files: { info: false } }      // sin info.log
logs: { level: 'off' }                // callar todo, y no escribir archivos
```

Sacar `info`, `warn` o `error` no pierde nada — esas líneas siguen en `app.log` y
en la consola — así que se trata de qué querés grepear aparte. `router` es la
excepción: no está en ningún otro archivo, así que `false` significa que no hay
mapa, y cae a la consola.

`dir: null` es la respuesta para contenedores: adentro de uno el disco no es donde
nadie lee logs, y los archivos se van con el contenedor.

Las variables de entorno no reemplazan nada de lo que pasó la aplicación, y están
para el mismo caso del contenedor:

| Variable          | Descripción |
| ----------------- | ----------- |
| `SAMBLE_LOG_DIR`   | Directorio para los archivos, cuando la aplicación no nombra uno. |
| `SAMBLE_LOG_LEVEL` | `trace` \| `debug` \| `info` \| `warn` \| `error` \| `off` (por defecto `trace`). |

`off` no escribe ningún archivo — crearlos para un logger que no dice nada
dejaría una carpeta de archivos vacíos después de cada corrida de pruebas. Y si el
directorio no se puede crear (permisos, sistema de archivos de sólo lectura),
samble degrada a la consola en vez de no arrancar.

### El mapa de rutas (`router.log`)

Cada arranque escribe las rutas en el orden en que se montaron:

```
[MAP] /api — registration order; the first match answers
#01 auto GET    /api/auth/me  (MeEndpoint)
#06 p1   GET    /api/products/page  (ProductsPageEndpoint)
#07 p1   GET    /api/products/export  (ExportProductsEndpoint)
#08 p2   GET    /api/products/:id  (GetProductEndpoint)
#10 auto GET    /api/products  (ListProductsEndpoint)
```

Contesta una sola pregunta: **qué ruta gana**. Express hace coincidir en orden de
registro, así que `/products/:id` montada antes que `/products/page` se traga la
página y el manejador recibe la cadena literal `"page"` — un bug que parece un
problema de datos. `#nn` es la posición en todo el montaje, y `p1`/`auto` es el
`@Priority` que la puso ahí (`auto` = ninguno declarado, que es el caso normal).
Va a parar a `router.log`; con `dir: null` — o `files: { router: false }` — va a
la consola, porque perder el mapa en silencio es peor que imprimirlo.

## Respuestas que no son JSON

`main()` normalmente devuelve datos y samble los serializa. Cuando la respuesta es
una página, un documento o un archivo, devolvé una de las **salidas**:

```typescript
import { csv, file, pdf, view } from '@samble/core';

@Group('clients')
@HttpGet()
@Query(ListClientsDto)
export class ListClientsApi extends Endpoint<null, null, ListClientsDto> {
  async main() {
    const clients = await this.db.select().from(clientsTable);

    if (this.query.format === 'csv') {
      return csv(clients, {
        filename: 'Clientes.csv',
        columns: [
          { key: 'name', header: 'Nombre' },
          { key: 'createdAt', header: 'Alta' },
        ],
      });
    }

    return { clients }; // los datos planos siguen siendo JSON
  }
}
```

La decisión se toma **dentro de `main()`, con los datos en la mano** — el mismo
endpoint puede contestar JSON o un archivo según lo que le pidan.

| Salida | Qué hace |
| --- | --- |
| `view(template, data?)` | Renderiza una plantilla y manda el HTML. Una plantilla que falla al renderizar vuelve con el contrato de error de samble, no con una página de stack de Express. |
| `pdf(content, options?)` | `application/pdf`. Se muestra en el navegador por defecto; `download: true` lo guarda. samble no construye el documento — pasale los bytes de lo que sea que los produjo. |
| `csv(rows, options?)` | Arma el archivo desde una lista de filas. `columns` elige qué campos salen y sus encabezados; se escribe un BOM por defecto para que una planilla lea bien los acentos. |
| `file(content, options?)` | El caso general — cualquier tipo MIME. `pdf` y `csv` son esto con los valores por defecto puestos. |

`content` puede ser un `Buffer`, un `Uint8Array`, una cadena o un **stream**, que
se canaliza en vez de acumularse en memoria. Los nombres de archivo con acentos se
mandan saneados y también en UTF-8 (RFC 5987), así que sobreviven a clientes
viejos.

Las plantillas siguen necesitando un motor y una ruta raíz:

```typescript
await samble.setTemplates('pug', './views'); // o 'ejs'
```

A las páginas suele convenirles `@ApiHidden()` para que queden fuera de la
especificación OpenAPI.

## Rutinas

Trabajo que la aplicación hace por su cuenta, con reloj. La tercera puerta de
entrada, al lado de un endpoint (contesta una petición) y una estrategia (una
implementación entre las que haya): a una rutina no la llama nadie, la llama el
reloj.

```typescript
import { Cron, Routine } from '@samble/core';

@Cron('0 * * * *', { timezone: 'America/Lima' }) // cada hora
export class HourlyReport extends Routine {
  start(now: Date | 'manual' | 'init') {
    // this.db, this.get(Contract) y this.notify(Slot, carga) funcionan acá
  }
}
```

El archivo va en la carpeta `routines/` del módulo y eso es todo. Todo se
detiene en el apagado ordenado.

Dos cosas que conviene saber:

- **Poné la `timezone`.** Sin ella la expresión se lee en la zona horaria de la
  máquina donde haya terminado el proceso, que es cómo una rutina de "las 7"
  corre a las 2 de la mañana en un servidor en otro país.
- **`now` no siempre es un `Date`.** Es `'init'` cuando la rutina se declaró con
  `{ runOnInit: true }` y corrió al arrancar, y `'manual'` para un tic que no
  programó nadie. Ramificá sobre él cuando la primera corrida tenga que ser
  distinta.

> Se renombró desde `Task` / `@Schedule`. "Task" es el sustantivo más común del
> software de gestión — una orden de trabajo, un caso, un pendiente — y una
> aplicación con su propia entidad `Task` tenía que aliasear una de las dos en
> cada archivo que usaba ambas. Los nombres viejos se eliminaron.

## Configuración por entorno

`ConfigService` lee de `process.env` (carga un archivo `.env` al importarse, con
`dotenv`). Lo que importa de cada método es **cuándo falla**.

```typescript
ConfigService.require(['DB_HOST', 'DB_PORT', 'SESSION_SECRET']); // lo primero
ConfigService.get('DB_HOST');        // lanza si falta, nombrándola
ConfigService.number('DB_PORT');     // lanza si no es número
ConfigService.boolean('ENABLE_X');   // true/false, 1/0, yes/no, on/off
ConfigService.optional('CORS_ORIGIN'); // string | undefined, y lo dice
ConfigService.mode();                // 'development' | 'production'
```

### `require()` va primero, y nombra todas

Va como **primera línea de `createApp()`**, antes de que se lea un solo valor:

```typescript
export async function createApp() {
  ConfigService.require(['DB_HOST', 'DB_PORT', 'DB_NAME', 'SESSION_SECRET']);

  return Samble.create({ db: { host: ConfigService.get('DB_HOST'), ... } });
}
```

Nombra **todas** las que faltan, no la primera. Quien está llenando un `.env` en
un servidor quiere una lista, no un fallo más por cada viaje de ida y vuelta.

Una variable **vacía cuenta como ausente**: `DB_PASSWORD=` es lo que parece una
plantilla antes de que alguien la edite, no una decisión.

> **Ojo con leer el entorno en el tope de un módulo.** Eso pasa al **importar**,
> que es antes de que `createApp()` corra, así que `require()` no llega a
> reportarlo. Si un archivo de configuración necesita una variable, que exporte
> una **función** y se la llame desde `createApp()`. El andamio de `samble init`
> lo hace así con la sesión, justamente por esto.

Las variables de la base son la excepción a "primero en `createApp()`": el
andamio las exige en `databaseFromEnv()` (`src/config/database.ts`), el valor por
defecto de `createApp(db = databaseFromEnv())`, que es donde se leen. Eso es lo
que deja a una prueba pasar su propia base sin necesitar ninguna. El costo: si
faltan las de la base y las de la aplicación, son dos listas en vez de una.

### `get()` lanza, y antes no

Devolvía `undefined` tipada `string`, así que el valor seguía viaje y rompía en
otro lado: `+ConfigService.get('DB_PORT')` daba `NaN`, y `NaN` le llega al driver
como puerto — el fallo salía como un problema de conexión. Ahora `get()` lanza
nombrando la variable, y `number()` falla por lo que es.

Para un valor que **legítimamente puede no estar** está `optional()`. Decirlo es
el punto: `optional()` se lee como una decisión, mientras un `get()` envuelto en
`?? ''` se lee como alguien esquivando un tipo.

### Lo que declara un módulo

Un módulo instalado nombra en su manifiesto lo que necesita del entorno:

```typescript
export default defineModule({
  id: 'whatsapp',
  dir: __dirname,
  env: ['WA_BRIDGE_URL', 'WA_BRIDGE_TOKEN'],
});
```

Se chequea **al arrancar, antes de abrir la base** —una variable que falta no es
un problema de la base, y si lo que falta son las credenciales, nombrar la
variable le gana a un `ECONNREFUSED`— y el error junta lo de **todos** los
módulos:

```
Missing environment variables declared by installed modules:
  whatsapp: WA_BRIDGE_TOKEN
  correo: SMTP_HOST
```

Va en el **manifiesto** y no en el código del módulo para que se pueda contestar
sin correr nada, que es lo que hace [`samble doctor`](./cli.md#samble-doctor) y lo
que vuelve «¿qué necesita este módulo de mí?» una pregunta que quien instala
puede hacer **antes** del primer arranque.

Sólo lo **obligatorio**. Una variable con valor por defecto en el código se lee
con `optional()` y no se declara: declararla rechazaría un arranque que tenía un
default perfectamente bueno.

## Pruebas

Una prueba arranca la aplicación como lo hace un despliegue, sobre un Postgres
de verdad dentro del proceso:

```typescript
import { closeTestDatabase, openTestDatabase } from '@samble/core';
import { createApp } from '../src';

const db = await openTestDatabase();      // Postgres: PGlite, sin servidor ni .env
const app = await createApp(db);          // el MISMO createApp() que producción
await app.start(0);
// ... supertest contra app.getApp() ...
await app.close();
await closeTestDatabase(db);
```

- `createApp(db = databaseFromEnv())` es la forma que escribe `samble init`.
  Sin argumento, la base es la que describe el entorno, y `databaseFromEnv()`
  (en `src/config/database.ts`) exige sus variables `DB_*` donde las lee. Una
  prueba pasa la suya y nunca llega ahí, así que no necesita ninguna. `_modules`,
  cada migración, los contratos, las rutas y el resolutor de auth corren de
  verdad. Sólo cambia la conexión, y ese es el
  punto: una suite que simula la base prueba la simulación.
- `openTestDatabase({ dialect })` sigue al motor: PGlite para Postgres, memoria
  para SQLite, y para MySQL — que no tiene opción dentro del proceso — una base
  propia creada en el servidor al que apunta `SAMBLE_TEST_MYSQL_URL`, que se
  borra al cerrar. No toca nada de lo que ya hay en ese servidor.
- Cada `openTestDatabase()` es una base nueva y vacía. Abrí una por archivo de
  pruebas.
- samble no cierra una conexión que no abrió: la cierra
  `closeTestDatabase(db)`.
- `@electric-sql/pglite` es un peer opcional, dependencia de desarrollo de una
  app sobre Postgres. Carga su WASM con un import dinámico, así que jest corre con
  `--experimental-vm-modules`; el script `test` que escribe `samble init` lo
  pasa.

## Aplicación de ejemplo

[`src/`](https://github.com/global-materis/samble/tree/main/src) es una aplicación Samble
chica pero completa, y
[`http/demo.http`](https://github.com/global-materis/samble/tree/main/http/demo.http)
recorre todo el flujo petición por petición — 401 vs 403, validación,
transacciones, y un módulo extendiendo a otro sin que ninguno se entere.

Tres módulos, a propósito:

| Módulo | | Qué muestra |
| --- | --- | --- |
| `identity` | | Tabla + migración con datos de siembra, login/logout/me, un contrato que otros módulos consumen, permisos, y una proyección para que la contraseña no salga |
| `catalog` | | `requires`, DTO de validación, `@Priority` bien usado, una página con `view()`, una exportación con `csv()`, `db.transaction()` para dos escrituras que tienen que caer juntas |
| `reports` | | No tiene tabla propia: lee a los otros dos por sus contratos, llena el punto de extensión de catalog y reacciona a lo que anuncia — la forma que tiene una extensión |

```bash
cp .env.template .env      # completá DB_* y SECRET_KEY
npm run dev                # las migraciones corren al arrancar; se siembran dos usuarios
```

Está cubierta por `test/demo-app.spec.ts`, que arranca esos mismos tres módulos
contra un Postgres dentro del proceso. El código de ejemplo que nadie corre deja
de ser un ejemplo.
