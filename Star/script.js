
// script.js - improved functionality: IndexedDB persistence, SPA navigation, voice commands

// Simple IndexedDB wrapper (promisified)
const DB_NAME = "stark_db_v1", DB_STORE = "records";
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        const store = db.createObjectStore(DB_STORE, { keyPath: "id" });
      }
    };
    r.onsuccess = e => res(e.target.result);
    r.onerror = e => rej(e.target.error);
  });
}
async function getAll() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const store = tx.objectStore(DB_STORE);
    const req = store.getAll();
    req.onsuccess = () => res(req.result || []);
    req.onerror = () => rej(req.error);
  });
}
async function put(obj) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    const store = tx.objectStore(DB_STORE);
    const r = store.put(obj);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function deleteId(id) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    const store = tx.objectStore(DB_STORE);
    const r = store.delete(id);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

// Utilities
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
function uid(prefix="id") { return prefix + "_" + Date.now() + "_" + Math.floor(Math.random()*9999); }
function speak(text) {
  if ('speechSynthesis' in window) {
    const u = new SpeechSynthesisUtterance(text);
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }
}

// Simple "auth" using localStorage (for demo). We'll store a user object in IndexedDB as well.
const defaultUser = { id: "user_admin", username: "admin", password: "123456" }; // WARNING: demo only

async function ensureDefaultUser() {
  const all = await getAll();
  const users = all.filter(x=>x.type==="user");
  if (!users.find(u=>u.username===defaultUser.username)) {
    await put({ id: defaultUser.id, type: "user", ...defaultUser });
  }
}

// Session
function setSession(user) {
  sessionStorage.setItem("stark_user", JSON.stringify({ username: user.username }));
  updateUserArea();
}
function clearSession() {
  sessionStorage.removeItem("stark_user");
  updateUserArea();
}
function getSession() {
  const s = sessionStorage.getItem("stark_user");
  return s ? JSON.parse(s) : null;
}

function updateUserArea() {
  const ua = $("#userArea");
  const session = getSession();
  if (session) {
    ua.innerHTML = `<span>👤 ${session.username}</span>`;
  } else ua.innerHTML = "";
}

// SPA navigation
function showSection(name) {
  $$(".nav-btn").forEach(b=>b.classList.toggle("active", b.dataset.section===name));
  $$(".section").forEach(s=>s.classList.toggle("active", s.id===name));
}

function showDashboard() {
  $("#loginScreen").classList.add("hidden");
  $("#dashboard").classList.remove("hidden");
  updateCounts();
  showSection("home");
}

// Populate product select from inventory
async function refreshProductSelect() {
  const all = await getAll();
  const items = all.filter(x=>x.type==="item");
  const sel = $("#saleProduct");
  sel.innerHTML = "";
  items.forEach(it=>{
    const opt = document.createElement("option");
    opt.value = it.id;
    opt.textContent = `${it.name} — ${it.price} RD$ (stock:${it.stock})`;
    sel.appendChild(opt);
  });
  $("#totalItems").textContent = items.length;
}

// Update dashboard counters
async function updateCounts() {
  const all = await getAll();
  const sales = all.filter(x=>x.type==="sale");
  const items = all.filter(x=>x.type==="item");
  const appts = all.filter(x=>x.type==="appt");
  $("#todaySales").textContent = sales.length;
  $("#totalItems").textContent = items.length;
  $("#totalAppts").textContent = appts.length;
}

// Modal helpers
function openModal(title, body, onConfirm) {
  $("#modalTitle").textContent = title;
  $("#modalBody").textContent = body;
  $("#modal").classList.remove("hidden");
  return new Promise(res=>{
    const ok = () => { $("#modal").classList.add("hidden"); $("#modalConfirm").removeEventListener("click", ok); $("#modalCancel").removeEventListener("click", canc); res(true); };
    const canc = () => { $("#modal").classList.add("hidden"); $("#modalConfirm").removeEventListener("click", ok); $("#modalCancel").removeEventListener("click", canc); res(false); };
    $("#modalConfirm").addEventListener("click", ok);
    $("#modalCancel").addEventListener("click", canc);
  });
}

// Event wiring
document.addEventListener("DOMContentLoaded", async () => {
  await ensureDefaultUser();
  updateUserArea();

  // Login
  $("#btnLogin").addEventListener("click", async ()=>{
    const u = $("#username").value.trim();
    const p = $("#password").value;
    const all = await getAll();
    const user = all.find(x=>x.type==="user" && x.username===u && x.password===p);
    if (user) {
      setSession(user);
      speak(`Bienvenido ${user.username}`);
      showDashboard();
    } else {
      alert("Credenciales incorrectas");
      speak("Credenciales incorrectas");
    }
  });

  // Register admin (creates default user)
  $("#btnRegister").addEventListener("click", async ()=>{
    await put({ id: defaultUser.id, type: "user", ...defaultUser });
    alert("Usuario admin registrado (demo). Usuario: admin / 123456");
  });

  // Logout
  $("#btnLogout").addEventListener("click", async ()=>{
    const ok = await openModal("Cerrar sesión", "¿Cerrar sesión ahora?");
    if (ok) {
      clearSession();
      $("#dashboard").classList.add("hidden");
      $("#loginScreen").classList.remove("hidden");
      speak("Sesión cerrada");
    }
  });

  // Navigation buttons
  $$(".nav-btn").forEach(b=>b.addEventListener("click", ()=> showSection(b.dataset.section)));

  // Add item to inventory
  $("#btnAddItem").addEventListener("click", async ()=>{
    const name = $("#itemName").value.trim();
    const stock = Number($("#itemStock").value);
    const price = Number($("#itemPrice").value);
    if (!name) { alert("Nombre requerido"); return; }
    const obj = { id: uid("item"), type: "item", name, stock, price };
    await put(obj);
    $("#itemName").value=""; $("#itemStock").value=1; $("#itemPrice").value=100;
    speak("Artículo añadido");
    refreshItemsList();
    refreshProductSelect();
    updateCounts();
  });

  $("#btnItemsList").addEventListener("click", refreshItemsList);

  async function refreshItemsList(){
    const all = await getAll();
    const items = all.filter(x=>x.type==="item");
    const container = $("#itemsList");
    container.innerHTML = "";
    items.forEach(it=>{
      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `<strong>${it.name}</strong> — ${it.price} RD$ (stock: ${it.stock})
        <div style="margin-top:8px"><button data-id="${it.id}" class="btnDel">Eliminar</button></div>`;
      container.appendChild(div);
    });
    $$(".btnDel").forEach(b=>b.addEventListener("click", async (e)=>{
      const id = e.target.dataset.id;
      const ok = await openModal("Eliminar item", "¿Eliminar este artículo?");
      if (ok) { await deleteId(id); refreshItemsList(); refreshProductSelect(); updateCounts(); speak("Artículo eliminado"); }
    }));
    refreshProductSelect();
  }

  // Sales
  $("#btnRegisterSale").addEventListener("click", async ()=>{
    const prodId = $("#saleProduct").value;
    const qty = Number($("#saleQty").value);
    if (!prodId) { alert("Selecciona un producto"); return; }
    const all = await getAll();
    const prod = all.find(x=>x.id===prodId);
    if (!prod || prod.stock < qty) { alert("Stock insuficiente"); return; }
    // reduce stock
    prod.stock = prod.stock - qty;
    await put(prod);
    const sale = { id: uid("sale"), type: "sale", productId: prod.id, qty, total: prod.price * qty, date: new Date().toISOString() };
    await put(sale);
    speak("Venta registrada");
    refreshSalesList();
    refreshItemsList();
    updateCounts();
  });

  $("#btnSalesList").addEventListener("click", refreshSalesList);

  async function refreshSalesList(){
    const all = await getAll();
    const sales = all.filter(x=>x.type==="sale").sort((a,b)=>b.date.localeCompare(a.date));
    const container = $("#salesList"); container.innerHTML="";
    sales.forEach(s=>{
      const div = document.createElement("div"); div.className="item";
      div.innerHTML = `<strong>Venta</strong> — ${s.total} RD$ | Cant: ${s.qty} <div style="margin-top:8px"><small>${s.date}</small></div>`;
      container.appendChild(div);
    });
    updateCounts();
  }

  // Barbería
  $("#btnAddBarber").addEventListener("click", async ()=>{
    const client = $("#barberClient").value.trim();
    const service = $("#barberService").value;
    const price = Number($("#barberPrice").value);
    if (!client) { alert("Cliente requerido"); return; }
    const obj = { id: uid("barber"), type: "service", category:"barber", client, service, price, date:new Date().toISOString() };
    await put(obj);
    $("#barberClient").value="";
    refreshBarberList();
    speak("Servicio de barbería guardado");
    updateCounts();
  });
  $("#btnListBarber").addEventListener("click", refreshBarberList);
  async function refreshBarberList(){
    const all = await getAll();
    const items = all.filter(x=>x.type==="service" && x.category==="barber");
    const c = $("#barberList"); c.innerHTML="";
    items.forEach(it=>{
      const d = document.createElement("div"); d.className="item";
      d.innerHTML = `<strong>${it.client}</strong> — ${it.service} — ${it.price} RD$ <div style="margin-top:6px"><small>${it.date}</small></div>`;
      c.appendChild(d);
    });
  }

  // Billar reservation
  $("#btnReservePool").addEventListener("click", async ()=>{
    const user = $("#billarUser").value.trim();
    const time = $("#billarTime").value;
    if (!user || !time) { alert("Usuario y hora requeridos"); return; }
    const obj = { id: uid("pool"), type: "service", category:"pool", user, time, date:new Date().toISOString() };
    await put(obj);
    $("#billarUser").value=""; $("#billarTime").value="";
    refreshPoolList();
    speak("Mesa reservada");
    updateCounts();
  });
  function refreshPoolList(){
    const allp = getAll().then(all=>{
      const items = all.filter(x=>x.type==="service" && x.category==="pool");
      const c = $("#billarList"); c.innerHTML="";
      items.forEach(it=>{
        const d = document.createElement("div"); d.className="item";
        d.innerHTML = `<strong>${it.user}</strong> — ${it.time} <div style="margin-top:6px"><small>${it.date}</small></div>`;
        c.appendChild(d);
      });
    });
  }

  // Car wash
  $("#btnAddCar").addEventListener("click", async ()=>{
    const vehicle = $("#carModel").value.trim();
    const service = $("#carService").value;
    const price = Number($("#carPrice").value);
    if (!vehicle) { alert("Vehículo requerido"); return; }
    const obj = { id: uid("car"), type: "service", category:"car", vehicle, service, price, date:new Date().toISOString() };
    await put(obj);
    $("#carModel").value="";
    refreshCarList();
    speak("Servicio de car wash agregado");
    updateCounts();
  });
  function refreshCarList(){
    getAll().then(all=>{
      const items = all.filter(x=>x.type==="service" && x.category==="car");
      const c = $("#carList"); c.innerHTML="";
      items.forEach(it=>{
        const d = document.createElement("div"); d.className="item";
        d.innerHTML = `<strong>${it.vehicle}</strong> — ${it.service} — ${it.price} RD$ <div style="margin-top:6px"><small>${it.date}</small></div>`;
        c.appendChild(d);
      });
    });
  }

  // Appointments
  $("#btnAddAppt").addEventListener("click", async ()=>{
    const client = $("#apptClient").value.trim();
    const date = $("#apptDate").value;
    const time = $("#apptTime").value;
    if (!client || !date || !time) { alert("Completa los campos"); return; }
    const obj = { id: uid("appt"), type: "appt", client, date, time, created:new Date().toISOString() };
    await put(obj);
    $("#apptClient").value=""; $("#apptDate").value=""; $("#apptTime").value="";
    refreshAppts();
    speak("Cita creada");
    updateCounts();
  });
  $("#btnApptsList").addEventListener("click", refreshAppts);
  async function refreshAppts(){
    const all = await getAll();
    const items = all.filter(x=>x.type==="appt").sort((a,b)=> a.date.localeCompare(b.date));
    const c = $("#apptsList"); c.innerHTML="";
    items.forEach(it=>{
      const d = document.createElement("div"); d.className="item";
      d.innerHTML = `<strong>${it.client}</strong> — ${it.date} ${it.time} <div style="margin-top:6px"><small>${it.created}</small></div>`;
      c.appendChild(d);
    });
  }

  // Export / Import
  $("#btnExport").addEventListener("click", async ()=>{
    const all = await getAll();
    $("#exportPreview").textContent = JSON.stringify(all, null, 2);
    speak("Datos listos para copiar");
  });
  $("#btnImport").addEventListener("click", ()=> $("#importFile").click());
  $("#importFile").addEventListener("change", async (e)=>{
    const f = e.target.files[0];
    if (!f) return;
    const text = await f.text();
    try {
      const arr = JSON.parse(text);
      for (const obj of arr) { await put(obj); }
      alert("Importación completada");
      updateCounts(); refreshItemsList(); refreshSalesList(); refreshAppts(); refreshBarberList();
    } catch(err){ alert("JSON inválido"); }
  });

  // Voice recognition (commands)
  let recognition = null;
  let listening = false;
  if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SR();
    recognition.lang = 'es-ES';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = async (e) => {
      const text = e.results[0][0].transcript.toLowerCase();
      speak("Comando: " + text);
      handleVoiceCommand(text);
    };
    recognition.onend = ()=> { listening = false; $("#btnVoice").textContent = "🎤 Voz"; };
  } else {
    $("#btnVoice").disabled = true;
    $("#btnVoice").title = "Reconocimiento de voz no soportado en este navegador";
  }

  $("#btnVoice").addEventListener("click", ()=>{
    if (!recognition) return alert("Reconocimiento no disponible");
    if (!listening) { recognition.start(); listening=true; $("#btnVoice").textContent="🔴 Grabando..."; }
    else { recognition.stop(); listening=false; $("#btnVoice").textContent="🎤 Voz"; }
  });

  function handleVoiceCommand(text) {
    // simple commands
    if (text.includes("abrir ventas") || text.includes("mostrar ventas")) { showSection("ventas"); speak("Abriendo ventas"); }
    else if (text.includes("abrir inventario") || text.includes("mostrar inventario")) { showSection("inventario"); speak("Mostrando inventario"); }
    else if (text.includes("crear cita")) { showSection("citas"); speak("Abriendo citas"); }
    else if (text.includes("barbería") || text.includes("barberia")) { showSection("barber"); speak("Abriendo barbería"); }
    else if (text.includes("car wash") || text.includes("lavado")) { showSection("carwash"); speak("Abriendo car wash"); }
    else if (text.includes("hola") || text.includes("buenos")) { speak("Hola, ¿en qué te ayudo?"); }
    else { speak("No entendí el comando"); }
  }

  // Initialize lists
  refreshItemsList(); refreshProductSelect(); refreshSalesList(); refreshAppts(); refreshBarberList(); refreshCarList(); refreshPoolList();

  // Auto-login if session exists
  if (getSession()) showDashboard();

  // Quick keyboard: Enter to login
  $("#password").addEventListener("keypress", (e)=> { if (e.key==="Enter") $("#btnLogin").click(); });
});
