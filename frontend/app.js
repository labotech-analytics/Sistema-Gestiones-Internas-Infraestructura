// app.js
const API_BASE = "http://localhost:8080";
const GOOGLE_CLIENT_ID = "354063050046-fkp06ao8aauems1gcj4hlngljf56o3cj.apps.googleusercontent.com";

let idToken = null;

// Catálogos en memoria
let CATALOGOS = {
  estados: [],
  urgencias: [],
  ministerios: [],
  categorias: [],
  departamentos: [],
  localidadesByDepto: new Map(),
};

// ============================
// Helpers UI
// ============================
function show(el) { el?.classList.remove("hidden"); }
function hide(el) { el?.classList.add("hidden"); }

function setLoginError(msg) {
  const box = document.getElementById("loginError");
  if (!box) return;
  if (!msg) {
    box.textContent = "";
    hide(box);
  } else {
    box.textContent = msg;
    show(box);
  }
}

function setAppError(msg) {
  const box = document.getElementById("appError");
  if (!box) return;
  if (!msg) {
    box.textContent = "";
    hide(box);
  } else {
    box.textContent = msg;
    show(box);
  }
}

function setAuthedUI(isAuthed) {
  const loginSection = document.getElementById("loginSection");
  const appSection = document.getElementById("appSection");
  const btnLogout = document.getElementById("btnLogout");

  if (isAuthed) {
    hide(loginSection);
    show(appSection);
    show(btnLogout);
  } else {
    show(loginSection);
    hide(appSection);
    hide(btnLogout);
  }
}

function saveToken(token) {
  idToken = token;
  if (token) sessionStorage.setItem("idToken", token);
  else sessionStorage.removeItem("idToken");
}
function readToken() {
  return sessionStorage.getItem("idToken");
}

// ============================
// Google Sign-In init
// ============================
function initGoogleButton() {
  if (!(window.google && google.accounts && google.accounts.id)) {
    setTimeout(initGoogleButton, 200);
    return;
  }

  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: onGoogleSignIn,
    auto_select: false,
    cancel_on_tap_outside: true,
  });

  const googleBtn = document.getElementById("googleBtn");
  if (googleBtn) {
    googleBtn.innerHTML = "";
    google.accounts.id.renderButton(googleBtn, {
      theme: "outline",
      size: "large",
      text: "signin_with",
      shape: "pill",
      width: 280,
    });
  }
}

// Callback de Google (recibe el credential id_token)
async function onGoogleSignIn(response) {
  setLoginError("");
  setAppError("");

  try {
    saveToken(response.credential);
    console.log("BEARER TOKEN (id_token):", idToken);

    // UI preliminar
    setAuthedUI(true);
    document.getElementById("userBox").innerText = "Validando usuario...";

    // 1) Validar auth (SOLO /me)
    await validateAuthOrThrow();

    // 2) Cargar datos (si falla, NO es auth; mostramos error en app)
    document.getElementById("userBox").innerText += " · Cargando datos...";
    await bootData();
  } catch (e) {
    console.error(e);

    // Si el error fue de auth => volvemos al login
    if (e?.__auth_error) {
      saveToken(null);
      setAuthedUI(false);
      document.getElementById("userBox").innerText = "";
      setLoginError(e.message || "No autorizado. Verificá que tu usuario esté habilitado en BigQuery.");
      return;
    }

    // Si no es auth, dejamos la sesión pero mostramos error arriba en la app
    setAuthedUI(true);
    setAppError(
      "Autenticación OK, pero falló la carga de datos. " +
      "Revisá backend/logs. Detalle: " + (e?.message || String(e))
    );
  }
}

// Logout
function logout() {
  saveToken(null);
  setAuthedUI(false);
  document.getElementById("userBox").innerText = "";
  setLoginError("");
  setAppError("");

  closeModal("modalNewGestion");
  closeModal("modalChangeState");
  closeModal("modalEventos");

  // opcional: evitar autoselect silencioso
  try {
    if (window.google?.accounts?.id) {
      google.accounts.id.disableAutoSelect();
    }
  } catch {}

  initGoogleButton();
}

// ============================
// API helper (con error detallado)
// ============================
async function api(path, opts = {}) {
  opts.headers = opts.headers || {};
  if (idToken) opts.headers["Authorization"] = `Bearer ${idToken}`;

  if (opts.body && typeof opts.body !== "string") {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(opts.body);
  }

  // evita respuestas cacheadas raras (especialmente en /me)
  opts.cache = "no-store";

  const res = await fetch(API_BASE + path, opts);

  const ct = res.headers.get("content-type") || "";
  const bodyText = await res.text();

  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} ${res.statusText}: ${bodyText}`);
    err.status = res.status;
    err.body = bodyText;
    throw err;
  }

  if (ct.includes("application/json")) {
    try { return JSON.parse(bodyText); } catch { return bodyText; }
  }
  return bodyText;
}

// ============================
// Boot: separado en Auth y Data
// ============================
let WIRED = false;
function wireUI() {
  if (WIRED) return;
  WIRED = true;

  document.getElementById("estadoFilter")?.addEventListener("change", loadGestiones);
  document.getElementById("ministerioFilter")?.addEventListener("change", loadGestiones);
  document.getElementById("categoriaFilter")?.addEventListener("change", loadGestiones);
  document.getElementById("departamentoFilter")?.addEventListener("change", loadGestiones);

  document.getElementById("ng_departamento")?.addEventListener("change", onNewGestionDeptoChange);
  document.getElementById("btnLogout")?.addEventListener("click", logout);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal("modalNewGestion");
      closeModal("modalChangeState");
      closeModal("modalEventos");
    }
  });
}

async function validateAuthOrThrow() {
  try {
    const me = await api(`/me`);
    const label = [me.nombre, me.email, me.rol].filter(Boolean).join(" · ");
    document.getElementById("userBox").innerText = label || "Autenticado";
  } catch (e) {
    const authErr = new Error(
      "No autorizado o error de autenticación. Verificá que tu usuario esté habilitado en BigQuery.\n" +
      "Detalle: " + (e?.message || String(e))
    );
    authErr.__auth_error = true;
    throw authErr;
  }
}

async function bootData() {
  wireUI();
  setAppError("");

  await loadCatalogos();
  await loadGestiones();
}

// ============================
// Modales
// ============================
function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("hidden");
  el.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add("hidden");
  el.setAttribute("aria-hidden", "true");

  const anyOpen = Array.from(document.querySelectorAll(".modal"))
    .some(m => !m.classList.contains("hidden"));
  if (!anyOpen) document.body.classList.remove("modal-open");
}

// ============================
// Catálogos
// ============================
async function loadCatalogos() {
  try {
    const [estados, urgencias, ministerios, categorias, departamentos] = await Promise.all([
      api(`/catalogos/estados`),
      api(`/catalogos/urgencias`),
      api(`/catalogos/ministerios`),
      api(`/catalogos/categorias`),
      api(`/catalogos/departamentos`),
    ]);

    CATALOGOS.estados = estados || [];
    CATALOGOS.urgencias = urgencias || [];
    CATALOGOS.ministerios = ministerios || [];
    CATALOGOS.categorias = categorias || [];
    CATALOGOS.departamentos = departamentos || [];

    fillSelectFromCatalog("estadoFilter", CATALOGOS.estados, { valueKey: "nombre", labelKey: "nombre", firstLabel: "(Todos)" });
    fillSelectFromCatalog("ministerioFilter", CATALOGOS.ministerios, { valueKey: "id", labelKey: "nombre", firstLabel: "(Todos)" });
    fillSelectFromCatalog("categoriaFilter", CATALOGOS.categorias, { valueKey: "id", labelKey: "nombre", firstLabel: "(Todos)" });
    fillSelectFromList("departamentoFilter", CATALOGOS.departamentos, "(Todos)");

    fillSelectFromCatalog("ng_ministerio", CATALOGOS.ministerios, { valueKey: "id", labelKey: "nombre", firstLabel: "(Seleccionar)" });
    fillSelectFromCatalog("ng_categoria", CATALOGOS.categorias, { valueKey: "id", labelKey: "nombre", firstLabel: "(Seleccionar)" });
    fillSelectFromCatalog("ng_urgencia", CATALOGOS.urgencias, { valueKey: "nombre", labelKey: "nombre", firstLabel: "(Seleccionar)" });
    fillSelectFromList("ng_departamento", CATALOGOS.departamentos, "(Seleccionar)");

    fillSelectFromCatalog("cs_nuevo_estado", CATALOGOS.estados, { valueKey: "nombre", labelKey: "nombre", firstLabel: "(Seleccionar)" });
  } catch (e) {
    setAppError("Falló la carga de catálogos: " + (e?.message || String(e)));
    throw e;
  }
}

function fillSelectFromCatalog(selectId, arr, { valueKey, labelKey, firstLabel }) {
  const sel = document.getElementById(selectId);
  if (!sel) return;

  sel.innerHTML = "";
  const first = document.createElement("option");
  first.value = "";
  first.textContent = firstLabel || "(Seleccionar)";
  sel.appendChild(first);

  (arr || []).forEach((item) => {
    const opt = document.createElement("option");
    opt.value = item[valueKey] ?? "";
    opt.textContent = item[labelKey] ?? "";
    sel.appendChild(opt);
  });
}

function fillSelectFromList(selectId, list, firstLabel) {
  const sel = document.getElementById(selectId);
  if (!sel) return;

  sel.innerHTML = "";
  const first = document.createElement("option");
  first.value = "";
  first.textContent = firstLabel || "(Seleccionar)";
  sel.appendChild(first);

  (list || []).forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  });
}

// ============================
// Localidades por depto
// ============================
async function getLocalidadesByDepto(departamento) {
  if (!departamento) return [];
  if (CATALOGOS.localidadesByDepto.has(departamento)) {
    return CATALOGOS.localidadesByDepto.get(departamento);
  }
  const locs = await api(`/catalogos/localidades?departamento=${encodeURIComponent(departamento)}`);
  CATALOGOS.localidadesByDepto.set(departamento, locs || []);
  return locs || [];
}

async function onNewGestionDeptoChange() {
  const depto = document.getElementById("ng_departamento").value || "";
  const selLoc = document.getElementById("ng_localidad");
  if (!selLoc) return;

  selLoc.innerHTML = `<option value="">(Seleccionar)</option>`;
  if (!depto) return;

  const locs = await getLocalidadesByDepto(depto);
  locs.forEach((l) => {
    const opt = document.createElement("option");
    opt.value = l;
    opt.textContent = l;
    selLoc.appendChild(opt);
  });
}

// ============================
// Gestiones (FIX: normalizar respuesta a array)
// ============================
function normalizeRows(resp) {
  if (Array.isArray(resp)) return resp;
  if (Array.isArray(resp?.items)) return resp.items;
  if (Array.isArray(resp?.rows)) return resp.rows;
  if (Array.isArray(resp?.data)) return resp.data;
  return [];
}

function updatePagerInfo(resp, rows) {
  const pager = document.getElementById("pagerInfo");
  if (!pager) return;

  const total = resp?.total ?? resp?.count ?? null;
  const limit = resp?.limit ?? 50;
  const offset = resp?.offset ?? 0;

  if (total != null) {
    pager.textContent = `Mostrando ${rows.length} de ${total} (limit=${limit}, offset=${offset})`;
  } else {
    pager.textContent = rows.length ? `Mostrando ${rows.length}` : "";
  }
}

async function loadGestiones() {
  try {
    setAppError("");

    const estado = document.getElementById("estadoFilter")?.value || null;
    const ministerio = document.getElementById("ministerioFilter")?.value || null;
    const categoria = document.getElementById("categoriaFilter")?.value || null;
    const departamento = document.getElementById("departamentoFilter")?.value || null;

    const qs = new URLSearchParams();
    if (estado) qs.set("estado", estado);
    if (ministerio) qs.set("ministerio", ministerio);
    if (categoria) qs.set("categoria", categoria);
    if (departamento) qs.set("departamento", departamento);
    qs.set("limit", "50");
    qs.set("offset", "0");

    const resp = await api(`/gestiones?${qs.toString()}`);

    const rows = normalizeRows(resp);
    updatePagerInfo(resp, rows);
    renderGrid(rows);
  } catch (e) {
    setAppError("Falló la carga de gestiones: " + (e?.message || String(e)));
    throw e;
  }
}

function renderGrid(rows) {
  if (!Array.isArray(rows)) rows = [];

  const table = document.getElementById("grid");
  if (!table) return;
  table.innerHTML = "";

  const minMap = new Map((CATALOGOS.ministerios || []).map((m) => [m.id, m.nombre]));
  const catMap = new Map((CATALOGOS.categorias || []).map((c) => [c.id, c.nombre]));

  const cols = [
    "id_gestion",
    "departamento",
    "localidad",
    "estado",
    "urgencia",
    "ministerio_agencia_id",
    "categoria_general_id",
    "fecha_ingreso",
    "dias_transcurridos",
  ];

  const thead = document.createElement("thead");
  const trh = document.createElement("tr");

  cols.forEach((c) => {
    const th = document.createElement("th");
    th.textContent = c;
    trh.appendChild(th);
  });

  const thA = document.createElement("th");
  thA.textContent = "Acciones";
  trh.appendChild(thA);

  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach((r) => {
    const tr = document.createElement("tr");

    cols.forEach((c) => {
      const td = document.createElement("td");

      if (c === "ministerio_agencia_id") {
        const id = r[c] ?? "";
        td.textContent = id ? `${id} · ${minMap.get(id) || ""}`.trim() : "";
      } else if (c === "categoria_general_id") {
        const id = r[c] ?? "";
        td.textContent = id ? `${id} · ${catMap.get(id) || ""}`.trim() : "";
      } else {
        td.textContent = r[c] ?? "";
      }

      tr.appendChild(td);
    });

    const tdA = document.createElement("td");
    tdA.className = "actions";
    tdA.innerHTML = `
      <button class="btn" type="button" onclick="view('${r.id_gestion}')">Ver</button>
      <button class="btn" type="button" onclick="openChangeState('${r.id_gestion}')">Estado</button>
      <button class="btn" type="button" onclick="openEventos('${r.id_gestion}')">Eventos</button>
      <button class="btn btn-danger" type="button" onclick="deleteGestion('${r.id_gestion}')">Eliminar</button>
    `;
    tr.appendChild(tdA);

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
}

// ============================
// Ver / Eventos
// ============================
async function view(id) {
  const g = await api(`/gestiones/${encodeURIComponent(id)}`);
  alert(JSON.stringify(g, null, 2));
}

async function openEventos(id) {
  const ev = await api(`/gestiones/${encodeURIComponent(id)}/eventos`);
  document.getElementById("ev_title").textContent = `Eventos · ${id}`;
  document.getElementById("ev_body").textContent = JSON.stringify(ev, null, 2);
  openModal("modalEventos");
}

async function deleteGestion(id) {
  if (!id) return;

  const ok = confirm(
    `¿Seguro que querés eliminar (borrado lógico) la gestión?\n\nID: ${id}\n\nEsta acción marcará la gestión como eliminada y ya no aparecerá en el listado.`
  );
  if (!ok) return;

  try {
    await api(`/gestiones/${encodeURIComponent(id)}`, { method: "DELETE" });
    alert("Gestión eliminada correctamente.");
    await loadGestiones();
  } catch (e) {
    // Si el backend devuelve 403, acá lo vas a ver clarito
    alert("No se pudo eliminar la gestión.\n\nDetalle: " + (e?.message || String(e)));
  }
}


// ============================
// Cambiar estado
// ============================
function openChangeState(id) {
  document.getElementById("cs_id_gestion").value = id;
  document.getElementById("cs_comentario").value = "";
  document.getElementById("cs_nuevo_estado").value = "";
  openModal("modalChangeState");
}

async function submitChangeState() {
  const id = document.getElementById("cs_id_gestion").value;
  const nuevo = document.getElementById("cs_nuevo_estado").value;
  const comentario = document.getElementById("cs_comentario").value || null;

  if (!id) return alert("Falta id_gestion");
  if (!nuevo) return alert("Seleccioná un estado");

  await api(`/gestiones/${encodeURIComponent(id)}/cambiar-estado`, {
    method: "POST",
    body: { nuevo_estado: nuevo, comentario },
  });

  closeModal("modalChangeState");
  await loadGestiones();
}

// ============================
// Nueva gestión
// ============================
function openNew() {
  document.getElementById("ng_ministerio").value = "";
  document.getElementById("ng_categoria").value = "";
  document.getElementById("ng_urgencia").value = "Media";

  document.getElementById("ng_departamento").value = "";
  document.getElementById("ng_localidad").innerHTML = `<option value="">(Seleccionar)</option>`;

  document.getElementById("ng_direccion").value = "";
  document.getElementById("ng_detalle").value = "";
  document.getElementById("ng_observaciones").value = "";

  openModal("modalNewGestion");
}

async function submitNewGestion() {
  const ministerio = document.getElementById("ng_ministerio").value;
  const categoria = document.getElementById("ng_categoria").value;
  const urgencia = document.getElementById("ng_urgencia").value || "Media";
  const departamento = document.getElementById("ng_departamento").value;
  const localidad = document.getElementById("ng_localidad").value;
  const direccion = document.getElementById("ng_direccion").value || null;
  const detalle = document.getElementById("ng_detalle").value;
  const observaciones = document.getElementById("ng_observaciones").value || null;

  if (!ministerio) return alert("Seleccioná un ministerio/agencia");
  if (!categoria) return alert("Seleccioná una categoría");
  if (!departamento) return alert("Seleccioná un departamento");
  if (!localidad) return alert("Seleccioná una localidad");
  if (!detalle || detalle.trim() === "") return alert("Detalle es obligatorio");

  await api(`/catalogos/geo?departamento=${encodeURIComponent(departamento)}&localidad=${encodeURIComponent(localidad)}`);

  const payload = {
    ministerio_agencia_id: ministerio,
    categoria_general_id: categoria,
    urgencia,
    detalle,
    observaciones,
    departamento,
    localidad,
    direccion,
  };

  const resp = await api(`/gestiones`, { method: "POST", body: payload });

  closeModal("modalNewGestion");
  await loadGestiones();

  if (resp?.id_gestion) alert(`Gestión creada: ${resp.id_gestion}`);
}

// ============================
// Init
// ============================
document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("userBox").innerText = "";
  setAuthedUI(false);
  setLoginError("");
  setAppError("");

  wireUI();
  initGoogleButton();

  // restaurar sesión si hay token
  const t = readToken();
  if (t) {
    try {
      saveToken(t);
      setAuthedUI(true);
      document.getElementById("userBox").innerText = "Restaurando sesión...";

      // solo auth primero
      await validateAuthOrThrow();

      // luego data
      await bootData();
    } catch (e) {
      console.warn("No se pudo restaurar sesión:", e);
      logout();
    }
  }
});

// ============================
// Exponer globales para onclick
// ============================
window.loadGestiones = loadGestiones;
window.openNew = openNew;
window.closeModal = closeModal;
window.submitNewGestion = submitNewGestion;
window.openChangeState = openChangeState;
window.submitChangeState = submitChangeState;
window.openEventos = openEventos;
window.view = view;
window.deleteGestion = deleteGestion;