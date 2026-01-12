// app.js (UI v2)
// - Mantiene la lógica de autenticación y llamadas al backend
// - Suma tabs (Gestiones / Tablero / Usuarios-admin)
// - Mejora UX de tabla + acciones

const API_BASE = "http://localhost:8080";
const GOOGLE_CLIENT_ID = "354063050046-fkp06ao8aauems1gcj4hlngljf56o3cj.apps.googleusercontent.com";

let idToken = null;
let CURRENT_USER = null;
let CURRENT_TAB = "gestiones";

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

function isAdmin() {
  const r = String(CURRENT_USER?.rol || "").toLowerCase();
  return r === "admin";
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

    // UI preliminar
    setAuthedUI(true);
    document.getElementById("userBox").innerText = "Validando usuario...";

    // 1) Validar auth (SOLO /me)
    await validateAuthOrThrow();

    // 2) Cargar datos
    document.getElementById("userBox").innerText += " · Cargando...";
    await bootData();
  } catch (e) {
    console.error(e);

    // Si el error fue de auth => volvemos al login
    if (e?.__auth_error) {
      saveToken(null);
      setAuthedUI(false);
      document.getElementById("userBox").innerText = "";
      setLoginError(e.message || "No autorizado. Verificá que tu usuario esté habilitado.");
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
  CURRENT_USER = null;
  setAuthedUI(false);
  document.getElementById("userBox").innerText = "";
  setLoginError("");
  setAppError("");

  closeModal("modalNewGestion");
  closeModal("modalChangeState");
  closeModal("modalEventos");

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

async function apiTry(path, opts) {
  try {
    return await api(path, opts);
  } catch (e) {
    return { __error: e };
  }
}

// ============================
// Boot
// ============================
let WIRED = false;
function wireUI() {
  if (WIRED) return;
  WIRED = true;

  // Filters
  document.getElementById("estadoFilter")?.addEventListener("change", loadGestiones);
  document.getElementById("ministerioFilter")?.addEventListener("change", loadGestiones);
  document.getElementById("categoriaFilter")?.addEventListener("change", loadGestiones);
  document.getElementById("departamentoFilter")?.addEventListener("change", loadGestiones);

  // New gestion depto -> localidades
  document.getElementById("ng_departamento")?.addEventListener("change", onNewGestionDeptoChange);

  // Tabs
  document.getElementById("tabGestiones")?.addEventListener("click", () => setTab("gestiones"));
  document.getElementById("tabTablero")?.addEventListener("click", () => setTab("tablero"));
  document.getElementById("tabUsuarios")?.addEventListener("click", () => setTab("usuarios"));

  // Logout
  document.getElementById("btnLogout")?.addEventListener("click", logout);

  // Esc closes modals
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
    CURRENT_USER = me;

    const label = [me.nombre, me.email, me.rol].filter(Boolean).join(" · ");
    document.getElementById("userBox").innerText = label || "Autenticado";

    // Tabs: admin-only
    const tabUsuarios = document.getElementById("tabUsuarios");
    const usersPane = document.getElementById("usersPane");
    if (isAdmin()) {
      show(tabUsuarios);
      show(usersPane);
    } else {
      hide(tabUsuarios);
      hide(usersPane);
      if (CURRENT_TAB === "usuarios") CURRENT_TAB = "gestiones";
    }

    // default tab restored
    const savedTab = sessionStorage.getItem("activeTab");
    if (savedTab && ["gestiones", "tablero", "usuarios"].includes(savedTab)) {
      if (savedTab === "usuarios" && !isAdmin()) {
        setTab("gestiones");
      } else {
        setTab(savedTab);
      }
    } else {
      setTab("gestiones");
    }

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

  if (isAdmin()) {
    // no rompe si el backend no existe
    await loadUsers().catch(() => {});
  }
}

// ============================
// Tabs
// ============================
function setTab(tab) {
  CURRENT_TAB = tab;
  sessionStorage.setItem("activeTab", tab);

  const btnG = document.getElementById("tabGestiones");
  const btnT = document.getElementById("tabTablero");
  const btnU = document.getElementById("tabUsuarios");

  btnG?.classList.toggle("active", tab === "gestiones");
  btnT?.classList.toggle("active", tab === "tablero");
  btnU?.classList.toggle("active", tab === "usuarios");

  const panes = {
    gestiones: document.getElementById("gestionesPane"),
    tablero: document.getElementById("tableroPane"),
    usuarios: document.getElementById("usuariosPane"),
  };

  Object.entries(panes).forEach(([k, el]) => {
    if (!el) return;
    el.classList.toggle("hidden", k !== tab);
  });

  // carga perezosa
  if (tab === "usuarios" && isAdmin()) loadUsers().catch(() => {});
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

  const anyOpen = Array.from(document.querySelectorAll(".modal")).some(m => !m.classList.contains("hidden"));
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
// Gestiones
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

function badge(text, kind) {
  const safe = String(text ?? "");
  const cls = kind ? `badge ${kind}` : "badge";
  return `<span class="${cls}">${escapeHtml(safe)}</span>`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderGrid(rows) {
  if (!Array.isArray(rows)) rows = [];

  const table = document.getElementById("grid");
  if (!table) return;
  table.innerHTML = "";

  const minMap = new Map((CATALOGOS.ministerios || []).map((m) => [m.id, m.nombre]));
  const catMap = new Map((CATALOGOS.categorias || []).map((c) => [c.id, c.nombre]));

  const cols = [
    { key: "id_gestion", label: "ID" },
    { key: "departamento", label: "Departamento" },
    { key: "localidad", label: "Localidad" },
    { key: "estado", label: "Estado" },
    { key: "urgencia", label: "Urgencia" },
    { key: "ministerio_agencia_id", label: "Ministerio/Agencia" },
    { key: "categoria_general_id", label: "Categoría" },
    { key: "fecha_ingreso", label: "Ingreso" },
    { key: "dias_transcurridos", label: "Días" },
  ];

  const thead = document.createElement("thead");
  const trh = document.createElement("tr");

  cols.forEach((c, idx) => {
    const th = document.createElement("th");
    th.textContent = c.label;
    if (idx === 0) th.classList.add("sticky-first");
    trh.appendChild(th);
  });

  const thA = document.createElement("th");
  thA.textContent = "Acciones";
  thA.className = "actions-col";
  trh.appendChild(thA);

  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach((r) => {
    const tr = document.createElement("tr");

    cols.forEach((c, idx) => {
      const td = document.createElement("td");
      if (idx === 0) td.classList.add("sticky-first");

      if (c.key === "estado") {
        td.innerHTML = badge(r[c.key] ?? "", `estado-${String(r[c.key] || "").toLowerCase().replaceAll(" ", "-")}`);
      } else if (c.key === "urgencia") {
        td.innerHTML = badge(r[c.key] ?? "", `urg-${String(r[c.key] || "").toLowerCase()}`);
      } else if (c.key === "ministerio_agencia_id") {
        const id = r[c.key] ?? "";
        const name = id ? (minMap.get(id) || "") : "";
        td.innerHTML = id ? `<div class="cell-main">${escapeHtml(id)}</div><div class="cell-sub">${escapeHtml(name)}</div>` : "";
      } else if (c.key === "categoria_general_id") {
        const id = r[c.key] ?? "";
        const name = id ? (catMap.get(id) || "") : "";
        td.innerHTML = id ? `<div class="cell-main">${escapeHtml(id)}</div><div class="cell-sub">${escapeHtml(name)}</div>` : "";
      } else {
        td.textContent = r[c.key] ?? "";
      }

      tr.appendChild(td);
    });

    const tdA = document.createElement("td");
    tdA.className = "actions actions-col";

    const canDelete = isAdmin() || String(CURRENT_USER?.rol || "").toLowerCase() === "supervisor";

    tdA.innerHTML = `
      <div class="actions-wrap">
        <button class="btn" type="button" onclick="view('${escapeHtml(r.id_gestion)}')">Ver</button>
        <button class="btn" type="button" onclick="openChangeState('${escapeHtml(r.id_gestion)}')">Estado</button>
        <button class="btn" type="button" onclick="openEventos('${escapeHtml(r.id_gestion)}')">Eventos</button>
        ${canDelete ? `<button class="btn danger" type="button" onclick="deleteGestion('${escapeHtml(r.id_gestion)}')">Eliminar</button>` : ``}
      </div>
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

  // Validación suave del par depto/localidad (backend). No usamos el resultado acá.
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
// Usuarios (admin)
// ============================
const USER_API_CANDIDATES = [
  { list: "/usuarios", create: "/usuarios", update: (e) => `/usuarios/${encodeURIComponent(e)}`, disable: (e) => `/usuarios/${encodeURIComponent(e)}/disable` },
  { list: "/usuarios/roles", create: "/usuarios/roles", update: (e) => `/usuarios/roles/${encodeURIComponent(e)}`, disable: (e) => `/usuarios/roles/${encodeURIComponent(e)}/disable` },
];
let USER_API = null;
let USERS_CACHE = [];

async function detectUsersApi() {
  if (USER_API) return USER_API;
  for (const c of USER_API_CANDIDATES) {
    const res = await apiTry(c.list);
    if (!res?.__error) {
      USER_API = c;
      return USER_API;
    }
  }
  // no hay backend
  USER_API = USER_API_CANDIDATES[0];
  return USER_API;
}

async function loadUsers() {
  if (!isAdmin()) return;

  const status = document.getElementById("usersStatus");
  const errBox = document.getElementById("usersError");
  errBox && (errBox.textContent = "");
  errBox && hide(errBox);

  status && (status.textContent = "Cargando usuarios...");

  const c = await detectUsersApi();
  const resp = await apiTry(c.list);
  if (resp?.__error) {
    if (status) status.textContent = "";
    if (errBox) {
      errBox.textContent = "No se pudo cargar usuarios (backend no disponible o endpoint no implementado). Detalle: " + (resp.__error?.message || String(resp.__error));
      show(errBox);
    }
    USERS_CACHE = [];
    renderUsers([]);
    return;
  }

  const rows = normalizeRows(resp);
  USERS_CACHE = rows;
  renderUsers(rows);
  if (status) status.textContent = rows.length ? `Usuarios: ${rows.length}` : "Sin usuarios";
}

function renderUsers(rows) {
  const host = document.getElementById("usersTable");
  if (!host) return;
  host.innerHTML = "";

  const table = document.createElement("table");
  table.className = "grid";

  const thead = document.createElement("thead");
  thead.innerHTML = `
    <tr>
      <th>Email</th>
      <th>Nombre</th>
      <th>Rol</th>
      <th>Activo</th>
      <th class="actions-col">Acciones</th>
    </tr>
  `;
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  (rows || []).forEach((u) => {
    const email = u.email || u.usuario_email || u.user || "";
    const nombre = u.nombre || "";
    const rol = u.rol || "";
    const activo = (u.activo === true || String(u.activo).toLowerCase() === "true" || u.activo === 1);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="sticky-first"><div class="cell-main">${escapeHtml(email)}</div></td>
      <td>${escapeHtml(nombre)}</td>
      <td><span class="badge">${escapeHtml(rol)}</span></td>
      <td>${activo ? '<span class="badge ok">Activo</span>' : '<span class="badge">Inactivo</span>'}</td>
      <td class="actions actions-col">
        <div class="actions-wrap">
          <button class="btn" type="button" onclick="openEditUser('${escapeHtml(email)}')">Editar</button>
          <button class="btn danger" type="button" onclick="toggleUser('${escapeHtml(email)}')">${activo ? "Desactivar" : "Activar"}</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  host.appendChild(table);
}

function openNewUser() {
  document.getElementById("u_mode").value = "create";
  document.getElementById("u_email").value = "";
  document.getElementById("u_nombre").value = "";
  document.getElementById("u_rol").value = "Consulta";
  document.getElementById("u_activo").checked = true;
  document.getElementById("u_email").disabled = false;

  document.getElementById("userModalTitle").textContent = "Nuevo usuario";
  openModal("modalUser");
}

function openEditUser(email) {
  const u = (USERS_CACHE || []).find(x => (x.email || x.usuario_email) === email) || {};
  document.getElementById("u_mode").value = "edit";
  document.getElementById("u_email").value = email;
  document.getElementById("u_nombre").value = u.nombre || "";
  document.getElementById("u_rol").value = u.rol || "Consulta";
  document.getElementById("u_activo").checked = (u.activo === true || String(u.activo).toLowerCase() === "true" || u.activo === 1);
  document.getElementById("u_email").disabled = true;

  document.getElementById("userModalTitle").textContent = "Editar usuario";
  openModal("modalUser");
}

async function saveUser() {
  const mode = document.getElementById("u_mode").value;
  const email = (document.getElementById("u_email").value || "").trim();
  const nombre = (document.getElementById("u_nombre").value || "").trim();
  const rol = document.getElementById("u_rol").value || "Consulta";
  const activo = !!document.getElementById("u_activo").checked;

  if (!email) return alert("Email es obligatorio");
  if (!nombre) return alert("Nombre es obligatorio");

  const c = await detectUsersApi();

  try {
    if (mode === "create") {
      await api(c.create, { method: "POST", body: { email, nombre, rol, activo } });
    } else {
      await api(c.update(email), { method: "PUT", body: { nombre, rol, activo } });
    }

    closeModal("modalUser");
    await loadUsers();
  } catch (e) {
    alert("No se pudo guardar el usuario.\n\nDetalle: " + (e?.message || String(e)));
  }
}

async function toggleUser(email) {
  if (!email) return;
  const u = (USERS_CACHE || []).find(x => (x.email || x.usuario_email) === email) || {};
  const activo = (u.activo === true || String(u.activo).toLowerCase() === "true" || u.activo === 1);
  const nuevoActivo = !activo;

  const c = await detectUsersApi();

  try {
    // 1) probamos PUT update
    const r1 = await apiTry(c.update(email), { method: "PUT", body: { activo: nuevoActivo } });
    if (!r1?.__error) {
      await loadUsers();
      return;
    }

    // 2) si existe endpoint disable (solo desactivar)
    if (!nuevoActivo) {
      const r2 = await apiTry(c.disable(email), { method: "POST" });
      if (!r2?.__error) {
        await loadUsers();
        return;
      }
    }

    throw r1.__error;
  } catch (e) {
    alert("No se pudo actualizar el usuario.\n\nDetalle: " + (e?.message || String(e)));
  }
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

  // botón usuarios (solo si está)
  document.getElementById("btnNewUser")?.addEventListener("click", openNewUser);
  document.getElementById("btnUsersReload")?.addEventListener("click", () => loadUsers());

  // guardar usuario
  document.getElementById("btnSaveUser")?.addEventListener("click", saveUser);

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

window.setTab = setTab;
window.openNewUser = openNewUser;
window.openEditUser = openEditUser;
window.saveUser = saveUser;
window.toggleUser = toggleUser;
