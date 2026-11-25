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

  async function poner(obj){
    var c = prompt("Contraseña del candado para este dispositivo.\n\n" +
      "Cuatro o cinco palabras sin relación. Si la pierdes, lo escrito aquí se pierde: " +
      "no hay forma de recuperarlo. Respalda antes.");
    if (c === null) return false;
    if (c.length < 12) { alert("Muy corta. Usa al menos 12 caracteres."); return false; }
    if (prompt("Escríbela otra vez.") !== c) { alert("No coinciden. No se puso el candado."); return false; }
    salViva = crypto.getRandomValues(new Uint8Array(16));
    llaveViva = await derivar(c, salViva);
    localStorage.removeItem(EN_CLARO);
    localStorage.setItem(CIFRADO, "{}");          // marca para que guardar() cifre
    await guardar(obj);
    tocar();
    return true;
  }

  async function quitar(obj){
    if (!confirm("Quitar el candado deja el análisis en claro en este navegador. " +
                 "Cualquiera que abra este dispositivo podrá leerlo.\n\n¿Quitarlo?")) return false;
    llaveViva = null; salViva = null;
    localStorage.removeItem(CIFRADO);
    localStorage.setItem(EN_CLARO, JSON.stringify(obj));
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
    llaveViva = null; salViva = null;
    location.reload();
    return true;
  }

  ["click","keydown","touchstart"].forEach(function(e){
    document.addEventListener(e, tocar, {passive:true});
  });

  return {cargar:cargar, guardar:guardar, poner:poner, quitar:quitar,
          cerrar:cerrar, borrarTodo:borrarTodo,
          protegido:protegido, abierto:abierto, inactividad:INACTIVIDAD};
})();
