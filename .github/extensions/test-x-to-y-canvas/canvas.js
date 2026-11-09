const $ = (id) => document.getElementById(id);
const statuses = [
  ["pending", "Pending"], ["in_progress", "In progress"], ["done", "Done"], ["blocked", "Blocked"],
];
let revision;
let dirty = false;
let busy = false;
let editVersion = 0;

function message(text, error = false) {
  $("message").textContent = text;
  $("message").dataset.error = String(error);
}

async function request(options) {
  const response = await fetch("state", options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

function updateRepositoryLink() {
  const link = $("repoLink");
  link.hidden = true;
  link.removeAttribute("href");
  try {
    const url = new URL($("repoUrl").value);
    if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) {
      link.href = url.href;
      link.hidden = false;
    }
  } catch { /* An incomplete URL stays unlinked while the user types. */ }
}

function updateProgress() {
  const rows = [...$("tasks").children];
  const done = rows.filter((row) => row.querySelector("select").value === "done").length;
  $("progress").textContent = `${done} of ${rows.length} tasks done`;
  $("emptyTasks").hidden = rows.length > 0;
  $("addTask").disabled = rows.length >= 200;
}

function markDirty() {
  dirty = true;
  editVersion += 1;
  message("Unsaved changes");
  updateProgress();
  updateRepositoryLink();
}

function addTask(task) {
  const row = document.createElement("li");
  row.dataset.id = task.id;
  const title = document.createElement("input");
  title.value = task.title;
  title.required = true;
  title.maxLength = 1000;
  title.placeholder = "Describe a migration task";
  title.setAttribute("aria-label", "Task title");
  const status = document.createElement("select");
  status.setAttribute("aria-label", "Task status");
  for (const [value, label] of statuses) status.add(new Option(label, value));
  status.value = task.status;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "Remove";
  remove.setAttribute("aria-label", "Remove task");
  remove.addEventListener("click", () => { row.remove(); markDirty(); });
  row.append(title, status, remove);
  $("tasks").append(row);
  return title;
}

function render(data) {
  revision = data.revision;
  for (const key of ["repoUrl", "currentState", "targetState", "plan"]) $(key).value = data[key];
  $("tasks").replaceChildren();
  data.tasks.forEach(addTask);
  dirty = false;
  updateProgress();
  updateRepositoryLink();
  message(revision ? "Saved plan loaded" : "No saved plan yet. Define your migration and save it.");
}

function collect() {
  return {
    revision,
    repoUrl: $("repoUrl").value,
    currentState: $("currentState").value,
    targetState: $("targetState").value,
    plan: $("plan").value,
    tasks: [...$("tasks").children].map((row) => ({
      id: row.dataset.id,
      title: row.querySelector("input").value,
      status: row.querySelector("select").value,
    })),
  };
}

async function reload() {
  if (busy || (dirty && !confirm("Discard unsaved changes and reload the saved plan?"))) return;
  busy = true;
  $("fields").disabled = true;
  try { render(await request()); } catch (error) { message(error.message, true); } finally {
    busy = false;
    $("fields").disabled = revision === undefined;
  }
}

$("editor").addEventListener("input", markDirty);
$("editor").addEventListener("change", markDirty);
$("addTask").addEventListener("click", () => {
  if ($("tasks").children.length >= 200) return;
  addTask({ id: crypto.randomUUID(), title: "", status: "pending" }).focus();
  markDirty();
});
$("reload").addEventListener("click", reload);
$("editor").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;
  busy = true;
  $("fields").disabled = true;
  message("Saving...");
  try {
    render(await request({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(collect()),
    }));
    message("Plan saved");
  } catch (error) { message(error.message, true); } finally {
    busy = false;
    $("fields").disabled = false;
  }
});
window.addEventListener("beforeunload", (event) => {
  if (dirty) { event.preventDefault(); event.returnValue = ""; }
});

await reload();
setInterval(async () => {
  if (dirty || busy || document.hidden) return;
  const version = editVersion;
  try {
    const data = await request();
    if (!dirty && !busy && version === editVersion && data.revision !== revision) {
      render(data);
      $("fields").disabled = false;
    }
  } catch (error) {
    if (!dirty && !busy && version === editVersion) message(error.message, true);
  }
}, 3000);
