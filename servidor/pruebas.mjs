/* Pruebas del servidor. Levanta un Worker local con una base D1 real,
 * ejercita las rutas y reporta. No toca la red ni la base publicada.
 *   npm run esquema:local && npm run prueba
 */
import { spawn } from "child_process";

const PUERTO = 8788;
const BASE = `http://127.0.0.1:${PUERTO}`;
const CLAVE = "clave-de-pruebas-no-usar-en-produccion";

const res = [];
const ok = (n, c, d) => res.push((c ? "OK   " : "FALLA") + " | " + n + (c ? "" : "  << " + d));
const dormir = ms => new Promise(r => setTimeout(r, ms));

async function pide(ruta, op = {}) {
  const cab = {...(op.cabeceras || {})};
  if (op.clave) cab.Authorization = "Bearer " + op.clave;
  if (op.cuerpo !== undefined) cab["Content-Type"] = "application/json";
  const r = await fetch(BASE + ruta, {
    method: op.metodo || "GET",
    headers: cab,
    body: op.cuerpo === undefined ? undefined
        : (typeof op.cuerpo === "string" ? op.cuerpo : JSON.stringify(op.cuerpo))
  });
  let cuerpo = null;
  try { cuerpo = await r.json(); } catch (e) { /* 204 no trae cuerpo */ }
  return {estado: r.status, cuerpo, cabeceras: r.headers};
}

const bien = (folio, extra = {}) => ({
  folio, unidad: "IZT", fecha: "2026-11-15T10:00:00.000Z", categoria: "Herramienta",
  procedencia: "Préstamo de una persona", prestador: "Quien lo prestó",
  descripcion: "Taladro", marca: "Truper", inventario: "", cantidad: 1,
  ubicacion: "Bodega", estado: "Bueno", observaciones: "Llegó con un rayón",
  responsable: "Quien registró", ...extra
});

const worker = spawn("npx", ["wrangler", "dev", "--local", "--port", String(PUERTO), "--ip", "127.0.0.1"],
  {cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"]});
let salida = "";
worker.stdout.on("data", d => { salida += d; });
worker.stderr.on("data", d => { salida += d; });

try {
  let vivo = false;
  for (let i = 0; i < 60 && !vivo; i++) {
    await dormir(1000);
    try { vivo = (await fetch(BASE + "/api/salud")).ok; } catch (e) { /* aún no levanta */ }
  }
  if (!vivo) { console.log(salida.slice(-1500)); throw new Error("el servidor no levantó"); }

  /* ---------- Rutas abiertas ---------- */
  let r = await pide("/api/salud");
  ok("la ruta de salud responde", r.estado === 200 && r.cuerpo.ok === true, JSON.stringify(r.cuerpo));

  r = await pide("/api/bien?folio=SIA-IZT-2026-9999");
  ok("un folio inexistente devuelve 404", r.estado === 404, r.estado + " " + JSON.stringify(r.cuerpo));

  r = await pide("/api/bien");
  ok("pedir un bien sin folio se rechaza", r.estado === 400, String(r.estado));

  /* ---------- Sin clave no se entra ---------- */
  for (const [ruta, metodo] of [["/api/bienes","GET"],["/api/bitacora","GET"],["/api/folio","POST"]]) {
    r = await pide(ruta, {metodo, cuerpo: metodo === "POST" ? {} : undefined});
    ok("sin clave, " + metodo + " " + ruta + " responde 401", r.estado === 401, String(r.estado));
  }
  r = await pide("/api/bienes", {clave: "clave-equivocada"});
  ok("una clave equivocada no entra", r.estado === 401, String(r.estado));
  r = await pide("/api/bienes", {clave: CLAVE.slice(0, -1)});
  ok("una clave casi correcta tampoco entra", r.estado === 401, String(r.estado));

  /* ---------- Alta ---------- */
  r = await pide("/api/bienes", {metodo: "POST", clave: CLAVE, cuerpo: {
    quien: "Diego", bienes: [bien("SIA-IZT-2026-0001"), bien("SIA-IZT-2026-0002", {
      descripcion: "Cafetera", procedencia: "Recurso del movimiento", prestador: "", cantidad: 2})]
  }});
  ok("se dan de alta dos bienes", r.estado === 200 && r.cuerpo.altas === 2 && r.cuerpo.cambios === 0,
     JSON.stringify(r.cuerpo));

  r = await pide("/api/bienes", {clave: CLAVE});
  ok("la lectura protegida los devuelve", r.cuerpo.bienes.length === 2, JSON.stringify(r.cuerpo.bienes.length));
  ok("la lectura protegida sí trae los datos personales",
     r.cuerpo.bienes[0].prestador === "Quien lo prestó" &&
     r.cuerpo.bienes[0].observaciones === "Llegó con un rayón", JSON.stringify(r.cuerpo.bienes[0]));

  /* ---------- Lo público no filtra personas ---------- */
  r = await pide("/api/catalogo");
  const comoTexto = JSON.stringify(r.cuerpo);
  ok("el catálogo público lista los bienes", r.cuerpo.bienes.length === 2, String(r.cuerpo.bienes.length));
  ok("el catálogo no filtra quién prestó ni quién registró",
     !comoTexto.includes("Quien lo prestó") && !comoTexto.includes("Quien registró"), "se filtró un nombre");
  ok("el catálogo no filtra las observaciones", !comoTexto.includes("rayón"), "se filtraron observaciones");
  ok("el catálogo sí trae los datos del bien",
     r.cuerpo.bienes[0].descripcion === "Taladro" && r.cuerpo.bienes[0].ubicacion === "Bodega",
     JSON.stringify(r.cuerpo.bienes[0]));

  r = await pide("/api/bien?folio=SIA-IZT-2026-0001");
  ok("la consulta de un folio funciona sin clave", r.estado === 200 && r.cuerpo.bien.descripcion === "Taladro",
     JSON.stringify(r.cuerpo));
  ok("la consulta de un folio tampoco filtra personas",
     !JSON.stringify(r.cuerpo).includes("Quien lo prestó"), "se filtró el nombre");

  /* ---------- Cambio, no alta duplicada ---------- */
  r = await pide("/api/bienes", {metodo: "POST", clave: CLAVE, cuerpo: {
    quien: "Ana", bienes: [bien("SIA-IZT-2026-0001", {ubicacion: "Cubículo 3"})]}});
  ok("volver a enviar un folio cuenta como cambio", r.cuerpo.altas === 0 && r.cuerpo.cambios === 1,
     JSON.stringify(r.cuerpo));
  r = await pide("/api/bien?folio=SIA-IZT-2026-0001");
  ok("el cambio quedó guardado", r.cuerpo.bien.ubicacion === "Cubículo 3", r.cuerpo.bien.ubicacion);
  r = await pide("/api/catalogo");
  ok("no se duplicó el renglón", r.cuerpo.bienes.length === 2, String(r.cuerpo.bienes.length));

  /* ---------- Validación ---------- */
  r = await pide("/api/bienes", {metodo: "POST", clave: CLAVE, cuerpo: {bienes: [
    {folio: "esto-no-es-un-folio", descripcion: "Algo"}, bien("SIA-IZT-2026-0003")]}});
  ok("un folio con mala forma se rechaza sin tumbar el envío",
     r.cuerpo.altas === 1 && r.cuerpo.rechazados.length === 1, JSON.stringify(r.cuerpo));

  r = await pide("/api/bienes", {metodo: "POST", clave: CLAVE, cuerpo: "{esto no es json"});
  ok("un cuerpo que no es JSON se rechaza", r.estado === 400, String(r.estado));

  r = await pide("/api/bienes", {metodo: "POST", clave: CLAVE, cuerpo: {bienes: "no es lista"}});
  ok("un cuerpo sin lista de bienes se rechaza", r.estado === 400, String(r.estado));

  r = await pide("/api/bienes", {metodo: "POST", clave: CLAVE, cuerpo: {
    bienes: Array.from({length: 501}, (_, i) => bien("SIA-IZT-2026-" + String(i+100).padStart(4,"0")))}});
  ok("un envío demasiado grande se rechaza", r.estado === 413, String(r.estado));

  /* ---------- Baja ---------- */
  await pide("/api/bienes", {metodo: "POST", clave: CLAVE, cuerpo: {
    quien: "Diego", bienes: [bien("SIA-IZT-2026-0003", {baja: 1})]}});
  r = await pide("/api/catalogo");
  ok("un bien dado de baja sale del catálogo público",
     !r.cuerpo.bienes.some(b => b.folio === "SIA-IZT-2026-0003"), "sigue apareciendo");
  r = await pide("/api/bienes", {clave: CLAVE});
  ok("pero se conserva en el registro interno",
     r.cuerpo.bienes.some(b => b.folio === "SIA-IZT-2026-0003" && b.baja === 1), "se perdió el renglón");

  /* ---------- Folios ---------- */
  r = await pide("/api/folio", {metodo: "POST", clave: CLAVE, cuerpo: {unidad: "IZT"}});
  const primero = r.cuerpo.folio;
  ok("el folio apartado continúa después del mayor ya usado",
     r.cuerpo.consecutivo === 4, "dio el " + r.cuerpo.consecutivo);

  const enParalelo = await Promise.all(Array.from({length: 8}, () =>
    pide("/api/folio", {metodo: "POST", clave: CLAVE, cuerpo: {unidad: "IZT"}})));
  const dados = enParalelo.map(x => x.cuerpo.folio);
  ok("ocho peticiones simultáneas no repiten folio", new Set(dados).size === 8, dados.join(" "));
  ok("y ninguno repite el anterior", !dados.includes(primero), "se repitió " + primero);

  r = await pide("/api/folio", {metodo: "POST", clave: CLAVE, cuerpo: {unidad: "XOC"}});
  ok("cada unidad lleva su propia cuenta", r.cuerpo.consecutivo === 1 && /SIA-XOC-/.test(r.cuerpo.folio),
     r.cuerpo.folio);

  /* ---------- Bitácora ---------- */
  r = await pide("/api/bitacora?folio=SIA-IZT-2026-0001", {clave: CLAVE});
  const acciones = r.cuerpo.movimientos.map(m => m.accion);
  ok("la bitácora asienta el alta y el cambio",
     acciones.includes("alta") && acciones.includes("cambio"), acciones.join(","));
  ok("la bitácora asienta quién lo hizo",
     r.cuerpo.movimientos.some(m => m.quien === "Ana"), JSON.stringify(r.cuerpo.movimientos.map(m=>m.quien)));
  r = await pide("/api/bitacora?folio=SIA-IZT-2026-0003", {clave: CLAVE});
  ok("la bitácora asienta la baja", r.cuerpo.movimientos.some(m => m.accion === "baja"),
     JSON.stringify(r.cuerpo.movimientos.map(m=>m.accion)));

  /* ---------- Sincronización incremental ---------- */
  const corte = new Date().toISOString();
  await dormir(1100);
  await pide("/api/bienes", {metodo: "POST", clave: CLAVE, cuerpo: {
    quien: "Diego", bienes: [bien("SIA-IZT-2026-0050", {descripcion: "Extensión"})]}});
  r = await pide("/api/catalogo?desde=" + encodeURIComponent(corte));
  ok("pedir solo lo nuevo devuelve solo lo nuevo",
     r.cuerpo.bienes.length === 1 && r.cuerpo.bienes[0].descripcion === "Extensión",
     JSON.stringify(r.cuerpo.bienes.map(b => b.folio)));

  /* ---------- Rutas y CORS ---------- */
  r = await pide("/api/loquesea");
  ok("una ruta inexistente devuelve 404", r.estado === 404, String(r.estado));


  /* ---------- Documentos ---------- */

  r = await pide("/api/documentos");
  ok("el archivo de documentos abre sin clave", r.estado === 200, String(r.estado));
  ok("y empieza vacío", Array.isArray(r.cuerpo.documentos) && r.cuerpo.documentos.length === 0,
     JSON.stringify(r.cuerpo));

  r = await pide("/api/documentos", {metodo: "POST", cuerpo: {documentos: [
    {id: "si-2344", tipo: "Oficio", etiqueta: "Oficio SI.2344.2026", titulo: "Instalación de las mesas",
     resumen: "Lo que dice el oficio.", archivo: "/assets/si-2344-2026.pdf", peso: "PDF · 3.7 MB",
     fecha: "2026-11-16", orden: 10}
  ]}});
  ok("publicar un documento sin clave se rechaza", r.estado === 401, String(r.estado));

  r = await pide("/api/documentos", {metodo: "POST", clave: CLAVE, cuerpo: {documentos: [
    {id: "si-2344", tipo: "Oficio", etiqueta: "Oficio SI.2344.2026", titulo: "Instalación de las mesas",
     resumen: "Lo que dice el oficio.", archivo: "/assets/si-2344-2026.pdf", peso: "PDF · 3.7 MB",
     fecha: "2026-11-16", orden: 10},
    {id: "carta-csh", tipo: "Carta compromiso", titulo: "No represalias de CSH",
     resumen: "Suscrita por 37 personas.", firmas: ["Dirección divisional", "Secretaría Académica"],
     archivo: "/assets/carta-no-represalias-csh.pdf", peso: "PDF · 4.0 MB",
     fecha: "2026-11-16", orden: 9},
    {id: "borrador", tipo: "Oficio", titulo: "Todavía no", resumen: "", publicado: false, orden: 1}
  ]}});
  ok("con la clave se publican", r.estado === 200 && r.cuerpo.guardados === 3, JSON.stringify(r.cuerpo));

  r = await pide("/api/documentos");
  ok("el archivo devuelve solo los publicados", r.cuerpo.documentos.length === 2,
     JSON.stringify(r.cuerpo.documentos.map(d => d.id)));
  ok("y en el orden pedido", r.cuerpo.documentos[0].id === "si-2344",
     JSON.stringify(r.cuerpo.documentos.map(d => d.id)));
  ok("las firmas vuelven como lista",
     Array.isArray(r.cuerpo.documentos[1].firmas) && r.cuerpo.documentos[1].firmas.length === 2,
     JSON.stringify(r.cuerpo.documentos[1].firmas));
  ok("un documento sin firmas trae una lista vacía",
     Array.isArray(r.cuerpo.documentos[0].firmas) && r.cuerpo.documentos[0].firmas.length === 0,
     JSON.stringify(r.cuerpo.documentos[0].firmas));

  r = await pide("/api/archivero");
  ok("la lista completa exige clave", r.estado === 401, String(r.estado));
  r = await pide("/api/archivero", {clave: CLAVE});
  ok("con la clave se ve también el borrador", r.cuerpo.documentos.length === 3,
     String(r.cuerpo.documentos.length));

  r = await pide("/api/documentos", {metodo: "POST", clave: CLAVE, cuerpo: {documentos: [
    {id: "si-2344", tipo: "Oficio", titulo: "Instalación de las mesas de diálogo",
     resumen: "Corregido.", archivo: "/assets/si-2344-2026.pdf", fecha: "2026-11-16", orden: 10}
  ]}});
  r = await pide("/api/documentos");
  ok("volver a publicar el mismo id corrige, no duplica",
     r.cuerpo.documentos.length === 2 &&
     r.cuerpo.documentos[0].titulo === "Instalación de las mesas de diálogo",
     JSON.stringify(r.cuerpo.documentos.map(d => d.titulo)));

  r = await pide("/api/documentos", {metodo: "POST", clave: CLAVE,
    cuerpo: {documentos: [{tipo: "Oficio", titulo: "Sin id"}]}});
  ok("un documento sin id se rechaza", r.estado === 400, String(r.estado));

  r = await pide("/api/documentos", {metodo: "POST", clave: CLAVE,
    cuerpo: {documentos: [{id: "x", titulo: ""}]}});
  ok("un documento sin título se rechaza", r.estado === 400, String(r.estado));

  r = await pide("/api/bitacora", {clave: CLAVE});
  ok("publicar un documento queda en la bitácora",
     r.cuerpo.movimientos.some(m => m.folio === "doc:si-2344" && m.accion === "documento"),
     JSON.stringify(r.cuerpo.movimientos.slice(0, 2)));

  /* ---------- Archivos ---------- */
  // Sin R2 conectado el servidor tiene que decirlo claro, no tronar.
  r = await fetch(BASE + "/api/archivo?nombre=acuerdos.pdf", {
    method: "POST", headers: {Authorization: "Bearer " + CLAVE}, body: "x"});
  const cuerpoArchivo = await r.json().catch(() => null);
  ok("subir un archivo sin almacén responde que no lo hay",
     r.status === 501 || r.status === 200, String(r.status));
  if (r.status === 501) {
    ok("y lo explica en vez de tronar",
       /almac/i.test(cuerpoArchivo && cuerpoArchivo.error || ""), JSON.stringify(cuerpoArchivo));
  } else {
    ok("y si lo hay, devuelve la ruta", !!(cuerpoArchivo && cuerpoArchivo.ruta), JSON.stringify(cuerpoArchivo));
  }

  r = await pide("/archivo/no-existe.pdf");
  ok("pedir un archivo que no está responde 404", r.estado === 404, String(r.estado));

  r = await pide("/archivo/..%2F..%2Fetc%2Fpasswd");
  ok("no se puede salir de la carpeta de archivos", r.estado === 400 || r.estado === 404,
     String(r.estado));

  r = await pide("/api/catalogo", {metodo: "OPTIONS", cabeceras: {Origin: "https://meuami.org"}});
  ok("la consulta previa de CORS responde", r.estado === 204, String(r.estado));
  ok("y autoriza al sitio", r.cabeceras.get("access-control-allow-origin") === "https://meuami.org",
     String(r.cabeceras.get("access-control-allow-origin")));

  r = await pide("/api/catalogo", {cabeceras: {Origin: "https://sitio-ajeno.example"}});
  ok("un sitio ajeno no recibe permiso de CORS",
     !r.cabeceras.get("access-control-allow-origin"),
     String(r.cabeceras.get("access-control-allow-origin")));

} catch (e) {
  res.push("FALLA | la prueba no terminó  << " + e.message);
} finally {
  worker.kill("SIGTERM");
  await dormir(500);
  try { process.kill(-worker.pid, "SIGKILL"); } catch (e) { /* ya murió */ }
}

res.forEach(l => console.log(l));
const mal = res.filter(l => l.startsWith("FALLA"));
console.log(`\n${res.length - mal.length} de ${res.length} pasaron`);
process.exit(mal.length ? 1 : 0);
