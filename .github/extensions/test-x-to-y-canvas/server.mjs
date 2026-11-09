import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { PlanError } from "./model.mjs";

const assets = new Map([
  ["", ["canvas.html", "text/html; charset=utf-8"]],
  ["canvas.js", ["canvas.js", "text/javascript; charset=utf-8"]],
  ["canvas.css", ["canvas.css", "text/css; charset=utf-8"]],
]);

export async function startServer(store) {
  const prefix = `/${randomBytes(24).toString("hex")}/`;
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'");
    const json = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(data));
    };
    try {
      if (req.headers.host !== new URL(url).host || !req.url?.startsWith(prefix)) {
        json(404, { error: "Not found." });
        return;
      }
      const route = req.url.slice(prefix.length);
      if (req.method === "GET" && assets.has(route)) {
        const [file, type] = assets.get(route);
        const content = await readFile(new URL(file, import.meta.url));
        res.writeHead(200, { "Content-Type": type });
        res.end(content);
      } else if (req.method === "GET" && route === "state") {
        json(200, await store.load());
      } else if (req.method === "POST" && route === "state") {
        if (req.headers.origin !== new URL(url).origin
          || req.headers["content-type"]?.split(";")[0] !== "application/json") {
          json(403, { error: "Only same-origin JSON saves are accepted." });
          return;
        }
        const chunks = [];
        let length = 0;
        for await (const chunk of req) {
          length += chunk.length;
          if (length > 1048576) {
            json(413, { error: "Plan exceeds the 1 MB request limit." });
            return;
          }
          chunks.push(chunk);
        }
        let input;
        try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch {
          json(400, { error: "Request must contain valid JSON." });
          return;
        }
        json(200, await store.save(input));
      } else {
        json(404, { error: "Not found." });
      }
    } catch (error) {
      json(error instanceof PlanError ? (error.code === "plan_conflict" ? 409 : 400) : 500,
        { error: error.message });
    }
  });
  let url;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  url = `http://127.0.0.1:${server.address().port}${prefix}`;
  return {
    url,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeIdleConnections();
    }),
  };
}
