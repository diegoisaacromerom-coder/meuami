# Cómo montar el servidor del inventario

## Camino corto, de unos 6 minutos

### 1. Crea la cuenta de Cloudflare

En `dash.cloudflare.com/sign-up`. No pide tarjeta.

Usa el correo que te quede más fácil; mudarlo después cuesta poco.

### 2. Aprieta este botón

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/diegoisaacromerom-coder/meuami/tree/main/servidor)

O pega esta dirección en el navegador:

    https://deploy.workers.cloudflare.com/?url=https://github.com/diegoisaacromerom-coder/meuami/tree/main/servidor

Cloudflare copia el servidor a tu cuenta de GitHub, **crea la base de datos D1
sola, la enlaza sola** y publica el servidor. Te va a pedir autorizar GitHub la
primera vez.

Esto hace de un jalón lo que antes eran cuatro pasos a mano: crear la base,
crear el Worker, pegar el código y enlazarlos.

### 3. Pon la clave de escritura

Es lo único que queda a mano, y no puede automatizarse: es el secreto que
separa a quien puede registrar de quien solo puede consultar.

En el Worker recién creado: **Settings → Variables and Secrets → Add**.

- Tipo: **Secret**, no "Text". Un secreto no se puede volver a leer desde el
  tablero, que es justo lo que queremos.
- Nombre: `CLAVE_ESCRITURA`
- Valor: una frase larga, cuatro o cinco palabras sin relación entre sí.
  Anótala donde guardes tus contraseñas.

Guarda y vuelve a publicar.

### 4. Comprueba y conéctalo

Abre la dirección del Worker con `/api/salud` al final:

    https://inventario-meuami.TU-SUBDOMINIO.workers.dev/api/salud

Debe responder algo así:

    {"ok":true,"bienes":0,"ultimoCambio":null,"hora":"..."}

Si eso sale, está listo. Ponla en la herramienta de registro, pestaña
**Respaldo → Servidor de la subcomisión**, junto con la clave, y aprieta
**Sincronizar**. Lo que hayas capturado en local sube solo, y los demás
teléfonos hacen lo mismo con la misma dirección y la misma clave.

**Las tablas se crean solas** la primera vez que alguien llama al servidor. No
hay que pegar ningún esquema en ninguna consola.

---

## Si el botón no funciona

Puede fallar si el repositorio dejara de ser público o si Cloudflare cambia el
flujo. El camino a mano, que es el de siempre:

1. **Storage & Databases → D1 SQL Database → Create**, nómbrala `inventario`.
2. **Compute (Workers) → Create → Start with Hello World → Deploy**, nómbralo
   `inventario-meuami`.
3. **Edit code**, borra todo y pega el contenido de `src/index.js`. Guarda y
   publica.
4. **Settings → Bindings → Add → D1 database**. Variable name: `DB`, así, en
   mayúsculas, que es como lo busca el código. Database: `inventario`.
5. El paso 3 de arriba: la clave de escritura.

El archivo `esquema.sql` queda como referencia de lo que el servidor crea solo.
No hace falta ejecutarlo.

## Lo que hace cada ruta

| Ruta | Quién entra | Para qué |
|---|---|---|
| `GET /api/salud` | cualquiera | Comprobar que el servidor responde |
| `GET /api/catalogo` | cualquiera | El catálogo público, sin datos de personas |
| `GET /api/bien?folio=X` | cualquiera | Consultar un folio, por ejemplo desde un QR |
| `GET /api/bienes` | con la clave | El registro completo |
| `POST /api/bienes` | con la clave | Dar de alta o modificar |
| `POST /api/folio` | con la clave | Apartar el siguiente folio de una unidad |
| `GET /api/bitacora` | con la clave | Quién tocó qué y cuándo |

Las rutas abiertas **nunca** devuelven quién prestó el bien, quién lo registró
ni las observaciones. Esas columnas existen en la base pero no salen por ahí.

## Más adelante: inicio de sesión de verdad

La clave de escritura es una sola, compartida por quienes capturan. Sirve bien
para dos o tres personas de confianza, pero no distingue quién es quién al
entrar, y si se filtra hay que cambiarla para todos.

Cuando haga falta identidad por persona, se pone **Cloudflare Access** encima:
es gratuito hasta cincuenta usuarios y pide correo y código a cada quien antes
de dejarlo pasar. No hay que programar nada; se configura en Zero Trust.

## Para trabajar en el código

```
npm install
cp .dev.vars.ejemplo .dev.vars     # la clave de pruebas
npm run esquema:local              # crea las tablas en una base local
npm run local                      # levanta el servidor en tu máquina
npm run prueba                     # 38 pruebas contra una base D1 de verdad
```

Nada de esto toca la base publicada.

## Respaldos

El plan gratuito de D1 guarda treinta días de historia y se puede volver a un
punto anterior. Aun así, conviene seguir descargando el respaldo cifrado desde
la herramienta de registro cada tanto: un respaldo que vive en otro lado es lo
único que protege de perder la cuenta, no solo los datos.
