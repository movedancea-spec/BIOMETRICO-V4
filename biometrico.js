// ==========================================
// MOVE ACCESS V3 - STANDALONE
// MOVE Dance Academy
// ==========================================

const WORKER_URL = "https://move-checkin-v2.movedancea.workers.dev";

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

const photoRing =
document.querySelector(".photo-ring");

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

function rotateMessage(){

if(studentName.innerHTML!="") return;

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

accion:"buscar"

})

}

);

const datos=await respuesta.json();

if(!datos.success){

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

accion:"confirmar",

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
// MOSTRAR VISTA PREVIA (antes de confirmar)
// -------------------------------------

function mostrarPreview(datos){

previewActivo=true;

tipoActual=datos.tipo;

clearTimeout(previewTimeout);

previewTimeout=setTimeout(()=>{

if(previewActivo){

reiniciar();

}

},15000);

photoContainer.style.display="flex";

if(datos.foto && datos.foto.length){

photo.src=datos.foto[0].url;

}

studentName.innerHTML=datos.nombre;

registerTime.innerHTML="";

birthday.innerHTML="";

if(datos.tipo==="maestra"){

photoRing.classList.add("photo-ring-maestra");

message.innerHTML=

"👩‍🏫 <span class='teacher-badge'>MAESTRA</span><br>¿Eres tú? Marca tu entrada o salida:";

pad.style.display="none";

teacherActions.style.display="flex";

}

else{

photoRing.classList.remove("photo-ring-maestra");

message.innerHTML="¿Eres tú? Presiona ✓ para confirmar";

pad.style.display="grid";

teacherActions.style.display="none";

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

if(datos.foto && datos.foto.length){

photo.src=datos.foto[0].url;

}

studentName.innerHTML=datos.nombre;

teacherActions.style.display="none";

pad.style.display="grid";

if(datos.tipo==="maestra"){

const accionTexto = datos.tipoRegistro==="SALIDA" ? "Salida" : "Entrada";

message.innerHTML =

"✅ " + accionTexto + " registrada. ¡Gracias por tu trabajo! 💕";

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

previewActivo=false;

tipoActual=null;

photoRing.classList.remove("photo-ring-maestra");

teacherActions.style.display="none";

pad.style.display="grid";

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

photoRing.classList.remove("photo-ring-maestra");

teacherActions.style.display="none";

pad.style.display="grid";

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

function lanzarConfetti(){

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
