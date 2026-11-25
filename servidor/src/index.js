/* Servidor de la Subcomisión de Inventariado y Auditoría Interna
 * Movimiento Estudiantil UAM-I · meuami.org
 *
 * Corre en Cloudflare Workers sobre una base D1. Dos clases de rutas:
 *
 *   Públicas   el catálogo y la consulta de un folio. Nunca devuelven quién
 *              prestó el bien, quién lo registró ni las observaciones.
 *   Protegidas todo lo demás. Exigen la clave, que vive en el servidor como
 *              secreto y jamás viaja dentro del sitio publicado.
 *
 * La comprobación de la clave ocurre aquí, en el servidor. Esa es la
 * diferencia con una contraseña escrita en una página: aquí quien no la trae
 * no recibe los datos, por más que modifique su navegador.
 */

// El esquema va aquí dentro para que la base se arme sola la primera vez que
// alguien llama al servidor. Antes había que pegarlo a mano en la consola del
// tablero, que era un paso más y un lugar más donde equivocarse.
const ESQUEMA = [
  "CREATE TABLE IF NOT EXISTS bienes ( folio TEXT PRIMARY KEY, unidad TEXT NOT NULL DEFAULT 'IZT', fecha TEXT NOT NULL, categoria TEXT NOT NULL DEFAULT '', procedencia TEXT NOT NULL DEFAULT '', descripcion TEXT NOT NULL DEFAULT '', marca TEXT NOT NULL DEFAULT '', inventario TEXT NOT NULL DEFAULT '', cantidad INTEGER NOT NULL DEFAULT 1, ubicacion TEXT NOT NULL DEFAULT '', estado TEXT NOT NULL DEFAULT 'Bueno', prestador TEXT NOT NULL DEFAULT '', responsable TEXT NOT NULL DEFAULT '', observaciones TEXT NOT NULL DEFAULT '', tiene_foto INTEGER NOT NULL DEFAULT 0, baja INTEGER NOT NULL DEFAULT 0, creado TEXT NOT NULL, actualizado TEXT NOT NULL, capturado_por TEXT NOT NULL DEFAULT '' )",
  "CREATE INDEX IF NOT EXISTS idx_bienes_unidad ON bienes (unidad, baja)",
  "CREATE INDEX IF NOT EXISTS idx_bienes_ubicacion ON bienes (ubicacion)",
  "CREATE INDEX IF NOT EXISTS idx_bienes_procedencia ON bienes (procedencia)",
  "CREATE INDEX IF NOT EXISTS idx_bienes_actualizado ON bienes (actualizado)",
  "CREATE TABLE IF NOT EXISTS bitacora ( id INTEGER PRIMARY KEY AUTOINCREMENT, cuando TEXT NOT NULL, folio TEXT NOT NULL, accion TEXT NOT NULL, quien TEXT NOT NULL DEFAULT '', detalle TEXT NOT NULL DEFAULT '' )",
  "CREATE INDEX IF NOT EXISTS idx_bitacora_folio ON bitacora (folio)",
  "CREATE INDEX IF NOT EXISTS idx_bitacora_cuando ON bitacora (cuando)",
  "CREATE TABLE IF NOT EXISTS consecutivos ( unidad TEXT PRIMARY KEY, ultimo INTEGER NOT NULL DEFAULT 0 )",
  "CREATE TABLE IF NOT EXISTS documentos ( id TEXT PRIMARY KEY, tipo TEXT NOT NULL DEFAULT '', etiqueta TEXT NOT NULL DEFAULT '', titulo TEXT NOT NULL DEFAULT '', resumen TEXT NOT NULL DEFAULT '', firmas TEXT NOT NULL DEFAULT '', nota TEXT NOT NULL DEFAULT '', archivo TEXT NOT NULL DEFAULT '', peso TEXT NOT NULL DEFAULT '', fecha TEXT NOT NULL DEFAULT '', orden INTEGER NOT NULL DEFAULT 0, publicado INTEGER NOT NULL DEFAULT 1, creado TEXT NOT NULL, actualizado TEXT NOT NULL )",
  "CREATE INDEX IF NOT EXISTS idx_documentos_lista ON documentos (publicado, orden, fecha)",
  "CREATE TABLE IF NOT EXISTS personas ( usuario TEXT PRIMARY KEY, sal TEXT NOT NULL, verificador TEXT NOT NULL, totp TEXT NOT NULL, eje TEXT NOT NULL DEFAULT '2', activa INTEGER NOT NULL DEFAULT 1, estrenada INTEGER NOT NULL DEFAULT 0, creada TEXT NOT NULL )",
  "CREATE TABLE IF NOT EXISTS sesiones ( ficha TEXT PRIMARY KEY, usuario TEXT NOT NULL, creada TEXT NOT NULL, expira TEXT NOT NULL )",
  "CREATE INDEX IF NOT EXISTS idx_sesiones_expira ON sesiones (expira)",
  "CREATE TABLE IF NOT EXISTS notas ( id TEXT PRIMARY KEY, eje TEXT NOT NULL DEFAULT '2', punto TEXT NOT NULL, campo TEXT NOT NULL, alias TEXT NOT NULL DEFAULT '', vector TEXT NOT NULL, datos TEXT NOT NULL, actualizado TEXT NOT NULL )",
  "CREATE INDEX IF NOT EXISTS idx_notas_eje ON notas (eje, punto, campo)",
  "CREATE TABLE IF NOT EXISTS intentos ( quien TEXT PRIMARY KEY, cuantos INTEGER NOT NULL DEFAULT 0, hasta TEXT NOT NULL )"
];
let baseLista = false;
async function prepararBase(env){
  if(baseLista) return;
  await env.DB.batch(ESQUEMA.map(q => env.DB.prepare(q)));
  baseLista = true;
}

const ORIGENES = [
  "https://meuami.org",
  "https://www.meuami.org"
];

/* ---------- Utilidades ---------- */

function origenPermitido(pet) {
  const o = pet.headers.get("Origin");
  if (!o) return null;
  if (ORIGENES.includes(o)) return o;
  // En desarrollo se trabaja contra un servidor local.
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)) return o;
  return null;
}

function cabeceras(pet, extra) {
  const h = {"Content-Type": "application/json; charset=utf-8", ...extra};
  const o = origenPermitido(pet);
  if (o) {
    h["Access-Control-Allow-Origin"] = o;
    h["Vary"] = "Origin";
  }
  return h;
}

const responde = (pet, cuerpo, estado, extra) =>
  new Response(JSON.stringify(cuerpo), {status: estado || 200, headers: cabeceras(pet, extra)});

const falla = (pet, estado, mensaje) => responde(pet, {error: mensaje}, estado);

// Comparación en tiempo constante: no revela por cuántos caracteres se acertó.
function mismaClave(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

function autorizado(pet, env) {
  const clave = env.CLAVE_ESCRITURA;
  if (!clave) return false;                       // sin secreto configurado, nada pasa
  const trae = pet.headers.get("Authorization") || "";
  const m = trae.match(/^Bearer\s+(.+)$/);
  return !!m && mismaClave(m[1], clave);
}

const texto = (v, tope) => String(v == null ? "" : v).trim().slice(0, tope || 200);
const entero = (v, pordefecto) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1000000) : pordefecto;
};
const ahora = () => new Date().toISOString();

// Columnas que sí puede ver cualquiera.
const PUBLICAS = "folio, unidad, fecha, categoria, procedencia, descripcion, marca, " +
                 "inventario, cantidad, ubicacion, estado, actualizado";

/* ---------- Rutas públicas ---------- */

async function catalogo(pet, env) {
  const u = new URL(pet.url);
  const unidad = texto(u.searchParams.get("unidad"), 8).toUpperCase();
  const desde = texto(u.searchParams.get("desde"), 40);

  let sql = "SELECT " + PUBLICAS + " FROM bienes WHERE baja = 0";
  const args = [];
  if (unidad) { sql += " AND unidad = ?"; args.push(unidad); }
  if (desde)  { sql += " AND actualizado > ?"; args.push(desde); }
  sql += " ORDER BY folio";

  const {results} = await env.DB.prepare(sql).bind(...args).all();
  return responde(pet, {
    version: 1,
    publicado: ahora(),
    unidad: unidad || "todas",
    nota: "Catálogo público de la Subcomisión de Inventariado y Auditoría Interna. " +
          "No incluye quién prestó cada bien, quién lo registró ni las observaciones.",
    bienes: results
  }, 200, {"Cache-Control": "public, max-age=60"});
}

async function unBien(pet, env) {
  const folio = texto(new URL(pet.url).searchParams.get("folio"), 40);
  if (!folio) return falla(pet, 400, "Hace falta el folio.");
  const fila = await env.DB.prepare(
    "SELECT " + PUBLICAS + ", baja FROM bienes WHERE folio = ?").bind(folio).first();
  if (!fila) return falla(pet, 404, "Ese folio no está registrado.");
  return responde(pet, {bien: fila}, 200, {"Cache-Control": "public, max-age=60"});
}

async function salud(pet, env) {
  const f = await env.DB.prepare(
    "SELECT count(*) AS bienes, max(actualizado) AS ultimo FROM bienes WHERE baja = 0").first();
  return responde(pet, {ok: true, bienes: f.bienes, ultimoCambio: f.ultimo, hora: ahora()});
}

/* ---------- Rutas protegidas ---------- */

async function todosLosBienes(pet, env) {
  const desde = texto(new URL(pet.url).searchParams.get("desde"), 40);
  const sql = "SELECT * FROM bienes" + (desde ? " WHERE actualizado > ?" : "") + " ORDER BY folio";
  const {results} = await env.DB.prepare(sql).bind(...(desde ? [desde] : [])).all();
  return responde(pet, {bienes: results, cuando: ahora()});
}

async function guardarBienes(pet, env) {
  let cuerpo;
  try { cuerpo = await pet.json(); }
  catch (e) { return falla(pet, 400, "El cuerpo de la petición no es JSON válido."); }

  const lista = Array.isArray(cuerpo) ? cuerpo : (cuerpo && cuerpo.bienes);
  if (!Array.isArray(lista)) return falla(pet, 400, "Se esperaba una lista de bienes.");
  if (lista.length > 500) return falla(pet, 413, "Máximo 500 bienes por envío.");

  const quien = texto(cuerpo && cuerpo.quien, 80);
  const momento = ahora();
  const sentencias = [];
  let altas = 0, cambios = 0;
  const rechazados = [];

  // Se consulta de una vez qué folios ya existen, para saber si es alta o cambio.
  const folios = lista.map(b => texto(b && b.folio, 40)).filter(f => f);
  const existentes = new Set();
  if (folios.length) {
    const marcas = folios.map(() => "?").join(",");
    const {results} = await env.DB.prepare(
      "SELECT folio FROM bienes WHERE folio IN (" + marcas + ")").bind(...folios).all();
    results.forEach(r => existentes.add(r.folio));
  }

  for (const b of lista) {
    const folio = texto(b && b.folio, 40);
    if (!/^[A-Z]{2,4}-[A-Z]{3}-\d{4}-\d{3,6}$/.test(folio)) {
      rechazados.push({folio: folio || "(vacío)", porque: "El folio no tiene la forma esperada."});
      continue;
    }
    const esAlta = !existentes.has(folio);
    const fila = {
      folio,
      unidad: texto(b.unidad, 8).toUpperCase() || folio.split("-")[1] || "IZT",
      fecha: texto(b.fecha, 40) || momento,
      categoria: texto(b.categoria, 80),
      procedencia: texto(b.procedencia, 80),
      descripcion: texto(b.descripcion, 300),
      marca: texto(b.marca, 120),
      inventario: texto(b.inventario, 60),
      cantidad: entero(b.cantidad, 1),
      ubicacion: texto(b.ubicacion, 160),
      estado: texto(b.estado, 40) || "Bueno",
      prestador: texto(b.prestador, 160),
      responsable: texto(b.responsable, 160),
      observaciones: texto(b.observaciones, 1000),
      tieneFoto: b.foto || b.tiene_foto ? 1 : 0,
      baja: b.baja ? 1 : 0
    };

    sentencias.push(env.DB.prepare(
      "INSERT INTO bienes (folio, unidad, fecha, categoria, procedencia, descripcion, marca, " +
      "inventario, cantidad, ubicacion, estado, prestador, responsable, observaciones, " +
      "tiene_foto, baja, creado, actualizado, capturado_por) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) " +
      "ON CONFLICT(folio) DO UPDATE SET " +
      "unidad=excluded.unidad, fecha=excluded.fecha, categoria=excluded.categoria, " +
      "procedencia=excluded.procedencia, descripcion=excluded.descripcion, marca=excluded.marca, " +
      "inventario=excluded.inventario, cantidad=excluded.cantidad, ubicacion=excluded.ubicacion, " +
      "estado=excluded.estado, prestador=excluded.prestador, responsable=excluded.responsable, " +
      "observaciones=excluded.observaciones, tiene_foto=excluded.tiene_foto, baja=excluded.baja, " +
      "actualizado=excluded.actualizado, capturado_por=excluded.capturado_por"
    ).bind(fila.folio, fila.unidad, fila.fecha, fila.categoria, fila.procedencia, fila.descripcion,
           fila.marca, fila.inventario, fila.cantidad, fila.ubicacion, fila.estado, fila.prestador,
           fila.responsable, fila.observaciones, fila.tieneFoto, fila.baja,
           momento, momento, quien));

    sentencias.push(env.DB.prepare(
      "INSERT INTO bitacora (cuando, folio, accion, quien, detalle) VALUES (?,?,?,?,?)"
    ).bind(momento, folio, fila.baja ? "baja" : (esAlta ? "alta" : "cambio"), quien,
           fila.descripcion));

    // El consecutivo de la unidad nunca debe quedar por debajo de lo ya usado.
    const n = parseInt(folio.split("-").pop(), 10);
    if (Number.isFinite(n)) {
      sentencias.push(env.DB.prepare(
        "INSERT INTO consecutivos (unidad, ultimo) VALUES (?, ?) " +
        "ON CONFLICT(unidad) DO UPDATE SET ultimo = max(ultimo, excluded.ultimo)"
      ).bind(fila.unidad, n));
    }
    if (esAlta) altas++; else cambios++;
  }

  if (sentencias.length) await env.DB.batch(sentencias);
  return responde(pet, {ok: true, altas, cambios, rechazados, cuando: momento});
}

async function apartarFolio(pet, env) {
  let cuerpo = {};
  try { cuerpo = await pet.json(); } catch (e) { /* se vale pedirlo sin cuerpo */ }
  const unidad = (texto(cuerpo.unidad, 8) || "IZT").toUpperCase();
  const [, fila] = await env.DB.batch([
    env.DB.prepare("INSERT INTO consecutivos (unidad, ultimo) VALUES (?, 0) ON CONFLICT(unidad) DO NOTHING").bind(unidad),
    env.DB.prepare("UPDATE consecutivos SET ultimo = ultimo + 1 WHERE unidad = ? RETURNING ultimo").bind(unidad)
  ]);
  const n = fila.results[0].ultimo;
  const anio = new Date().getFullYear();
  return responde(pet, {
    folio: "SIA-" + unidad + "-" + anio + "-" + String(n).padStart(4, "0"),
    consecutivo: n
  });
}

async function verBitacora(pet, env) {
  const u = new URL(pet.url);
  const folio = texto(u.searchParams.get("folio"), 40);
  const sql = "SELECT * FROM bitacora" + (folio ? " WHERE folio = ?" : "") +
              " ORDER BY id DESC LIMIT " + entero(u.searchParams.get("limite"), 200);
  const {results} = await env.DB.prepare(sql).bind(...(folio ? [folio] : [])).all();
  return responde(pet, {movimientos: results});
}

/* ---------- Documentos ---------- */

// Columnas que salen por la ruta abierta. No hay datos de personas aqui, pero
// se nombran una por una igual que en el catalogo: si manana se agrega una
// columna interna, no se escapa sola.
const DOC_PUBLICAS = "id, tipo, etiqueta, titulo, resumen, firmas, nota, archivo, peso, fecha";

function documentoAfuera(fila){
  var firmas = [];
  if (fila.firmas) {
    try { firmas = JSON.parse(fila.firmas); }
    catch (e) { firmas = []; }
    if (!Array.isArray(firmas)) firmas = [];
  }
  return {
    id: fila.id, tipo: fila.tipo, etiqueta: fila.etiqueta, titulo: fila.titulo,
    resumen: fila.resumen, nota: fila.nota, archivo: fila.archivo,
    peso: fila.peso, fecha: fila.fecha, firmas: firmas
  };
}

async function documentos(pet, env) {
  const {results} = await env.DB.prepare(
    "SELECT " + DOC_PUBLICAS + " FROM documentos WHERE publicado = 1 ORDER BY orden DESC, fecha DESC, titulo"
  ).all();
  return responde(pet, {documentos: results.map(documentoAfuera)});
}

async function todosLosDocumentos(pet, env) {
  const {results} = await env.DB.prepare(
    "SELECT * FROM documentos ORDER BY orden DESC, fecha DESC, titulo"
  ).all();
  return responde(pet, {documentos: results.map(function(f){
    const d = documentoAfuera(f);
    d.publicado = f.publicado === 1;
    d.orden = f.orden;
    d.actualizado = f.actualizado;
    return d;
  })});
}

async function guardarDocumentos(pet, env) {
  let cuerpo;
  try { cuerpo = await pet.json(); }
  catch (e) { return falla(pet, 400, "El cuerpo de la peticion no es JSON valido."); }

  const lista = Array.isArray(cuerpo) ? cuerpo : (cuerpo && cuerpo.documentos);
  if (!Array.isArray(lista)) return falla(pet, 400, "Se esperaba una lista de documentos.");
  if (lista.length > 200) return falla(pet, 413, "Demasiados documentos en una sola peticion.");

  const cuando = ahora();
  const quien = texto(pet.headers.get("X-Quien"), 60);
  const ordenes = [];
  let guardados = 0;

  for (const d of lista) {
    const id = texto(d && d.id, 80);
    const titulo = texto(d && d.titulo, 240);
    if (!id) return falla(pet, 400, "Cada documento necesita un id.");
    if (!titulo) return falla(pet, 400, "El documento " + id + " no trae titulo.");

    let firmas = "";
    if (Array.isArray(d.firmas) && d.firmas.length) {
      firmas = JSON.stringify(d.firmas.slice(0, 60).map(function(f){ return texto(f, 120); }));
    }

    ordenes.push(env.DB.prepare(
      "INSERT INTO documentos (id, tipo, etiqueta, titulo, resumen, firmas, nota, archivo, peso, fecha, orden, publicado, creado, actualizado) " +
      "VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?13) " +
      "ON CONFLICT(id) DO UPDATE SET tipo=?2, etiqueta=?3, titulo=?4, resumen=?5, firmas=?6, " +
      "nota=?7, archivo=?8, peso=?9, fecha=?10, orden=?11, publicado=?12, actualizado=?13"
    ).bind(
      id, texto(d.tipo, 60), texto(d.etiqueta, 160), titulo,
      texto(d.resumen, 4000), firmas, texto(d.nota, 1000),
      texto(d.archivo, 400), texto(d.peso, 40), texto(d.fecha, 30),
      entero(d.orden, 0), d.publicado === false ? 0 : 1, cuando
    ));
    ordenes.push(env.DB.prepare(
      "INSERT INTO bitacora (cuando, folio, accion, quien, detalle) VALUES (?1,?2,?3,?4,?5)"
    ).bind(cuando, "doc:" + id, "documento", quien, titulo));
    guardados++;
  }

  await env.DB.batch(ordenes);
  return responde(pet, {ok: true, guardados: guardados, cuando: cuando});
}

/* ---------- Archivos ---------- */

// R2 es opcional a proposito: si la cuenta no lo tiene activado el servidor
// sigue sirviendo, y los PDF se publican desde el repositorio como hasta hoy.
const TIPOS_ARCHIVO = {pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg",
                       png: "image/png", webp: "image/webp"};
const TOPE_ARCHIVO = 25 * 1024 * 1024;

function nombreLimpio(n) {
  return texto(n, 120).toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

async function subirArchivo(pet, env) {
  if (!env.ARCHIVOS) {
    return falla(pet, 501, "Este servidor no tiene almacen de archivos conectado. " +
                           "Publica el PDF en el repositorio y pon su direccion en el documento.");
  }
  const u = new URL(pet.url);
  const nombre = nombreLimpio(u.searchParams.get("nombre"));
  if (!nombre) return falla(pet, 400, "Hace falta el nombre del archivo.");

  const partes = nombre.split(".");
  const tipo = partes.length > 1 ? TIPOS_ARCHIVO[partes.pop()] : null;
  if (!tipo) return falla(pet, 415, "Solo se aceptan PDF e imagenes.");
  if (!partes.join(".")) return falla(pet, 400, "El archivo necesita un nombre, no solo la extension.");

  const datos = await pet.arrayBuffer();
  if (!datos.byteLength) return falla(pet, 400, "El archivo llego vacio.");
  if (datos.byteLength > TOPE_ARCHIVO) return falla(pet, 413, "El archivo pasa de 25 MB.");

  await env.ARCHIVOS.put(nombre, datos, {httpMetadata: {contentType: tipo}});
  const kb = datos.byteLength / 1024;
  return responde(pet, {
    ok: true, nombre: nombre, ruta: "/archivo/" + nombre,
    peso: kb >= 1024 ? ("PDF · " + (kb / 1024).toFixed(1) + " MB") : ("PDF · " + Math.round(kb) + " KB")
  });
}

async function verArchivo(pet, env, nombre) {
  if (!env.ARCHIVOS) return falla(pet, 404, "Aqui no hay archivos guardados.");
  const obj = await env.ARCHIVOS.get(nombre);
  if (!obj) return falla(pet, 404, "No existe ese archivo.");
  const h = new Headers();
  obj.writeHttpMetadata(h);
  h.set("etag", obj.httpEtag);
  h.set("Cache-Control", "public, max-age=3600");
  const o = origenPermitido(pet);
  if (o) { h.set("Access-Control-Allow-Origin", o); h.set("Vary", "Origin"); }
  return new Response(obj.body, {headers: h});
}

/* ---------- Sesión con segundo factor ----------

   El estirado de la contraseña (PBKDF2, 310 000 vueltas) ocurre en el
   navegador, no aquí. Un Worker del plan gratuito tiene del orden de 10 ms de
   CPU por petición y 310 000 vueltas no caben ni de lejos. El navegador deriva
   y manda el resultado; el servidor guarda SHA-256 de eso con una pimienta
   suya. Quien robe la base se lleva el hash de un valor ya estirado: para
   probar contraseñas sigue teniendo que pasar por las 310 000 vueltas de cada
   intento.

   La sal de cada persona es pública a propósito: el navegador la necesita
   antes de poder derivar. A quien no existe se le devuelve una sal falsa pero
   estable, deducida del nombre, para no delatar quién tiene cuenta. */

const VIDA_SESION = 12 * 60 * 60 * 1000;   // 12 horas
const TOPE_INTENTOS = 8;
const CASTIGO = 15 * 60 * 1000;

const cod = new TextEncoder();

function aHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(texto) {
  return aHex(await crypto.subtle.digest("SHA-256", cod.encode(texto)));
}

function alAzarHex(n) {
  return aHex(crypto.getRandomValues(new Uint8Array(n)));
}

// Sal falsa pero siempre la misma para un nombre dado, para que pedir la sal
// de una cuenta inexistente se vea igual que pedir la de una real.
async function salFingida(usuario, env) {
  return (await sha256Hex("sal-fingida:" + usuario + ":" + (env.CLAVE_ESCRITURA || ""))).slice(0, 32);
}

async function verificadorDe(derivada, sal, env) {
  return sha256Hex(derivada + ":" + sal + ":" + (env.PIMIENTA || env.CLAVE_ESCRITURA || ""));
}

/* ----- TOTP (RFC 6238): HMAC-SHA1, pasos de 30 s, 6 dígitos ----- */

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32aBytes(s) {
  const limpio = String(s).toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, valor = 0;
  const salida = [];
  for (const c of limpio) {
    valor = (valor << 5) | B32.indexOf(c);
    bits += 5;
    if (bits >= 8) { salida.push((valor >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return new Uint8Array(salida);
}

function bytesABase32(u) {
  let bits = 0, valor = 0, salida = "";
  for (const b of u) {
    valor = (valor << 8) | b; bits += 8;
    while (bits >= 5) { salida += B32[(valor >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) salida += B32[(valor << (5 - bits)) & 31];
  return salida;
}

async function codigoTOTP(secreto, paso) {
  const llave = await crypto.subtle.importKey("raw", base32aBytes(secreto),
    {name: "HMAC", hash: "SHA-1"}, false, ["sign"]);
  const buf = new ArrayBuffer(8);
  const vista = new DataView(buf);
  vista.setUint32(0, Math.floor(paso / 0x100000000));
  vista.setUint32(4, paso >>> 0);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", llave, buf));
  const desp = firma[firma.length - 1] & 0x0f;
  const n = ((firma[desp] & 0x7f) << 24) | (firma[desp+1] << 16) |
            (firma[desp+2] << 8) | firma[desp+3];
  return String(n % 1000000).padStart(6, "0");
}

// Se aceptan el paso actual y uno a cada lado: los relojes de los teléfonos
// no siempre coinciden con el del servidor.
async function totpValido(secreto, codigo, cuando) {
  const limpio = String(codigo || "").replace(/\D/g, "");
  if (limpio.length !== 6) return false;
  const paso = Math.floor((cuando || Date.now()) / 1000 / 30);
  for (const d of [-1, 0, 1]) {
    if (mismaClave(limpio, await codigoTOTP(secreto, paso + d))) return true;
  }
  return false;
}

/* ----- Freno a la fuerza bruta ----- */

async function frenado(env, quien) {
  const f = await env.DB.prepare("SELECT cuantos, hasta FROM intentos WHERE quien = ?1")
    .bind(quien).first();
  if (!f) return false;
  if (new Date(f.hasta) > new Date()) return f.cuantos >= TOPE_INTENTOS;
  await env.DB.prepare("DELETE FROM intentos WHERE quien = ?1").bind(quien).run();
  return false;
}

async function apuntarFallo(env, quien) {
  const hasta = new Date(Date.now() + CASTIGO).toISOString();
  await env.DB.prepare(
    "INSERT INTO intentos (quien, cuantos, hasta) VALUES (?1, 1, ?2) " +
    "ON CONFLICT(quien) DO UPDATE SET cuantos = cuantos + 1, hasta = ?2"
  ).bind(quien, hasta).run();
}

/* ----- Rutas de sesión ----- */

async function pedirSal(pet, env) {
  let cuerpo;
  try { cuerpo = await pet.json(); } catch (e) { return falla(pet, 400, "Cuerpo inválido."); }
  const usuario = texto(cuerpo && cuerpo.usuario, 60).toLowerCase();
  if (!usuario) return falla(pet, 400, "Falta el usuario.");
  const f = await env.DB.prepare("SELECT sal FROM personas WHERE usuario = ?1 AND activa = 1")
    .bind(usuario).first();
  return responde(pet, {sal: f ? f.sal : await salFingida(usuario, env), vueltas: 310000});
}

async function ingresar(pet, env) {
  let cuerpo;
  try { cuerpo = await pet.json(); } catch (e) { return falla(pet, 400, "Cuerpo inválido."); }
  const usuario = texto(cuerpo && cuerpo.usuario, 60).toLowerCase();
  const derivada = texto(cuerpo && cuerpo.derivada, 200);
  const codigo = texto(cuerpo && cuerpo.codigo, 10);
  if (!usuario || !derivada) return falla(pet, 400, "Faltan datos.");

  if (await frenado(env, usuario)) {
    return falla(pet, 429, "Demasiados intentos fallidos. Espera 15 minutos.");
  }

  const f = await env.DB.prepare(
    "SELECT usuario, sal, verificador, totp, estrenada FROM personas WHERE usuario = ?1 AND activa = 1"
  ).bind(usuario).first();

  // Mismo mensaje y mismo trabajo tanto si la persona no existe como si la
  // contraseña está mal: desde fuera no se distingue.
  const esperado = f ? f.verificador : await sha256Hex("nadie:" + usuario);
  const dado = await verificadorDe(derivada, f ? f.sal : await salFingida(usuario, env), env);
  if (!f || !mismaClave(dado, esperado)) {
    await apuntarFallo(env, usuario);
    return falla(pet, 401, "Usuario, contraseña o código incorrectos.");
  }

  if (!(await totpValido(f.totp, codigo))) {
    await apuntarFallo(env, usuario);
    return falla(pet, 401, "Usuario, contraseña o código incorrectos.");
  }

  await env.DB.prepare("DELETE FROM intentos WHERE quien = ?1").bind(usuario).run();
  const ficha = alAzarHex(32);
  const expira = new Date(Date.now() + VIDA_SESION).toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sesiones (ficha, usuario, creada, expira) VALUES (?1,?2,?3,?4)")
      .bind(ficha, usuario, ahora(), expira),
    env.DB.prepare("DELETE FROM sesiones WHERE expira < ?1").bind(ahora()),
    env.DB.prepare("UPDATE personas SET estrenada = 1 WHERE usuario = ?1").bind(usuario)
  ]);
  return responde(pet, {ficha, usuario, expira});
}

async function conSesion(pet, env) {
  const trae = pet.headers.get("X-Sesion") || "";
  if (!/^[0-9a-f]{64}$/.test(trae)) return null;
  const f = await env.DB.prepare(
    "SELECT usuario, expira FROM sesiones WHERE ficha = ?1"
  ).bind(trae).first();
  if (!f) return null;
  if (new Date(f.expira) <= new Date()) {
    await env.DB.prepare("DELETE FROM sesiones WHERE ficha = ?1").bind(trae).run();
    return null;
  }
  return f.usuario;
}

async function salir(pet, env) {
  const trae = pet.headers.get("X-Sesion") || "";
  if (/^[0-9a-f]{64}$/.test(trae)) {
    await env.DB.prepare("DELETE FROM sesiones WHERE ficha = ?1").bind(trae).run();
  }
  return responde(pet, {ok: true});
}

/* ----- Alta de personas (solo con la clave de escritura) ----- */

async function altaPersona(pet, env) {
  let cuerpo;
  try { cuerpo = await pet.json(); } catch (e) { return falla(pet, 400, "Cuerpo inválido."); }
  const usuario = texto(cuerpo && cuerpo.usuario, 60).toLowerCase();
  const derivada = texto(cuerpo && cuerpo.derivada, 200);
  const sal = texto(cuerpo && cuerpo.sal, 64);
  if (!/^[a-z0-9._-]{3,60}$/.test(usuario)) {
    return falla(pet, 400, "El usuario solo admite letras, números, punto, guion y guion bajo.");
  }
  if (!derivada || !/^[0-9a-f]{16,64}$/.test(sal)) return falla(pet, 400, "Faltan datos.");

  const secreto = bytesABase32(crypto.getRandomValues(new Uint8Array(20)));
  const verificador = await verificadorDe(derivada, sal, env);
  try {
    await env.DB.prepare(
      "INSERT INTO personas (usuario, sal, verificador, totp, eje, activa, estrenada, creada) " +
      "VALUES (?1,?2,?3,?4,?5,1,0,?6)"
    ).bind(usuario, sal, verificador, secreto, texto(cuerpo.eje, 8) || "2", ahora()).run();
  } catch (e) {
    return falla(pet, 409, "Ese usuario ya existe.");
  }
  const etiqueta = encodeURIComponent("Eje 2 UAM-I:" + usuario);
  return responde(pet, {
    ok: true, usuario,
    secreto,
    uri: "otpauth://totp/" + etiqueta + "?secret=" + secreto + "&issuer=" +
         encodeURIComponent("Movimiento Estudiantil UAM-I") + "&digits=6&period=30",
    aviso: "Este secreto se muestra una sola vez. Cárgalo ahora en la app de códigos."
  });
}

/* ---------- Notas del eje ----------

   El servidor guarda bytes que no puede leer. Las notas llegan ya cifradas
   desde el navegador con una llave del eje que nunca sale de ahí, y así se
   guardan. Quien tenga acceso a la base —o quien opere la nube— ve quién
   escribió, en qué punto y cuándo, pero no qué dice.

   El precio es real y hay que tenerlo claro: aquí no se puede buscar dentro
   de las notas, y si el eje pierde la llave, las notas no se recuperan. */

async function verNotas(pet, env) {
  const quien = await conSesion(pet, env);
  if (!quien) return falla(pet, 401, "Hace falta iniciar sesión.");
  const u = new URL(pet.url);
  const eje = texto(u.searchParams.get("eje"), 8) || "2";
  const {results} = await env.DB.prepare(
    "SELECT id, punto, campo, alias, vector, datos, actualizado FROM notas " +
    "WHERE eje = ?1 ORDER BY punto, campo, actualizado"
  ).bind(eje).all();
  return responde(pet, {notas: results, quien});
}

async function guardarNotas(pet, env) {
  const quien = await conSesion(pet, env);
  if (!quien) return falla(pet, 401, "Hace falta iniciar sesión.");
  let cuerpo;
  try { cuerpo = await pet.json(); } catch (e) { return falla(pet, 400, "Cuerpo inválido."); }
  const lista = Array.isArray(cuerpo) ? cuerpo : (cuerpo && cuerpo.notas);
  if (!Array.isArray(lista)) return falla(pet, 400, "Se esperaba una lista de notas.");
  if (lista.length > 200) return falla(pet, 413, "Demasiadas notas en una sola petición.");

  const cuando = ahora();
  const ordenes = [];
  for (const n of lista) {
    const id = texto(n && n.id, 80);
    const punto = texto(n && n.punto, 20);
    const campo = texto(n && n.campo, 40);
    const vector = texto(n && n.vector, 64);
    const datos = texto(n && n.datos, 20000);
    if (!id || !punto || !campo || !vector || !datos) {
      return falla(pet, 400, "Una nota llegó incompleta.");
    }
    // El alias es como la persona quiere aparecer ante el eje. No se guarda
    // ningún nombre real: el pliego de seguridad lo pide así.
    const alias = texto(n && n.alias, 40);
    ordenes.push(env.DB.prepare(
      "INSERT INTO notas (id, eje, punto, campo, alias, vector, datos, actualizado) " +
      "VALUES (?1,?2,?3,?4,?5,?6,?7,?8) " +
      "ON CONFLICT(id) DO UPDATE SET alias=?5, vector=?6, datos=?7, actualizado=?8 " +
      "WHERE excluded.actualizado > notas.actualizado"
    ).bind(id, texto(n.eje, 8) || "2", punto, campo, alias, vector, datos,
           texto(n.actualizado, 40) || cuando));
  }
  if (ordenes.length) await env.DB.batch(ordenes);
  return responde(pet, {ok: true, guardadas: ordenes.length, cuando});
}

/* ---------- Reparto ---------- */

const RUTAS = {
  "GET /api/salud":    {abierta: true,  atiende: salud},
  "GET /api/catalogo": {abierta: true,  atiende: catalogo},
  "GET /api/bien":     {abierta: true,  atiende: unBien},
  "GET /api/bienes":   {abierta: false, atiende: todosLosBienes},
  "POST /api/bienes":  {abierta: false, atiende: guardarBienes},
  "POST /api/folio":   {abierta: false, atiende: apartarFolio},
  "GET /api/bitacora": {abierta: false, atiende: verBitacora},
  "GET /api/documentos":  {abierta: true,  atiende: documentos},
  "GET /api/archivero":   {abierta: false, atiende: todosLosDocumentos},
  "POST /api/documentos": {abierta: false, atiende: guardarDocumentos},
  "POST /api/archivo":    {abierta: false, atiende: subirArchivo},
  "POST /api/sal":        {abierta: true,  atiende: pedirSal},
  "POST /api/ingreso":    {abierta: true,  atiende: ingresar},
  "POST /api/salir":      {abierta: true,  atiende: salir},
  "POST /api/persona":    {abierta: false, atiende: altaPersona},
  "GET /api/notas":       {abierta: true,  atiende: verNotas},
  "POST /api/notas":      {abierta: true,  atiende: guardarNotas}
};

export default {
  async fetch(pet, env) {
    const u = new URL(pet.url);

    if (pet.method === "OPTIONS") {
      return new Response(null, {status: 204, headers: cabeceras(pet, {
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400"
      })});
    }

    if (pet.method === "GET" && u.pathname.startsWith("/archivo/")) {
      const nombre = decodeURIComponent(u.pathname.slice("/archivo/".length));
      if (!nombre || nombre.includes("/")) return falla(pet, 400, "Nombre de archivo invalido.");
      try { return await verArchivo(pet, env, nombre); }
      catch (e) {
        console.error("fallo al servir " + nombre + ": " + (e && e.stack || e));
        return falla(pet, 500, "No se pudo leer el archivo.");
      }
    }

    const ruta = RUTAS[pet.method + " " + u.pathname];
    if (!ruta) return falla(pet, 404, "Esa ruta no existe en este servidor.");

    try { await prepararBase(env); }
    catch (e) {
      console.error("no se pudo preparar la base: " + (e && e.stack || e));
      return falla(pet, 503, "La base de datos no está lista todavía.");
    }

    if (!ruta.abierta && !autorizado(pet, env)) {
      return falla(pet, 401, "Hace falta la clave de la subcomisión para esta operación.");
    }

    try {
      return await ruta.atiende(pet, env);
    } catch (e) {
      // El detalle se queda en los registros del servidor, no se le devuelve a quien pregunta.
      console.error("fallo en " + u.pathname + ": " + (e && e.stack || e));
      return falla(pet, 500, "El servidor no pudo completar la operación.");
    }
  }
};
