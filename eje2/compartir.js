"use strict";
/* Trabajo compartido del eje.

   Dos secretos distintos, y conviene no confundirlos:

   - La contrasena de cada quien, con su codigo de la app, sirve para entrar.
     Dice QUIEN eres. El servidor la verifica.
   - La llave del eje sirve para leer y escribir las notas. Dice QUE puedes
     leer. El servidor nunca la ve. Si alguien se robara la base entera y las
     sesiones, seguiria sin poder leer una sola nota.

   Las notas se cifran aqui, en el navegador, y asi viajan. El servidor guarda
   bytes: ve quien escribio, en que punto y cuando, pero no que dice. Eso es lo
   que permite trabajar en comun sin dejar la estrategia en una plataforma
   ajena.

   Cada nota se identifica por punto, campo y alias, de modo que nadie pisa lo
   de nadie: todos ven todo y cada quien manda sobre lo suyo.

   Lo que esto NO resuelve, dicho claro: quien opere el servidor ve el mapa del
   trabajo —quien escribe, en que punto y a que hora—, aunque no su contenido.
   Y si el eje pierde la llave, las notas no se recuperan. */
window.Compartir = (function(){
  var AJUSTES = "eje2-servidor-v1";
  var VUELTAS = 310000;
  // Sal fija de la aplicacion para la llave del eje. Una sal no es secreta;
  // su trabajo es que no sirva una tabla precalculada para todo el mundo. Con
  // 310 000 vueltas y una llave larga alcanza, pero por eso se exigen 16
  // caracteres y no 8.
  var SAL_EJE = "meuami-eje2-llave-del-eje-v1";

  var ficha = null;      // ficha de sesion, solo en memoria
  var quien = null;
  var alias = null;
  var llave = null;      // llave del eje, solo en memoria

  var cod = new TextEncoder();
  var dec = new TextDecoder();

  function ajustes(){
    try { return JSON.parse(localStorage.getItem(AJUSTES) || "{}") || {}; }
    catch (e) { return {}; }
  }
  function guardarAjustes(a){
    try { localStorage.setItem(AJUSTES, JSON.stringify(a)); } catch (e) {}
  }
  function base(){ return (ajustes().url || "").replace(/\/+$/, ""); }

  function hex(buf){
    return [].map.call(new Uint8Array(buf), function(b){
      return b.toString(16).padStart(2, "0"); }).join("");
  }
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

  async function estirar(clave, sal, uso){
    var base0 = await crypto.subtle.importKey("raw", cod.encode(clave), "PBKDF2", false, ["deriveBits","deriveKey"]);
    if (uso === "bits") {
      return hex(await crypto.subtle.deriveBits(
        {name:"PBKDF2", salt:cod.encode(sal), iterations:VUELTAS, hash:"SHA-256"}, base0, 256));
    }
    return crypto.subtle.deriveKey(
      {name:"PBKDF2", salt:cod.encode(sal), iterations:VUELTAS, hash:"SHA-256"},
      base0, {name:"AES-GCM", length:256}, false, ["encrypt","decrypt"]);
  }

  async function pide(ruta, op){
    op = op || {};
    var cab = {};
    if (ficha) cab["X-Sesion"] = ficha;
    if (op.cuerpo !== undefined) cab["Content-Type"] = "application/json";
    var r = await fetch(base() + ruta, {
      method: op.metodo || "GET", headers: cab,
      body: op.cuerpo === undefined ? undefined : JSON.stringify(op.cuerpo)
    });
    var cuerpo = null;
    try { cuerpo = await r.json(); } catch (e) {}
    return {estado: r.status, cuerpo: cuerpo};
  }

  async function conectar(){
    var a = ajustes();
    var url = prompt("Dirección del servidor del eje.", a.url || "");
    if (url === null) return false;
    a.url = url.trim().replace(/\/+$/, "");
    guardarAjustes(a);
    if (!a.url) return false;

    var usuario = prompt("Tu usuario.", a.usuario || "");
    if (usuario === null) return false;
    usuario = usuario.trim().toLowerCase();

    var clave = prompt("Tu contraseña.");
    if (clave === null) return false;

    var r = await pide("/api/sal", {metodo:"POST", cuerpo:{usuario: usuario}});
    if (r.estado !== 200 || !r.cuerpo || !r.cuerpo.sal) {
      alert("No se pudo hablar con el servidor."); return false;
    }

    var codigo = prompt("El código de seis dígitos de tu app.");
    if (codigo === null) return false;

    var derivada = await estirar(clave, r.cuerpo.sal, "bits");
    var e = await pide("/api/ingreso", {metodo:"POST",
      cuerpo:{usuario: usuario, derivada: derivada, codigo: codigo.trim()}});
    if (e.estado !== 200 || !e.cuerpo || !e.cuerpo.ficha) {
      alert((e.cuerpo && e.cuerpo.error) || "No se pudo entrar.");
      return false;
    }
    ficha = e.cuerpo.ficha;
    quien = e.cuerpo.usuario;

    a.usuario = usuario;
    a.alias = a.alias || {};
    if (typeof a.alias === "string") a.alias = {};      // formato viejo
    alias = (a.alias[usuario] || "").trim();
    if (!alias) {
      alias = (prompt("¿Con qué alias quieres aparecer ante el eje?\n\n" +
        "No pongas tu nombre: el eje acordó no guardar nombres reales. " +
        "Sirve algo como «datos», «norma» o «vocería».") || "").trim().slice(0, 40);
      if (!alias) { alert("Hace falta un alias."); ficha = null; return false; }
      a.alias[usuario] = alias;
    }
    guardarAjustes(a);

    var frase = prompt("Llave del eje, la que comparten entre ustedes.\n\n" +
      "Es distinta de tu contraseña: sirve para leer y escribir las notas, " +
      "y el servidor nunca la ve. Mínimo 16 caracteres.");
    if (frase === null || frase.length < 16) {
      alert("La llave del eje necesita al menos 16 caracteres.");
      ficha = null; return false;
    }
    llave = await estirar(frase, SAL_EJE, "llave");
    return true;
  }

  function conectado(){ return !!(ficha && llave); }
  function comoQuien(){ return quien; }
  function miAlias(){ return alias; }

  function desconectar(){
    if (ficha) pide("/api/salir", {metodo:"POST"}).catch(function(){});
    ficha = null; llave = null; quien = null;
  }

  async function cifrar(texto){
    var vec = crypto.getRandomValues(new Uint8Array(12));
    var c = await crypto.subtle.encrypt({name:"AES-GCM", iv:vec}, llave, cod.encode(texto));
    return {vector: aB64(vec), datos: aB64(c)};
  }
  async function descifrar(n){
    try {
      var claro = await crypto.subtle.decrypt(
        {name:"AES-GCM", iv:deB64(n.vector)}, llave, deB64(n.datos));
      return dec.decode(claro);
    } catch (e) {
      // Llave distinta: la nota es de alguien que usa otra. No se inventa nada.
      return null;
    }
  }

  /* trabajo: {punto: {campo: texto}}  ->  sube lo mio y baja lo de todos */
  async function sincronizar(trabajo, campos){
    if (!conectado()) throw new Error("Sin conexión con el eje.");
    var mias = [];
    var cuando = new Date().toISOString();
    for (var punto in trabajo) {
      if (!Object.prototype.hasOwnProperty.call(trabajo, punto)) continue;
      for (var i = 0; i < campos.length; i++) {
        var campo = campos[i];
        var txt = (trabajo[punto][campo] || "").trim();
        if (!txt) continue;
        var sobre = await cifrar(txt);
        mias.push({id: punto + ":" + campo + ":" + alias, punto: punto, campo: campo,
                   alias: alias, vector: sobre.vector, datos: sobre.datos, actualizado: cuando});
      }
    }
    if (mias.length) {
      var s = await pide("/api/notas", {metodo:"POST", cuerpo:{notas: mias}});
      if (s.estado === 401) { ficha = null; throw new Error("La sesión venció. Vuelve a entrar."); }
      if (s.estado !== 200) throw new Error((s.cuerpo && s.cuerpo.error) || "No se pudieron subir.");
    }

    var r = await pide("/api/notas");
    if (r.estado === 401) { ficha = null; throw new Error("La sesión venció. Vuelve a entrar."); }
    if (r.estado !== 200) throw new Error("No se pudieron bajar las notas.");

    var ajenas = {};
    var ilegibles = 0;
    for (var j = 0; j < r.cuerpo.notas.length; j++) {
      var n = r.cuerpo.notas[j];
      if (n.alias === alias) continue;              // lo mío ya lo tengo
      var txt2 = await descifrar(n);
      if (txt2 === null) { ilegibles++; continue; }
      ajenas[n.punto] = ajenas[n.punto] || {};
      ajenas[n.punto][n.campo] = ajenas[n.punto][n.campo] || [];
      ajenas[n.punto][n.campo].push({alias: n.alias, texto: txt2, cuando: n.actualizado});
    }
    return {ajenas: ajenas, subidas: mias.length, ilegibles: ilegibles};
  }

  return {conectar:conectar, conectado:conectado, desconectar:desconectar,
          sincronizar:sincronizar, comoQuien:comoQuien, miAlias:miAlias,
          ajustes:ajustes};
})();
