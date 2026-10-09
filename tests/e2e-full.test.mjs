// Tier-3 e2e: full loop through a LIVE pi session.
// POST /bridge/reply streams raw PCM (audio/L16;rate=24000) as pi speaks each
// sentence — assert the audio contract only, never wording (LLM output is
// non-deterministic). Opt-in: E2E_FULL=1 (costs a pi turn: tokens + seconds).
import { test } from "node:test";
import assert from "node:assert/strict";
import { BRIDGE_PORT, backendUp, startServer } from "./e2e/helpers.mjs";

test("e2e full loop: /bridge/reply streams PCM from live pi turn", async t => {
  if (process.env.E2E_FULL !== "1") { t.skip("opt-in tier: run with E2E_FULL=1"); return; }
  if (!(await backendUp(`http://127.0.0.1:${BRIDGE_PORT}/bridge/health`))) { t.skip("bridge not running"); return; }

  const srv = await startServer();
  t.after(() => srv.kill());

  const res = await fetch(`${srv.base}/bridge/reply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "Say exactly: beep." }),
    signal: AbortSignal.timeout(180000),   // pi turns are highly variable (6s..2min+ observed)
  });
  if (res.status === 409) { await res.text(); t.skip("pi session busy (409)"); return; }
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /audio\/L16/);

  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.ok(bytes.byteLength >= 24000, `expected >=0.5s of PCM, got ${bytes.byteLength} bytes`);
  assert.equal(bytes.byteLength % 2, 0, "PCM16 must be whole samples");
});
