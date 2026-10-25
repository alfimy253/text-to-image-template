/*
 * RENDER APP — a small local server around the TTS engine.
 *
 * The app is deliberately self-contained: node:http, no framework, no
 * database. It exists to answer two routes for the studio:
 *
 *   POST /api/tts        { apiKey, script, voice }  -> { jobId }
 *   GET  /api/job/<id>                               -> progress + url
 *
 * plus the static page in public/. The API key is hardcoded (the app is a
 * private render helper, not a public service), the script is capped at
 * 20,000 characters, and the voice is one of exactly two: male or female.
 *
 * Run:  npm start            (http://localhost:8787)
 *       TTS_PROVIDER=mock npm start   (no network, silent MP3 - for wiring)
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import {
	API_KEY,
	MAX_SCRIPT_CHARS,
	VOICES,
	VOICE_IDS,
	acceptsScript,
	listProviders,
	normalizeVoice,
	resolveProvider,
	splitScript,
	synthesize
} from "./lib/tts-engine.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));

const PUBLIC_DIR = resolve(HERE, "public");

/* read at call time, so a test (or a second instance) can point elsewhere */
function outputDir() {
	return resolve(HERE, process.env.TTS_OUTPUT_DIR || "output");
}

const MIME = {
	".html": "text/html; charset=UTF-8",
	".js": "text/javascript; charset=UTF-8",
	".css": "text/css; charset=UTF-8",
	".mp3": "audio/mpeg",
	".json": "application/json; charset=UTF-8",
	".svg": "image/svg+xml",
	".png": "image/png"
};

/*
 * Jobs live in memory only. A render helper is a short-lived process: a
 * restart losing its job list is acceptable, and keeping no state on disk
 * means nothing to clean up.
 */
const jobs = new Map();

const JOB_TTL_MS = 1000 * 60 * 60;

function send(res, status, body, headers = {}) {
	res.writeHead(status, Object.assign({ "Cache-Control": "no-store" }, headers));
	res.end(body);
}

function sendJson(res, status, data) {
	send(res, status, JSON.stringify(data, null, 2), {
		"Content-Type": "application/json; charset=UTF-8"
	});
}

async function readBody(req, limit = 1024 * 1024) {

	const chunks = [];
	let size = 0;

	for await (const chunk of req) {

		size += chunk.length;

		if (size > limit) {
			throw new Error("Request body is too large");
		}

		chunks.push(chunk);

	}

	return Buffer.concat(chunks).toString("utf8");

}

export function jobView(job) {

	const total = job.total || 1;

	return {
		success: true,
		id: job.id,
		stage: job.stage,
		done: job.done,
		total: total,
		percent: Math.min(100, Math.round((job.done / total) * 100)),
		message: job.message,
		error: job.error || null,
		url: job.url || null,
		bytes: job.bytes || null,
		voice: job.voice,
		provider: job.provider,
		ms: job.finishedAt ? job.finishedAt - job.startedAt : Date.now() - job.startedAt
	};

}

function pruneJobs() {

	const cutoff = Date.now() - JOB_TTL_MS;

	for (const [id, job] of jobs) {
		if (job.finishedAt && job.finishedAt < cutoff) {
			jobs.delete(id);
		}
	}

}

function startJob({ text, voice, provider }) {

	const id = randomUUID();

	const job = {
		id,
		stage: "queued",
		done: 0,
		total: splitScript(text).length,
		message: "Waiting for the voice",
		voice,
		provider,
		startedAt: Date.now(),
		finishedAt: 0,
		error: null,
		url: null,
		bytes: 0,
		file: null,
		controller: new AbortController()
	};

	jobs.set(id, job);

	job.promise = synthesize({
		jobId: id,
		text,
		voice,
		provider,
		outputDir: outputDir(),
		signal: job.controller.signal,
		onProgress(done, total, message) {
			job.done = done;
			job.total = total || job.total;
			job.message = message;
			job.stage = done >= total && total > 0 ? "finishing" : "speaking";
		}
	})
		.then((result) => {

			job.stage = "done";
			job.done = result.chunks;
			job.total = result.chunks;
			job.bytes = result.bytes;
			job.file = result.file;
			job.url = "/media/" + id + ".mp3";
			job.message = "Ready - " + result.chunks + " chunk" + (result.chunks === 1 ? "" : "s");
			job.finishedAt = Date.now();

		})
		.catch((error) => {

			job.stage = "error";
			job.error = (error && error.message) || String(error);
			job.message = job.error;
			job.finishedAt = Date.now();
			console.error("[render-app] job " + id + " failed:", job.error);

		});

	return job;

}

async function serveStatic(pathname, res) {

	const relative =
		pathname === "/"
			? "index.html"
			: pathname.replace(/^\/+/, "");

	const file = join(PUBLIC_DIR, relative);

	/* never leave the folder: a resolved path must still start with it */
	if (!file.startsWith(PUBLIC_DIR)) {
		sendJson(res, 403, { success: false, error: "Forbidden" });
		return;
	}

	try {

		const body = await readFile(file);

		send(res, 200, body, {
			"Content-Type": MIME[extname(file)] || "application/octet-stream"
		});

	}
	catch (readError) {
		sendJson(res, 404, { success: false, error: "Not found" });
	}

}

async function serveMedia(id, res) {

	const job = jobs.get(id);

	if (!job || !job.file) {
		sendJson(res, 404, { success: false, error: "That MP3 is not ready" });
		return;
	}

	try {

		const info = await stat(job.file);
		const body = await readFile(job.file);

		send(res, 200, body, {
			"Content-Type": "audio/mpeg",
			"Content-Length": info.size,
			"Content-Disposition": 'attachment; filename="script-' + job.voice + '.mp3"'
		});

	}
	catch (readError) {
		sendJson(res, 404, { success: false, error: "The MP3 is gone" });
	}

}

export function createApp() {

	return createServer(async (req, res) => {

		pruneJobs();

		const url = new URL(req.url || "/", "http://localhost");
		const pathname = url.pathname;

		if (req.method === "GET" && pathname === "/api/health") {

			sendJson(res, 200, {
				success: true,
				maxScriptChars: MAX_SCRIPT_CHARS,
				voices: VOICE_IDS.map((id) => ({ id, label: VOICES[id].label })),
				providers: listProviders(),
				provider: resolveProvider() || "mock"
			});

			return;

		}

		if (req.method === "POST" && pathname === "/api/tts") {

			let payload;

			try {
				payload = JSON.parse((await readBody(req)) || "{}");
			}
			catch (parseError) {
				sendJson(res, 400, { success: false, error: "Send a JSON body" });
				return;
			}

			/*
			 * The key is hardcoded on purpose: this helper is allowed to run
			 * next to the studio, but it must never become an open TTS relay.
			 */
			if (String(payload.apiKey || "") !== API_KEY) {
				sendJson(res, 401, { success: false, error: "Wrong API key" });
				return;
			}

			const accepted = acceptsScript(payload.script);

			if (!accepted.ok) {
				sendJson(res, 400, { success: false, error: accepted.error });
				return;
			}

			const voice = normalizeVoice(payload.voice);

			if (!voice) {
				sendJson(res, 400, {
					success: false,
					error: "voice must be one of: " + VOICE_IDS.join(", ")
				});
				return;
			}

			const provider = resolveProvider(payload.provider);

			if (!provider) {
				sendJson(res, 400, {
					success: false,
					error: "provider must be one of: " + listProviders().map((item) => item.id).join(", ")
				});
				return;
			}

			const job = startJob({
				text: accepted.text,
				voice,
				provider
			});

			sendJson(res, 202, {
				success: true,
				jobId: job.id,
				chunks: job.total,
				voice,
				provider,
				statusUrl: "/api/job/" + job.id
			});

			return;

		}

		const jobMatch = pathname.match(/^\/api\/job\/([A-Za-z0-9-]+)$/);

		if (req.method === "GET" && jobMatch) {

			const job = jobs.get(jobMatch[1]);

			if (!job) {
				sendJson(res, 404, { success: false, error: "No such job" });
				return;
			}

			sendJson(res, 200, jobView(job));
			return;

		}

		if (req.method === "POST" && jobMatch) {

			const job = jobs.get(jobMatch[1]);

			if (!job) {
				sendJson(res, 404, { success: false, error: "No such job" });
				return;
			}

			job.controller.abort();
			sendJson(res, 200, { success: true, stopped: true });
			return;

		}

		const mediaMatch = pathname.match(/^\/media\/([A-Za-z0-9-]+)\.mp3$/);

		if (req.method === "GET" && mediaMatch) {
			await serveMedia(mediaMatch[1], res);
			return;
		}

		if (req.method === "GET") {
			await serveStatic(pathname, res);
			return;
		}

		sendJson(res, 405, { success: false, error: "Method not allowed" });

	});

}

const isDirect =
	process.argv[1] &&
	resolve(process.argv[1]) === resolve(HERE, "server.mjs");

if (isDirect) {

	const port = Number(process.env.PORT || 8787);

	const server = createApp();

	server.listen(port, "0.0.0.0", () => {

		console.log("[render-app] TTS render app on http://0.0.0.0:" + port);
		console.log("[render-app] provider: " + (resolveProvider() || "mock"));
		console.log("[render-app] voices:   " + VOICE_IDS.join(", "));
		console.log("[render-app] limit:    " + MAX_SCRIPT_CHARS + " characters");

	});

}
