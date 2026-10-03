# Autorización

Quién hace la petición, y qué tiene permitido hacer.

samble **no guarda usuarios ni roles**. Recibe una lista de claves de permiso por
petición y compara cadenas. Todo lo que sigue es sobre quién produce esa lista y
quién la comprueba.

## Las tres responsabilidades

Están separadas a propósito, y nada funciona hasta que las tres existen.

| Responsabilidad | Dónde vive | Quién decide |
| --- | --- | --- |
| Qué claves **existen** | el manifiesto del módulo | el módulo |
| Qué claves **tiene** alguien | tu resolutor `auth` | tu aplicación |
| Qué claves **exige** un endpoint | `this.auth.assert(...)` | el endpoint |

El endpoint nunca se entera de que existen usuarios. El usuario nunca se entera
de que existen endpoints. Se encuentran en la clave.

---

# Paso a paso

## 1. Con qué arranca un proyecto nuevo

`samble init` escribe `src/config/auth.ts`: un resolutor que deja pasar a
**todos** con todos los permisos, y avisa una vez en el log la primera vez que lo
hace. No es autenticación. Está para que `this.auth` funcione, para que las
líneas `this.auth.assert(...)` que genera el andamiaje pasen, y para que el
compilador chequee las claves desde la primera petición — la puerta puesta y
abierta, así cerrarla después es un solo archivo.

Reemplazá su cuerpo (paso 3) y todo lo ya escrito empieza a aplicarse.

`auth` es obligatorio en `Samble.create()`, así que la pregunta "quién llama"
siempre tiene una respuesta elegida. Lo que sigue siendo opcional es
**gatear**: un endpoint que nunca lee `this.auth` no comprueba nada, y eso es lo
que anda `--public`.

```typescript
@HttpGet()
export default class ListTasksEndpoint extends Endpoint {
  public async main() {
    return this.db.select().from(tasks);
  }
}
```

Esto contesta 200 a cualquiera. Todo lo que sigue es lo que se agrega cuando eso
deja de ser lo que querés.

## 2. Declarar las claves que el módulo puede gatear

En el manifiesto, y en ningún otro lado. Es el único lugar donde una clave se
escribe:

```typescript
// src/modules/tasks/module.ts
export default defineModule({
  id: 'tasks',
  version: '1.0.0',
  core: true,
  dir: __dirname,

  permissions: [
    'tasks.view',
    'tasks.manage',
    // Texto sólo donde la clave no lo puede cargar sola.
    { key: 'tasks.assign', label: 'Pasarle una tarea a otra persona' },
  ],
});
```

Después se nombra el módulo una vez, en el `src/config/permissions.ts` de la
aplicación:

```typescript
import type { PermissionsOf } from 'samble';

declare global {
  namespace SambleAuth {
    interface Permissions
      extends PermissionsOf<typeof import('../modules/tasks/module').default> {}
  }
}
```

Eso es lo que hace que las claves estén CHEQUEADAS sin dejar de ser cadenas
comunes: `this.auth.assert('tasks.manage')` se lee igual que siempre, y
`'tasks.mange'` no compila — TypeScript hasta sugiere la grafía correcta. Las
**lee** del manifiesto en vez de repetirlas, así que no hay una segunda lista que
mantener sincronizada.

Un bloque `declare global` por módulo, que TypeScript fusiona, así que agregar un
módulo es añadir al final y acá nunca se vuelve a abrir nada. Eso es también por
qué esto es una interface y no una union: una union no se puede fusionar, así que
cada módulo nuevo tendría que reabrir una sola declaración. Y el módulo se
alcanza con un `import(...)` en línea y sólo de tipos, así que nombrarlo no
cuesta una línea de import y no puede crear un ciclo.

`samble init` escribe `config/permissions.ts` con un bloque inicial vacío, y
`samble module` agrega el de verdad. `samble endpoint tasks/assign --permission
tasks.assign` agrega la clave al arreglo del módulo en la misma pasada. No hay
nada que cablear a mano.

Dos reglas que el manifiesto aplica al importarse, antes de que arranque nada:

- **La clave tiene que empezar con el id del módulo.** `tasks.view` es válida
  dentro del módulo `tasks`; `billing.view` no. Todos los módulos instalados,
  incluidos los de terceros, comparten un único espacio de claves, así que el id
  es lo que impide que dos módulos entiendan cosas distintas por la misma
  palabra.
- **Un `label`, si lo escribís, no puede estar vacío.** Quien lo escribió quiso
  decir algo; omitir el campo es la forma de no decir nada.

### Cuándo escribir un label

El label es **opcional**, y la razón es que una clave como
`billing.invoices.void` ya lo dice. Un label que repite la clave en una oración
es una cadena más que alguien tiene que mantener verdadera, y no compra nada.

Escribí uno cuando la clave no puede cargar el significado sola. Dos casos donde
normalmente no puede:

- La clave esconde parte de lo que concede. `tasks.manage` no dice que
  reasignar está incluido.
- El módulo vino **de otro lado**. Ahí el operador está leyendo un namespace que
  no escribió, y la clave es todo lo que tiene.

Lo que un label **no** hace: nunca llega a un cliente. Un 403 lleva la **clave**,
en el `detail` y en `missing` — mirá [403](#403--hay-sesión-pero-no-alcanza). El
label es para la pantalla donde se arma un rol, que es lo único que lee
`app.permissions()`. Si tus roles están fijos en código, nada lo lee y las claves
peladas son la opción honesta.

Tampoco es documentación para quien programa: TypeScript no muestra ninguna
documentación de un literal de texto, así que ni un label ni un comentario JSDoc
aparecen cuando escribís `assert('tasks.…')`. Lo que explica una clave a quien
escribe código va en el README del módulo o al lado de la clave en el manifiesto.

El catálogo de todas las claves declaradas es `app.permissions()`:

```typescript
[
  { key: 'tasks.view', moduleId: 'tasks' },
  { key: 'tasks.manage', moduleId: 'tasks' },
  { key: 'tasks.assign', label: 'Pasarle una tarea a otra persona', moduleId: 'tasks' },
]
```

Para conceder todo lo que tiene un módulo, esparcí sus claves en vez de
listarlas — `[...tasks.permissionKeys]` — así un rol sigue siendo correcto cuando
el módulo gana una clave.

Se arma con todos los módulos **presentes en el código**. Una clave existe
porque un manifiesto la declara, y eso no depende de nada más.

## 3. Convertir una petición en un actor

Una función, que se le pasa a `Samble.create()`. Corre una vez por petición.

```typescript
// src/config/roles.ts — tu política, no la del framework
import { permissions as tasks } from '../modules/tasks/permissions';

export const PERMISSIONS_BY_ROLE: Record<UserRole, string[]> = {
  owner: ['*'], // todo, ver más abajo
  agent: ['tasks.view', 'tasks.manage'], // chequeadas, ver paso 2
  viewer: ['tasks.view'],
  auditor: [...tasks], // todo lo que tiene ESTE módulo
};
```

```typescript
// src/config/session-auth.ts
import { defineAuth } from 'samble';

const sessionAuth = defineAuth(async (request, { db }) => {
  const userId = request.session?.userId;
  if (!userId) return null; // anónimo

  const [user] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) return null; // borrado a mitad de la sesión

  return {
    actor: { userId },
    permissions: PERMISSIONS_BY_ROLE[user.role],
  };
});
```

```typescript
// src/index.ts
const app = await Samble.create({ db, modules, version, auth: sessionAuth });
```

Tres cosas sobre lo que devuelve:

- **`null` significa anónimo.** No es un error: un endpoint que no exige nada
  igual contesta.
- **`actor` es lo que tu aplicación diga que es.** samble declara la forma vacía y
  vos la ampliás una vez (ver *Tipar el actor* más abajo). Un id de usuario, un
  inquilino, una API key emitida a una integración: todos valen.
- **`permissions` es una lista simple de cadenas.** De dónde sale es asunto tuyo:
  una constante como la de arriba, una columna, una tabla intermedia, una llamada
  a otro servicio.

La sesión guarda **sólo el id del usuario**. Los permisos se leen por petición,
no se copian al iniciar sesión, así que quitar un rol tiene efecto en la petición
siguiente y no en el siguiente ingreso. Eso cuesta una consulta por petición.
Empezá por ahí, y recurrí a *Cachear lo que contestó el resolutor*, más abajo,
sólo cuando aparezca en una medición.

`defineAuth` es lo que escribe `samble init` y lo que usan los ejemplos de acá.
Tipa los dos argumentos del callback sin necesidad de anotar nada, y revisa el
resultado antes de que un endpoint lo lea: un objeto sin `actor` dejaría a
`this.auth` diciendo `isAuthenticated` con `actor` en `undefined` — el 401 que
correspondía nunca pasa, y la falla aparece después, en otra parte. Eso es un
error de código, así que lanza un 500, no un 401.

El tipo `AuthResolver` sigue exportado, y `auth:` sigue aceptando cualquier
función pelada con esa forma. Nada de lo que ya funcionaba deja de funcionar.

### Más de una puerta de entrada

El resolutor es una función, pero las maneras de entrar a una aplicación son
varias: una cookie para la web, un token bearer para la app móvil, una API key
para una integración. Pasalas en orden en vez de encadenar `if`s dentro de un
solo cuerpo — la primera que reconoce a quien llama gana, y las demás no se
ejecutan.

```typescript
export default defineAuth(sessionAuth, bearerAuth, apiKeyAuth);
```

Cada una es un resolutor común que devuelve `null` para decir "no es mío", así
que cada una se lee sola y un tipo de cliente nuevo es un argumento más. Cuando
todas devuelven `null` la llamada es anónima, igual que el `null` de un resolutor
único.

### Cachear lo que contestó el resolutor

Esa consulta por petición es un impuesto fijo, y se paga también en las
lecturas baratas que son la mayoría de una API. Medido sobre una petición HTTP
completa contra un Postgres en proceso, era cerca del 40 % de la petición.

`cacheAuth` recuerda la respuesta por llamante:

```typescript
// src/config/auth.ts
export const auth = cacheAuth(defineAuth(sessionAuth, bearerAuth), {
  key: (request) => request.session?.userId ?? null, // null = resolver de nuevo
  ttl: 15_000,
  max: 5_000, // opcional, por defecto 5000
});
```

```typescript
// donde cambie lo que alguien puede hacer: cerrar sesión, un rol, una baja
auth.invalidate(userId);
```

**`invalidate` no es opcional.** El TTL es el piso, no el contrato: sin esa
llamada, un rol revocado sigue funcionando hasta que venza. samble no puede
hacerla por vos, porque no sabe dónde cambian tus roles.

**La key va sobre la identidad, no sobre la credencial.** El id del usuario, no
el de la sesión: así un cambio de rol es una sola llamada y se refrescan todos
los dispositivos donde esté conectado, en vez de tener que enumerar sus
sesiones. Sacarla de la sesión además deja el cierre remoto inmediato gratis —
una sesión destruida del lado del servidor no carga ningún `userId`, la key es
`null` y la caché no se consulta.

Tres cosas que se niega a cachear, cada una porque cachearla es un error:

| No se cachea | Por qué |
| --- | --- |
| una key `null` | no hay con qué indexar la petición |
| un resultado `null` | es como alguien inicia sesión y sigue anónimo hasta que venza el TTL |
| un resolutor que lanzó | una credencial mal formada es un 401 siempre, no uno recordado |

Las peticiones que llegan mientras una resolución está en vuelo esperan esa, en
vez de arrancar la suya: una pantalla que dispara ocho llamadas a la vez con la
caché fría corre el resolutor una sola vez — que es justo el momento para el que
querías la caché.

No hay ningún temporizador. Las entradas vencen cuando se las lee y al llegar a
`max` se suelta la menos usada, así que nada de esto mantiene vivo un proceso ni
hay que apagarlo.

Dos límites para saber antes de encenderla:

- **El resultado se comparte entre peticiones.** Tratá el actor como inmutable.
  Escribir en `this.auth.actor` ya era un error; con caché es uno que ven las
  otras peticiones.
- **Vive en un solo proceso.** Con más de una réplica, `invalidate` en una no
  llega a las otras y la garantía baja en silencio al TTL. Corré un proceso, o
  dejá el TTL lo bastante corto como para aceptarlo como única garantía.

## 4. Exigir una clave

```typescript
@HttpPost()
@Body(CreateTaskDto)
export default class CreateTaskEndpoint extends Endpoint<null, CreateTaskDto> {
  public async main() {
    this.auth.assert('tasks.manage');

    const [task] = await this.db
      .insert(tasks)
      .values({ ...this.body, createdBy: this.auth.actor.userId })
      .returning();

    return task;
  }
}
```

`assert()` en la primera línea, antes de cualquier trabajo. Leer
`this.auth.actor` después es seguro: si la llamada fuera anónima, `assert` ya
habría cortado la petición.

## 5. Leer lo que pasa

Con el resolutor de arriba y un usuario de rol `agent`
(`['tasks.view', 'tasks.manage']`):

| Petición | `assert` | Resultado |
| --- | --- | --- |
| `POST /api/tasks`, con sesión | `tasks.manage` | **200** — la tiene |
| `POST /api/tasks/1/assign`, con sesión | `tasks.assign` | **403** — conocida, no permitida |
| `POST /api/tasks`, sin cookie | `tasks.manage` | **401** — el resolutor devolvió `null` |
| `POST /api/tasks`, owner | `tasks.manage` | **200** — `*` tiene todo |
| `GET /api/tasks` (sin assert) | — | **200** — cualquiera, incluso anónimo |

---

# Los tres fallos, y qué significa cada uno

Son distintos a propósito. Leer el estado te dice dónde mirar.

## 401 — no hay nadie con sesión

```json
{
  "type": "/problems/unauthorized",
  "title": "Not authenticated",
  "status": 401,
  "detail": "Unauthorized.",
  "code": "unauthorized",
  "errors": {},
  "requestId": "6eac410efc74"
}
```

El resolutor devolvió `null` y un endpoint exigió algo. Le dice al cliente:
autenticate y volvé a intentar.

## 403 — hay sesión, pero no alcanza

```json
{
  "type": "/problems/forbidden",
  "title": "Not allowed",
  "status": 403,
  "detail": "Missing permission: tasks.assign.",
  "code": "forbidden",
  "errors": {},
  "missing": ["tasks.assign"],
  "requestId": "6eac410efc74"
}
```

`missing` son las claves que `assert()` encontró ausentes, estructuradas. Están
también dentro del `detail` como texto, pero una pantalla que quiera ofrecer
"pedir acceso a esto" no debería tener que parsear una oración para sacarlas. No
expone nada nuevo, y no aparece en un 401 — ahí no hay sesión, así que no es una
clave lo que falta.

Le dice al cliente: no te molestes en reintentar. Mirá el rol, la concesión o la
política de tu resolutor.

## 500 — el código está mal

Dos casos, y los dos son errores de programación más que respuestas a quien
llama.

**Una clave que nadie declara:**

```
Unknown permission "tasks.assing": no installed module declares it.
Add it to that module's "permissions" in defineModule().
Did you mean: tasks.assign, tasks.manage, tasks.view?
```

Se comprueba **antes** del 401, deliberadamente: la primera petición en
desarrollo suele ser anónima, que es justo cuando querés enterarte de un typo. Si
esto contestara 403, te irías a mirar roles en vez de la ortografía.

**Ningún resolutor:**

```
This application resolves no actor: pass `auth` to Samble.create()
before reading this.auth.
```

La aplicación nunca cableó la autorización. Eso no es un visitante no
autorizado, así que no tiene que parecerlo.

---

# `assert` y `can`

Dos verbos, dos trabajos distintos.

```typescript
this.auth.assert('tasks.manage'); // corta la petición: 401 o 403
if (this.auth.can('tasks.assign')) {
  // ramifica: nunca lanza
}
```

Usá `assert` cuando la respuesta es "esto quizás no te corresponde". Usá `can`
cuando la respuesta cambia de forma en vez de negarse — una columna que no todos
ven, un total que sólo recibe un encargado, una acción que la respuesta anuncia o
no.

```typescript
public async main() {
  this.auth.assert('tasks.view');

  const tasks = await this.repo.find();

  return tasks.map((task) => ({
    id: task.id,
    title: task.title,
    // Sólo quien podría actuar sobre ella necesita saber quién la tiene.
    assignee: this.auth.can('tasks.assign') ? task.assignee : undefined,
  }));
}
```

Las dos toman **varias claves y las exigen todas**:

```typescript
this.auth.assert('tasks.manage', 'tasks.assign'); // Y, no O
```

Para "alguna de estas", usá `can` dos veces — no hay `assertAny`, a propósito:
escribir el O lo deja visible en la revisión, que es donde una puerta permisiva
tiene que notarse.

```typescript
if (!this.auth.can('tasks.manage') && !this.auth.can('tasks.assign')) {
  throw new ForbiddenError('Esta tarea no es tuya.');
}
```

## El resto de `this.auth`

| | Qué da | Si es anónimo |
| --- | --- | --- |
| `this.auth.actor` | el actor | **lanza** 401 |
| `this.auth.optional` | el actor o `null` | `null` |
| `this.auth.isAuthenticated` | `boolean` | `false` |
| `this.auth.permissions` | las claves que tiene | `[]` |
| `this.auth.can(...)` | `boolean` | `false` |
| `this.auth.assert(...)` | nada | **lanza** 401 |

Que `actor` lance es el punto: leerlo y comprobar que existía eran dos pasos que
había que escribir juntos todas las veces, y olvidarse del segundo fallaba en
silencio.

---

# `*`

Un resolutor puede devolver `['*']`, que tiene todos los permisos — los de ahora
y los que vengan. Es lo que suele significar "owner".

```typescript
owner: ['*'],
```

Siempre es una clave válida para preguntar, aunque ningún módulo la declare, y
nunca dispara la comprobación de clave desconocida. Dos consecuencias que
conviene saber:

- Un módulo instalado el mes que viene le sirve al owner de inmediato, sin tocar
  el rol.
- Con un owner nunca vas a poder probar que una puerta funciona. Probá con el rol
  que debería ser rechazado.

---

# Tipar el actor

samble declara `Actor` vacío. Ampliálo **una vez**, en cualquier parte de tu
aplicación, y todos los endpoints lo ven:

```typescript
declare global {
  namespace SambleAuth {
    interface Actor {
      userId: number;
      tenantId: string;
    }
  }
}
```

Desde ahí `this.auth.actor.tenantId` está tipado, y un resolutor que se olvide de
devolverlo no compila.

Es un espacio de nombres global y no una interfaz exportada porque una interfaz
re-exportada desde el paquete no se puede fusionar desde afuera — esta es la
única forma que un consumidor puede ampliar de verdad.

---

# Recetas

## Un endpoint público dentro de un módulo gateado

No hagas nada. Sin `assert`, sin decorador:

```typescript
@HttpGet('public-board')
export default class PublicBoardEndpoint extends Endpoint {
  public async main() {
    return this.repo.findBy({ isPublic: true });
  }
}
```

## Con sesión, pero sin un permiso en particular

```typescript
public async main() {
  const userId = this.auth.actor.userId;   // 401 si es anónimo, y nada más
  return this.repo.findBy({ createdBy: userId });
}
```

## Lo tuyo, o lo de cualquiera si tenés el permiso

```typescript
public async main() {
  const task = await this.repo.findOneBy({ id: this.params.id });
  if (!task) throw new NotFoundError('Tarea no encontrada');

  const mine = task.createdBy === this.auth.actor.userId;
  if (!mine && !this.auth.can('tasks.manage')) {
    throw new ForbiddenError('Esta tarea no es tuya.');
  }

  return task;
}
```

## Atender a anónimos y a quienes tienen sesión

```typescript
public async main() {
  const actor = this.auth.optional;        // null en vez de lanzar
  return actor
    ? this.repo.findBy({ createdBy: actor.userId })
    : this.repo.findBy({ isPublic: true });
}
```

## Todo lo que declara un módulo

Un conjunto se expande en sus claves, que es la concesión "este rol es dueño de
este módulo" sin listarlas una por una — y sin `*`, que además entregaría todos
los demás módulos:

```typescript
import { permissions as tasks } from '../modules/tasks/permissions';
import { permissions as billing } from '../modules/billing/permissions';

manager: [...tasks, ...billing],
```

## La política en la base de datos en vez de una constante

Lo único que cambia es el resolutor. Nada más en la aplicación nota la
diferencia.

```typescript
const sessionAuth = defineAuth(async (request, { db }) => {
  const userId = request.session?.userId;
  if (!userId) return null;

  const rows = await db.query(
    `select p.key from user_roles ur
       join role_permissions p on p.role_id = ur.role_id
      where ur.user_id = $1`,
    [userId],
  );

  return { actor: { userId }, permissions: rows.map((row) => row.key) };
});
```

Para validar la pantalla de roles contra lo que de verdad existe, alimentala con
`app.permissions()` — la lista sale de los módulos, así que un módulo agregado
después aparece sin editar un archivo central.

---

# Dónde no existe `this.auth`

Sólo un `Endpoint` lo tiene, porque sólo una petición tiene un actor detrás.

- **Una rutina programada** corre porque lo dijo el reloj. Nadie la pidió, así que
  no hay nada que autorizar. Si actúa en nombre de alguien, eso tiene que ser un
  dato que lee, no un actor ambiental.
- **Una reacción** (`Reaction<T>`) corre porque otro módulo anunció algo. Si el
  actor importa, lo lleva la carga — `RestockPayload` en la demo lleva `userId`
  exactamente por esto.
- **El resolutor mismo**, obviamente, no puede usarlo.

---

# Reglas para las claves

- Tienen que empezar con el id del módulo y seguir con al menos un segmento más
  separado por punto: `tasks.view`, `tasks.board.export`. El manifiesto rechaza
  una clave que no lo haga, así que el prefijo no es una convención que se pueda
  olvidar.
- Minúsculas, dígitos y guiones: `customer-portal.view` está bien, `Tasks.View`
  no.
- Sin duplicados dentro de un mismo módulo.
- Todo esto se comprueba cuando se importa el manifiesto, así que una clave mala
  es una negativa a arrancar y no una sorpresa más tarde.

Una convención útil, no una regla: `<módulo>.<cosa>.<acción>` cuando un módulo
gatea más de un par de cosas — `catalog.products.view`,
`catalog.products.manage`. La sugerencia ante un typo lista las claves que
comparten el primer segmento, así que un espacio de nombres consistente vuelve
útil el mensaje de error.

---

# Cuando algo no anda

| Síntoma | Causa |
| --- | --- |
| 500 `resolves no actor` | No hay `auth` en `Samble.create()`, y algo leyó `this.auth`. |
| 500 `Unknown permission` | La clave no está en ningún manifiesto — casi siempre un typo, a veces una clave escrita en el endpoint y nunca declarada. |
| 403 para todos, siempre | El resolutor devuelve `permissions: []`, o el mapa de roles no tiene entrada para ese rol (`undefined` llega a la comprobación como vacío). |
| 401 con sesión iniciada | El resolutor devolvió `null`: la sesión no tiene `userId`, o la fila del usuario ya no está. |
| Pasa todo, no se gatea nada | Sigue ahí el resolutor del andamiaje en `src/config/auth.ts`: le da `*` a todo el mundo. Avisa una vez en el log la primera vez que lo hace. |
| Desapareció una clave de la pantalla de roles | Estás listando desde otro lado que no es `app.permissions()`. Esa lista sale de los manifiestos. |
| Funciona para el owner y para nadie más | `*` tiene todo. Probá con un rol que debería ser rechazado. |
