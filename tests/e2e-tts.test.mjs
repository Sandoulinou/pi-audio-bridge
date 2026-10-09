// Tier-2 e2e: TTS. Binary WAV round-trip of POST /v1/audio/speech through the
// server proxy — this is the streaming-binary path that requires h2 in
// production, so it proves the proxy carries binary bodies intact.
// Auto-skips when audio.cpp is not running.
import { test } from "node:test";
import assert from "node:assert/strict";
import { wavToPCM } from "../wav.mjs";
import { API_PORT, backendUp, startServer } from "./e2e/helpers.mjs";

test("e2e TTS: /v1/audio/speech through server proxy returns playable WAV", async t => {
  if (!(await backendUp(`http://127.0.0.1:${API_PORT}/health`))) { t.skip("audio.cpp not running"); return; }
  const srv = await startServer();
  t.after(() => srv.kill());

  const r = await fetch(`${srv.base}/v1/audio/speech`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "kokoro-tts", input: "Hello, this is an end to end test.", voice: "af_heart", language: "en-us" }),
    signal: AbortSignal.timeout(60000),
  });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") || "", /wav/);

  const bytes = new Uint8Array(await r.arrayBuffer());
  const { bytes: pcm, rate } = wavToPCM(bytes);
  assert.equal(rate, 24000);
  const minBytes = 24000 * 2;   // 1s of 16-bit mono
  assert.ok(pcm.byteLength >= minBytes, `expected >1s of PCM, got ${pcm.byteLength} bytes`);
});
