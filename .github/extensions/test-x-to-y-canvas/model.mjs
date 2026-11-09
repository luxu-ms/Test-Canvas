import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export class PlanError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const text = (maxLength) => ({ type: "string", maxLength });
export const fields = {
  repoUrl: text(2048),
  currentState: text(500),
  targetState: text(500),
  plan: text(100000),
  tasks: {
    type: "array",
    maxItems: 200,
    items: {
      type: "object",
      additionalProperties: false,
      required: ["id", "title", "status"],
      properties: {
        id: { type: "string", minLength: 1, maxLength: 100 },
        title: { type: "string", minLength: 1, maxLength: 1000 },
        status: { type: "string", enum: ["pending", "in_progress", "done", "blocked"] },
      },
    },
  },
};

export const saveSchema = {
  type: "object",
  additionalProperties: false,
  required: [...Object.keys(fields), "revision"],
  properties: { ...fields, revision: { type: "string" } },
};

export function validatePlan(value) {
  const invalid = (message) => { throw new PlanError("invalid_plan", message); };
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("A plan must be an object.");
  if (Object.keys(value).some((key) => !Object.hasOwn(fields, key))) invalid("Unknown plan field.");
  for (const [key, schema] of Object.entries(fields)) {
    if (key !== "tasks" && (typeof value[key] !== "string" || value[key].length > schema.maxLength)) {
      invalid(`${key} must be text of at most ${schema.maxLength} characters.`);
    }
  }
  if (value.repoUrl) {
    let url;
    try { url = new URL(value.repoUrl); } catch { invalid("Repository URL must be an absolute HTTP(S) URL."); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      invalid("Repository URL must use HTTP(S) without embedded credentials.");
    }
  }
  if (!Array.isArray(value.tasks) || value.tasks.length > fields.tasks.maxItems) invalid("Use at most 200 tasks.");
  const ids = new Set();
  for (const task of value.tasks) {
    if (!task || typeof task !== "object" || Array.isArray(task)
      || Object.keys(task).some((key) => !["id", "title", "status"].includes(key))
      || typeof task.id !== "string" || !task.id.trim() || task.id.length > 100 || ids.has(task.id)
      || typeof task.title !== "string" || !task.title.trim() || task.title.length > 1000
      || !fields.tasks.items.properties.status.enum.includes(task.status)) {
      invalid("Each task needs a unique ID, a nonblank title, and a valid status.");
    }
    ids.add(task.id);
  }
  return value;
}

const revisionOf = (content) => createHash("sha256").update(content).digest("hex");

export function createPlanStore(workspace) {
  const file = join(workspace, "migration-plan.json");
  let pending = Promise.resolve();

  async function load() {
    let content;
    try {
      content = await readFile(file, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return {
        repoUrl: "", currentState: "", targetState: "", plan: "", tasks: [], revision: "",
      };
    }
    let data;
    try { data = JSON.parse(content); } catch {
      throw new PlanError("invalid_plan_file", "migration-plan.json contains invalid JSON; fix it before saving.");
    }
    return { ...validatePlan(data), revision: revisionOf(content) };
  }

  function save(input) {
    const operation = pending.then(async () => {
      if (!input || typeof input.revision !== "string") {
        throw new PlanError("invalid_plan", "A revision from get_plan is required.");
      }
      const { revision, ...data } = input;
      validatePlan(data);
      if ((await load()).revision !== revision) {
        throw new PlanError("plan_conflict", "The saved plan has changed. Reload it before saving again.");
      }
      const content = `${JSON.stringify(data, null, 2)}\n`;
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, content, { flag: "wx" });
        await rename(temporary, file);
      } finally {
        await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
      }
      return { ...data, revision: revisionOf(content) };
    });
    pending = operation.then(() => undefined, () => undefined);
    return operation;
  }

  return { load, save };
}
