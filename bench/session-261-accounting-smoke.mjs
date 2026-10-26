/**
 * Run only against `npm run e2e:accounting`.
 *
 * This fixture uses real workerd + KV with deterministic AI. It proves the
 * binary/chunk routes and the EXISTING server KV counters work. KV is not
 * distributed-atomic, so it does NOT prove an exact global quota: concurrent
 * requests may over- or under-count. The per-device localStorage/cookie record
 * is display-only and is intentionally not part of this server check.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
const base = process.env.STUDIO_TEST_URL || "http://127.0.0.1:8787";
const probe = await fetch(base + "/api/pipeline-capabilities");
assert.equal(probe.headers.get("X-Studio-Test-Fixture"), "accounting-261", "Refusing to submit images to a non-fixture endpoint");
const caps = await probe.json();
assert.equal(caps.binaryImages, true); assert.equal(caps.chunkVoiceover, true);
const ip = "2001:db8:" + randomBytes(2).toString("hex") + ":" + randomBytes(2).toString("hex") + "::261";
const headers = { Cookie: "yvs_free=1", "CF-Connecting-IP": ip, "Content-Type": "application/json" };
const images = await Promise.all(Array.from({ length: 12 }, (_, i) => fetch(base + "/api/image", {
	method: "POST", headers, body: JSON.stringify({ prompt: "Mock accounting image " + i })
})));
const ok = images.filter((r) => r.status === 200), denied = images.filter((r) => r.status === 429);
assert.ok(ok.length >= 1, "at least one guest image should be served");
assert.equal(ok.length + denied.length, images.length, "every response is either an image or a quota rejection");
assert.ok(images.every((r) => r.status === 200 || r.status === 429), "no unexpected statuses");
for (const response of ok) {
	assert.match(response.headers.get("Content-Type") || "", /^image\//);
	assert.ok((await response.arrayBuffer()).byteLength > 8);
}
await Promise.all(denied.map((r) => r.arrayBuffer()));
const credits = await (await fetch(base + "/api/credits", { headers })).json();
assert.ok(credits.remaining.images >= 0);
assert.ok(credits.used.images <= 12);
const voice = await fetch(base + "/api/voiceover", {
	method: "POST", headers, body: JSON.stringify({ text: "Mock narration chunk.", lang: "en", chunk: true })
});
assert.equal(voice.status, 200); assert.equal(voice.headers.get("Content-Type"), "audio/wav");
assert.ok((await voice.arrayBuffer()).byteLength > 44);
console.log("#261 workerd smoke passed: " + ok.length + "/12 concurrent images served, " + denied.length +
	" quota rejections, KV summary used=" + credits.used.images + ", binary WAV chunk.");
if (ok.length > 10) console.log("NOTE: KV over-granted the guest allowance under concurrency (no atomic accounting by design).");
