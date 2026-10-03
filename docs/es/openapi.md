# Swagger y OpenAPI

La especificación sale de **los mismos decoradores que montan las rutas**. No hay
un archivo `.yaml` que mantener al lado, ni anotaciones que repitan lo que el
código ya dice, ni un paso de compilación: si el endpoint existe y valida un
`@Body`, ya está documentado.

Lo que esa decisión te compra es que la documentación no puede quedar vieja. Lo
que te cuesta es que la especificación sólo sabe lo que los decoradores dicen —
y esta página es, sobre todo, sobre esa segunda mitad.

| | |
| --- | --- |
| [1. Encenderlo](#1-encenderlo) | la opción, y lo que monta |
| [2. Qué sale solo](#2-qué-sale-solo) | de decorador a especificación |
| [3. Cómo se arma cada URL](#3-cómo-se-arma-cada-url) | `basePath` + grupo + ruta |
| [4. Los DTO](#4-los-dto) | `components.schemas`, y sus dos trampas |
| [5. Los cinco decoradores](#5-los-cinco-decoradores) | pulir la salida |
| [6. Lo que la especificación no sabe](#6-lo-que-la-especificación-no-sabe) | los huecos, uno por uno |
| [7. Documentar los errores](#7-documentar-los-errores) | un DTO reusable |
| [8. Cuándo se construye](#8-cuándo-se-construye) | y qué implica |
| [9. Poner `/docs` detrás de una puerta](#9-poner-docs-detrás-de-una-puerta) | o sacarlo |
| [10. Usar el JSON](#10-usar-el-json) | clientes, y vigilar la superficie |

---

## 1. Encenderlo

```typescript
const app = await Samble.create({
  // ...
  docs: {
    path: '/docs',
    info: {
      title: 'My API',
      version: '1.0.0',
      description: 'Markdown opcional, se ve arriba de todo en la interfaz',
    },
  },
});
```

| | |
| --- | --- |
| `GET /docs` | la interfaz de Swagger UI |
| `GET /docs.json` | el documento OpenAPI 3.0.3 crudo |

- **`path` es opcional** y su valor por defecto es `/docs`. El JSON siempre
  cuelga de ahí con `.json` pegado: `path: '/api-docs'` da `/api-docs.json`.
- **`info` también es opcional.** Sin él, el documento se describe como
  `title: 'API'`, `version: '1.0.0'`.
- **Sin la opción `docs` no se expone nada.** No hay una segunda forma de
  encenderlo — es una opción de la aplicación, decidida donde se deciden todas
  las demás. `samble init` la deja encendida.
- **Se monta antes que los routers de los módulos**, así que un módulo que sirva
  un prefijo parecido no lo puede tapar.

Al arrancar queda dicho en la línea de resumen del log:

```
[INFO] Serving on :5050 - 11 routes, docs at /docs (1.4s)
```

La especificación cruda se sirve al lado, en `/docs.json` — el mismo camino con
`.json`.

> Encendido publica **la forma completa de tu API** a cualquiera que encuentre
> la URL: rutas, cuerpos, campos obligatorios y enums. Ver
> [§9](#9-poner-docs-detrás-de-una-puerta).

## 2. Qué sale solo

| De dónde | Qué aparece en la especificación |
| --- | --- |
| `@Group(name)`, o el id del módulo si no hay decorador | la ruta, y la etiqueta por defecto |
| `@HttpGet` `@HttpPost` `@HttpPut` `@HttpPatch` `@HttpDelete` | el método de la operación |
| `@Body(Dto)` | `requestBody` de `application/json`, como `$ref` a un esquema reusable |
| `@Params(Dto)` | parámetros de ruta tipados, **siempre obligatorios** |
| `@Query(Dto)` | parámetros de query tipados; lo obligatorio lo decide `@IsOptional` |
| `:foo` en la ruta sin `@Params` | se infiere como parámetro de ruta `string` |
| nada | una respuesta `200 OK` sin cuerpo descrito |

Y lo que **no** aparece:

| De dónde | Por qué |
| --- | --- |
| `@ApiHidden()` | pedido explícito: se monta y contesta, pero queda fuera del documento |
| `@HttpQuery` | OpenAPI 3 no define `QUERY` como operación; incluirla haría inválido el documento |

La inferencia de `:foo` está porque OpenAPI **exige** que cada `{placeholder}`
de una ruta tenga su parámetro declarado: sin eso el documento no valida. Si no
escribiste un `@Params`, samble lo completa como `string` en vez de emitir algo
roto.

## 3. Cómo se arma cada URL

La ruta del documento es la ruta real, compuesta igual que al montar:

```
basePath del grupo  +  grupo  +  ruta del decorador
```

| En el código | En la especificación |
| --- | --- |
| módulo `catalog`, `@HttpGet(':id')` | `/api/catalog/{id}` |
| `@Group('products')` + `@HttpGet(':id')` | `/api/products/{id}` |
| `@Group('products', { mount: '/' })` | `/products/{id}` |
| `@Group('checkout', { mount: '/shop' })` | `/shop/checkout` |

Los `:param` de Express se traducen a `{param}` de OpenAPI, que es la única
diferencia de notación entre lo que escribís y lo que se publica.

**La etiqueta** —lo que agrupa los endpoints en la interfaz— es el grupo, salvo
que un `@ApiTag` diga otra cosa. Las etiquetas se juntan, se ordenan alfabética
y se listan arriba del documento, así que dos módulos que comparten grupo
aparecen juntos.

## 4. Los DTO

Los DTO se convierten a JSON Schema con
[`class-validator-jsonschema`](https://github.com/epiphone/class-validator-jsonschema).
Lo que ya validás queda documentado sin configurar nada: `@IsString`, `@IsInt`,
`@IsEnum`, `@IsUUID`, `@IsOptional`, `@MinLength`, `@Min`/`@Max` y compañía se
mapean a su equivalente.

```typescript
class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsOptional()
  @IsString()
  nickname?: string;
}
```

```json
{
  "type": "object",
  "properties": {
    "email": { "type": "string", "format": "email" },
    "password": { "type": "string", "minLength": 8 },
    "nickname": { "type": "string" }
  },
  "required": ["email", "password"]
}
```

Cada DTO queda en `components.schemas` con **el nombre de su clase**, y el
endpoint lo referencia con un `$ref`. De ahí salen las dos trampas de esta
página.

### Trampa 1: entran todos los DTO, no sólo los usados

El generador no recorre tus endpoints buscando DTO: lee el almacén global de
metadata de `class-validator`, donde quedó **todo lo que se importó** al momento
de construir el documento.

Consecuencia: un DTO que ninguna ruta usa igual aparece en `components.schemas`.
No rompe nada —el documento sigue siendo válido y la interfaz no lo muestra si
nadie lo referencia— pero si generás un cliente desde el JSON, vas a ver tipos
que no corresponden a ninguna operación.

### Trampa 2: dos clases con el mismo nombre se fusionan

Como la clave es el nombre de la clase, dos DTO llamados igual en dos módulos
distintos **no se pisan: se mezclan**. Con `CreateUserDto` en `identity` y otro
`CreateUserDto` en `billing`, el esquema que queda tiene las propiedades de los
dos, y los campos obligatorios de los dos:

```json
{
  "type": "object",
  "properties": { "campoA": { "type": "string" }, "campoB": { "type": "integer" } },
  "required": ["campoA", "campoB"]
}
```

Los dos endpoints apuntan a ese mismo `$ref`, así que la interfaz pide campos
que ninguno de los dos acepta. Nada falla al arrancar y la validación real sigue
siendo correcta — lo único equivocado es la documentación, que es justo lo que
nadie prueba.

**Qué hacer:** que el nombre de la clase sea único en toda la aplicación. En un
framework de módulos instalables, donde el módulo de al lado lo escribió otra
persona, eso quiere decir prefijarlo:

```typescript
class BillingCreateInvoiceDto {}  // no CreateInvoiceDto
class IdentityCreateUserDto {}    // no CreateUserDto
```

## 5. Los cinco decoradores

Son opcionales: sin ninguno ya tenés un documento válido. Sirven para lo que los
decoradores de ruteo no pueden saber.

| Decorador | Para qué |
| --- | --- |
| `@ApiTag(...names)` | Agrupa el endpoint bajo una o más etiquetas. **Reemplaza** la etiqueta por defecto, no se suma a ella. |
| `@ApiSummary(text)` | Una línea, que es el título del endpoint en la lista. |
| `@ApiDescription(text)` | El texto largo, con Markdown. |
| `@ApiResponse(status, { description?, Schema? })` | Un código de estado y la forma de su cuerpo. Se apilan. |
| `@ApiHidden()` | Lo monta y lo deja fuera del documento. |

```typescript
@Group('users')
@HttpPost()
@Body(IdentityCreateUserDto)
@ApiSummary('Create a user')
@ApiDescription('Creates a new user. The email must be unique.')
@ApiResponse(201, { description: 'Created', Schema: UserDto })
@ApiResponse(409, { description: 'Email already in use', Schema: ProblemDto })
export default class CreateUser extends Endpoint<null, IdentityCreateUserDto> {
  httpStatus = HttpStatus.CREATED;

  async main() {
    // ...
  }
}
```

### El `200` por defecto desaparece apenas declarás uno

Es el detalle que más sorprende: mientras no haya ningún `@ApiResponse`, el
endpoint se documenta con un `200 OK`. En cuanto ponés **uno**, esa respuesta
por defecto ya no se agrega.

```typescript
@ApiResponse(404, { description: 'Not found' })
// El documento ahora dice que este endpoint sólo contesta 404.
```

No es un bug, es el precio de una regla simple: si empezaste a describir las
respuestas, las describís vos. Declará siempre la buena junto con las malas.

### `@ApiHidden` no es seguridad

Saca la ruta del documento, nada más. Sigue montada, sigue contestando y sigue
sujeta a la misma autenticación y a los mismos permisos que tendría sin el
decorador. Es para lo que la especificación no puede describir honestamente —una
página renderizada con `view()`, un webhook de un proveedor, una ruta interna—,
no para esconder algo que no debería ser alcanzable.

## 6. Lo que la especificación no sabe

Todo lo de esta sección es real y conocido. Está acá junto para que no lo
descubras en una demo.

| Hueco | Qué pasa | Qué hacer |
| --- | --- | --- |
| **El estado que contestás** | El documento dice `200` salvo que declares otro; `this.httpStatus = 201` no lo cambia. Son dos caminos independientes | un `@ApiResponse(201, ...)` al lado de cada `httpStatus` que no sea 200 |
| **Los errores** | Ni un 401, ni un 403, ni un 404, ni el `422` de validación aparecen solos | [§7](#7-documentar-los-errores) |
| **La autenticación** | No se emiten `securitySchemes`, así que la interfaz no tiene botón **Authorize** y cada operación se muestra como si fuera pública | describirla en `info.description`, en prosa |
| **`multipart/form-data`** | Una subida de archivos no se genera sola: sólo se documentan cuerpos `application/json` | `@ApiDescription` explicando los campos |
| **La forma de la respuesta buena** | Lo que devuelve `main()` no está tipado en ningún decorador, así que sin `@ApiResponse(..., { Schema })` el `200` no describe cuerpo | un DTO de respuesta y `@ApiResponse(200, { Schema })` |
| **`QUERY`** | Un `@HttpQuery` se monta pero no se documenta | nada: OpenAPI 3 no lo soporta |

Sobre el botón **Authorize**: como no hay `securitySchemes`, "Try it out"
manda la petición sin nada que vos puedas escribir en la interfaz. Si tu
autenticación va por cookie de sesión y ya iniciaste sesión en ese mismo origen,
el navegador puede mandarla igual; si va por cabecera —un `Authorization:
Bearer …`— no hay dónde ponerla, y la prueba desde la interfaz va a contestar
401.

## 7. Documentar los errores

samble contesta los errores con un cuerpo con forma de
[RFC 9457](./guide.md#fallos) (`problem+json`), el mismo para todos. El
generador no lo conoce, así que la forma de documentarlo es escribirlo una vez
como DTO y referenciarlo desde donde haga falta:

```typescript
// shared/dtos/problem.dto.ts
export class ProblemDto {
  @IsString()
  type: string;

  @IsString()
  title: string;

  @IsInt()
  status: number;

  @IsString()
  detail: string;

  @IsString()
  code: string;

  /** Un mensaje por campo que falló. Vacío cuando el problema no es un campo. */
  @IsObject()
  errors: Record<string, string>;

  /** El mismo id que viaja en la cabecera `x-request-id`. */
  @IsOptional()
  @IsString()
  requestId?: string;

  /** Sólo en un 403 de `this.auth.assert(...)`: las claves que faltaban. */
  @IsOptional()
  @IsString({ each: true })
  missing?: string[];
}
```

```typescript
@ApiResponse(200, { description: 'OK', Schema: UserDto })
@ApiResponse(401, { description: 'Sin sesión', Schema: ProblemDto })
@ApiResponse(403, { description: 'Falta un permiso', Schema: ProblemDto })
@ApiResponse(422, { description: 'El cuerpo no valida', Schema: ProblemDto })
```

Dos cosas que conviene tener claras:

- **Los decoradores de `class-validator` acá son sólo para el esquema.** Nada
  valida las respuestas; están porque son la forma en que este DTO se convierte
  en JSON Schema.
- **Es prosa, no verdad garantizada.** Un `@ApiResponse(403)` no hace que el
  endpoint conteste 403, y quitarlo no se lo impide. A diferencia de las rutas y
  los cuerpos, esta parte del documento sí se puede quedar vieja: es lo único de
  acá que hay que mantener a mano.

## 8. Cuándo se construye

**Una vez, dentro de `start()`**, no por petición. Se arma con los endpoints de
los módulos que quedaron montados, y se guarda en memoria.

De ahí salen tres cosas:

- **Se arma una sola vez, al arrancar.** Agregar un endpoint cambia la
  documentación y eso pide reiniciar: no hay forma de regenerar el documento con
  la aplicación arriba.
- **El JSON es el mismo objeto en cada petición a `/docs.json`**, así que pedirlo
  es barato.
- **No hay un comando que lo emita.** Para tener el JSON en un archivo hay que
  levantar la aplicación y pedírselo.

## 9. Poner `/docs` detrás de una puerta

No hay una opción para esto, a propósito: quién puede ver la documentación es
una decisión de tu aplicación, y samble no tiene una noción de "administrador"
que pueda asumir. Las tres formas, de menor a mayor esfuerzo:

**Sacarlo donde no lo querés.** Es una opción como cualquier otra, así que puede
depender del entorno:

```typescript
const config = new ConfigService();

const app = await Samble.create({
  // ...
  docs:
    config.mode() === 'production'
      ? undefined
      : { path: '/docs', info: { title: 'My API', version } },
});
```

**Taparlo con un middleware**, antes de `start()`. Lo que se registre primero
corre primero, y la interfaz se monta recién al arrancar:

```typescript
const app = await Samble.create({ ...options, docs: { path: '/docs' } });

app.getApp().use('/docs', (req, res, next) => {
  if (req.headers['x-docs-key'] === process.env.DOCS_KEY) return next();
  res.status(404).end(); // 404 y no 401: no anuncia que hay algo ahí
});

await app.start(3000);
```

Ojo con cubrir **las dos** URLs: `/docs` y `/docs.json` son rutas distintas, y
el JSON es el que tiene todo. Un `use('/docs', …)` de Express cubre `/docs` y lo
que cuelgue de él, pero **no** `/docs.json`, que es un hermano. Registrá la
puerta para los dos.

**Dejarlo afuera del borde**, en tu proxy o tu ingress, que es lo que hace que
ni siquiera llegue al proceso.

## 10. Usar el JSON

`/docs.json` es un documento OpenAPI 3.0.3 común, así que sirve para lo de
siempre: generar un cliente tipado, cargarlo en un cliente HTTP, o dárselo a
alguien que consume la API sin darle acceso al código.

Un uso menos obvio y bastante barato: **vigilar la superficie pública**. Levantás
la aplicación en CI, guardás el JSON y lo comparás con el de la rama principal.
Un endpoint que aparece, un campo que se vuelve obligatorio o una ruta que
cambió de lugar dejan de ser cosas que alguien nota en la revisión.

```bash
node dist/index.js &
curl -s localhost:3000/docs.json > openapi.json
```

Como el documento sale de los decoradores, ese diff es exactamente el cambio de
contrato: no puede mostrar algo que el código no hace, ni ocultar algo que sí.

---

Seguir leyendo: [la guía](./guide.md#swagger--openapi) para la versión corta,
[Autorización](./authorization.md) para lo que la interfaz no muestra, y
[la API](./api.md#8-logs-health-cors-docs) para las firmas.
