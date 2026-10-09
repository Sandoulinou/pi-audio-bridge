// pi-audio-bridge tests — run with: node --test tests/
// No dependencies: node:test + node:assert, stub upstreams on ephemeral ports.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { wavToPCM, pcmToWav } from "../wav.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/* ---------------------------------------------------------------- wav.mjs */

test("pcmToWav/wavToPCM round-trip (16k)", () => {
  const pcm = new Uint8Array(100 * 2);
  for (let i = 0; i < pcm.length; i++) pcm[i] = (i * 7) & 0xff;
  const { bytes, rate } = wavToPCM(pcmToWav(pcm, 16000));
  assert.equal(rate, 16000);
  assert.deepEqual(bytes, pcm);
});

test("pcmToWav/wavToPCM round-trip (24k)", () => {
  const pcm = new Uint8Array(1234);
  const { bytes, rate } = wavToPCM(pcmToWav(pcm, 24000));
  assert.equal(rate, 24000);
  assert.deepEqual(bytes, pcm);
});

test("wavToPCM tolerates garbage/empty input", () => {
  assert.doesNotThrow(() => wavToPCM(new Uint8Array(0)));
  const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const r = wavToPCM(garbage);   // must not throw; best-effort slice
  assert.ok(r.bytes instanceof Uint8Array);
  assert.ok(r.bytes.byteLength <= garbage.byteLength);
});

/* ------------------------------------------------------------- server.mjs */

function freePort() {
  return new Promise(res => {
    const s = http.createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = s.address().port;
      s.close(() => res(port));
    });
  });
}

function stubServer(name) {
  const s = http.createServer((req, res) => {
    let body = "";
    req.on("data", c => (body += c));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ stub: name, url: req.url, body }));
    });
  });
  return new Promise(res => s.listen(0, "127.0.0.1", () => res({ srv: s, port: s.address().port })));
}

async function startServer(env) {
  const proc = spawn(process.execPath, [path.join(ROOT, "server.mjs")], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stderr.on("data", d => process.env.TEST_DEBUG && console.error(`[server] ${d}`));
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("server spawn timeout")), 5000);
    proc.stdout.on("data", d => { if (String(d).includes("on http://") || String(d).includes("HTTPS/h2 on")) { clearTimeout(t); resolve(); } });
    proc.on("exit", c => reject(new Error(`server exited early: ${c}`)));
  });
  return proc;
}

const toKill = [];
after(() => { toKill.forEach(p => { try { p.kill("SIGKILL"); } catch {} }); });

const get = (url, opts) => fetch(url, { signal: AbortSignal.timeout(5000), ...opts }).then(async r => ({ status: r.status, ct: r.headers.get("content-type"), body: await r.text() }));

test("routing, static, traversal (stub upstreams)", async t => {
  const api = await stubServer("api");
  const bridge = await stubServer("bridge");
  const port = await freePort();
  const proc = await startServer({ PORT: String(port), API_HOST: "127.0.0.1", API_PORT: String(api.port), BRIDGE_PORT: String(bridge.port) });
  toKill.push(proc);
  const base = `http://127.0.0.1:${port}`;
  t.after(() => { api.srv.close(); bridge.srv.close(); });

  const root = await get(base + "/");
  assert.equal(root.status, 200);
  assert.match(root.ct, /text\/html/);
  assert.match(root.body, /<html|<!DOCTYPE/i);

  assert.equal((await get(base + "/nope")).status, 404);

  const health = await get(base + "/health");
  assert.equal(health.status, 200);
  assert.equal(JSON.parse(health.body).stub, "api");

  const post = await get(base + "/v1/audio/transcriptions", { method: "POST", body: "hello-world-body" });
  assert.equal(post.status, 200);
  const postJson = JSON.parse(post.body);
  assert.equal(postJson.stub, "api");
  assert.equal(postJson.url, "/v1/audio/transcriptions");
  assert.equal(postJson.body, "hello-world-body");

  const b = JSON.parse((await get(base + "/bridge/health")).body);
  assert.equal(b.stub, "bridge");

  // traversal must stay inside WEB (use raw socket path, no URL normalization)
  const trav = await new Promise(resolve => {
    const req = http.get({ host: "127.0.0.1", port, path: "/%2e%2e/%2e%2e/etc/passwd" }, res => {
      let b = ""; res.on("data", c => (b += c)); res.on("end", () => resolve({ status: res.statusCode, body: b }));
    });
    req.setTimeout(5000, () => { req.destroy(); resolve({ status: -1, body: "timeout" }); });
  });
  assert.equal(trav.status, 404);
  assert.ok(!trav.body.includes("root:"), "must never leak /etc/passwd");
});

test("502 with readable text when upstreams are down", async () => {
  const dead = await freePort();
  const port = await freePort();
  const proc = await startServer({ PORT: String(port), API_HOST: "127.0.0.1", API_PORT: String(dead), BRIDGE_PORT: String(dead + 1) });
  toKill.push(proc);
  const base = `http://127.0.0.1:${port}`;

  const a = await get(base + "/health");
  assert.equal(a.status, 502);
  assert.match(a.body, /upstream/);

  const b = await get(base + "/bridge/health");
  assert.equal(b.status, 502);
  assert.match(b.body, /bridge/);
});
