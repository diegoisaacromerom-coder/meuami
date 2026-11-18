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

/* ---------- Reparto ---------- */

const RUTAS = {
  "GET /api/salud":    {abierta: true,  atiende: salud},
  "GET /api/catalogo": {abierta: true,  atiende: catalogo},
  "GET /api/bien":     {abierta: true,  atiende: unBien},
  "GET /api/bienes":   {abierta: false, atiende: todosLosBienes},
  "POST /api/bienes":  {abierta: false, atiende: guardarBienes},
  "POST /api/folio":   {abierta: false, atiende: apartarFolio},
  "GET /api/bitacora": {abierta: false, atiende: verBitacora}
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

    const ruta = RUTAS[pet.method + " " + u.pathname];
    if (!ruta) return falla(pet, 404, "Esa ruta no existe en este servidor.");

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
