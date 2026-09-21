const API = "/api/admin";
const EVENT_FIELDS = [
  "date", "speaker", "title", "link", "speaker_detail", "speaker_portfolio",
  "time", "end_time", "timezone", "venue", "abstract", "published",
];

const elements = {
  loginView: document.getElementById("login-view"),
  loginForm: document.getElementById("login-form"),
  loginStatus: document.getElementById("login-status"),
  password: document.getElementById("password"),
  dashboard: document.getElementById("dashboard"),
  logout: document.getElementById("logout-button"),
  form: document.getElementById("event-form"),
  editorTitle: document.getElementById("editor-title"),
  editorStatus: document.getElementById("editor-status"),
  save: document.getElementById("save-button"),
  cancelEdit: document.getElementById("cancel-edit-button"),
  newEvent: document.getElementById("new-event-button"),
  refresh: document.getElementById("refresh-button"),
  listStatus: document.getElementById("list-status"),
  eventList: document.getElementById("admin-events"),
  row: document.getElementById("record-row"),
  fingerprint: document.getElementById("record-fingerprint"),
  deleteDialog: document.getElementById("delete-dialog"),
  deleteCopy: document.getElementById("delete-copy"),
  deleteCancel: document.getElementById("delete-cancel"),
  deleteConfirm: document.getElementById("delete-confirm"),
};

let events = [];
let pendingDelete = null;

elements.loginForm.addEventListener("submit", login);
elements.logout.addEventListener("click", logout);
elements.form.addEventListener("submit", saveEvent);
elements.cancelEdit.addEventListener("click", resetEditor);
elements.newEvent.addEventListener("click", resetEditor);
elements.refresh.addEventListener("click", loadEvents);
elements.deleteCancel.addEventListener("click", () => elements.deleteDialog.close());
elements.deleteConfirm.addEventListener("click", deleteEvent);
elements.eventList.addEventListener("click", handleListClick);

checkSession();

async function checkSession() {
  try {
    const result = await api(`${API}/session`);
    if (result.authenticated) await showDashboard();
    else showLogin();
  } catch (error) {
    showLogin();
    setStatus(elements.loginStatus, error.message, "error");
  }
}

async function login(event) {
  event.preventDefault();
  const submit = elements.loginForm.querySelector("button[type='submit']");
  setBusy(submit, true);
  setStatus(elements.loginStatus, "Checking password…");
  try {
    await api(`${API}/login`, { method: "POST", body: { password: elements.password.value } });
    elements.loginForm.reset();
    await showDashboard();
  } catch (error) {
    setStatus(elements.loginStatus, error.message, "error");
    elements.password.focus();
    elements.password.select();
  } finally {
    setBusy(submit, false);
  }
}

async function logout() {
  setBusy(elements.logout, true);
  try { await api(`${API}/logout`, { method: "POST", body: {} }); } catch { /* Clear the local view regardless. */ }
  events = [];
  resetEditor();
  showLogin();
  setBusy(elements.logout, false);
}

async function showDashboard() {
  elements.loginView.classList.add("hidden");
  elements.dashboard.classList.remove("hidden");
  elements.logout.classList.remove("hidden");
  await loadEvents();
}

function showLogin() {
  elements.dashboard.classList.add("hidden");
  elements.logout.classList.add("hidden");
  elements.loginView.classList.remove("hidden");
  requestAnimationFrame(() => elements.password.focus());
}

async function loadEvents() {
  setBusy(elements.refresh, true);
  setStatus(elements.listStatus, "Loading seminars…");
  try {
    const result = await api(`${API}/seminars`);
    events = [...result.events].sort((a, b) => b.date.localeCompare(a.date) || a.speaker.localeCompare(b.speaker));
    renderEvents();
    setStatus(elements.listStatus, events.length ? `${events.length} seminar${events.length === 1 ? "" : "s"}` : "No seminars yet.");
  } catch (error) {
    if (error.status === 401) { showLogin(); return; }
    setStatus(elements.listStatus, error.message, "error");
  } finally {
    setBusy(elements.refresh, false);
  }
}

function renderEvents() {
  elements.eventList.replaceChildren();
  for (const item of events) {
    const card = document.createElement("article");
    card.className = "admin-event";
    const top = document.createElement("div");
    top.className = "admin-event-top";
    const copy = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = item.title;
    const meta = document.createElement("p");
    meta.textContent = [formatDate(item.date), item.time, item.speaker, item.venue].filter(Boolean).join(" · ");
    const badge = document.createElement("span");
    badge.className = `visibility-badge${item.published === "no" ? " draft" : ""}`;
    badge.textContent = item.published === "no" ? "Draft" : "Published";
    copy.append(title, meta, badge);

    const actions = document.createElement("div");
    actions.className = "admin-event-actions";
    actions.append(
      actionButton("Edit", "edit", item),
      actionButton("Delete", "delete", item, "button-danger"),
    );
    top.append(copy, actions);
    card.append(top);
    elements.eventList.append(card);
  }
}

function actionButton(label, action, item, extraClass = "button-secondary") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `button ${extraClass}`;
  button.textContent = label;
  button.dataset.action = action;
  button.dataset.row = item._row;
  return button;
}

function handleListClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const item = events.find((candidate) => String(candidate._row) === button.dataset.row);
  if (!item) return;
  if (button.dataset.action === "edit") beginEdit(item);
  if (button.dataset.action === "delete") confirmDelete(item);
}

function beginEdit(item) {
  for (const field of EVENT_FIELDS) {
    const input = elements.form.elements.namedItem(field);
    if (input) input.value = item[field] || (field === "published" ? "yes" : "");
  }
  elements.row.value = item._row;
  elements.fingerprint.value = item._fingerprint;
  elements.editorTitle.textContent = "Edit seminar";
  elements.save.textContent = "Save changes";
  elements.cancelEdit.classList.remove("hidden");
  elements.newEvent.classList.remove("hidden");
  setStatus(elements.editorStatus, `Editing “${item.title}”`);
  elements.form.scrollIntoView({ behavior: "smooth", block: "start" });
  document.getElementById("title").focus({ preventScroll: true });
}

function resetEditor() {
  elements.form.reset();
  document.getElementById("timezone").value = "Europe/Berlin";
  document.getElementById("published").value = "yes";
  elements.row.value = "";
  elements.fingerprint.value = "";
  elements.editorTitle.textContent = "Add seminar";
  elements.save.textContent = "Add seminar";
  elements.cancelEdit.classList.add("hidden");
  elements.newEvent.classList.add("hidden");
  setStatus(elements.editorStatus, "");
}

async function saveEvent(event) {
  event.preventDefault();
  const isEditing = Boolean(elements.row.value);
  const record = Object.fromEntries(EVENT_FIELDS.map((field) => [field, String(elements.form.elements.namedItem(field)?.value || "").trim()]));
  const body = { event: record };
  if (isEditing) {
    body.row = Number(elements.row.value);
    body.fingerprint = elements.fingerprint.value;
  }

  setBusy(elements.save, true);
  setStatus(elements.editorStatus, isEditing ? "Saving changes…" : "Adding seminar…");
  try {
    await api(`${API}/seminars`, { method: isEditing ? "PUT" : "POST", body });
    resetEditor();
    setStatus(elements.editorStatus, isEditing ? "Changes saved." : "Seminar added.", "success");
    await loadEvents();
  } catch (error) {
    if (error.status === 401) { showLogin(); return; }
    setStatus(elements.editorStatus, error.message, "error");
  } finally {
    setBusy(elements.save, false);
  }
}

function confirmDelete(item) {
  pendingDelete = item;
  elements.deleteCopy.textContent = `“${item.title}” by ${item.speaker} will be permanently removed from the Google Sheet.`;
  elements.deleteDialog.showModal();
  elements.deleteConfirm.focus();
}

async function deleteEvent() {
  if (!pendingDelete) return;
  const item = pendingDelete;
  setBusy(elements.deleteConfirm, true);
  try {
    await api(`${API}/seminars`, {
      method: "DELETE",
      body: { row: item._row, fingerprint: item._fingerprint },
    });
    elements.deleteDialog.close();
    pendingDelete = null;
    if (elements.row.value === String(item._row)) resetEditor();
    await loadEvents();
    setStatus(elements.listStatus, "Seminar deleted.", "success");
  } catch (error) {
    if (error.status === 401) { elements.deleteDialog.close(); showLogin(); return; }
    elements.deleteCopy.textContent = error.message;
  } finally {
    setBusy(elements.deleteConfirm, false);
  }
}

async function api(url, options = {}) {
  const init = { method: options.method || "GET", credentials: "same-origin", headers: { accept: "application/json" } };
  if (options.body !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  const response = await fetch(url, init);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || `Request failed: HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return result;
}

function setBusy(button, busy) { button.disabled = busy; button.setAttribute("aria-busy", String(busy)); }
function setStatus(target, message, kind = "") { target.textContent = message; target.dataset.kind = kind; }
function formatDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}
