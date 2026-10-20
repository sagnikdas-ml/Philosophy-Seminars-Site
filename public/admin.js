const API = "/api/admin";
const DEFAULT_VENUE = "Department Liberal Arts and Social Sciences, Ulmenstraße 52i, Meetingroom 32";
const DEFAULT_MEETING_URL = "https://utn-de.zoom.us/j/63489126627?pwd=yDamnnbZTu0lfNauqurO3OEalHIKO1.1";
const DEFAULT_START_TIME = "17:00";
const DEFAULT_END_TIME = "19:00";
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
  researcherForm: document.getElementById("researcher-form"),
  researcherList: document.getElementById("admin-researchers"),
  researcherStatus: document.getElementById("researchers-status"),
  researcherEditorStatus: document.getElementById("researcher-editor-status"),
  researcherId: document.getElementById("researcher-id"),
  researcherFingerprint: document.getElementById("researcher-fingerprint"),
  researcherEditorTitle: document.getElementById("researcher-editor-title"),
  saveResearcher: document.getElementById("save-researcher-button"),
  newResearcher: document.getElementById("new-researcher-button"),
  refreshResearchers: document.getElementById("refresh-researchers-button"),
  cancelResearcher: document.getElementById("cancel-researcher-button"),
  editorPanel: document.getElementById("editor-panel"),
  eventsPanel: document.getElementById("events-panel"),
  back: document.getElementById("editor-back-button"),
  logout: document.getElementById("logout-button"),
  form: document.getElementById("event-form"),
  editorTitle: document.getElementById("editor-title"),
  editorStatus: document.getElementById("editor-status"),
  save: document.getElementById("save-button"),
  saveTop: document.getElementById("save-top-button"),
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
let researchers = [];
let pendingDelete = null;
let pendingDeleteResearcher = null;

elements.loginForm.addEventListener("submit", login);
elements.logout.addEventListener("click", logout);
elements.form.addEventListener("submit", saveEvent);
elements.cancelEdit.addEventListener("click", () => showEventList(true));
elements.back.addEventListener("click", () => showEventList(true));
elements.newEvent.addEventListener("click", beginAdd);
elements.refresh.addEventListener("click", loadEvents);
elements.deleteCancel.addEventListener("click", () => {
  elements.deleteDialog.close();
  pendingDelete = null;
  pendingDeleteResearcher = null;
  restoreDeleteDialog();
});
elements.deleteConfirm.addEventListener("click", () => pendingDeleteResearcher ? deleteResearcher() : deleteEvent());
elements.eventList.addEventListener("click", handleListClick);
elements.researcherForm.addEventListener("submit", saveResearcher);
elements.researcherList.addEventListener("click", handleResearcherClick);
elements.newResearcher.addEventListener("click", beginAddResearcher);
elements.refreshResearchers.addEventListener("click", loadResearchers);
elements.cancelResearcher.addEventListener("click", resetResearcherForm);

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
  researchers = [];
  resetEditor();
  showLogin();
  setBusy(elements.logout, false);
}

async function showDashboard() {
  elements.loginView.classList.add("hidden");
  elements.dashboard.classList.remove("hidden");
  elements.logout.classList.remove("hidden");
  showEventList();
  await loadEvents();
  await loadResearchers();
}

function showEventList(scroll = false) {
  resetEditor();
  elements.editorPanel.classList.add("hidden");
  elements.eventsPanel.classList.remove("hidden");
  if (scroll) {
    elements.eventsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    elements.newEvent.focus({ preventScroll: true });
  }
}

function showEditor() {
  elements.eventsPanel.classList.add("hidden");
  elements.editorPanel.classList.remove("hidden");
  elements.editorPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  document.getElementById("title").focus({ preventScroll: true });
}

function beginAdd() {
  resetEditor();
  showEditor();
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
    return true;
  } catch (error) {
    if (error.status === 401) { showLogin(); return; }
    setStatus(elements.listStatus, error.message, "error");
  } finally {
    setBusy(elements.refresh, false);
  }
}

async function loadResearchers() {
  setBusy(elements.refreshResearchers, true);
  setStatus(elements.researcherStatus, "Loading researchers…");
  try {
    const result = await api(`${API}/researchers`);
    researchers = result.researchers || [];
    renderResearchers();
    setStatus(elements.researcherStatus, researchers.length ? `${researchers.length} researcher${researchers.length === 1 ? "" : "s"}` : "No researchers yet.");
    return true;
  } catch (error) {
    if (error.status === 401) { showLogin(); return false; }
    setStatus(elements.researcherStatus, error.message, "error");
    return false;
  } finally {
    setBusy(elements.refreshResearchers, false);
  }
}

function renderResearchers() {
  elements.researcherList.replaceChildren();
  for (const item of researchers) {
    const card = document.createElement("article");
    card.className = "admin-event";
    const top = document.createElement("div");
    top.className = "admin-event-top";
    const copy = document.createElement("div");
    const name = document.createElement("h3");
    name.textContent = [item.title, item.full_name].filter(Boolean).join(" ");
    const link = document.createElement("a");
    link.href = item.portfolio_link;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = item.portfolio_link;
    copy.append(name, link);
    const actions = document.createElement("div");
    actions.className = "admin-event-actions";
    actions.append(researcherActionButton("Edit", "edit", item), researcherActionButton("Remove", "remove", item, "button-danger"));
    top.append(copy, actions);
    card.append(top);
    elements.researcherList.append(card);
  }
}

function researcherActionButton(label, action, item, extraClass = "button-secondary") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `button ${extraClass}`;
  button.textContent = label;
  button.dataset.researcherAction = action;
  button.dataset.id = item.id;
  return button;
}

function handleResearcherClick(event) {
  const button = event.target.closest("button[data-researcher-action]");
  if (!button) return;
  const item = researchers.find((candidate) => candidate.id === button.dataset.id);
  if (!item) return;
  if (button.dataset.researcherAction === "edit") editResearcher(item);
  if (button.dataset.researcherAction === "remove") confirmDeleteResearcher(item);
}

function beginAddResearcher() {
  elements.researcherForm.reset();
  elements.researcherId.value = "";
  elements.researcherFingerprint.value = "";
  elements.researcherEditorTitle.textContent = "Add researcher";
  elements.saveResearcher.textContent = "Add researcher";
  elements.researcherForm.classList.remove("hidden");
  setStatus(elements.researcherEditorStatus, "");
  document.getElementById("researcher-full-name").focus();
}

function editResearcher(item) {
  elements.researcherForm.elements.namedItem("title").value = item.title || "";
  elements.researcherForm.elements.namedItem("full_name").value = item.full_name || "";
  elements.researcherForm.elements.namedItem("portfolio_link").value = item.portfolio_link || "";
  elements.researcherId.value = item.id;
  elements.researcherFingerprint.value = item._fingerprint;
  elements.researcherEditorTitle.textContent = "Edit researcher";
  elements.saveResearcher.textContent = "Save changes";
  elements.researcherForm.classList.remove("hidden");
  setStatus(elements.researcherEditorStatus, `Editing ${item.full_name}`);
  document.getElementById("researcher-full-name").focus();
}

function resetResearcherForm() {
  elements.researcherForm.reset();
  elements.researcherId.value = "";
  elements.researcherFingerprint.value = "";
  elements.researcherForm.classList.add("hidden");
  setStatus(elements.researcherEditorStatus, "");
}

async function saveResearcher(event) {
  event.preventDefault();
  const isEditing = Boolean(elements.researcherId.value);
  const researcher = Object.fromEntries(["title", "full_name", "portfolio_link"].map((field) => [field, String(elements.researcherForm.elements.namedItem(field).value || "").trim()]));
  const body = { researcher };
  if (isEditing) {
    body.id = elements.researcherId.value;
    body.fingerprint = elements.researcherFingerprint.value;
  }
  setBusy(elements.saveResearcher, true);
  setStatus(elements.researcherEditorStatus, isEditing ? "Saving changes…" : "Adding researcher…");
  try {
    await api(`${API}/researchers`, { method: isEditing ? "PUT" : "POST", body });
    resetResearcherForm();
    if (await loadResearchers()) setStatus(elements.researcherStatus, isEditing ? "Researcher updated." : "Researcher added.", "success");
  } catch (error) {
    if (error.status === 401) { showLogin(); return; }
    setStatus(elements.researcherEditorStatus, error.message, "error");
  } finally {
    setBusy(elements.saveResearcher, false);
  }
}

function confirmDeleteResearcher(item) {
  pendingDeleteResearcher = item;
  pendingDelete = null;
  elements.deleteDialog.querySelector("h2").textContent = "Remove this researcher?";
  elements.deleteCopy.textContent = `${item.full_name} will be removed from the public site.`;
  elements.deleteCancel.textContent = "Keep researcher";
  elements.deleteConfirm.textContent = "Remove researcher";
  elements.deleteDialog.showModal();
  elements.deleteConfirm.focus();
}

async function deleteResearcher() {
  const item = pendingDeleteResearcher;
  if (!item) return;
  setBusy(elements.deleteConfirm, true);
  try {
    await api(`${API}/researchers`, { method: "DELETE", body: { id: item.id, fingerprint: item._fingerprint } });
    elements.deleteDialog.close();
    pendingDeleteResearcher = null;
    restoreDeleteDialog();
    if (await loadResearchers()) setStatus(elements.researcherStatus, "Researcher removed.", "success");
  } catch (error) {
    if (error.status === 401) { elements.deleteDialog.close(); showLogin(); return; }
    elements.deleteCopy.textContent = error.message;
  } finally {
    setBusy(elements.deleteConfirm, false);
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
  elements.saveTop.textContent = "Save changes";
  setStatus(elements.editorStatus, `Editing “${item.title}”`);
  showEditor();
}

function resetEditor() {
  elements.form.reset();
  document.getElementById("timezone").value = "Europe/Berlin";
  document.getElementById("venue").value = DEFAULT_VENUE;
  document.getElementById("link").value = DEFAULT_MEETING_URL;
  document.getElementById("time").value = DEFAULT_START_TIME;
  document.getElementById("end_time").value = DEFAULT_END_TIME;
  document.getElementById("published").value = "yes";
  elements.row.value = "";
  elements.fingerprint.value = "";
  elements.editorTitle.textContent = "Add seminar";
  elements.save.textContent = "Add seminar";
  elements.saveTop.textContent = "Add seminar";
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
  setBusy(elements.saveTop, true);
  setStatus(elements.editorStatus, isEditing ? "Saving changes…" : "Adding seminar…");
  try {
    await api(`${API}/seminars`, { method: isEditing ? "PUT" : "POST", body });
    showEventList(true);
    if (await loadEvents()) {
      setStatus(elements.listStatus, isEditing ? "Changes saved." : "Seminar added.", "success");
    }
  } catch (error) {
    if (error.status === 401) { showLogin(); return; }
    setStatus(elements.editorStatus, error.message, "error");
  } finally {
    setBusy(elements.save, false);
    setBusy(elements.saveTop, false);
  }
}

function confirmDelete(item) {
  pendingDeleteResearcher = null;
  pendingDelete = item;
  restoreDeleteDialog();
  elements.deleteCopy.textContent = `“${item.title}” by ${item.speaker} will be permanently deleted.`;
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
    restoreDeleteDialog();
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

function restoreDeleteDialog() {
  elements.deleteDialog.querySelector("h2").textContent = "Delete this seminar?";
  elements.deleteCancel.textContent = "Keep seminar";
  elements.deleteConfirm.textContent = "Delete seminar";
  elements.deleteCopy.textContent = "This permanently deletes the seminar.";
}

async function api(url, options = {}) {
  const init = { method: options.method || "GET", credentials: "same-origin", headers: { accept: "application/json" } };
  if (options.body !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  let response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new Error("We could not connect. Check your internet connection and try again.");
  }
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(result?.error || "Something went wrong. Please try again.");
    error.status = response.status;
    throw error;
  }
  if (!result || typeof result !== "object") throw new Error("Something went wrong. Please try again.");
  return result;
}

function setBusy(button, busy) { button.disabled = busy; button.setAttribute("aria-busy", String(busy)); }
function setStatus(target, message, kind = "") { target.textContent = message; target.dataset.kind = kind; }
function formatDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}
