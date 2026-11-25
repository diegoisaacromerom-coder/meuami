"use strict";
/* Respaldo del analisis del eje.

   Sale cifrado siempre, sin opcion de no cifrarlo. Un archivo con la
   estrategia de negociacion del eje andando suelto en la carpeta de descargas
   de un telefono es justo lo que no queremos, y quien respalda con prisa antes
   de una mesa no esta para decidir eso en ese momento.

   AES-GCM de 256 bits, con la llave derivada de la contrasena por PBKDF2 y
   310 000 vueltas. La contrasena no se guarda en ningun lado. Si se pierde,
   el respaldo no se abre: no hay puerta de atras, y es a proposito. */
(function(){
  var VUELTAS = 310000;
  var $ = function(id){ return document.getElementById(id); };

  function bytes(s){ return new TextEncoder().encode(s); }

  async function llave(contrasena, sal){
    var base = await crypto.subtle.importKey("raw", bytes(contrasena), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      {name:"PBKDF2", salt:sal, iterations:VUELTAS, hash:"SHA-256"},
      base, {name:"AES-GCM", length:256}, false, ["encrypt","decrypt"]);
  }

  // En trozos: btoa con un arreglo grande de una sola vez revienta la pila.
  function aBase64(buf){
    var u = new Uint8Array(buf), s = "", paso = 0x8000;
    for (var i = 0; i < u.length; i += paso) {
      s += String.fromCharCode.apply(null, u.subarray(i, i + paso));
    }
    return btoa(s);
  }
  function deBase64(t){
    var b = atob(t), u = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    return u;
  }

  function hoy(){
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") +
           "-" + String(d.getDate()).padStart(2,"0");
  }

  function bajar(nombre, texto){
    var a = document.createElement("a");
    var url = URL.createObjectURL(new Blob([texto], {type:"application/json"}));
    a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
  }

  async function exportar(){
    var crudo = localStorage.getItem("eje2-analisis-v1") || "{}";
    if (crudo === "{}") { alert("Todavía no hay nada escrito que respaldar."); return; }

    var c = prompt("Contraseña para cifrar el respaldo.\n\n" +
                   "Usa cuatro o cinco palabras sin relación entre ellas. " +
                   "Si la pierdes, el archivo no se puede abrir: no hay forma de recuperarlo.");
    if (c === null) return;
    if (c.length < 12) { alert("Muy corta. Usa al menos 12 caracteres."); return; }
    var otra = prompt("Escríbela otra vez.");
    if (otra !== c) { alert("No coinciden. No se respaldó nada."); return; }

    try {
      var sal = crypto.getRandomValues(new Uint8Array(16));
      var vec = crypto.getRandomValues(new Uint8Array(12));
      var k = await llave(c, sal);
      var cifrado = await crypto.subtle.encrypt({name:"AES-GCM", iv:vec}, k, bytes(crudo));
      var sobre = {
        formato: "eje2-respaldo-cifrado", version: 1,
        algoritmo: "AES-GCM-256",
        derivacion: {fn:"PBKDF2", hash:"SHA-256", vueltas:VUELTAS},
        sal: aBase64(sal), vector: aBase64(vec), datos: aBase64(cifrado),
        creado: new Date().toISOString(),
        nota: "Análisis del Eje 2 del Movimiento Estudiantil UAM-I. Cifrado. Sin la contraseña no se abre."
      };
      bajar("eje2-analisis-" + hoy() + ".json", JSON.stringify(sobre, null, 1));
    } catch (e) {
      alert("No se pudo cifrar el respaldo: " + e.message);
    }
  }

  async function importar(){
    var campo = document.createElement("input");
    campo.type = "file"; campo.accept = ".json,application/json";
    campo.addEventListener("change", async function(){
      var f = campo.files[0];
      if (!f) return;
      var texto = await f.text();
      var sobre;
      try { sobre = JSON.parse(texto); }
      catch (e) { alert("Ese archivo no es un respaldo válido."); return; }
      if (!sobre || sobre.formato !== "eje2-respaldo-cifrado") {
        alert("Ese archivo no es un respaldo del Eje 2."); return;
      }
      var c = prompt("Contraseña del respaldo.");
      if (c === null) return;
      try {
        var k = await llave(c, deBase64(sobre.sal));
        var claro = await crypto.subtle.decrypt(
          {name:"AES-GCM", iv:deBase64(sobre.vector)}, k, deBase64(sobre.datos));
        var venido = JSON.parse(new TextDecoder().decode(claro));
        var actual = JSON.parse(localStorage.getItem("eje2-analisis-v1") || "{}");
        var cuantos = Object.keys(venido).length;
        var pisa = Object.keys(venido).filter(function(x){ return actual[x]; }).length;
        var msg = "El respaldo trae análisis de " + cuantos + " punto(s).";
        if (pisa) msg += "\n\nDe esos, " + pisa + " ya tienen algo escrito en este " +
          "dispositivo y se van a reemplazar con lo del respaldo.";
        msg += "\n\n¿Cargarlo?";
        if (!confirm(msg)) return;
        Object.keys(venido).forEach(function(x){ actual[x] = venido[x]; });
        localStorage.setItem("eje2-analisis-v1", JSON.stringify(actual));
        location.reload();
      } catch (e) {
        alert("No se pudo abrir el respaldo. Casi siempre es la contraseña.");
      }
    });
    campo.click();
  }

  if ($("exportar")) $("exportar").addEventListener("click", exportar);
  if ($("importar")) $("importar").addEventListener("click", importar);
})();
