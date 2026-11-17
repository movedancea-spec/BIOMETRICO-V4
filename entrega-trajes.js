// ==========================================
// MODO ENTREGA DE TRAJES DEL SHOW (2026-11-16)
// Es POR DISPOSITIVO (decisión de Ana, 2026-11-16): el interruptor de
// Recepción (Alumnas Show → 📦 Entregas) solo PERMITE usarlo. Con el
// interruptor encendido, el biométrico muestra el botón "👗 Modo entrega de
// trajes"; quien lo toca escribe la clave de Recepción y SOLO ese celular
// entra al modo (permiso firmado de 12 h, guardado solo aquí). Los demás
// siguen marcando asistencia normal.
// En el modo, esta pantalla tapa el biométrico: el código de 3 dígitos NO
// marca asistencia ni toca la racha (nunca se llama a move-checkin-v2), solo
// muestra los trajes de la alumna para entregarlos con foto. Todo lo decide
// el Worker del portal (portalalumnas, ENTREGA DE TRAJES CON EL BIOMÉTRICO).
// - Sale con "↩ Volver a asistencia", y solo cuando vence el permiso o
//   Recepción apaga el interruptor (si estaba a media entrega, al terminarla).
// - Nunca guarda la clave, solo el permiso.
// - Las fotos se comprimen aquí (JPG de 1600 px) antes de subirlas.
// - Sin señal: se avisa y no se guarda nada a medias. El reintento manda el
//   mismo ID de entrega, así nunca se duplica.
// biometrico.js no se toca: si este archivo no carga, el biométrico sigue
// marcando asistencia como siempre.
// ==========================================
(function () {
  const WORKER = ["localhost", "127.0.0.1"].includes(location.hostname)
    ? "http://localhost:8787"
    : "https://portalalumnas.movedancea.workers.dev";
  const LLAVE_PERMISO = "move_permiso_entrega_trajes";
  const SEGUNDOS_REVISAR_MODO = 30;
  const SEGUNDOS_EXITO = 6;
  const LADO_MAXIMO_FOTO = 1600;
  const BYTES_MAXIMOS_FOTO = 900 * 1024;
  const MAX_FOTOS = 8;

  let permitido = false; // el interruptor de Recepción
  let pantalla = ""; // clave | codigo | trajes | fotos | enviando | error | exito
  let codigo = "";
  let alumna = null; // { nombre, trajes: [...] }
  let elegidos = new Set();
  let fotos = []; // [{ blob, url, archivo }]
  let entregaId = "";
  let temporizadorExito = null;
  let accionReintentar = null;

  // ---------- Utilidades ----------
  const $ = (id) => document.getElementById(id);
  function crear(tag, clase, texto) {
    const e = document.createElement(tag);
    if (clase) e.className = clase;
    if (texto !== undefined) e.textContent = texto;
    return e;
  }
  const sonar = (nombre) => {
    try {
      if (typeof window[nombre] === "function") window[nombre]();
    } catch (e) {}
  };

  function leerPermiso() {
    try {
      const g = JSON.parse(localStorage.getItem(LLAVE_PERMISO) || "null");
      return g && g.permiso && g.vence > Date.now() + 60000 ? g.permiso : "";
    } catch (e) {
      return "";
    }
  }
  function guardarPermiso(permiso, vence) {
    try {
      localStorage.setItem(LLAVE_PERMISO, JSON.stringify({ permiso, vence }));
      permisoEnMemoria = null;
    } catch (e) {
      permisoEnMemoria = { permiso, vence };
    }
  }
  function borrarPermiso() {
    try {
      localStorage.removeItem(LLAVE_PERMISO);
    } catch (e) {}
    permisoEnMemoria = null;
  }
  // Solo si el navegador no deja guardar (modo privado) el permiso vive en
  // memoria; si no, la copia guardada es la única (y su vencimiento manda).
  let permisoEnMemoria = null;
  const permisoActual = () => leerPermiso() || (permisoEnMemoria && permisoEnMemoria.vence > Date.now() + 60000 ? permisoEnMemoria.permiso : "");

  // "10 nov, 4:30 p.m." siempre en hora de Guatemala.
  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const FORMATO = new Intl.DateTimeFormat("en-US", { timeZone: "America/Guatemala", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", hourCycle: "h23" });
  function fechaHora(iso) {
    const f = new Date(iso);
    if (isNaN(f.getTime())) return "";
    const p = {};
    FORMATO.formatToParts(f).forEach((x) => (p[x.type] = x.value));
    const h = Number(p.hour) % 24;
    return `${Number(p.day)} ${MESES[Number(p.month) - 1]}, ${h % 12 || 12}:${p.minute} ${h < 12 ? "a.m." : "p.m."}`;
  }

  // Sin señal = el fetch ni siquiera llega (TypeError) o se pasa del tiempo.
  class SinSenal extends Error {}
  async function llamar(cuerpo, segundos = 25) {
    if (navigator.onLine === false) throw new SinSenal();
    const control = new AbortController();
    const t = setTimeout(() => control.abort(), segundos * 1000);
    let r;
    try {
      r = await fetch(WORKER, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo), signal: control.signal });
    } catch (e) {
      throw new SinSenal();
    } finally {
      clearTimeout(t);
    }
    const datos = await r.json().catch(() => ({ success: false, error: "Respuesta inesperada del servidor." }));
    datos.status = r.status;
    return datos;
  }

  async function subirFoto(blob) {
    if (navigator.onLine === false) throw new SinSenal();
    const control = new AbortController();
    const t = setTimeout(() => control.abort(), 60000);
    let r;
    try {
      r = await fetch(WORKER + "/subirFotoEntregaTraje", {
        method: "POST",
        headers: { "Content-Type": "image/jpeg", "X-Permiso-Entrega": permisoActual() },
        body: blob,
        signal: control.signal,
      });
    } catch (e) {
      throw new SinSenal();
    } finally {
      clearTimeout(t);
    }
    const datos = await r.json().catch(() => ({ success: false }));
    datos.status = r.status;
    return datos;
  }

  // Foto de la cámara → JPG de máximo 1600 px. Se prueba con menos calidad
  // si quedó pesada (el Worker acepta hasta 1.2 MB).
  async function comprimir(archivo) {
    let fuente;
    try {
      fuente = await createImageBitmap(archivo, { imageOrientation: "from-image" });
    } catch (e) {
      fuente = await new Promise((ok, mal) => {
        const img = new Image();
        img.onload = () => ok(img);
        img.onerror = () => mal(new Error("No se pudo leer la foto."));
        img.src = URL.createObjectURL(archivo);
      });
    }
    const ancho = fuente.width || fuente.naturalWidth;
    const alto = fuente.height || fuente.naturalHeight;
    const escala = Math.min(1, LADO_MAXIMO_FOTO / Math.max(ancho, alto));
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.round(ancho * escala);
    lienzo.height = Math.round(alto * escala);
    lienzo.getContext("2d").drawImage(fuente, 0, 0, lienzo.width, lienzo.height);
    let blob = null;
    for (const calidad of [0.82, 0.7, 0.58, 0.45]) {
      blob = await new Promise((ok) => lienzo.toBlob(ok, "image/jpeg", calidad));
      if (blob && blob.size <= BYTES_MAXIMOS_FOTO) break;
    }
    if (!blob) throw new Error("No se pudo preparar la foto.");
    return blob;
  }

  // ---------- Pantallas ----------
  function armar() {
    const capa = crear("div", "et-capa");
    capa.id = "etCapa";
    capa.hidden = true;
    capa.setAttribute("role", "dialog");
    capa.setAttribute("aria-label", "Entrega de trajes del show");
    capa.innerHTML = `
      <div class="et-barra">
        <div class="et-barra-textos"><span class="et-barra-titulo">👗 Entrega de trajes</span><span class="et-barra-pista">Solo en este celular · no marca asistencia</span></div>
        <button id="etBtnVolverAsistencia" class="et-btn-volver" type="button">↩ Volver a asistencia</button>
      </div>
      <section class="et-pantalla" id="etClave" hidden>
        <p class="et-grande">🔐 Clave de Recepción</p>
        <p class="et-texto">Escribe la clave de Recepción para usar ESTE celular en modo entrega de trajes durante 12 horas. Los demás biométricos siguen marcando asistencia.</p>
        <input id="etInputClave" class="et-input" type="password" autocomplete="off" placeholder="Clave de Recepción" />
        <button id="etBtnClave" class="et-btn et-btn-principal" type="button">Activar en este celular</button>
        <p id="etMsgClave" class="et-msg" role="alert"></p>
      </section>
      <section class="et-pantalla" id="etCodigo" hidden>
        <p class="et-grande">Código de la alumna</p>
        <p class="et-texto">Escribe su código de 3 dígitos.</p>
        <div id="etPuntos" class="et-puntos"><span></span><span></span><span></span></div>
        <p id="etMsgCodigo" class="et-msg" role="alert"></p>
        <div id="etTeclado" class="et-teclado"></div>
      </section>
      <section class="et-pantalla" id="etTrajes" hidden>
        <p class="et-nombre" id="etNombre"></p>
        <p class="et-texto" id="etPistaTrajes">Marca los trajes que se entregan ahora.</p>
        <div id="etListaTrajes" class="et-lista"></div>
        <button id="etBtnAFotos" class="et-btn et-btn-principal" type="button" disabled>Siguiente: fotos 📷</button>
        <button id="etBtnCancelar1" class="et-btn et-btn-secundario" type="button">✕ Cancelar</button>
      </section>
      <section class="et-pantalla" id="etFotos" hidden>
        <p class="et-nombre" id="etNombre2"></p>
        <p class="et-texto" id="etResumenFotos"></p>
        <p class="et-texto">Toma una foto de la persona que recibe <strong>con el traje</strong>. Al menos una.</p>
        <label class="et-btn et-btn-camara" for="etInputFoto">📷 Tomar foto</label>
        <input id="etInputFoto" type="file" accept="image/*" capture="environment" hidden />
        <div id="etMiniaturas" class="et-miniaturas"></div>
        <p id="etMsgFotos" class="et-msg" role="alert"></p>
        <button id="etBtnConfirmar" class="et-btn et-btn-confirmar" type="button" disabled>✅ Confirmar entrega</button>
        <button id="etBtnAtras" class="et-btn et-btn-secundario" type="button">← Atrás</button>
      </section>
      <section class="et-pantalla et-centro" id="etEnviando" hidden>
        <div class="et-giro" aria-hidden="true"></div>
        <p class="et-grande" id="etTextoEnviando">Guardando la entrega…</p>
        <p class="et-texto">No cierres esta pantalla.</p>
      </section>
      <section class="et-pantalla et-centro" id="etError" hidden>
        <p class="et-icono" id="etIconoError">📵</p>
        <p class="et-grande" id="etTituloError">Sin señal</p>
        <p class="et-texto" id="etTextoError"></p>
        <button id="etBtnReintentar" class="et-btn et-btn-principal" type="button">🔄 Reintentar</button>
        <button id="etBtnCancelarError" class="et-btn et-btn-secundario" type="button">✕ Cancelar entrega</button>
      </section>
      <section class="et-pantalla et-centro et-exito" id="etExito" hidden>
        <p class="et-icono">✅</p>
        <p class="et-titulo-exito">¡Traje entregado!</p>
        <p class="et-nombre" id="etExitoNombre"></p>
        <p class="et-texto" id="etExitoBailes"></p>
        <p class="et-texto" id="etExitoHora"></p>
        <button id="etBtnSiguiente" class="et-btn et-btn-principal" type="button">Siguiente alumna</button>
        <p class="et-texto et-chico" id="etCuentaExito"></p>
      </section>
      <div class="et-modal" id="etModal" hidden>
        <div class="et-modal-caja" role="alertdialog" aria-labelledby="etModalTexto">
          <p class="et-modal-icono">⚠️</p>
          <p class="et-modal-texto" id="etModalTexto"></p>
          <button id="etModalSi" class="et-btn et-btn-principal" type="button">Sí, entregar igual</button>
          <button id="etModalNo" class="et-btn et-btn-secundario" type="button">No, regresar</button>
        </div>
      </div>`;
    document.body.appendChild(capa);

    // Botón en la pantalla de asistencia, debajo de "Validar código de
    // recogida". Solo se ve con el interruptor de Recepción encendido.
    const entrar = crear("button", "btn-modo-entrega-trajes", "👗 Modo entrega de trajes");
    entrar.type = "button";
    entrar.id = "btnModoEntregaTrajes";
    entrar.hidden = true;
    const ancla = $("btnModoRecogida");
    if (ancla) ancla.insertAdjacentElement("afterend", entrar);
    else (document.querySelector(".container") || document.body).appendChild(entrar);
    entrar.addEventListener("click", () => {
      if (!permitido) return;
      sonar("playKeySound");
      encenderCapa();
    });

    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", ""].forEach((t) => {
      const b = crear("button", "et-tecla" + (t ? "" : " et-tecla-vacia"), t);
      b.type = "button";
      if (!t) b.disabled = true;
      b.addEventListener("click", () => tecla(t));
      $("etTeclado").appendChild(b);
    });
    $("etBtnClave").addEventListener("click", pedirPermiso);
    $("etBtnVolverAsistencia").addEventListener("click", volverAAsistencia);
    $("etInputClave").addEventListener("keydown", (e) => e.key === "Enter" && pedirPermiso());
    $("etBtnAFotos").addEventListener("click", () => mostrar("fotos"));
    $("etBtnCancelar1").addEventListener("click", volverAlCodigo);
    $("etBtnAtras").addEventListener("click", () => mostrar("trajes"));
    $("etInputFoto").addEventListener("change", agregarFoto);
    $("etBtnConfirmar").addEventListener("click", revisarAntesDeConfirmar);
    $("etBtnReintentar").addEventListener("click", () => accionReintentar && accionReintentar());
    $("etBtnCancelarError").addEventListener("click", volverAlCodigo);
    $("etBtnSiguiente").addEventListener("click", volverAlCodigo);
    $("etModalNo").addEventListener("click", () => ($("etModal").hidden = true));
    $("etModalSi").addEventListener("click", () => {
      $("etModal").hidden = true;
      enviarEntrega();
    });
  }

  function mostrar(nombre) {
    pantalla = nombre;
    const ids = { clave: "etClave", codigo: "etCodigo", trajes: "etTrajes", fotos: "etFotos", enviando: "etEnviando", error: "etError", exito: "etExito" };
    Object.entries(ids).forEach(([n, id]) => ($(id).hidden = n !== nombre));
    if (nombre === "trajes") pintarTrajes();
    if (nombre === "fotos") pintarFotos();
    if (nombre === "clave") setTimeout(() => $("etInputClave").focus(), 50);
    // Mientras se guarda no se puede salir (la entrega quedaría sin saber).
    $("etBtnVolverAsistencia").hidden = nombre === "enviando";
    $("etCapa").scrollTop = 0;
  }

  function encenderCapa() {
    $("etCapa").hidden = false;
    document.body.classList.add("et-activo");
    $("btnModoEntregaTrajes").hidden = true;
    if (!pantalla) mostrar(permisoActual() ? "codigo" : "clave");
  }

  function apagarCapa() {
    $("etCapa").hidden = true;
    document.body.classList.remove("et-activo");
    limpiarEntrega();
    pantalla = "";
    $("etInputClave").value = "";
    $("etMsgClave").textContent = "";
    $("btnModoEntregaTrajes").hidden = !permitido;
  }

  // "↩ Volver a asistencia": este celular sale del modo y olvida el permiso
  // (para volver a entrar hay que escribir la clave otra vez).
  function volverAAsistencia() {
    if (pantalla === "enviando") return;
    sonar("playKeySound");
    borrarPermiso();
    apagarCapa();
  }

  const capaAbierta = () => !$("etCapa").hidden;
  // A media entrega (trajes elegidos, fotos, error por reintentar) no se corta.
  const aMediaEntrega = () => ["trajes", "fotos", "enviando", "error"].includes(pantalla);

  function limpiarEntrega() {
    clearInterval(temporizadorExito);
    fotos.forEach((f) => URL.revokeObjectURL(f.url));
    fotos = [];
    elegidos = new Set();
    alumna = null;
    codigo = "";
    entregaId = "";
    accionReintentar = null;
    $("etModal").hidden = true;
    pintarPuntos();
  }

  function volverAlCodigo() {
    limpiarEntrega();
    $("etMsgCodigo").textContent = "";
    // Recepción apagó el interruptor o venció el permiso: a asistencia.
    if (!permitido || !permisoActual()) {
      borrarPermiso();
      return apagarCapa();
    }
    mostrar("codigo");
  }

  function mostrarError({ icono = "📵", titulo = "Sin señal", texto, reintentar }) {
    $("etIconoError").textContent = icono;
    $("etTituloError").textContent = titulo;
    $("etTextoError").textContent = texto;
    accionReintentar = reintentar || null;
    $("etBtnReintentar").hidden = !reintentar;
    sonar("playErrorSound");
    mostrar("error");
  }

  const TEXTO_SIN_SENAL = "No hay internet en este celular. No se guardó nada de esta entrega: revisa el Wi-Fi o los datos y toca Reintentar.";

  // ---------- Clave ----------
  async function pedirPermiso() {
    const clave = $("etInputClave").value.trim();
    if (!clave) return ($("etMsgClave").textContent = "Escribe la clave.");
    $("etBtnClave").disabled = true;
    $("etMsgClave").textContent = "Revisando…";
    try {
      const r = await llamar({ accion: "entregaTrajesPermiso", clave });
      if (!r.success) {
        $("etMsgClave").textContent = r.error || "No se pudo revisar la clave.";
        sonar("playErrorSound");
        if (r.apagado) actualizarPermitido(false);
        return;
      }
      guardarPermiso(r.permiso, r.vence);
      $("etInputClave").value = "";
      $("etMsgClave").textContent = "";
      mostrar("codigo");
    } catch (e) {
      $("etMsgClave").textContent = "📵 Sin señal. Revisa el internet e intenta de nuevo.";
    } finally {
      $("etBtnClave").disabled = false;
    }
  }

  // Venció el permiso (o cambiaron la clave de Recepción): este celular
  // vuelve solo a asistencia. Si fue al guardar, se avisa que no se guardó.
  function permisoVencido() {
    borrarPermiso();
    if (pantalla === "enviando") {
      return mostrarError({ icono: "⏰", titulo: "Venció el permiso", texto: "Pasaron las 12 horas del modo entrega. No se guardó esta entrega: el celular vuelve a asistencia.", reintentar: null });
    }
    apagarCapa();
  }

  // ---------- Código ----------
  function pintarPuntos() {
    const puntos = $("etPuntos");
    if (!puntos) return;
    [...puntos.children].forEach((p, i) => p.classList.toggle("lleno", i < codigo.length));
  }

  function tecla(t) {
    if (pantalla !== "codigo" || !t) return;
    sonar("playKeySound");
    $("etMsgCodigo").textContent = "";
    if (t === "⌫") codigo = codigo.slice(0, -1);
    else if (codigo.length < 3) codigo += t;
    pintarPuntos();
    if (codigo.length === 3) buscar();
  }

  async function buscar() {
    $("etMsgCodigo").textContent = "⏳ Buscando…";
    try {
      const r = await llamar({ accion: "entregaTrajesBuscar", permiso: permisoActual(), codigo });
      if (r.sinPermiso) return permisoVencido();
      if (r.apagado) return actualizarPermitido(false);
      if (!r.success) {
        sonar("playErrorSound");
        $("etMsgCodigo").textContent = r.noEncontrado ? "❌ Código no encontrado" : "❌ " + (r.error || "No se pudo buscar.");
        codigo = "";
        pintarPuntos();
        return;
      }
      alumna = { nombre: r.alumna, trajes: r.trajes || [] };
      elegidos = new Set();
      entregaId = "";
      $("etMsgCodigo").textContent = "";
      mostrar("trajes");
    } catch (e) {
      sonar("playErrorSound");
      $("etMsgCodigo").textContent = "📵 Sin señal. Revisa el internet e intenta de nuevo.";
      codigo = "";
      pintarPuntos();
    }
  }

  // ---------- Trajes ----------
  function pintarTrajes() {
    $("etNombre").textContent = alumna.nombre;
    const lista = $("etListaTrajes");
    lista.innerHTML = "";
    const pendientes = alumna.trajes.filter((t) => !t.entregado);
    if (!alumna.trajes.length) {
      $("etPistaTrajes").textContent = "Esta alumna no tiene trajes del show.";
    } else if (!pendientes.length) {
      $("etPistaTrajes").textContent = "Todos sus trajes ya se entregaron.";
    } else {
      $("etPistaTrajes").textContent = "Marca los trajes que se entregan ahora.";
    }
    alumna.trajes.forEach((t) => {
      const b = crear("button", "et-traje");
      b.type = "button";
      const marcado = elegidos.has(t.asignacionId);
      if (t.entregado) {
        b.classList.add("et-traje-entregado");
        b.disabled = true;
      } else if (marcado) b.classList.add("et-traje-elegido");
      b.setAttribute("aria-pressed", marcado ? "true" : "false");
      const caja = crear("span", "et-traje-caja", t.entregado ? "✓" : marcado ? "✓" : "");
      caja.setAttribute("aria-hidden", "true");
      const texto = crear("span", "et-traje-texto");
      texto.appendChild(crear("span", "et-traje-baile", "👗 " + t.baile));
      if (t.entregado) texto.appendChild(crear("span", "et-traje-estado", "✅ Entregado · " + fechaHora(t.entregado)));
      else if (t.listo) texto.appendChild(crear("span", "et-traje-estado et-ok", "📦 Listo para entrega"));
      else texto.appendChild(crear("span", "et-traje-estado et-alerta", "⚠️ No está marcado como Listo para entrega"));
      b.append(caja, texto);
      b.addEventListener("click", () => {
        if (t.entregado) return;
        sonar("playKeySound");
        elegidos.has(t.asignacionId) ? elegidos.delete(t.asignacionId) : elegidos.add(t.asignacionId);
        entregaId = ""; // otra selección = otra entrega
        pintarTrajes();
      });
      lista.appendChild(b);
    });
    $("etBtnAFotos").disabled = !elegidos.size;
    $("etBtnAFotos").hidden = !pendientes.length;
    $("etBtnCancelar1").textContent = pendientes.length ? "✕ Cancelar" : "← Otra alumna";
  }

  const trajesElegidos = () => alumna.trajes.filter((t) => elegidos.has(t.asignacionId));

  // ---------- Fotos ----------
  function pintarFotos() {
    $("etNombre2").textContent = alumna.nombre;
    const nombres = trajesElegidos().map((t) => t.baile);
    $("etResumenFotos").textContent = (nombres.length > 1 ? "Trajes: " : "Traje: ") + nombres.join(", ");
    const cont = $("etMiniaturas");
    cont.innerHTML = "";
    fotos.forEach((f, i) => {
      const caja = crear("div", "et-mini");
      const img = crear("img");
      img.src = f.url;
      img.alt = `Foto ${i + 1}`;
      const quitar = crear("button", "et-mini-quitar", "✕");
      quitar.type = "button";
      quitar.setAttribute("aria-label", `Quitar foto ${i + 1}`);
      quitar.addEventListener("click", () => {
        URL.revokeObjectURL(f.url);
        fotos.splice(i, 1);
        pintarFotos();
      });
      caja.append(img, quitar);
      cont.appendChild(caja);
    });
    const etiqueta = document.querySelector('label[for="etInputFoto"]');
    etiqueta.textContent = fotos.length ? "📷 Tomar otra foto" : "📷 Tomar foto";
    etiqueta.classList.toggle("et-deshabilitado", fotos.length >= MAX_FOTOS);
    $("etInputFoto").disabled = fotos.length >= MAX_FOTOS;
    $("etBtnConfirmar").disabled = !fotos.length;
    $("etMsgFotos").textContent = fotos.length >= MAX_FOTOS ? `Máximo ${MAX_FOTOS} fotos.` : "";
  }

  async function agregarFoto(e) {
    const archivo = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!archivo) return;
    $("etMsgFotos").textContent = "Preparando la foto…";
    try {
      const blob = await comprimir(archivo);
      fotos.push({ blob, url: URL.createObjectURL(blob), archivo: "" });
      pintarFotos();
    } catch (err) {
      $("etMsgFotos").textContent = "No se pudo usar esa foto. Toma otra.";
    }
  }

  function revisarAntesDeConfirmar() {
    if (!fotos.length) return ($("etMsgFotos").textContent = "Toma al menos una foto.");
    const noListos = trajesElegidos().filter((t) => !t.listo);
    if (noListos.length) {
      $("etModalTexto").textContent =
        noListos.length === 1
          ? `El traje “${noListos[0].baile}” no está marcado como Listo para entrega. ¿Entregar igual?`
          : `Estos trajes no están marcados como Listo para entrega: ${noListos.map((t) => t.baile).join(", ")}. ¿Entregar igual?`;
      $("etModal").hidden = false;
      return;
    }
    enviarEntrega();
  }

  function nuevoIdEntrega() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // ---------- Enviar ----------
  async function enviarEntrega(yaReintentoFotos = false) {
    if (!entregaId) entregaId = nuevoIdEntrega();
    accionReintentar = () => enviarEntrega();
    mostrar("enviando");
    try {
      for (let i = 0; i < fotos.length; i++) {
        if (fotos[i].archivo) continue; // ya subida en un intento anterior
        $("etTextoEnviando").textContent = fotos.length > 1 ? `Subiendo foto ${i + 1} de ${fotos.length}…` : "Subiendo la foto…";
        const r = await subirFoto(fotos[i].blob);
        if (r.sinPermiso) return permisoVencido();
        if (r.apagado) return entregaApagada();
        if (!r.success) return mostrarError({ icono: "⚠️", titulo: "No se pudo subir la foto", texto: (r.error || "Intenta de nuevo.") + " No se guardó la entrega.", reintentar: accionReintentar });
        fotos[i].archivo = r.archivo;
      }
      $("etTextoEnviando").textContent = "Guardando la entrega…";
      const r = await llamar({
        accion: "entregaTrajesConfirmar",
        permiso: permisoActual(),
        codigo,
        entregaId,
        asignacionIds: [...elegidos],
        fotos: fotos.map((f) => f.archivo),
      }, 40);
      if (r.success) return mostrarExito(r);
      if (r.sinPermiso) return permisoVencido();
      if (r.apagado) return entregaApagada();
      if (r.fotosFaltan && !yaReintentoFotos) {
        fotos.forEach((f) => (f.archivo = ""));
        return enviarEntrega(true);
      }
      if (r.cambio) {
        return mostrarError({ icono: "⚠️", titulo: "Algo cambió", texto: (r.error || "Vuelve a escribir el código.") + " No se guardó esta entrega.", reintentar: null });
      }
      return mostrarError({ icono: "⚠️", titulo: "No se guardó", texto: r.error || "No se pudo guardar la entrega. No se entregó nada: intenta de nuevo.", reintentar: accionReintentar });
    } catch (e) {
      if (e instanceof SinSenal) return mostrarError({ texto: TEXTO_SIN_SENAL, reintentar: accionReintentar });
      return mostrarError({ icono: "⚠️", titulo: "No se guardó", texto: "Algo falló. No se entregó nada: intenta de nuevo.", reintentar: accionReintentar });
    }
  }

  function entregaApagada() {
    permitido = false;
    mostrarError({ icono: "⏸️", titulo: "Modo entrega apagado", texto: "Recepción apagó el modo entrega. No se guardó esta entrega: el celular vuelve a asistencia.", reintentar: null });
  }

  function mostrarExito(r) {
    sonar("playSuccessSound");
    $("etExitoNombre").textContent = r.alumna || alumna.nombre;
    const bailes = r.bailes || [];
    $("etExitoBailes").textContent = (bailes.length > 1 ? "Trajes: " : "Traje: ") + bailes.join(", ");
    $("etExitoHora").textContent = r.fecha ? "🕒 " + fechaHora(r.fecha) : "";
    mostrar("exito");
    let quedan = SEGUNDOS_EXITO;
    $("etCuentaExito").textContent = `Siguiente alumna en ${quedan} s`;
    clearInterval(temporizadorExito);
    temporizadorExito = setInterval(() => {
      quedan--;
      if (quedan <= 0) return volverAlCodigo();
      $("etCuentaExito").textContent = `Siguiente alumna en ${quedan} s`;
    }, 1000);
  }

  // ---------- ¿Lo permite Recepción? ¿Sigue vigente el permiso? ----------
  function actualizarPermitido(valor) {
    permitido = valor;
    if (!permitido) {
      // Recepción lo apagó: este celular vuelve a asistencia (si estaba a
      // media entrega, al terminarla: el Worker igual ya no la acepta).
      if (capaAbierta() && !aMediaEntrega()) {
        borrarPermiso();
        apagarCapa();
      }
      if (!capaAbierta()) borrarPermiso();
      $("btnModoEntregaTrajes").hidden = true;
      return;
    }
    // Este celular ya estaba en modo entrega (se recargó la página): sigue.
    if (!capaAbierta() && permisoActual()) return encenderCapa();
    $("btnModoEntregaTrajes").hidden = capaAbierta();
  }

  function revisarPermiso() {
    // Vencieron las 12 h sin tocar nada: de vuelta a asistencia.
    if (capaAbierta() && pantalla !== "clave" && !aMediaEntrega() && !permisoActual()) apagarCapa();
  }

  async function revisarModo() {
    revisarPermiso();
    try {
      const r = await llamar({ accion: "entregaTrajesModo" }, 10);
      // Si no se pudo saber (Airtable caído), se queda como estaba.
      if (r.success) actualizarPermitido(r.activo === true);
    } catch (e) {}
  }

  armar();
  revisarModo();
  setInterval(revisarModo, SEGUNDOS_REVISAR_MODO * 1000);
  // Al volver a la pantalla (el celular se bloqueó), se revisa enseguida.
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && revisarModo());
})();
