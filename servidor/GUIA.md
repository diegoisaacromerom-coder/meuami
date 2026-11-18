# Cómo montar el servidor del inventario

Todo se hace a clics en el tablero de Cloudflare. No hace falta terminal ni
saber programar. Son unos veinte minutos.

Cuesta cero: el plan gratuito de Workers y de D1 cubre de sobra este tamaño.

---

## 1. Crear la cuenta de Cloudflare

Entra a `dash.cloudflare.com/sign-up` y date de alta.

**Usa un correo de la subcomisión, no el personal.** Si la cuenta cuelga del
correo de una sola persona, el inventario de la subcomisión depende de esa
persona. Ese mismo correo sirve para las solicitudes del informe completo.

No hace falta mover el dominio a Cloudflare. `meuami.org` se queda en Porkbun
y el sitio sigue en GitHub Pages, igual que hoy.

## 2. Crear la base de datos

En el menú de la izquierda: **Storage & Databases → D1 SQL Database →
Create**.

Nómbrala exactamente `inventario` y créala.

## 3. Poner las tablas

Dentro de la base, pestaña **Console**. Abre el archivo `esquema.sql` de esta
misma carpeta, copia todo su contenido, pégalo y ejecútalo.

Debe decir que se crearon tres tablas: `bienes`, `bitacora` y `consecutivos`.
Volver a ejecutarlo no rompe nada, por si quedaste con la duda.

## 4. Crear el servidor

En el menú: **Compute (Workers) → Workers & Pages → Create → Start with
Hello World → Deploy**.

Nómbralo `inventario-meuami`. Se publica un ejemplo; lo sustituimos enseguida.

Entra a **Edit code**, borra todo lo que trae y pega el contenido completo de
`src/index.js` de esta carpeta. Guarda y publica.

## 5. Enlazar el servidor con la base

En el Worker: **Settings → Bindings → Add → D1 database**.

- Variable name: `DB` (así, en mayúsculas; el código la busca por ese nombre)
- D1 database: `inventario`

Guarda y vuelve a publicar.

## 6. Poner la clave de escritura

Es la que permite registrar y leer los datos completos. Sin ella, el servidor
solo entrega el catálogo público.

En el Worker: **Settings → Variables and Secrets → Add**.

- Tipo: **Secret** (no "Text": un secreto no se puede volver a leer desde el
  tablero, que es justo lo que queremos)
- Nombre: `CLAVE_ESCRITURA`
- Valor: una frase larga, de las que no se adivinan. Algo como cuatro o cinco
  palabras sin relación entre sí. Anótala donde guardes las contraseñas.

Guarda y publica.

## 7. Comprobar que vive

Copia la dirección del Worker, que se ve así:

    https://inventario-meuami.TU-SUBDOMINIO.workers.dev

Ábrela en el navegador con `/api/salud` al final. Debe responder algo como:

    {"ok":true,"bienes":0,"ultimoCambio":null,"hora":"..."}

Si eso sale, está listo. Pásame la dirección y conecto las herramientas.

---

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
