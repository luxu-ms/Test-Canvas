import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPlanStore, validatePlan } from "../.github/extensions/test-x-to-y-canvas/model.mjs";
import { startServer } from "../.github/extensions/test-x-to-y-canvas/server.mjs";

const sample = () => ({
  repoUrl: "https://github.com/example/repository",
  currentState: "JavaScript",
  targetState: "TypeScript",
  plan: "Migrate incrementally, then verify behavior.",
  tasks: [{ id: "task-1", title: "Enable type checking", status: "pending" }],
});

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "test-x-to-y-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, store: createPlanStore(directory) };
}

test("plugin points to the project-discovered extension", async () => {
  const manifest = JSON.parse(await readFile(new URL("../plugin.json", import.meta.url), "utf8"));
  assert.equal(manifest.name, "test-x-to-y-canvas");
  assert.deepEqual(manifest.extensions, [".github/extensions"]);
  const entry = await readFile(new URL("../.github/extensions/test-x-to-y-canvas/extension.mjs", import.meta.url), "utf8");
  assert.match(entry, /joinSession\(/);
  assert.match(entry, /id: "test-x-to-y-canvas"/);
  assert.doesNotMatch(entry, /console\.log/);
});

test("saved plans persist across stores and use file content as revision", async (t) => {
  const { directory, store } = await fixture(t);
  assert.equal((await store.load()).revision, "");
  assert.deepEqual(await readdir(directory), []);
  const saved = await store.save({ ...sample(), revision: "" });
  assert.ok(saved.revision);
  assert.deepEqual(await createPlanStore(directory).load(), saved);
  assert.deepEqual(JSON.parse(await readFile(join(directory, "migration-plan.json"), "utf8")), sample());
  const updated = await store.save({ ...saved, tasks: [{ ...saved.tasks[0], status: "done" }] });
  assert.notEqual(updated.revision, saved.revision);
  assert.deepEqual(await readdir(directory), ["migration-plan.json"]);
});

test("stale and concurrent saves do not overwrite newer edits", async (t) => {
  const { directory, store } = await fixture(t);
  const saved = await store.save({ ...sample(), revision: "" });
  const results = await Promise.allSettled([
    store.save({ ...saved, plan: "First edit" }),
    store.save({ ...saved, plan: "Stale edit" }),
  ]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].reason.code, "plan_conflict");
  const disk = JSON.parse(await readFile(join(directory, "migration-plan.json"), "utf8"));
  await writeFile(join(directory, "migration-plan.json"), JSON.stringify({ ...disk, plan: "External edit" }));
  await assert.rejects(store.save({ ...results[0].value, plan: "Overwrite" }), { code: "plan_conflict" });
  assert.equal((await store.load()).plan, "External edit");
});

test("invalid saved data is reported, not overwritten", async (t) => {
  const { directory, store } = await fixture(t);
  const file = join(directory, "migration-plan.json");
  await writeFile(file, "{broken");
  await assert.rejects(store.load(), { code: "invalid_plan_file" });
  await assert.rejects(store.save({ ...sample(), revision: "" }), { code: "invalid_plan_file" });
  assert.equal(await readFile(file, "utf8"), "{broken");
});

test("validates links, text limits, task IDs and task statuses", () => {
  assert.deepEqual(validatePlan(sample()), sample());
  assert.doesNotThrow(() => validatePlan({ ...sample(), repoUrl: "", tasks: [] }));
  for (const override of [
    { repoUrl: "javascript:alert(1)" }, { repoUrl: "https://user:secret@example.com" },
    { repoUrl: "not a URL" }, { plan: "x".repeat(100001) }, { currentState: 42 },
    { tasks: [{ id: "x", title: " ", status: "pending" }] },
    { tasks: [{ id: "x", title: "Title", status: "unknown" }] },
    { tasks: [sample().tasks[0], sample().tasks[0]] },
    { tasks: Array.from({ length: 201 }, (_, id) => ({ id: String(id), title: "Task", status: "pending" })) },
    { unexpected: true },
  ]) {
    assert.throws(() => validatePlan({ ...sample(), ...override }), { code: "invalid_plan" });
  }
});

test("HTTP serves assets and saves with validation, authentication and conflicts", async (t) => {
  const { store } = await fixture(t);
  const panel = await startServer(store);
  t.after(() => panel.close());
  const origin = new URL(panel.url).origin;
  const read = await fetch(`${panel.url}state`);
  assert.equal(read.status, 200);
  assert.equal((await read.json()).revision, "");
  for (const [path, contentType] of [["", "text/html"], ["canvas.js", "text/javascript"], ["canvas.css", "text/css"]]) {
    const response = await fetch(`${panel.url}${path}`);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get("content-type").startsWith(contentType));
    assert.match(response.headers.get("content-security-policy"), /script-src 'self'/);
  }
  assert.equal((await fetch(`${origin}/state`)).status, 404);
  const save = (data, requestOrigin = origin) => fetch(`${panel.url}state`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: requestOrigin },
    body: JSON.stringify(data),
  });
  assert.equal((await save({ ...sample(), revision: "" }, "https://untrusted.example")).status, 403);
  assert.equal((await save({ ...sample(), revision: "", repoUrl: "file:///secret" })).status, 400);
  const response = await save({ ...sample(), revision: "" });
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.repoUrl, sample().repoUrl);
  assert.equal((await save({ ...sample(), revision: "" })).status, 409);
  const otherPanel = await startServer(store);
  t.after(() => otherPanel.close());
  assert.deepEqual(await (await fetch(`${otherPanel.url}state`)).json(), saved);
});
