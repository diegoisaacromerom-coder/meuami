"use strict";
/* Candado del dispositivo.

   Sin esto, el analisis del eje queda en claro en el navegador: quien levante
   un telefono desbloqueado, o copie el perfil del navegador, lee la estrategia
   de negociacion completa. En una mesa, con el telefono sobre el escritorio,
   eso no es una hipotesis remota.

   Con el candado puesto, lo guardado es un sobre cifrado (AES-GCM de 256, con
   la llave derivada por PBKDF2 en 310 000 vueltas) y la llave vive solo en
   memoria mientras la pestana esta abierta. Al recargar hay que volver a
   escribir la contrasena.

   Si se pierde la contrasena, lo escrito en este dispositivo se pierde. No hay
   puerta de atras: si la hubiera, el candado no serviria de nada. Por eso el
   respaldo cifrado existe y conviene usarlo.

   Por omision el candado esta quitado, porque obligar a escribir una
   contrasena a quien solo quiere leer la respuesta de la autoridad antes de
   entrar a la mesa seria estorbar mas que proteger. */
window.Candado = (function(){
  var EN_CLARO = "eje2-analisis-v1";
  var CIFRADO  = "eje2-analisis-cifrado-v1";
  var SECRETO  = "eje2-secreto-";          // + nombre
  var VUELTAS  = 310000;
  var INACTIVIDAD = 15 * 60 * 1000;

  var llaveViva = null;   // CryptoKey, solo en memoria
  var salViva   = null;
  var reloj     = null;

  function bytes(s){ return new TextEncoder().encode(s); }
  function aB64(buf){
    var u = new Uint8Array(buf), s = "", paso = 0x8000;
    for (var i = 0; i < u.length; i += paso) s += String.fromCharCode.apply(null, u.subarray(i, i + paso));
    return btoa(s);
  }
  function deB64(t){
    var b = atob(t), u = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    return u;
  }
  async function derivar(contrasena, sal){
    var base = await crypto.subtle.importKey("raw", bytes(contrasena), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      {name:"PBKDF2", salt:sal, iterations:VUELTAS, hash:"SHA-256"},
      base, {name:"AES-GCM", length:256}, false, ["encrypt","decrypt"]);
  }

  function protegido(){ return !!localStorage.getItem(CIFRADO); }
  function abierto(){ return !protegido() || !!llaveViva; }

  function tocar(){
    if (!llaveViva) return;
    clearTimeout(reloj);
    reloj = setTimeout(function(){
      // El telefono quedo sobre la mesa. Se cierra solo.
      llaveViva = null; salViva = null;
      location.reload();
    }, INACTIVIDAD);
  }

  async function cargar(){
    if (!protegido()) {
      try { return JSON.parse(localStorage.getItem(EN_CLARO) || "{}") || {}; }
      catch (e) { return {}; }
    }
    var sobre = JSON.parse(localStorage.getItem(CIFRADO));
    for (var intento = 0; intento < 3; intento++) {
      var c = prompt(intento === 0
        ? "Este dispositivo tiene candado.\n\nEscribe la contraseña del eje para ver el análisis."
        : "Contraseña incorrecta. Vuelve a intentarlo.");
      if (c === null) return null;               // leer sin abrir: solo la parte pública
      try {
        var sal = deB64(sobre.sal);
        var k = await derivar(c, sal);
        var claro = await crypto.subtle.decrypt(
          {name:"AES-GCM", iv:deB64(sobre.vector)}, k, deB64(sobre.datos));
        llaveViva = k; salViva = sal;
        tocar();
        return JSON.parse(new TextDecoder().decode(claro));
      } catch (e) { /* contraseña equivocada */ }
    }
    return null;
  }

  async function guardar(obj){
    var texto = JSON.stringify(obj);
    if (!protegido()) {
      try { localStorage.setItem(EN_CLARO, texto); return true; } catch (e) { return false; }
    }
    if (!llaveViva) return false;
    tocar();
    var vec = crypto.getRandomValues(new Uint8Array(12));
    var cifrado = await crypto.subtle.encrypt({name:"AES-GCM", iv:vec}, llaveViva, bytes(texto));
    localStorage.setItem(CIFRADO, JSON.stringify({
      formato:"eje2-local-cifrado", version:1, algoritmo:"AES-GCM-256",
      derivacion:{fn:"PBKDF2", hash:"SHA-256", vueltas:VUELTAS},
      sal: aB64(salViva), vector: aB64(vec), datos: aB64(cifrado),
      guardado: new Date().toISOString()
    }));
    return true;
  }


  /* ----- Secretos del dispositivo -----

     La ficha de sesion y la llave del eje tienen que sobrevivir a una recarga,
     o trabajar en la mesa se vuelve imposible: seis ventanitas cada vez que el
     telefono se duerme no las aguanta nadie, y lo que de verdad pasa entonces
     es que alguien abre un chat cualquiera y ahi se va la estrategia.

     Se guardan con exactamente la misma proteccion que el analisis, ni mas ni
     menos: cifrados si el dispositivo tiene candado, en claro si no lo tiene.
     Asi la promesa al eje es una sola y es facil de explicar: con candado, lo
     de este aparato esta cifrado; sin candado, no. */

  function llaveDe(nombre){ return SECRETO + nombre + "-v1"; }

  async function guardaSecreto(nombre, obj){
    var texto = JSON.stringify(obj);
    if (!protegido()) {
      try { localStorage.setItem(llaveDe(nombre), JSON.stringify({claro: texto})); return true; }
      catch (e) { return false; }
    }
    if (!llaveViva) return false;
    var vec = crypto.getRandomValues(new Uint8Array(12));
    var cifrado = await crypto.subtle.encrypt({name:"AES-GCM", iv:vec}, llaveViva, bytes(texto));
    try {
      localStorage.setItem(llaveDe(nombre), JSON.stringify({
        sal: aB64(salViva), vector: aB64(vec), datos: aB64(cifrado)
      }));
      return true;
    } catch (e) { return false; }
  }

  async function leeSecreto(nombre){
    var crudo = localStorage.getItem(llaveDe(nombre));
    if (!crudo) return null;
    var sobre;
    try { sobre = JSON.parse(crudo); } catch (e) { return null; }
    if (sobre && typeof sobre.claro === "string") {
      // Guardado sin candado. Si entretanto se puso candado, ya no vale.
      if (protegido()) return null;
      try { return JSON.parse(sobre.claro); } catch (e) { return null; }
    }
    if (!llaveViva) return null;               // con candado puesto y sin abrir
    try {
      var claro = await crypto.subtle.decrypt(
        {name:"AES-GCM", iv:deB64(sobre.vector)}, llaveViva, deB64(sobre.datos));
      return JSON.parse(new TextDecoder().decode(claro));
    } catch (e) { return null; }
  }

  function olvidaSecreto(nombre){
    try { localStorage.removeItem(llaveDe(nombre)); } catch (e) {}
  }

  function nombresDeSecretos(){
    var fuera = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(SECRETO) === 0 && k.slice(-3) === "-v1") {
        fuera.push(k.slice(SECRETO.length, -3));
      }
    }
    return fuera;
  }

  // Al poner o quitar el candado hay que volver a envolver lo guardado, o se
  // quedaria ilegible (o peor: en claro cuando ya deberia estar cifrado).
  async function reenvolver(antes){
    var nombres = nombresDeSecretos();
    for (var i = 0; i < nombres.length; i++) {
      if (Object.prototype.hasOwnProperty.call(antes, nombres[i])) {
        await guardaSecreto(nombres[i], antes[nombres[i]]);
      } else {
        olvidaSecreto(nombres[i]);
      }
    }
  }

  async function secretosEnMemoria(){
    var nombres = nombresDeSecretos(), fuera = {};
    for (var i = 0; i < nombres.length; i++) {
      var v = await leeSecreto(nombres[i]);
      if (v !== null) fuera[nombres[i]] = v;
    }
    return fuera;
  }

  async function poner(obj){
    var c = prompt("Contraseña del candado para este dispositivo.\n\n" +
      "Cuatro o cinco palabras sin relación. Si la pierdes, lo escrito aquí se pierde: " +
      "no hay forma de recuperarlo. Respalda antes.");
    if (c === null) return false;
    if (c.length < 12) { alert("Muy corta. Usa al menos 12 caracteres."); return false; }
    if (prompt("Escríbela otra vez.") !== c) { alert("No coinciden. No se puso el candado."); return false; }
    var rescatados = await secretosEnMemoria();   // leerlos mientras siguen en claro
    salViva = crypto.getRandomValues(new Uint8Array(16));
    llaveViva = await derivar(c, salViva);
    localStorage.removeItem(EN_CLARO);
    localStorage.setItem(CIFRADO, "{}");          // marca para que guardar() cifre
    await guardar(obj);
    await reenvolver(rescatados);                 // ahora quedan cifrados
    tocar();
    return true;
  }

  async function quitar(obj){
    if (!confirm("Quitar el candado deja el análisis en claro en este navegador. " +
                 "Cualquiera que abra este dispositivo podrá leerlo.\n\n¿Quitarlo?")) return false;
    var rescatados = await secretosEnMemoria();   // leerlos mientras la llave vive
    llaveViva = null; salViva = null;
    localStorage.removeItem(CIFRADO);
    localStorage.setItem(EN_CLARO, JSON.stringify(obj));
    await reenvolver(rescatados);                 // quedan en claro, como el resto
    return true;
  }

  function cerrar(){
    llaveViva = null; salViva = null;
    clearTimeout(reloj);
    location.reload();
  }

  function borrarTodo(){
    if (!confirm("Esto borra de este dispositivo todo el análisis del eje: " +
                 "clasificaciones, notas y réplicas.\n\nNo se puede deshacer. " +
                 "¿Tienes un respaldo?")) return false;
    if (!confirm("Última confirmación. ¿Borrar todo?")) return false;
    localStorage.removeItem(EN_CLARO);
    localStorage.removeItem(CIFRADO);
    nombresDeSecretos().forEach(olvidaSecreto);   // sesion y llave del eje tambien
    llaveViva = null; salViva = null;
    location.reload();
    return true;
  }

  ["click","keydown","touchstart"].forEach(function(e){
    document.addEventListener(e, tocar, {passive:true});
  });

  return {cargar:cargar, guardar:guardar, poner:poner, quitar:quitar,
          cerrar:cerrar, borrarTodo:borrarTodo,
          guardaSecreto:guardaSecreto, leeSecreto:leeSecreto,
          olvidaSecreto:olvidaSecreto, tocar:tocar,
          protegido:protegido, abierto:abierto, inactividad:INACTIVIDAD};
})();
