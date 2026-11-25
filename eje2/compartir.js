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
   Y si el eje pierde la llave, las notas no se recuperan.

   SOBRE RECORDAR LA SESION. La version anterior pedia seis cosas, una por una,
   y no sobrevivia a una recarga: en una mesa de negociacion eso no se sostiene,
   y un sistema que estorba termina en que alguien abre un chat cualquiera y por
   ahi se va la estrategia. Ahora la ficha de sesion y la llave del eje se
   guardan en el dispositivo con la misma proteccion que el analisis: cifradas
   si hay candado, en claro si no lo hay. Guardar la llave equivale a guardar la
   frase; por eso la recomendacion al eje es poner candado, y por eso el candado
   se cierra solo a los quince minutos. */
window.Compartir = (function(){
  var AJUSTES = "eje2-servidor-v1";    // no secreto: direccion, usuario, alias
  var GUARDADO = "sesion";             // nombre del secreto dentro del Candado
  var VUELTAS = 310000;
  // Sal fija de la aplicacion para la llave del eje. Una sal no es secreta;
  // su trabajo es que no sirva una tabla precalculada para todo el mundo. Con
  // 310 000 vueltas y una llave larga alcanza, pero por eso se exigen 16
  // caracteres y no 8.
  var SAL_EJE = "meuami-eje2-llave-del-eje-v1";

  var ficha = null;      // ficha de sesion
  var quien = null;
  var alias = null;
  var llave = null;      // llave del eje (CryptoKey)
  var vence = null;      // cuando expira la sesion del servidor

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
    // Extraible a proposito: hay que poder guardarla para no volver a pedirla
    // en cada recarga. Queda dentro del sobre del Candado, no suelta.
    return crypto.subtle.deriveKey(
      {name:"PBKDF2", salt:cod.encode(sal), iterations:VUELTAS, hash:"SHA-256"},
      base0, {name:"AES-GCM", length:256}, true, ["encrypt","decrypt"]);
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

  /* ----- Lo guardado entre recargas ----- */

  async function recordar(){
    if (!llave) return;
    var crudo = await crypto.subtle.exportKey("raw", llave);
    await Candado.guardaSecreto(GUARDADO, {
      ficha: ficha, quien: quien, alias: alias, vence: vence,
      llave: aB64(crudo)
    });
  }

  function olvidar(){ Candado.olvidaSecreto(GUARDADO); }

  // Devuelve que se logro recuperar: "todo", "llave" (la sesion vencio pero la
  // llave del eje sigue ahi) o "nada".
  async function recuperar(){
    var g = null;
    try { g = await Candado.leeSecreto(GUARDADO); } catch (e) { g = null; }
    if (!g || !g.llave) return "nada";
    try {
      llave = await crypto.subtle.importKey(
        "raw", deB64(g.llave), {name:"AES-GCM", length:256}, true, ["encrypt","decrypt"]);
    } catch (e) { llave = null; return "nada"; }
    alias = g.alias || null;
    quien = g.quien || null;
    if (g.ficha && g.vence && new Date(g.vence) > new Date()) {
      ficha = g.ficha; vence = g.vence;
      return "todo";
    }
    ficha = null; vence = null;
    return "llave";
  }

  /* ----- Ingreso -----
     Recibe un objeto del formulario. Ya no hay ventanitas encadenadas: la
     pantalla pide todo junto y esta funcion solo valida y habla con el
     servidor. Devuelve {ok:true} o {ok:false, error:"...", campo:"..."} para
     que la pantalla pueda senalar donde esta el problema. */
  async function entrar(datos){
    datos = datos || {};
    var a = ajustes();

    var url = String(datos.url || a.url || "").trim().replace(/\/+$/, "");
    if (!url) return {ok:false, campo:"url", error:"Falta la dirección del servidor del eje."};
    a.url = url;
    guardarAjustes(a);

    var usuario = String(datos.usuario || "").trim().toLowerCase();
    if (!usuario) return {ok:false, campo:"usuario", error:"Falta tu usuario."};

    var clave = String(datos.clave || "");
    if (!clave) return {ok:false, campo:"clave", error:"Falta tu contraseña."};

    var codigo = String(datos.codigo || "").replace(/\s+/g, "");
    if (!/^\d{6}$/.test(codigo)) {
      return {ok:false, campo:"codigo", error:"El código de la app son seis dígitos."};
    }

    // La llave del eje solo hace falta si no venia guardada de antes.
    var frase = String(datos.llave || "");
    if (!llave) {
      if (frase.length < 16) {
        return {ok:false, campo:"llave",
                error:"La llave del eje necesita al menos 16 caracteres. Es la que comparten entre ustedes, distinta de tu contraseña."};
      }
    }

    a.alias = a.alias || {};
    if (typeof a.alias === "string") a.alias = {};      // formato viejo
    var miAlias = String(datos.alias || a.alias[usuario] || "").trim().slice(0, 40);
    if (!miAlias) {
      return {ok:false, campo:"alias",
              error:"Hace falta un alias para firmar tus notas ante el eje."};
    }

    var r;
    try {
      r = await pide("/api/sal", {metodo:"POST", cuerpo:{usuario: usuario}});
    } catch (e) {
      return {ok:false, campo:"url",
              error:"No se pudo hablar con el servidor. Revisa la dirección y tu conexión."};
    }
    if (r.estado !== 200 || !r.cuerpo || !r.cuerpo.sal) {
      return {ok:false, campo:"url", error:"El servidor no respondió como se esperaba."};
    }

    var derivada = await estirar(clave, r.cuerpo.sal, "bits");
    var e = await pide("/api/ingreso", {metodo:"POST",
      cuerpo:{usuario: usuario, derivada: derivada, codigo: codigo}});
    if (e.estado !== 200 || !e.cuerpo || !e.cuerpo.ficha) {
      return {ok:false, campo:"clave",
              error:(e.cuerpo && e.cuerpo.error) || "No se pudo entrar."};
    }

    ficha = e.cuerpo.ficha;
    quien = e.cuerpo.usuario;
    vence = e.cuerpo.expira || null;
    alias = miAlias;

    a.usuario = usuario;
    a.alias[usuario] = miAlias;
    guardarAjustes(a);

    if (!llave) llave = await estirar(frase, SAL_EJE, "llave");

    if (datos.recordar !== false) { try { await recordar(); } catch (e2) {} }
    return {ok:true};
  }

  function conectado(){ return !!(ficha && llave); }
  function hayLlave(){ return !!llave; }
  function comoQuien(){ return quien; }
  function miAlias(){ return alias; }
  function expira(){ return vence; }

  function desconectar(opc){
    opc = opc || {};
    if (ficha) pide("/api/salir", {metodo:"POST"}).catch(function(){});
    ficha = null; quien = null; vence = null;
    if (opc.olvidarLlave !== false) { llave = null; alias = null; olvidar(); }
    else { recordar().catch(function(){}); }
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

  function caduco(){ ficha = null; vence = null; recordar().catch(function(){}); }

  /* trabajo: {punto: {campo: texto}}  ->  sube lo mio y baja lo de todos */
  async function sincronizar(trabajo, campos, opc){
    opc = opc || {};
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
    if (mias.length && opc.soloBajar !== true) {
      var s = await pide("/api/notas", {metodo:"POST", cuerpo:{notas: mias}});
      if (s.estado === 401) { caduco(); throw new Error("La sesión venció. Vuelve a entrar."); }
      if (s.estado !== 200) throw new Error((s.cuerpo && s.cuerpo.error) || "No se pudieron subir.");
    }

    var r = await pide("/api/notas");
    if (r.estado === 401) { caduco(); throw new Error("La sesión venció. Vuelve a entrar."); }
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
    return {ajenas: ajenas, subidas: opc.soloBajar === true ? 0 : mias.length, ilegibles: ilegibles};
  }

  return {entrar:entrar, recuperar:recuperar, conectado:conectado, hayLlave:hayLlave,
          desconectar:desconectar, sincronizar:sincronizar,
          comoQuien:comoQuien, miAlias:miAlias, expira:expira,
          ajustes:ajustes};
})();
