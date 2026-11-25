/* Escribe los catorce puntos dentro de index.html.

   Antes la pagina los armaba con JavaScript al abrirse, y quien la leyera sin
   ejecutarlo —un buscador, un archivador, un lector de texto— recibia una
   cascara vacia. Para una pagina cuyo proposito es que la transcripcion sea
   publica y verificable, eso le quitaba la mitad del sentido.

   Ahora la transcripcion vive en el archivo. El JavaScript solo agrega encima
   lo que no puede estar ahi: los campos del analisis del eje, que son
   privados y no deben aparecer en ningun archivo publicado.

       node eje2/construir.mjs        escribe
       node eje2/construir.mjs --ver  solo avisa si esta desfasado

   Correr esto cada vez que cambie datos.js. Hay una prueba que falla si el
   HTML y los datos no coinciden, para que no se quede olvidado. */
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const AQUI = dirname(fileURLToPath(import.meta.url));
const INICIO = "<!-- PUNTOS:INICIO (generado por construir.mjs — no editar a mano) -->";
const FIN = "<!-- PUNTOS:FIN -->";

const TIPOS = {
  "concreto":  "Compromiso concreto",
  "sin-plazo": "Compromiso sin plazo o monto",
  "existente": "Describe lo que ya hay",
  "remision":  "Remite a otra instancia",
  "negacion":  "Justifica o niega",
  "silencio":  "Silencio u omisión"
};

function escapa(t) {
  return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function cita(lista, vacio) {
  if (!lista || !lista.length) return `      <p class="vacio-cita">${escapa(vacio)}</p>\n`;
  return `      <blockquote class="cita">\n` +
    lista.map(t => `       <p>${escapa(t)}</p>`).join("\n") +
    `\n      </blockquote>\n`;
}

function punto(p) {
  const tipos = (p.tipos || []).map(t =>
    `<span class="chip t-${t}">${escapa(TIPOS[t] || t)}</span>`).join("");
  const val = p.valoracion || "";
  const sello = `<span class="val ${val || "sin"}">${escapa(val || "sin valorar")}</span>`;

  let aut = "";
  if (p.respuesta && p.respuesta.length) {
    aut += `      <p class="sub">Respuesta</p>\n` + cita(p.respuesta);
  }
  if (p.compromisos && p.compromisos.length) {
    aut += `      <p class="sub">Compromisos</p>\n` + cita(p.compromisos);
  }
  if (!aut) aut = `      <p class="vacio-cita">La autoridad no respondió este punto.</p>\n`;

  return `
   <details class="punto" data-clave="${escapa(p.clave)}">
    <summary>
     <span class="clave">${escapa(p.clave)}</span>
     <h2>${escapa(p.titulo)}</h2>
     <div class="estado">${tipos}${sello}</div>
    </summary>
    <div class="cuerpo">
     <section class="capa pliego">
      <h3>Lo que exige el pliego</h3>
${cita(p.exigencia, "El documento no trae esta sección para este punto.")}     </section>
     <section class="capa autoridad">
      <h3>Lo que respondió la autoridad</h3>
${aut}     </section>
     <section class="capa analisis" data-analisis="${escapa(p.clave)}">
      <h3>Análisis del eje</h3>
${p.origen ? `      <p class="origen">${escapa(p.origen)}</p>\n` : ""}      <noscript><p class="vacio-cita">El análisis del eje necesita JavaScript. La transcripción de arriba no.</p></noscript>
     </section>
    </div>
   </details>`;
}

const datosJs = readFileSync(join(AQUI, "datos.js"), "utf8");
const datos = JSON.parse(datosJs.slice(datosJs.indexOf("["), datosJs.lastIndexOf("]") + 1));

const html = readFileSync(join(AQUI, "index.html"), "utf8");
const a = html.indexOf(INICIO);
const b = html.indexOf(FIN);
if (a === -1 || b === -1) {
  console.error("Faltan las marcas PUNTOS:INICIO y PUNTOS:FIN en index.html.");
  process.exit(2);
}

const nuevo = html.slice(0, a + INICIO.length) +
  datos.map(punto).join("\n") + "\n  " +
  html.slice(b);

if (process.argv.includes("--ver")) {
  if (nuevo !== html) {
    console.error("index.html está desfasado de datos.js. Corre: node eje2/construir.mjs");
    process.exit(1);
  }
  console.log("index.html coincide con datos.js");
} else {
  writeFileSync(join(AQUI, "index.html"), nuevo);
  console.log(`index.html escrito con ${datos.length} puntos`);
}
