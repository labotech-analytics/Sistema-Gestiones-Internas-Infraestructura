const API_BASE = "http://localhost:8080";
const GOOGLE_CLIENT_ID = "354063050046-fkp06ao8aauems1gcj4hlngljf56o3cj.apps.googleusercontent.com";

let idToken = null;
let CURRENT_USER = null;
let CURRENT_TAB = "gestiones";

// paginado
const PAGE = { limit: 50, offset: 0, total: null };

// cache UI
let LAST_ROWS = [];
let LAST_SEARCH = "";

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
  if (!msg) { box.textContent = ""; hide(box); }
  else { box.textContent = msg; show(box); }
}

function setAppError(msg) {
  const box = document.getElementById("appError");
  if (!box) return;
  if (!msg) { box.textContent = ""; hide(box); }
  else { box.textContent = msg; show(box); }
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
function readToken() { return sessionStorage.getItem("idToken"); }

function isAdmin() { return String(CURRENT_USER?.rol || "").toLowerCase() === "admin"; }
function isSupervisor() { return String(CURRENT_USER?.rol || "").toLowerCase() === "supervisor"; }

// ============================
// Robust field getter (fix para detalle/costo vacíos)
// ============================
function pick(row, ...keys) {
  if (!row || typeof row !== "object") return undefined;

  // 1) exact
  for (const k of keys) {
    if (k in row) return row[k];
  }

  // 2) case-insensitive lookup
  const lowerMap = new Map();
  for (const k of Object.keys(row)) lowerMap.set(k.toLowerCase(), k);

  for (const wanted of keys) {
    const real = lowerMap.get(String(wanted).toLowerCase());
    if (real) return row[real];
  }

  // 3) try variants (snake/camel/upper)
  const variants = [];
  for (const k of keys) {
    const s = String(k);
    variants.push(s.toUpperCase());
    variants.push(s.toLowerCase());
    // camelCase guess
    variants.push(s.replace(/_([a-z])/g, (_, c) => c.toUpperCase()));
  }
  for (const v of variants) {
    const real = lowerMap.get(String(v).toLowerCase());
    if (real) return row[real];
  }

  return undefined;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fmtDateLike(v) {
  if (!v) return "";
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleString();
  } catch {
    return String(v);
  }
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

async function onGoogleSignIn(response) {
  setLoginError("");
  setAppError("");

  try {
    saveToken(response.credential);

    setAuthedUI(true);
    document.getElementById("userBox").innerText = "Validando usuario...";

    await validateAuthOrThrow();

    document.getElementById("userBox").innerText += " · Cargando...";
    await bootData();
  } catch (e) {
    console.error(e);
    if (e?.__auth_error) {
      saveToken(null);
      setAuthedUI(false);
      document.getElementById("userBox").innerText = "";
      setLoginError(e.message || "No autorizado.");
      return;
    }
    setAuthedUI(true);
    setAppError("Autenticación OK, pero falló la carga de datos. Detalle: " + (e?.message || String(e)));
  }
}

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
  closeDrawer();

  try { window.google?.accounts?.id?.disableAutoSelect(); } catch {}
  initGoogleButton();
}

// ============================
// API helper
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
  try { return await api(path, opts); }
  catch (e) { return { __error: e }; }
}

// ============================
// Boot / Wire
// ============================
let WIRED = false;
function wireUI() {
  if (WIRED) return;
  WIRED = true;

  document.getElementById("estadoFilter")?.addEventListener("change", () => loadGestiones(true));
  document.getElementById("ministerioFilter")?.addEventListener("change", () => loadGestiones(true));
  document.getElementById("categoriaFilter")?.addEventListener("change", () => loadGestiones(true));

  document.getElementById("departamentoFilter")?.addEventListener("change", onDepartamentoFilterChange);
  document.getElementById("localidadFilter")?.addEventListener("change", () => loadGestiones(true));

  document.getElementById("searchInput")?.addEventListener("input", (e) => {
    LAST_SEARCH = e.target.value || "";
    applySearchAndRender();
  });

  document.getElementById("ng_departamento")?.addEventListener("change", onNewGestionDeptoChange);

  document.getElementById("tab-gestiones")?.addEventListener("click", () => setTab("gestiones"));
  document.getElementById("tab-tablero")?.addEventListener("click", () => setTab("tablero"));
  document.getElementById("tab-usuarios")?.addEventListener("click", () => setTab("usuarios"));

  document.getElementById("btnPrev")?.addEventListener("click", () => pagePrev());
  document.getElementById("btnNext")?.addEventListener("click", () => pageNext());

  document.getElementById("btnLogout")?.addEventListener("click", logout);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal("modalNewGestion");
      closeModal("modalChangeState");
      closeModal("modalEventos");
      closeDrawer();
    }
  });
}

async function validateAuthOrThrow() {
  try {
    const me = await api(`/me`);
    CURRENT_USER = me;

    const label = [me.nombre, me.email, me.rol].filter(Boolean).join(" · ");
    document.getElementById("userBox").innerText = label || "Autenticado";

    const tabUsuarios = document.getElementById("tab-usuarios");
    if (isAdmin()) show(tabUsuarios);
    else hide(tabUsuarios);

    const savedTab = sessionStorage.getItem("activeTab");
    if (savedTab && ["gestiones", "tablero", "usuarios"].includes(savedTab)) {
      if (savedTab === "usuarios" && !isAdmin()) setTab("gestiones");
      else setTab(savedTab);
    } else {
      setTab("gestiones");
    }
  } catch (e) {
    const authErr = new Error("No autorizado o error de autenticación. Detalle: " + (e?.message || String(e)));
    authErr.__auth_error = true;
    throw authErr;
  }
}

async function bootData() {
  wireUI();
  setAppError("");
  await loadCatalogos();
  await loadGestiones(true);
  if (isAdmin()) await loadUsers().catch(() => {});
}

// ============================
// Tabs
// ============================
function setTab(tab) {
  CURRENT_TAB = tab;
  sessionStorage.setItem("activeTab", tab);

  document.getElementById("tab-gestiones")?.classList.toggle("active", tab === "gestiones");
  document.getElementById("tab-tablero")?.classList.toggle("active", tab === "tablero");
  document.getElementById("tab-usuarios")?.classList.toggle("active", tab === "usuarios");

  const panes = {
    gestiones: document.getElementById("view-gestiones"),
    tablero: document.getElementById("view-tablero"),
    usuarios: document.getElementById("view-usuarios"),
  };
  Object.entries(panes).forEach(([k, el]) => el && el.classList.toggle("hidden", k !== tab));

  if (tab === "usuarios" && isAdmin()) loadUsers().catch(() => {});
}

// ============================
// Modales + Drawer
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

function openDrawer() {
  const el = document.getElementById("drawer");
  if (!el) return;
  el.classList.remove("hidden");
  el.setAttribute("aria-hidden", "false");
}
function closeDrawer() {
  const el = document.getElementById("drawer");
  if (!el) return;
  el.classList.add("hidden");
  el.setAttribute("aria-hidden", "true");
}

// ============================
// Catálogos
// ============================
async function loadCatalogos() {
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

  const locSel = document.getElementById("localidadFilter");
  if (locSel) {
    locSel.innerHTML = `<option value="">(Todas)</option>`;
    locSel.disabled = true;
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
  if (CATALOGOS.localidadesByDepto.has(departamento)) return CATALOGOS.localidadesByDepto.get(departamento);
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

async function onDepartamentoFilterChange() {
  const depto = document.getElementById("departamentoFilter")?.value || "";
  const locSel = document.getElementById("localidadFilter");
  if (!locSel) return;

  locSel.innerHTML = `<option value="">(Todas)</option>`;
  locSel.value = "";
  locSel.disabled = !depto;

  if (depto) {
    const locs = await getLocalidadesByDepto(depto);
    locs.forEach((l) => {
      const opt = document.createElement("option");
      opt.value = l;
      opt.textContent = l;
      locSel.appendChild(opt);
    });
  }
  await loadGestiones(true);
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
  const limit = resp?.limit ?? PAGE.limit;
  const offset = resp?.offset ?? PAGE.offset;

  PAGE.total = total;
  PAGE.limit = limit;
  PAGE.offset = offset;

  if (total != null) {
    const from = Math.min(total, offset + 1);
    const to = Math.min(total, offset + rows.length);
    pager.textContent = `Mostrando ${from}-${to} de ${total}`;
  } else {
    pager.textContent = rows.length ? `Mostrando ${rows.length}` : "";
  }

  const btnPrev = document.getElementById("btnPrev");
  const btnNext = document.getElementById("btnNext");
  if (btnPrev) btnPrev.disabled = (offset <= 0);
  if (btnNext) btnNext.disabled = (total != null ? (offset + limit >= total) : (rows.length < limit));
}

function currentFilters() {
  return {
    estado: document.getElementById("estadoFilter")?.value || null,
    ministerio: document.getElementById("ministerioFilter")?.value || null,
    categoria: document.getElementById("categoriaFilter")?.value || null,
    departamento: document.getElementById("departamentoFilter")?.value || null,
    localidad: document.getElementById("localidadFilter")?.value || null,
  };
}

async function loadGestiones(resetOffset = false) {
  setAppError("");
  if (resetOffset) PAGE.offset = 0;

  const { estado, ministerio, categoria, departamento, localidad } = currentFilters();

  const qs = new URLSearchParams();
  if (estado) qs.set("estado", estado);
  if (ministerio) qs.set("ministerio", ministerio);
  if (categoria) qs.set("categoria", categoria);
  if (departamento) qs.set("departamento", departamento);
  if (localidad) qs.set("localidad", localidad);

  qs.set("limit", String(PAGE.limit));
  qs.set("offset", String(PAGE.offset));

  const resp = await api(`/gestiones/?${qs.toString()}`);
  const rows = normalizeRows(resp);

  LAST_ROWS = rows;
  updatePagerInfo(resp, rows);
  applySearchAndRender();
}

function pagePrev() {
  PAGE.offset = Math.max(0, PAGE.offset - PAGE.limit);
  loadGestiones(false);
}
function pageNext() {
  PAGE.offset = PAGE.offset + PAGE.limit;
  loadGestiones(false);
}

function applySearchAndRender() {
  const q = String(LAST_SEARCH || "").trim().toLowerCase();
  if (!q) return renderGrid(LAST_ROWS);

  const filtered = (LAST_ROWS || []).filter((r) => {
    const hay = [
      pick(r, "id_gestion"),
      pick(r, "departamento"),
      pick(r, "localidad"),
      pick(r, "estado"),
      pick(r, "urgencia"),
      pick(r, "ministerio_agencia_id"),
      pick(r, "categoria_general_id"),
      pick(r, "detalle"),
      pick(r, "costo_estimado"),
      pick(r, "costo_moneda"),
      pick(r, "nro_expediente"),
    ].map(x => String(x ?? "").toLowerCase()).join(" | ");
    return hay.includes(q);
  });

  renderGrid(filtered);
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
    { key: "detalle", label: "Detalle" },
    { key: "costo_estimado", label: "Costo" },
    { key: "fecha_ingreso", label: "Ingreso" },
    { key: "dias_transcurridos", label: "Días" },
  ];

  const thead = document.createElement("thead");
  const trh = document.createElement("tr");
  cols.forEach((c) => {
    const th = document.createElement("th");
    th.textContent = c.label;
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

      if (c.key === "ministerio_agencia_id") {
        const id = pick(r, "ministerio_agencia_id");
        td.textContent = id ? (minMap.get(id) || id) : "";
      } else if (c.key === "categoria_general_id") {
        const id = pick(r, "categoria_general_id");
        td.textContent = id ? (catMap.get(id) || id) : "";
      } else if (c.key === "detalle") {
        const txt = String(pick(r, "detalle") ?? "");
        td.innerHTML = `<div class="cell-wrap" title="${escapeHtml(txt)}">${escapeHtml(txt)}</div>`;
      } else if (c.key === "costo_estimado") {
        const v = pick(r, "costo_estimado");
        const m = pick(r, "costo_moneda");
        td.textContent = (v === null || v === undefined || v === "") ? "" : `${v}${m ? " " + m : ""}`;
      } else {
        td.textContent = pick(r, c.key) ?? "";
      }

      tr.appendChild(td);
    });

    const tdA = document.createElement("td");
    tdA.className = "actions";
    const canDelete = isAdmin() || isSupervisor();

    const id = pick(r, "id_gestion") ?? "";
    tdA.innerHTML = `
      <div class="actions-wrap">
        <button class="btn" type="button" onclick="openDetalle('${escapeHtml(id)}')">Ver</button>
        <button class="btn" type="button" onclick="openChangeState('${escapeHtml(id)}')">Modificar Estado</button>
        <button class="btn" type="button" onclick="openEventos('${escapeHtml(id)}')">Eventos</button>
        ${canDelete ? `<button class="btn btn-danger" type="button" onclick="deleteGestion('${escapeHtml(id)}')">Eliminar</button>` : ``}
      </div>
    `;
    tr.appendChild(tdA);

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
}

// ============================
// Drawer
// ============================
function kvRow(k, v) {
  return `
    <div class="kv-row">
      <div class="kv-k">${escapeHtml(k)}</div>
      <div class="kv-v">${escapeHtml(v ?? "")}</div>
    </div>
  `;
}

async function openDetalle(id) {
  if (!id) return;

  try {
    const [g, ev] = await Promise.all([
      api(`/gestiones/${encodeURIComponent(id)}`),
      api(`/gestiones/${encodeURIComponent(id)}/eventos`).catch(() => []),
    ]);

    document.getElementById("drawerTitle").textContent = `Gestión ${id}`;
    document.getElementById("drawerSub").textContent =
      [pick(g, "departamento"), pick(g, "localidad"), pick(g, "estado")].filter(Boolean).join(" · ");

    const minMap = new Map((CATALOGOS.ministerios || []).map((m) => [m.id, m.nombre]));
    const catMap = new Map((CATALOGOS.categorias || []).map((c) => [c.id, c.nombre]));

    const ministerioId = pick(g, "ministerio_agencia_id");
    const categoriaId = pick(g, "categoria_general_id");
    const ministerioNombre = ministerioId ? (minMap.get(ministerioId) || ministerioId) : "";
    const categoriaNombre = categoriaId ? (catMap.get(categoriaId) || categoriaId) : "";

    const costo = pick(g, "costo_estimado");
    const moneda = pick(g, "costo_moneda");

    const summary = [
      ["Estado", pick(g, "estado")],
      ["Urgencia", pick(g, "urgencia")],
      ["Ministerio/Agencia", ministerioNombre],
      ["Categoría", categoriaNombre],
      ["Detalle", pick(g, "detalle")],
      ["Subtipo detalle", pick(g, "subtipo_detalle")],
      ["Costo", (costo != null && costo !== "" ? `${costo}${moneda ? " " + moneda : ""}` : "")],
      ["Nro expediente", pick(g, "nro_expediente")],
      ["Organismo", pick(g, "organismo_id")],
      ["Departamento", pick(g, "departamento")],
      ["Localidad", pick(g, "localidad")],
      ["Dirección", pick(g, "direccion")],
      ["Ingreso", fmtDateLike(pick(g, "fecha_ingreso"))],
      ["Última actualización", fmtDateLike(pick(g, "updated_at"))],
    ];

    document.getElementById("drawerSummary").innerHTML =
      summary.filter(([_, v]) => v !== null && v !== undefined && String(v).trim() !== "")
        .map(([k, v]) => kvRow(k, String(v)))
        .join("");

    const arr = Array.isArray(ev) ? ev : [];
    arr.sort((a, b) => {
      const ta = new Date(pick(a, "fecha_evento", "ts_evento") || 0).getTime();
      const tb = new Date(pick(b, "fecha_evento", "ts_evento") || 0).getTime();
      return (tb || 0) - (ta || 0);
    });

    const timeline = arr.map((e) => {
      const tipo = pick(e, "tipo_evento", "tipo_evento") || "";
      const when = fmtDateLike(pick(e, "fecha_evento", "ts_evento") || "");
      const actor = pick(e, "usuario", "actor_email") || "";
      const rol = pick(e, "rol_usuario") || "";
      const estA = pick(e, "estado_anterior") || "";
      const estN = pick(e, "estado_nuevo") || "";
      const comentario = pick(e, "comentario") || "";

      let extra = "";
      const meta = pick(e, "metadata_json", "payload_json");
      if (meta) {
        try {
          const obj = (typeof meta === "string") ? JSON.parse(meta) : meta;
          const deriv = obj?.derivado_a || obj?.derivado_a_id;
          const acc = obj?.acciones_implementadas;
          const lines = [];
          if (deriv) lines.push(`Derivado a: ${deriv}`);
          if (acc) lines.push(`Acciones: ${acc}`);
          if (lines.length) extra = "\n" + lines.join("\n");
        } catch {}
      }

      const bodyLines = [];
      if (actor || rol) bodyLines.push(`Actor: ${actor}${rol ? " (" + rol + ")" : ""}`);
      if (estA || estN) bodyLines.push(`Estado: ${estA || "—"} → ${estN || "—"}`);
      if (comentario) bodyLines.push(`Comentario: ${comentario}`);
      const body = bodyLines.join("\n") + (extra || "");

      return `
        <div class="tl-item">
          <div class="tl-head">
            <div class="tl-type">${escapeHtml(tipo)}</div>
            <div class="tl-date">${escapeHtml(when)}</div>
          </div>
          <div class="tl-body">${escapeHtml(body)}</div>
        </div>
      `;
    }).join("");

    document.getElementById("drawerEventos").innerHTML = timeline || `<div class="hint">Sin movimientos.</div>`;
    openDrawer();
  } catch (e) {
    alert("No se pudo abrir el detalle.\n\nDetalle: " + (e?.message || String(e)));
  }
}

// ============================
// Eventos (modal raw JSON)
/// ============================
async function openEventos(id) {
  const ev = await api(`/gestiones/${encodeURIComponent(id)}/eventos`);
  document.getElementById("ev_title").textContent = `Eventos · ${id}`;
  document.getElementById("ev_body").textContent = JSON.stringify(ev, null, 2);
  openModal("modalEventos");
}

// ============================
// Delete
// ============================
async function deleteGestion(id) {
  if (!id) return;
  const ok = confirm(`¿Seguro que querés eliminar (borrado lógico) la gestión?\n\nID: ${id}`);
  if (!ok) return;

  try {
    await api(`/gestiones/${encodeURIComponent(id)}`, { method: "DELETE" });
    alert("Gestión eliminada correctamente.");
    await loadGestiones(true);
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

  const d = document.getElementById("cs_derivado_a");
  const a = document.getElementById("cs_acciones_implementadas");
  if (d) d.value = "";
  if (a) a.value = "";

  openModal("modalChangeState");
}

async function submitChangeState() {
  const id = document.getElementById("cs_id_gestion").value;
  const nuevo = document.getElementById("cs_nuevo_estado").value;
  const comentario = document.getElementById("cs_comentario").value || null;
  const derivado_a = document.getElementById("cs_derivado_a")?.value || null;
  const acciones_implementadas = document.getElementById("cs_acciones_implementadas")?.value || null;

  if (!id) return alert("Falta id_gestion");
  if (!nuevo) return alert("Seleccioná un estado");

  await api(`/gestiones/${encodeURIComponent(id)}/cambiar-estado`, {
    method: "POST",
    body: { nuevo_estado: nuevo, comentario, derivado_a, acciones_implementadas },
  });

  closeModal("modalChangeState");
  await loadGestiones(false);
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

  document.getElementById("ng_organismo_id").value = "";
  document.getElementById("ng_subtipo_detalle").value = "";
  document.getElementById("ng_costo_estimado").value = "";
  document.getElementById("ng_costo_moneda").value = "ARS";
  document.getElementById("ng_nro_expediente").value = "";

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

  const organismo_id = document.getElementById("ng_organismo_id").value || null;
  const subtipo_detalle = document.getElementById("ng_subtipo_detalle").value || null;

  const costo_estimado_raw = document.getElementById("ng_costo_estimado").value;
  const costo_estimado = (costo_estimado_raw === "" || costo_estimado_raw == null) ? null : Number(costo_estimado_raw);

  const costo_moneda = document.getElementById("ng_costo_moneda").value || "ARS";
  const nro_expediente = document.getElementById("ng_nro_expediente").value || null;

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

    organismo_id,
    subtipo_detalle,
    costo_estimado,
    costo_moneda,
    nro_expediente,
  };

  const resp = await api(`/gestiones`, { method: "POST", body: payload });

  closeModal("modalNewGestion");
  await loadGestiones(true);

  if (resp?.id_gestion) alert(`Gestión creada: ${resp.id_gestion}`);
}

// ============================
// Usuarios (placeholder por ahora)
// ============================
async function loadUsers() { if (!isAdmin()) return; }
function upsertUser() { alert("Usuarios: lo conectamos cuando definamos endpoints definitivos."); }
function clearUserForm() {
  document.getElementById("u_email").value = "";
  document.getElementById("u_nombre").value = "";
  document.getElementById("u_rol").value = "";
  document.getElementById("u_activo").checked = true;
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

  const t = readToken();
  if (t) {
    try {
      saveToken(t);
      setAuthedUI(true);
      document.getElementById("userBox").innerText = "Restaurando sesión...";
      await validateAuthOrThrow();
      await bootData();
    } catch (e) {
      console.warn("No se pudo restaurar sesión:", e);
      logout();
    }
  }
});

// ============================
// Exponer globales
// ============================
window.loadGestiones = loadGestiones;
window.openNew = openNew;
window.closeModal = closeModal;
window.submitNewGestion = submitNewGestion;
window.openChangeState = openChangeState;
window.submitChangeState = submitChangeState;
window.openEventos = openEventos;
window.deleteGestion = deleteGestion;

window.setTab = setTab;

window.openDetalle = openDetalle;
window.closeDrawer = closeDrawer;

window.upsertUser = upsertUser;
window.clearUserForm = clearUserForm;
window.loadUsers = loadUsers;
