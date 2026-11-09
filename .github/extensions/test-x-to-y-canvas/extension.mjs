import { CanvasError, createCanvas, joinSession } from "@github/copilot-sdk/extension";
import { createPlanStore, PlanError, saveSchema } from "./model.mjs";
import { startServer } from "./server.mjs";

const store = createPlanStore(process.cwd());
const servers = new Map();

async function action(operation) {
  try { return await operation(); } catch (error) {
    throw new CanvasError(error instanceof PlanError ? error.code : "plan_io_error", error.message);
  }
}

await joinSession({
  canvases: [createCanvas({
    id: "test-x-to-y-canvas",
    displayName: "Test X-to-Y canvas",
    description: "Display and edit a repository URL, X-to-Y migration plan, and migration tasks.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    actions: [
      {
        name: "get_plan",
        description: "Read the workspace migration plan and its revision before editing.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        handler: () => action(() => store.load()),
      },
      {
        name: "save_plan",
        description: "Save the full migration plan using the revision from get_plan; all open panels refresh.",
        inputSchema: saveSchema,
        handler: (ctx) => action(() => store.save(ctx.input)),
      },
    ],
    open: (ctx) => action(async () => {
      await store.load();
      let entry = servers.get(ctx.instanceId);
      if (!entry) {
        entry = startServer(store);
        servers.set(ctx.instanceId, entry);
      }
      try {
        return { title: "Test X-to-Y canvas", url: (await entry).url };
      } catch (error) {
        servers.delete(ctx.instanceId);
        throw error;
      }
    }),
    onClose: async (ctx) => {
      const entry = servers.get(ctx.instanceId);
      servers.delete(ctx.instanceId);
      if (entry) await (await entry).close();
    },
  })],
});
