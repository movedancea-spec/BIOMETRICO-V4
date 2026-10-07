// ==========================================
// MOVE ACCESS V3 - STANDALONE
// MOVE Dance Academy
// ==========================================

const WORKER_URL = "https://move-checkin-v2.movedancea.workers.dev";

// Códigos del curso de vacaciones (Move Vacation Camp). NO viven en
// move-checkin-v2: si ese Worker no encuentra el código (no es alumna
// ni maestra), se pregunta al Worker del portal, que revisa si hoy hay
// curso para esa participante y guarda la marcación en su propia tabla
// (ASISTENCIA VACATION CAMP), sin tocar la asistencia de las alumnas.
// En localhost (prueba con `wrangler dev`) se usa el Worker local, igual
// que en recepcion.js; en el kiosko de verdad, siempre el publicado.
const WORKER_PORTAL_URL = ["localhost", "127.0.0.1"].includes(location.hostname)
? "http://localhost:8787"
: "https://portalalumnas.movedancea.workers.dev";

async function llamarPortal(accion){

const respuesta=await fetch(WORKER_PORTAL_URL,{
method:"POST",
headers:{"Content-Type":"application/json"},
body:JSON.stringify({accion,codigo})
});

return await respuesta.json().catch(()=>({success:false}));

}

// ----------------------------
// SONIDOS (generados por código, sin archivos .mp3)
// ----------------------------

let audioCtx = null;

function getAudioCtx(){

if(!audioCtx){

audioCtx = new (window.AudioContext || window.webkitAudioContext)();

}

if(audioCtx.state === "suspended"){

audioCtx.resume();

}

return audioCtx;

}

function playTone(frequency, duration, volume, type){

try{

const ctx = getAudioCtx();

const osc = ctx.createOscillator();

const gain = ctx.createGain();

osc.type = type || "sine";

osc.frequency.value = frequency;

gain.gain.setValueAtTime(volume, ctx.currentTime);

gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

osc.connect(gain);

gain.connect(ctx.destination);

osc.start();

osc.stop(ctx.currentTime + duration);

}

catch(e){

console.warn("Audio no disponible:", e);

}

}

function playKeySound(){

playTone(650, 0.06, 0.5, "sine");

}

function playSuccessSound(){

playTone(740, 0.16, 0.7, "sine");

setTimeout(()=>playTone(1100, 0.28, 0.7, "sine"), 130);

}

function playErrorSound(){

playTone(200, 0.35, 0.6, "sawtooth");

}

// ----------------------------
// ELEMENTOS
// ----------------------------

const pad = document.getElementById("pad");
const dots = document.getElementById("dots");

const message = document.getElementById("message");
const greeting = document.getElementById("greeting");

const studentName = document.getElementById("studentName");

const birthday = document.getElementById("birthday");

const registerTime = document.getElementById("registerTime");

const photo = document.getElementById("photo");

const photoContainer =
document.getElementById("photoContainer");

const clock =
document.getElementById("clock");

const teacherActions =
document.getElementById("teacherActions");

const btnEntrada =
document.getElementById("btnEntrada");

const btnSalida =
document.getElementById("btnSalida");

const studentConfirm =
document.getElementById("studentConfirm");

const btnConfirmar =
document.getElementById("btnConfirmar");

const btnNoSoyYo =
document.getElementById("btnNoSoyYo");

const btnNoSoyYoMaestra =
document.getElementById("btnNoSoyYoMaestra");

const btnModoRecogida =
document.getElementById("btnModoRecogida");

const photoInicial =
document.getElementById("photoInicial");

const photoRing =
document.querySelector(".photo-ring");

const logoWrap =
document.querySelector(".logo-wrap");

// -------------------------------------
// MENSAJES
// -------------------------------------

const waitingMessages=[

"✨ Hoy será un gran día.",

"💖 Nunca dejes de bailar.",

"🩰 El escenario te espera.",

"🌸 Cree en ti.",

"⭐ Haz que cada paso cuente.",

"💃 Disfruta cada movimiento.",

"💕 Gracias por ser parte de MOVE.",

"🌈 Todo esfuerzo tiene recompensa.",

"✨ Los sueños se entrenan.",

"🎀 Tu pasión inspira.",

"🩷 Que tengas una hermosa clase.",

"🌸 Sonríe, baila y disfruta.",

"💖 La disciplina supera al talento.",

"🩰 Cada paso cuenta."

];

const successMessages=[

"💖 Que tengas una hermosa clase.",

"✨ Disfruta cada ensayo.",

"🌸 Hoy será un gran entrenamiento.",

"🩰 Gracias por venir a MOVE.",

"💃 Haz que cada paso valga la pena.",

"⭐ Nunca dejes de creer en ti.",

"🌈 Todo comienza con un primer paso.",

"💕 Sigue creciendo cada día."

];

// -------------------------------------
// VARIABLES
// -------------------------------------

let codigo="";

let waitingIndex=0;

let previewActivo=false;

let previewTimeout=null;

let tipoActual=null;

// La recogida se inicia explícitamente para que un código temporal de
// tres dígitos nunca se confunda con un código normal de asistencia.
let modoRecogida=false;

btnModoRecogida?.addEventListener("click",()=>{

if(previewActivo) return;

modoRecogida=!modoRecogida;
codigo="";
actualizarDots();
message.innerHTML=modoRecogida
? "🔐 Ingresa el código de recogida"
: waitingMessages[0];
btnModoRecogida.textContent=modoRecogida
? "← Volver a asistencia"
: "🔐 Validar código de recogida";

});

// -------------------------------------
// RELOJ
// -------------------------------------

function updateClock(){

const now=new Date();

clock.innerHTML=
now.toLocaleTimeString(

"es-GT",

{

hour:"2-digit",

minute:"2-digit"

}

);

let h=now.getHours();

if(h<12){

greeting.innerHTML="☀️ Buenos días";

}

else if(h<18){

greeting.innerHTML="🌤️ Buenas tardes";

}

else{

greeting.innerHTML="🌙 Buenas noches";

}

}

updateClock();

setInterval(updateClock,1000);

// -------------------------------------
// MENSAJES ROTATIVOS
// -------------------------------------

// Hasta cuándo se deja quieto un mensaje de error (ver mostrarError).
let mensajeFijoHasta=0;

function rotateMessage(){

if(studentName.innerHTML!="") return;

if(Date.now()<mensajeFijoHasta) return;

message.animate(

[

{

opacity:1,

transform:"translateY(0px)"

},

{

opacity:0,

transform:"translateY(12px)"

}

],

{

duration:250,

fill:"forwards"

}

);

setTimeout(()=>{

// Si en estos 250 ms apareció un error o una persona, no se tapa.
if(studentName.innerHTML!="" || Date.now()<mensajeFijoHasta) return;

waitingIndex++;

if(waitingIndex>=waitingMessages.length){

waitingIndex=0;

}

message.innerHTML=waitingMessages[waitingIndex];

message.animate(

[

{

opacity:0,

transform:"translateY(-12px)"

},

{

opacity:1,

transform:"translateY(0px)"

}

],

{

duration:350,

fill:"forwards"

}

);

},260);

}



setInterval(

rotateMessage,

5000

);
// -------------------------------------
// CREAR TECLADO
// -------------------------------------

const teclas=[

"1","2","3",

"4","5","6",

"7","8","9",

"⌫","0","✓"

];

teclas.forEach(tecla=>{

const boton=document.createElement("button");

boton.innerHTML=tecla;

boton.addEventListener("click",()=>{

playKeySound();

presionar(tecla);

});

pad.appendChild(boton);

});

btnEntrada.addEventListener("click",()=>{

playKeySound();

confirmarAsistencia("ENTRADA");

});

btnSalida.addEventListener("click",()=>{

playKeySound();

confirmarAsistencia("SALIDA");

});

btnConfirmar.addEventListener("click",()=>{

playKeySound();

confirmarAsistencia();

});

btnNoSoyYo.addEventListener("click",()=>{

playKeySound();

reiniciar();

});

btnNoSoyYoMaestra.addEventListener("click",()=>{

playKeySound();

reiniciar();

});

// -------------------------------------
// ACTUALIZAR PUNTOS
// -------------------------------------

function actualizarDots(){

dots.innerHTML="";

for(let i=0;i<3;i++){

const punto=document.createElement("span");

if(i<codigo.length){

punto.classList.add("fill");

}

dots.appendChild(punto);

}

}

// -------------------------------------
// PRESIONAR TECLA
// -------------------------------------

async function presionar(tecla){

if(tecla==="⌫"){

if(previewActivo){

reiniciar();

return;

}

codigo=codigo.slice(0,-1);

actualizarDots();

return;

}

if(tecla==="✓"){

if(previewActivo){

confirmarAsistencia();

return;

}

if(codigo.length===0){

mostrarError("Ingresa tu código");

return;

}

return;

}

if(codigo.length>=3 || previewActivo){

return;

}

codigo+=tecla;

actualizarDots();

if(codigo.length===3){

buscarPreview();

}

}

// -------------------------------------
// VISTA PREVIA (solo busca, no registra
// asistencia ni manda WhatsApp)
// -------------------------------------

async function buscarPreview(){

message.innerHTML="⏳ Verificando...";

try{

const respuesta=await fetch(

WORKER_URL,

{

method:"POST",

headers:{

"Content-Type":"application/json"

},

body:JSON.stringify({

codigo:codigo,

accion:modoRecogida ? "buscarRecogida" : "buscar"

})

}

);

const datos=await respuesta.json();

if(!datos.success){

// Los códigos de recogida nunca son del campamento.
if(!modoRecogida){

const camp=await llamarPortal("campKioskoBuscar");

if(camp.success){

mostrarPreview(camp);

return;

}

// Es del campamento pero hoy no se puede marcar (fuera de fechas,
// fin de semana, día sin curso, o ya marcó entrada y salida): un
// mensaje amable en vez de "Código no encontrado".
if(camp.encontrado && camp.mensaje){

mostrarError("💗 "+camp.mensaje);

return;

}

}

mostrarError("❌ Código no encontrado");

return;

}

mostrarPreview(datos);

}

catch(e){

console.error(e);

mostrarError("⚠ Error de conexión");

}

}

// -------------------------------------
// CONFIRMAR (registra asistencia y
// manda el WhatsApp)
// -------------------------------------

async function confirmarAsistencia(tipoRegistro){

message.innerHTML="⏳ Registrando...";

if(tipoActual==="campamento"){

try{

const datos=await llamarPortal("campKioskoMarcar");

if(!datos.success){

mostrarError(datos.mensaje ? "💗 "+datos.mensaje : "❌ Código no encontrado");

return;

}

mostrarBienvenida(datos);

}

catch(e){

console.error(e);

mostrarError("⚠ Error de conexión");

}

return;

}

try{

const respuesta=await fetch(

WORKER_URL,

{

method:"POST",

headers:{

"Content-Type":"application/json"

},

body:JSON.stringify({

codigo:codigo,

accion:tipoActual==="recogida" ? "confirmarRecogida" : "confirmar",

tipo:tipoActual,

tipoRegistro:tipoRegistro

})

}

);

const datos=await respuesta.json();

if(!datos.success){

mostrarError("❌ Código no encontrado");

return;

}

mostrarBienvenida(datos);

}

catch(e){

console.error(e);

mostrarError("⚠ Error de conexión");

}

}

// -------------------------------------
// FOTO Y NOMBRE
// Antes, si alguien no tenía foto, se quedaba la foto de la persona
// anterior. Ahora, sin foto se muestra un círculo con su inicial.
// El nombre va con textContent (no innerHTML): los nombres del curso
// de vacaciones los escriben los papás en una ficha pública.
// -------------------------------------

function ponerFotoYNombre(datos){

const nombre=String(datos.nombre||"");

studentName.textContent=nombre;

if(datos.foto && datos.foto.length && datos.foto[0].url){

photo.src=datos.foto[0].url;

photo.hidden=false;

photoInicial.hidden=true;

}

else{

photo.removeAttribute("src");

photo.hidden=true;

photoInicial.textContent=(nombre.trim()[0]||"★").toUpperCase();

photoInicial.hidden=false;

}

}

// -------------------------------------
// MOSTRAR VISTA PREVIA (antes de confirmar)
// -------------------------------------

function mostrarPreview(datos){

previewActivo=true;

tipoActual=datos.tipo;

if(logoWrap) logoWrap.style.display="none";

clearTimeout(previewTimeout);

previewTimeout=setTimeout(()=>{

if(previewActivo){

reiniciar();

}

},15000);

photoContainer.style.display="flex";

ponerFotoYNombre(datos);

registerTime.innerHTML="";

birthday.innerHTML="";

if(datos.cumpleHoy){

birthday.innerHTML=

"🎂 ¡FELIZ CUMPLEAÑOS! 🎉";

lanzarConfetti();

}

if(datos.tipo==="maestra"){

photoRing.classList.add("photo-ring-maestra");

message.innerHTML=

"👩‍🏫 <span class='teacher-badge'>MAESTRA</span><br>¿Eres tú? Marca tu entrada o salida:";

pad.style.display="none";

teacherActions.style.display="flex";

studentConfirm.style.display="none";

}

else if(datos.tipo==="campamento"){

photoRing.classList.remove("photo-ring-maestra");

const accionCamp = datos.siguiente==="SALIDA" ? "salida" : "entrada";

message.innerHTML="🌴 ¿Eres tú? Presiona ✓ para marcar tu <strong>"+accionCamp+"</strong>";

pad.style.display="none";

teacherActions.style.display="none";

studentConfirm.style.display="flex";

}

else if(datos.tipo==="recogida"){

photoRing.classList.remove("photo-ring-maestra");

message.innerHTML="🔐 <strong>Código de recogida válido</strong><br>Confirma la entrega de esta alumna.";

pad.style.display="none";

teacherActions.style.display="none";

studentConfirm.style.display="flex";

}

else{

photoRing.classList.remove("photo-ring-maestra");

message.innerHTML="¿Eres tú? Presiona ✓ para confirmar";

pad.style.display="none";

teacherActions.style.display="none";

studentConfirm.style.display="flex";

}

photoContainer.animate(

[

{

transform:"scale(.6)",

opacity:0

},

{

transform:"scale(1)",

opacity:1

}

],

{

duration:500,

fill:"forwards"

}

);

}

// -------------------------------------
// BIENVENIDA
// -------------------------------------

function mostrarBienvenida(datos){

previewActivo=false;

clearTimeout(previewTimeout);

codigo="";

actualizarDots();

navigator.vibrate?.(200);

playSuccessSound();

photoContainer.style.display="flex";

ponerFotoYNombre(datos);

teacherActions.style.display="none";

pad.style.display="grid";

studentConfirm.style.display="none";

if(datos.tipo==="maestra"){

const accionTexto = datos.tipoRegistro==="SALIDA" ? "Salida" : "Entrada";

message.innerHTML =

"✅ " + accionTexto + " registrada. ¡Gracias por tu trabajo! 💕";

}

else{

if(datos.tipo==="recogida"){

message.innerHTML="✅ Recogida validada. El código quedó desactivado.";

}

else if(datos.tipo==="campamento"){

message.innerHTML = datos.tipoRegistro==="SALIDA"
? "✅ Salida registrada. ¡Hasta pronto! 👋"
: "✅ Entrada registrada. ¡Bienvenida! 🌴";

}

else{

const frase=

successMessages[

Math.floor(

Math.random()*successMessages.length

)

];

message.innerHTML=frase;

}

}

const ahora = new Date();

registerTime.innerHTML =
"🕒 " +
ahora.toLocaleTimeString("es-GT",{
hour:"2-digit",
minute:"2-digit",
hour12:true
});

birthday.innerHTML="";

if(datos.cumpleHoy){

birthday.innerHTML=

"🎂 ¡FELIZ CUMPLEAÑOS! 🎉";

lanzarConfetti();

}

photoContainer.animate(

[

{

transform:"scale(.6)",

opacity:0

},

{

transform:"scale(1)",

opacity:1

}

],

{

duration:600,

fill:"forwards"

}

);

// Antes esto redirigía al menú principal (index.html del
// sitio de recepción). Como esta pantalla ahora vive sola
// en su propio celular, en vez de salir a otro sitio,
// simplemente se reinicia a sí misma para esperar el
// siguiente código.

setTimeout(()=>{

reiniciar();

},7000);

}

// -------------------------------------
// ERROR
// -------------------------------------

function mostrarError(texto){

playErrorSound();

// Los mensajes de reposo cambian cada 5 s; sin esto, un error (p. ej.
// "Este código no está activo hoy") podía desaparecer casi al instante.
mensajeFijoHasta=Date.now()+6000;

previewActivo=false;

tipoActual=null;

photoRing.classList.remove("photo-ring-maestra");

teacherActions.style.display="none";

pad.style.display="grid";

studentConfirm.style.display="none";

clearTimeout(previewTimeout);

codigo="";

actualizarDots();

message.innerHTML=texto;

studentName.innerHTML="";

birthday.innerHTML="";

registerTime.innerHTML="";

photoContainer.style.display="none";

}

// -------------------------------------
// REINICIAR
// -------------------------------------

function reiniciar(){

previewActivo=false;

tipoActual=null;

modoRecogida=false;

if(logoWrap) logoWrap.style.display="";

if(btnModoRecogida) btnModoRecogida.textContent="🔐 Validar código de recogida";

photoRing.classList.remove("photo-ring-maestra");

teacherActions.style.display="none";

pad.style.display="grid";

studentConfirm.style.display="none";

clearTimeout(previewTimeout);

codigo="";

actualizarDots();

photoContainer.style.display="none";

studentName.innerHTML="";

birthday.innerHTML="";

registerTime.innerHTML="";

waitingIndex=0;

message.innerHTML=

waitingMessages[0];

}

// -------------------------------------
// CONFETTI (VERSIÓN SIMPLE)
// -------------------------------------

// -------------------------------------
// SONIDO de cumpleaños + confeti
// (se genera con Web Audio, no necesita
// ningún archivo de audio externo)
// -------------------------------------

function sonidoCumpleanos(){

try{

const ctx=getAudioCtx();

// Arpegio alegre (do-mi-sol-do agudo)
const notas=[523.25,659.25,783.99,1046.5];

notas.forEach((freq,i)=>{

const o=ctx.createOscillator();
const g=ctx.createGain();
o.type="triangle";
o.frequency.value=freq;
o.connect(g);
g.connect(ctx.destination);

const t0=ctx.currentTime+i*0.12;
g.gain.setValueAtTime(0.0001,t0);
g.gain.exponentialRampToValueAtTime(0.25,t0+0.02);
g.gain.exponentialRampToValueAtTime(0.0001,t0+0.35);

o.start(t0);
o.stop(t0+0.4);

});

// Pops de confeti explotando (ruido filtrado, varios "pop" en cadena)
const popTimes=[0.05,0.15,0.28,0.42,0.6];

popTimes.forEach(delay=>{

const duracion=0.06;
const bufferSize=Math.floor(ctx.sampleRate*duracion);
const buffer=ctx.createBuffer(1,bufferSize,ctx.sampleRate);
const data=buffer.getChannelData(0);

for(let i=0;i<bufferSize;i++){
data[i]=(Math.random()*2-1)*(1-i/bufferSize);
}

const noise=ctx.createBufferSource();
noise.buffer=buffer;

const filtro=ctx.createBiquadFilter();
filtro.type="bandpass";
filtro.frequency.value=1000+Math.random()*900;

const g2=ctx.createGain();
g2.gain.value=0.35;

noise.connect(filtro);
filtro.connect(g2);
g2.connect(ctx.destination);

noise.start(ctx.currentTime+delay);

});

}catch(e){}

}

function lanzarConfetti(){

sonidoCumpleanos();

const canvas=document.getElementById("confetti");

if(!canvas) return;

const ctx=canvas.getContext("2d");

canvas.width=window.innerWidth;

canvas.height=window.innerHeight;

const piezas=[];

for(let i=0;i<180;i++){

piezas.push({

x:Math.random()*canvas.width,

y:-20,

vx:(Math.random()-.5)*5,

vy:Math.random()*5+3,

r:Math.random()*8+4,

rot:Math.random()*360

});

}

let frame=0;

function animar(){

ctx.clearRect(0,0,canvas.width,canvas.height);

piezas.forEach(p=>{

ctx.save();

ctx.translate(p.x,p.y);

ctx.rotate(p.rot);

ctx.fillStyle=

Math.random()>.5?

"#ef4b9b":

"#ffd54f";

ctx.fillRect(

-p.r/2,

-p.r/2,

p.r,

p.r

);

ctx.restore();

p.x+=p.vx;

p.y+=p.vy;

p.rot+=0.1;

});

frame++;

if(frame<140){

requestAnimationFrame(animar);

}else{

ctx.clearRect(

0,

0,

canvas.width,

canvas.height

);

}

}

animar();

}

// -------------------------------------

actualizarDots();

message.innerHTML=

waitingMessages[0];

// -------------------------------------
// Acceso de emergencia: botón discreto (esquina inferior derecha) que
// lleva a la página con toda la información de clases, precios, clase
// de prueba y ficha de inscripción — para cuando falla el internet de
// la tablet y hay que mostrarle algo a alguien ahí mismo. Como este
// dispositivo corre en modo pantalla completa (sin pestañas), navega
// en la misma pantalla en vez de abrir una pestaña nueva que nadie
// vería. Para volver al biométrico después, hay que volver a entrar a
// su link de siempre.
const LINK_INFO_EMERGENCIA =
  "https://movedancea-spec.github.io/move-recepcion2-sin-biometrico/";

const btnAccesoEmergencia = document.getElementById("btnAccesoEmergencia");
if (btnAccesoEmergencia) {
  btnAccesoEmergencia.addEventListener("click", () => {
    window.location.href = LINK_INFO_EMERGENCIA;
  });
}

// =====================================================================
// DECORACIÓN DE TEMPORADA (portado desde portal.js del Portal de
// Alumnas — un tema por mes, todo el año). No incluye la parte de
// cumpleaños: este proyecto ya la maneja por su cuenta (ver #birthday
// / lanzarConfetti() más arriba).
// =====================================================================

const EMOJIS_TEMA = {
  "back-to-dance": ["📚", "🩰", "🎒", "✨", "👟"],
  carino: ["💕", "❤️", "💌", "🌹", "💗"],
  mujer: ["💜", "🌷", "✨", "👑", "💪"],
  danza: ["💃", "🕺", "🎶", "✨", "👯"],
  madre: ["💐", "🌸", "💖", "🌷", "👩‍👧"],
  padre: ["👔", "💙", "🎩", "⭐", "👨‍👧"],
  independencia: ["🇬🇹", "🎆", "🔥", "💙", "🤍"],
  nino: ["🎈", "🧸", "🎨", "🎠", "🍭"],
  halloween: ["🎃", "👻", "🕸️", "🦇", "🕷️"],
  show: ["🎭", "🌟", "✨", "🎬", "👑"],
  navidad: ["❄️", "🎄", "🎅", "⛄", "🎁"],
};

// Cómo se mueven las partículas de cada tema: "cae" (bajan, como
// confeti o nieve), "sube" (suben, como globos) o "flota" (se
// mecen en su lugar, como fantasmas).
const ESTILO_PARTICULA = {
  "back-to-dance": "sube",
  carino: "cae",
  mujer: "flota",
  danza: "flota",
  madre: "cae",
  padre: "cae",
  independencia: "cae",
  nino: "sube",
  halloween: "flota",
  show: "cae",
  navidad: "cae",
};

const BANNER_TEXTO = {
  "back-to-dance": "✨ ¡Bienvenidas de vuelta a MOVE!",
  carino: "💕 ¡Feliz Día del Cariño!",
  mujer: "💜 ¡Feliz Día de la Mujer!",
  danza: "💃 ¡Feliz Mes de la Danza!",
  madre: "💐 ¡Feliz Día de la Madre!",
  padre: "💙 ¡Feliz Día del Padre!",
  independencia: "🇬🇹 ¡Feliz Independencia, Guatemala!",
  nino: "🎈 ¡Feliz Día del Niño!",
  halloween: "🎃 Halloween",
  show: "🌟 ¡Se viene nuestro Show de Fin de Año! 🌟",
  navidad: "🎄 ¡Feliz Navidad!",
};

// Un tema por mes, todo el año. Julio y agosto se quedan sin tema
// especial (pantalla normal). Para probar cualquiera sin esperar al
// mes correcto, se puede abrir la página con ?temaPrueba=nombreDelTema
// al final del link (por ejemplo ?temaPrueba=danza) — solo para
// pruebas, quítalo del link cuando termines de revisar.
const TEMA_POR_MES = {
  1: "back-to-dance",
  2: "carino",
  3: "mujer",
  4: "danza",
  5: "madre",
  6: "padre",
  9: "independencia",
  10: "halloween",
  11: "show",
  12: "navidad",
};

// Excepciones de un solo día dentro de un mes (formato "mes-día"),
// que interrumpen por ese único día el tema del mes completo. Por
// ahora solo el 1 de octubre (Día del Niño) interrumpe a Halloween;
// el resto de octubre sigue siendo Halloween normal.
const TEMA_POR_DIA_ESPECIFICO = {
  "10-1": "nino",
};

function obtenerTemaDelDia() {
  const forzado = new URLSearchParams(window.location.search).get("temaPrueba");
  if (forzado && EMOJIS_TEMA[forzado]) return forzado;

  // Mes y día de HOY en hora de Guatemala (no la del dispositivo), para
  // que el tema cambie a la medianoche de Guatemala aunque la tablet
  // tenga mal la zona horaria.
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Guatemala",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date());
  const mes = Number(partes.find((p) => p.type === "month").value); // 1-12
  const dia = Number(partes.find((p) => p.type === "day").value);
  const claveDia = `${mes}-${dia}`;

  return TEMA_POR_DIA_ESPECIFICO[claveDia] || TEMA_POR_MES[mes] || null;
}

function limpiarDecoracionTema() {
  Object.keys(EMOJIS_TEMA).forEach((t) => document.body.classList.remove("tema-" + t));
  document.getElementById("particles").innerHTML = "";
  const banner = document.getElementById("temaBanner");
  banner.hidden = true;
  banner.className = "tema-banner";
}

function aplicarDecoracionTema(tema) {
  limpiarDecoracionTema();
  if (!tema) return;

  document.body.classList.add("tema-" + tema);

  const emojis = EMOJIS_TEMA[tema] || [];
  const cont = document.getElementById("particles");
  const estilo = ESTILO_PARTICULA[tema] || "cae";

  for (let i = 0; i < 18; i++) {
    const span = document.createElement("span");
    span.className = "tema-particula " + estilo;
    span.textContent = emojis[i % emojis.length];
    span.style.left = Math.random() * 96 + "%";
    span.style.fontSize = 1.2 + Math.random() * 1.3 + "rem";
    // Entre 2.2 y 5.2 s por recorrido (el doble de rápido que los 4.4–10.3 s de antes).
    const duracion = 2.2 + Math.random() * 3;
    span.style.animationDuration = duracion + "s";
    // Retraso negativo: cada emoji arranca ya a media animación, así
    // ninguno se queda quieto esperando al abrir la página.
    span.style.animationDelay = -Math.random() * duracion + "s";
    if (estilo === "flota") {
      span.style.top = Math.random() * 85 + "%";
    }
    cont.appendChild(span);
  }

  const banner = document.getElementById("temaBanner");
  banner.className = "tema-banner " + tema;
  banner.textContent = BANNER_TEXTO[tema] || "";
  banner.hidden = false;
}

aplicarDecoracionTema(obtenerTemaDelDia());
