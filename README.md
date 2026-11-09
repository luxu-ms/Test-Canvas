# test-x-to-y-canvas

A project-scoped Copilot app plugin with a canvas for a repository URL,
current state (X), target state (Y), migration plan, and migration tasks.

The canvas supports editing, adding and removing tasks, and the statuses
**Pending**, **In progress**, **Done**, and **Blocked**, with a completion count.
It does not clone repositories, generate a migration automatically, or execute tasks.

## Load in the Copilot app

Open this repository in a **new project session** after adding the files.
Copilot discovers `.github/extensions/test-x-to-y-canvas/extension.mjs`.
Ask Copilot to open the **Test X-to-Y canvas**.

The plugin requires a Copilot app/runtime with extension canvas support.
The SDK is supplied by Copilot; no npm install or separate server is needed.
This project uses the supported legacy plugin manifest because its `extensions`
field explicitly registers the same project extension directory for plugin installs.

For local CLI development, `copilot --plugin-dir .` loads the plugin without
installing it globally. The CLI alone does not display a canvas; use the app
for the rendered panel.

## Saved data

**Save plan** writes `migration-plan.json` to the active workspace's working
directory, not the plugin installation directory. The file is created only on
the first save. It contains `repoUrl`, `currentState`, `targetState`, `plan`,
and `tasks` (each task has a unique `id`, `title`, and `status`).
It is a normal project artifact you may commit to share with contributors.

Saved data survives new panels, extension reloads, and app restarts.
Clean panels check for updates every three seconds; unsaved edits are never
replaced automatically. A stale save is rejected; **Reload saved plan**
explicitly discards local edits after confirmation.

Only HTTP(S) repository links without embedded credentials are accepted.
Plan and task text is displayed as plain text. The canvas binds an authenticated,
per-panel server to loopback only; it sends no plan data to external services.

## Agent actions

Canvas ID: `test-x-to-y-canvas`. Open input is optional (or `{}`).
Choose a panel instance ID, such as `migration-board`.

- `get_plan` returns the fields above plus a `revision`.
- `save_plan` accepts all fields plus that exact revision. Read first, modify
  the returned plan, then save. Use `revision: ""` only for an unsaved plan.

The file path is the durable identity; panel instance IDs never own plan data.
Actions and the UI use the same validation and persistence logic.

## Development

Run the dependency-free checks with Node.js 22 or later:

```powershell
node --test tests\canvas.test.mjs
```

The tests cover persistence, validation, conflicting edits, HTTP endpoints,
and renderer assets. App discovery and rendering still require a live app
session with the extension loaded.
