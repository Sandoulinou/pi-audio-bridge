// Shared helpers for the tier-2/3 e2e tests (tests/e2e-*.test.mjs).
// E2E runs the REAL backends — audio.cpp (:8090) and bridge.mjs (:8092) — through
// a freshly spawned server.mjs proxy on an ephemeral port, so the proxy is under
// test in every tier, never bypassed.
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

// tests/e2e/helpers.mjs -> project root is three levels up
export const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

export const API_PORT = Number(process.env.API_PORT || 8090);
export const BRIDGE_PORT = Number(process.env.BRIDGE_PORT || 8092);

/** True if `url` answers 2xx within `ms`. Used to decide skip vs fail. */
export async function backendUp(url, ms = 2000) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(ms) })).ok; }
  catch { return false; }
}

export function freePort() {
  return new Promise(res => {
    const s = http.createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = s.address().port;
      s.close(() => res(port));
    });
  });
}

/** Spawn server.mjs (real API/bridge ports) on an ephemeral loopback port. */
export async function startServer(extraEnv = {}) {
  const port = await freePort();
  const proc = spawn(process.execPath, [path.join(ROOT, "server.mjs")], {
    env: { ...process.env, PORT: String(port), ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stderr.on("data", d => process.env.E2E_DEBUG && console.error(`[e2e server] ${d}`));
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("server spawn timeout")), 5000);
    proc.stdout.on("data", d => {
      if (String(d).includes("on http://")) { clearTimeout(t); resolve(); }
    });
    proc.on("exit", c => reject(new Error(`server exited early: ${c}`)));
  });
  return {
    base: `http://127.0.0.1:${port}`,
    kill: () => { try { proc.kill("SIGKILL"); } catch {} },
  };
}
