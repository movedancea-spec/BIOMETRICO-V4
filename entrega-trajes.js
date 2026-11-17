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
// - Android (2026-11-17): la cámara se abre con un botón que llama a
//   input.click() en el mismo toque (sin nada asíncrono antes; un input con
//   display:none + <label> falla en algunos navegadores de Android). Si
//   Android recarga la página al volver de la cámara por falta de memoria,
//   la entrega a medias (código, alumna, trajes y fotos ya tomadas) vuelve
//   de sessionStorage + IndexedDB y espera la foto. "🖼️ Elegir de la
//   galería" es el respaldo sin capture.
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
  const ES_LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
  // Entrega a medias por si Android recarga la página al volver de la cámara.
  const LLAVE_EN_CURSO = "move_entrega_trajes_en_curso";
  const MINUTOS_EN_CURSO = 30;

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

  // Foto de la cámara o la galería → JPG de máximo 1600 px. Se prueba con
  // menos calidad si quedó pesada (el Worker acepta hasta 1.2 MB).
  // Android: una foto de 12–50 MP decodificada entera ocupa 50–200 MB y el
  // canvas puede fallar sin avisar. Por eso primero se mide (el <img> lee el
  // tamaño ya girado según el EXIF) y createImageBitmap la reduce AL
  // DECODIFICAR (resizeWidth/resizeHeight). Si el navegador no puede, se
  // decodifica entera y se reduce a la mitad por pasos.
  class FotoNoSirve extends Error {}
  const esHeic = (archivo) => /hei[cf]/i.test(archivo.type || "") || /\.hei[cf]$/i.test(archivo.name || "");
  const conTiempo = (promesa, segundos) =>
    Promise.race([promesa, new Promise((_, mal) => setTimeout(() => mal(new Error("tiempo")), segundos * 1000))]);

  function abrirComoImagen(archivo) {
    return conTiempo(
      new Promise((ok, mal) => {
        const url = URL.createObjectURL(archivo);
        const img = new Image();
        img.onload = () => ok({ img, soltar: () => URL.revokeObjectURL(url) });
        img.onerror = () => {
          URL.revokeObjectURL(url);
          mal(new Error("No se pudo leer la foto."));
        };
        img.src = url;
      }),
      30
    );
  }

  function medidaFinal(ancho, alto) {
    const escala = Math.min(1, LADO_MAXIMO_FOTO / Math.max(ancho, alto));
    return { ancho: Math.max(1, Math.round(ancho * escala)), alto: Math.max(1, Math.round(alto * escala)) };
  }

  // Reduce a la mitad hasta quedar cerca del tamaño final (dibujar de un
  // golpe 6000 px en 1600 px se ve pixelado y en Android a veces falla).
  function reducirPorPasos(fuente, ancho, alto) {
    const final = medidaFinal(ancho, alto);
    let actual = fuente;
    let w = ancho;
    let h = alto;
    while (w / 2 >= final.ancho * 1.2) {
      w = Math.round(w / 2);
      h = Math.round(h / 2);
      const paso = document.createElement("canvas");
      paso.width = w;
      paso.height = h;
      paso.getContext("2d").drawImage(actual, 0, 0, w, h);
      if (actual instanceof HTMLCanvasElement) actual.width = 0; // soltar memoria
      actual = paso;
    }
    return { actual, final };
  }

  async function comprimir(archivo) {
    if (archivo.type && !/^image\//i.test(archivo.type)) throw new FotoNoSirve("Ese archivo no es una foto. Toma otra.");
    const lienzo = document.createElement("canvas");
    const ctx = lienzo.getContext("2d");
    let listo = false;

    // 1) Medir y reducir al decodificar.
    try {
      const { img, soltar } = await abrirComoImagen(archivo);
      const final = medidaFinal(img.naturalWidth, img.naturalHeight);
      soltar();
      const bitmap = await conTiempo(
        createImageBitmap(archivo, { imageOrientation: "from-image", resizeWidth: final.ancho, resizeHeight: final.alto, resizeQuality: "high" }),
        30
      );
      lienzo.width = bitmap.width;
      lienzo.height = bitmap.height;
      ctx.drawImage(bitmap, 0, 0);
      if (bitmap.close) bitmap.close();
      listo = true;
    } catch (e) {}

    // 2) Respaldo: decodificar entera y reducir por pasos.
    if (!listo) {
      let fuente = null;
      let soltar = () => {};
      try {
        fuente = await conTiempo(createImageBitmap(archivo, { imageOrientation: "from-image" }), 30);
      } catch (e) {
        try {
          const abierta = await abrirComoImagen(archivo);
          fuente = abierta.img;
          soltar = abierta.soltar;
        } catch (e2) {
          throw new FotoNoSirve(
            esHeic(archivo)
              ? "Este navegador no puede abrir fotos HEIC. Usa «📷 Tomar foto» o elige una foto JPG."
              : "No se pudo abrir esa foto. Toma otra o elígela de la galería."
          );
        }
      }
      try {
        const ancho = fuente.width || fuente.naturalWidth;
        const alto = fuente.height || fuente.naturalHeight;
        const { actual, final } = reducirPorPasos(fuente, ancho, alto);
        lienzo.width = final.ancho;
        lienzo.height = final.alto;
        ctx.drawImage(actual, 0, 0, final.ancho, final.alto);
        if (actual instanceof HTMLCanvasElement) actual.width = 0;
      } catch (e) {
        throw new FotoNoSirve("La foto es demasiado grande para este celular. Toma otra con menos resolución o elígela de la galería.");
      } finally {
        if (fuente && fuente.close) fuente.close();
        soltar();
      }
    }

    let blob = null;
    for (const calidad of [0.82, 0.7, 0.58, 0.45]) {
      blob = await new Promise((ok) => lienzo.toBlob(ok, "image/jpeg", calidad));
      if (blob && blob.size <= BYTES_MAXIMOS_FOTO) break;
    }
    lienzo.width = 0;
    if (!blob || !blob.size) throw new FotoNoSirve("No se pudo preparar la foto en este celular. Toma otra o elígela de la galería.");
    return blob;
  }

  // ---------- Entrega a medias (si Android recarga la página) ----------
  // sessionStorage: código, alumna, trajes marcados y si la cámara estaba
  // abierta (se escribe ANTES de abrirla, en el mismo toque). IndexedDB: las
  // fotos ya tomadas (ya comprimidas, unos 300 KB cada una). Todo es "mejor
  // esfuerzo": si el navegador no deja guardar, la entrega sigue igual.
  const BASE_FOTOS = "move-entrega-trajes";
  function abrirBaseFotos() {
    return new Promise((ok, mal) => {
      if (!window.indexedDB) return mal(new Error("sin IndexedDB"));
      const pedido = indexedDB.open(BASE_FOTOS, 1);
      pedido.onupgradeneeded = () => pedido.result.createObjectStore("fotos");
      pedido.onsuccess = () => ok(pedido.result);
      pedido.onerror = () => mal(pedido.error);
    });
  }
  async function enBaseFotos(modo, hacer) {
    const db = await abrirBaseFotos();
    try {
      return await new Promise((ok, mal) => {
        const tx = db.transaction("fotos", modo);
        const pedido = hacer(tx.objectStore("fotos"));
        tx.oncomplete = () => ok(pedido && pedido.result);
        tx.onerror = () => mal(tx.error);
        tx.onabort = () => mal(tx.error);
      });
    } finally {
      db.close();
    }
  }
  const guardarFotoEnBase = (id, blob) => enBaseFotos("readwrite", (st) => st.put(blob, id)).catch(() => {});
  const leerFotoDeBase = (id) => enBaseFotos("readonly", (st) => st.get(id)).catch(() => null);
  const vaciarBaseFotos = () => enBaseFotos("readwrite", (st) => st.clear()).catch(() => {});

  let restaurando = false; // mientras vuelven las fotos de IndexedDB
  function guardarEnCurso(camaraAbierta = false) {
    if (restaurando || !alumna || !elegidos.size) return;
    try {
      sessionStorage.setItem(
        LLAVE_EN_CURSO,
        JSON.stringify({ codigo, alumna, elegidos: [...elegidos], entregaId, fotoIds: fotos.map((f) => f.id), camaraAbierta, guardado: Date.now() })
      );
    } catch (e) {}
  }
  function borrarEnCurso() {
    try {
      sessionStorage.removeItem(LLAVE_EN_CURSO);
    } catch (e) {}
    vaciarBaseFotos();
  }

  // Al cargar la página: si había una entrega a medias (y el permiso sigue),
  // vuelve a la pantalla de fotos. El Worker revisa todo otra vez al
  // confirmar, así que una alumna o un traje que cambió no se cuela.
  function restaurarEnCurso() {
    let g = null;
    try {
      g = JSON.parse(sessionStorage.getItem(LLAVE_EN_CURSO) || "null");
    } catch (e) {}
    if (!g) return;
    const vigente = g.alumna && Array.isArray(g.alumna.trajes) && Date.now() - Number(g.guardado) < MINUTOS_EN_CURSO * 60000;
    if (!vigente || !permisoActual()) return borrarEnCurso();
    const pendientes = new Set(g.alumna.trajes.filter((t) => !t.entregado).map((t) => t.asignacionId));
    const marcados = (g.elegidos || []).filter((id) => pendientes.has(id));
    if (!marcados.length) return borrarEnCurso();
    codigo = String(g.codigo || "");
    alumna = g.alumna;
    elegidos = new Set(marcados);
    // El mismo ID: si la página se recargó mientras se guardaba y la entrega
    // sí quedó, reintentar devuelve esa misma (nunca una segunda).
    entregaId = marcados.length === (g.elegidos || []).length ? String(g.entregaId || "") : "";
    restaurando = true;
    $("etCapa").hidden = false;
    document.body.classList.add("et-activo");
    $("btnModoEntregaTrajes").hidden = true;
    mostrar("fotos");
    if (g.camaraAbierta) {
      $("etAvisoFotos").textContent =
        "📱 La página se recargó al volver de la cámara (pasa en algunos Android con poca memoria). La entrega sigue aquí: toma la foto otra vez o elígela de la galería.";
      $("etAvisoFotos").hidden = false;
    }
    (async () => {
      for (const id of g.fotoIds || []) {
        const blob = await leerFotoDeBase(id);
        if (!(blob instanceof Blob) || pantalla !== "fotos" || fotos.length >= MAX_FOTOS) continue;
        fotos.push({ id, blob, url: URL.createObjectURL(blob), archivo: "" });
      }
      restaurando = false;
      if (pantalla === "fotos") pintarFotos();
      guardarEnCurso(false);
    })();
  }

  // ---------- Navegador dentro de WhatsApp / Facebook ----------
  // Su navegador interno a veces no abre la cámara ni deja elegir fotos.
  // (En local, ?ua=whatsapp|facebook|webview lo simula para probar.)
  function navegadorDeApp() {
    const prueba = ES_LOCAL ? new URLSearchParams(location.search).get("ua") : null;
    const ua = prueba ? { whatsapp: "WhatsApp/2.24 Android", facebook: "FBAN/FB4A;FBAV/450 Android", webview: "Android 14; wv) Chrome" }[prueba] || "" : navigator.userAgent || "";
    if (/FBAN|FBAV|FB_IAB|FBIOS|Instagram/i.test(ua)) return "Facebook";
    if (/WhatsApp/i.test(ua)) return "WhatsApp";
    if (/Android/i.test(ua) && /; wv\)/.test(ua)) return "otra app";
    return "";
  }
  function pintarAvisoApp() {
    const app = navegadorDeApp();
    const aviso = $("etAvisoApp");
    if (!app) return (aviso.hidden = true);
    const android = /Android/i.test(navigator.userAgent || "") || ES_LOCAL;
    aviso.innerHTML = "";
    aviso.appendChild(
      crear(
        "p",
        "",
        `⚠️ Esta página está abierta dentro de ${app === "otra app" ? "otra aplicación" : app}, y ahí la cámara puede no funcionar. Ábrela en ${android ? "Chrome" : "Safari"} (menú ⋮ → «Abrir en ${android ? "Chrome" : "el navegador"}»).`
      )
    );
    if (android) {
      const enlace = crear("a", "et-btn et-btn-secundario", "Abrir en Chrome");
      enlace.href = `intent://${location.host}${location.pathname}${location.search}#Intent;scheme=${location.protocol.replace(":", "")};package=com.android.chrome;end`;
      aviso.appendChild(enlace);
    }
    aviso.hidden = false;
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
      <div id="etAvisoApp" class="et-aviso-app" role="alert" hidden></div>
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
        <p id="etAvisoFotos" class="et-aviso-recarga" role="status" hidden></p>
        <button id="etBtnCamara" class="et-btn et-btn-camara" type="button">📷 Tomar foto</button>
        <button id="etBtnGaleria" class="et-btn et-btn-galeria" type="button">🖼️ Elegir de la galería</button>
        <input id="etInputFoto" class="et-input-archivo" type="file" accept="image/*" capture="environment" tabindex="-1" aria-hidden="true" />
        <input id="etInputGaleria" class="et-input-archivo" type="file" accept="image/*" multiple tabindex="-1" aria-hidden="true" />
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
    $("etBtnCamara").addEventListener("click", () => abrirSelector($("etInputFoto")));
    $("etBtnGaleria").addEventListener("click", () => abrirSelector($("etInputGaleria")));
    ["etInputFoto", "etInputGaleria"].forEach((id) => {
      $(id).addEventListener("change", agregarFoto);
      // Cerró la cámara sin foto: ya no está "abierta".
      $(id).addEventListener("cancel", () => guardarEnCurso(false));
    });
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
    if (nombre === "fotos") {
      pintarFotos();
      guardarEnCurso(false);
    }
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
    borrarEnCurso();
    if ($("etAvisoFotos")) $("etAvisoFotos").hidden = true;
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
        guardarEnCurso(false);
      });
      caja.append(img, quitar);
      cont.appendChild(caja);
    });
    const lleno = fotos.length >= MAX_FOTOS;
    $("etBtnCamara").textContent = fotos.length ? "📷 Tomar otra foto" : "📷 Tomar foto";
    $("etBtnCamara").disabled = lleno;
    $("etBtnGaleria").disabled = lleno;
    $("etBtnConfirmar").disabled = !fotos.length;
    $("etMsgFotos").textContent = fotos.length >= MAX_FOTOS ? `Máximo ${MAX_FOTOS} fotos.` : "";
  }

  // La cámara se abre EN el toque: primero se guarda la entrega (sessionStorage
  // es inmediato) y enseguida input.click(), sin ningún await antes; Android
  // no abre el selector si el click llega después de algo asíncrono.
  function abrirSelector(input) {
    if (fotos.length >= MAX_FOTOS) return;
    $("etMsgFotos").textContent = "";
    guardarEnCurso(true);
    input.value = "";
    input.click();
  }

  async function agregarFoto(e) {
    const archivos = [...(e.target.files || [])];
    e.target.value = "";
    guardarEnCurso(false);
    if (!archivos.length) return;
    $("etAvisoFotos").hidden = true;
    const espacio = MAX_FOTOS - fotos.length;
    let error = "";
    for (const [i, archivo] of archivos.slice(0, espacio).entries()) {
      $("etMsgFotos").textContent = archivos.length > 1 ? `Preparando foto ${i + 1} de ${Math.min(archivos.length, espacio)}…` : "Preparando la foto…";
      try {
        const blob = await comprimir(archivo);
        const id = nuevoIdEntrega();
        fotos.push({ id, blob, url: URL.createObjectURL(blob), archivo: "" });
        pintarFotos();
        await guardarFotoEnBase(id, blob);
        guardarEnCurso(false);
      } catch (err) {
        error = err instanceof FotoNoSirve ? err.message : "No se pudo usar esa foto. Toma otra o elígela de la galería.";
      }
    }
    pintarFotos();
    if (error) {
      sonar("playErrorSound");
      $("etMsgFotos").textContent = "❌ " + error;
    } else if (archivos.length > espacio) {
      $("etMsgFotos").textContent = `Solo se agregaron ${espacio}: máximo ${MAX_FOTOS} fotos.`;
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
    guardarEnCurso(false);
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
    borrarEnCurso(); // ya quedó: una recarga ahora no debe volver a abrirla
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
  pintarAvisoApp();
  restaurarEnCurso();
  revisarModo();
  setInterval(revisarModo, SEGUNDOS_REVISAR_MODO * 1000);
  // Al volver a la pantalla (el celular se bloqueó), se revisa enseguida.
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && revisarModo());
})();
