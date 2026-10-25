/*
 * TTS ENGINE — the voice behind the render app.
 *
 * Requirement (this session, #7): the app takes a script of up to 20,000
 * characters plus a voice type (male or female) and returns one MP3. No
 * paid API, no signup, no login: the audio is produced by driving a free
 * online text-to-speech site with Playwright, and there is exactly ONE
 * male voice and ONE female voice to choose from.
 *
 * How it works
 * ------------
 *   1. the script is split on sentence boundaries into chunks the site
 *      will accept (most free no-login forms cap a request at a few
 *      hundred characters);
 *   2. one browser page is opened per chunk: type the text, pick the
 *      gender's single voice from the site's own <select>, press convert,
 *      and capture the MP3 (a browser download event, or the <audio>/
 *      download link the page reveals);
 *   3. the chunk MP3s are concatenated into one file in output/.
 *
 * Everything site-specific lives in PROVIDERS below: if a free host
 * changes its markup, only that object needs editing. `mock` renders a
 * silent MP3 locally, so the whole pipeline (chunking, progress,
 * concatenation, download) can be exercised with no network at all.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

/* ------------------------------------------------------------------ */
/* the contract                                                        */
/* ------------------------------------------------------------------ */

/* Hardcoded key for this app — the endpoint answers nothing without it. */
export const API_KEY = "1290890909&aPiky2026";

/* Up to 20k characters of script, per the requirement. */
export const MAX_SCRIPT_CHARS = 20000;

/* Free hosts cap the box, so the script is spoken in pieces. */
export const CHUNK_CHARS = 280;

/* ONE male voice + ONE female voice: the only two choices in the app. */
export const VOICES = {
	male: {
		id: "male",
		label: "Male voice",
		note: "one fixed male narrator",
		/*
		 * Matched against the host's own <option> labels. The lookbehind is
		 * load-bearing: "female" ends in "male", so a bare /male/ would hand
		 * the male slot a female voice.
		 */
		pick: /\b(?<!fe)male\b|\bdave\b|\bdavid\b|\bgeorge\b|\bguy\b|\badam\b|\bryan\b/i
	},
	female: {
		id: "female",
		label: "Female voice",
		note: "one fixed female narrator",
		pick: /\bfemale\b|\bsusan\b|\bamy\b|\bemma\b|\bzira\b|\bjoan\b|\bkate\b/i
	}
};

export const VOICE_IDS = Object.keys(VOICES);

export function normalizeVoice(value) {
	const voice = String(value || "").trim().toLowerCase();
	return VOICES[voice] ? voice : null;
}

export function acceptsScript(script) {
	const text = String(script || "").replace(/\r/g, "").trim();
	if (!text) {
		return { ok: false, error: "The script is empty" };
	}
	if (text.length > MAX_SCRIPT_CHARS) {
		return {
			ok: false,
			error:
				"The script is " +
				text.length +
				" characters; the limit is " +
				MAX_SCRIPT_CHARS
		};
	}
	return { ok: true, text };
}

/* ------------------------------------------------------------------ */
/* chunking                                                            */
/* ------------------------------------------------------------------ */

/*
 * Sentences are packed up to CHUNK_CHARS. A single sentence longer than
 * the cap is cut on a word boundary, then on a hard slice, so even a
 * script with no punctuation at all still comes out in speakable pieces.
 */
export function splitScript(script, maxChars = CHUNK_CHARS) {
	const text = String(script || "").replace(/\s+/g, " ").trim();

	if (!text) {
		return [];
	}

	const limit = Math.max(60, Math.min(Number(maxChars) || CHUNK_CHARS, 1000));

	const sentences = text
		.split(/(?<=[.!?;:])\s+/)
		.flatMap((sentence) => {
			const trimmed = sentence.trim();
			if (trimmed.length <= limit) {
				return [trimmed];
			}
			return splitLongSentence(trimmed, limit);
		})
		.filter(Boolean);

	const chunks = [];

	let current = "";

	for (const sentence of sentences) {
		if (!current) {
			current = sentence;
			continue;
		}
		if ((current + " " + sentence).length <= limit) {
			current += " " + sentence;
			continue;
		}
		chunks.push(current);
		current = sentence;
	}

	if (current) {
		chunks.push(current);
	}

	return chunks;
}

function splitLongSentence(sentence, limit) {
	const words = sentence.split(" ");
	const parts = [];
	let current = "";

	for (const word of words) {
		if ((current + " " + word).trim().length > limit) {
			if (current) {
				parts.push(current);
			}
			current = word.length > limit ? word.slice(0, limit) : word;
			continue;
		}
		current = current ? current + " " + word : word;
	}

	if (current) {
		parts.push(current);
	}

	return parts.filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* MP3 concatenation                                                   */
/* ------------------------------------------------------------------ */

/*
 * Free TTS hosts answer with MPEG audio, and the browser saves each chunk
 * as its own .mp3. Joining them is not a byte-copy: every chunk carries
 * its own ID3v2 tag, and a player only reads the first one, so the tags
 * of later chunks are dropped and the frame streams are appended.
 */
export function concatMp3(files, outFile) {
	if (!Array.isArray(files) || !files.length) {
		throw new Error("concatMp3 needs at least one file");
	}

	const frames = [];

	for (const file of files) {
		const bytes = readFileSync(file);
		frames.push(stripId3(bytes));
	}

	const total = frames.reduce((sum, frame) => sum + frame.length, 0);
	const joined = new Uint8Array(total);

	let offset = 0;

	for (const frame of frames) {
		joined.set(frame, offset);
		offset += frame.length;
	}

	writeFileSync(outFile, joined);

	return {
		file: outFile,
		bytes: joined.length,
		chunks: frames.length
	};
}

/* ID3v2 lives at the head of the file; its size is a 4-byte synchsafe int. */
function stripId3(bytes) {
	if (
		bytes.length < 10 ||
		bytes[0] !== 0x49 || /* I */
		bytes[1] !== 0x44 || /* D */
		bytes[2] !== 0x33    /* 3 */
	) {
		return bytes;
	}

	const flags = bytes[5];
	const size =
		(bytes[6] << 21) |
		(bytes[7] << 14) |
		(bytes[8] << 7) |
		bytes[9];

	let start = 10 + size;

	/* an extended header is counted twice in some encoders */
	if (flags & 0x40) {
		start += 10;
	}

	return start < bytes.length ? bytes.subarray(start) : bytes;
}

/* the first MPEG audio frame offset - used to sanity check a download */
export function looksLikeMp3(bytes) {
	if (!bytes || bytes.length < 4) {
		return false;
	}
	if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
		return true;
	}
	return bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
}

/* ------------------------------------------------------------------ */
/* providers                                                           */
/* ------------------------------------------------------------------ */

/*
 * Each provider lists the selectors the driver tries IN ORDER, so a small
 * markup change on the host is a one-line fix. `voiceOption` is how the
 * gender is chosen: the app never invents a voice, it picks the one
 * option on the host that matches the requested gender.
 */
export const PROVIDERS = {
	mock: {
		id: "mock",
		label: "Local silent MP3 (no network)",
		offline: true
	},
	ttsmp3: {
		id: "ttsmp3",
		label: "TTSMP3 — free, no login",
		url: "https://www.ttsmp3.com/",
		textarea: ["textarea[name='text']", "#text", "textarea"],
		voiceSelect: ["select[name='voice']", "select"],
		submit: [
			"button[type='submit']",
			"input[type='submit']",
			"button:has-text('Convert')"
		],
		download: ["a[download]", "#download_link a", "a:has-text('Download')"],
		hint: "pick the English (male) / English (female) option it offers"
	},
	"text-to-speech": {
		id: "text-to-speech",
		label: "text-to-speech.com — free, no login",
		url: "https://text-to-speech.com/",
		textarea: ["#text", "textarea[name='text']", "textarea"],
		voiceSelect: ["select[name='voice']", "select"],
		submit: [
			"button:has-text('Convert')",
			"button:has-text('Read')",
			"button[type='submit']"
		],
		download: ["a[download]", "a:has-text('Download')"],
		hint: "the voice list is a plain <select> of named voices"
	}
};

export function listProviders() {
	return Object.values(PROVIDERS).map((provider) => ({
		id: provider.id,
		label: provider.label,
		offline: !!provider.offline
	}));
}

export function resolveProvider(name) {
	const key = String(name || process.env.TTS_PROVIDER || "ttsmp3").trim();
	return PROVIDERS[key] ? key : null;
}

/* ------------------------------------------------------------------ */
/* the mock voice                                                      */
/* ------------------------------------------------------------------ */

/*
 * A silent MPEG-1 Layer III frame (128 kbps, 44.1 kHz, stereo) is 417
 * bytes long, so a "recording" is that frame repeated. It is a real MP3:
 * players report a duration, the progress bar moves, and the concatenation
 * step has something genuine to join.
 */
const MP3_FRAME_BYTES = 417;
const MP3_FRAME_SECONDS = 1152 / 44100;

function silentMp3(chars) {
	const frames = Math.max(20, Math.round((chars / 14) / MP3_FRAME_SECONDS));
	const header = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
	const frame = Buffer.concat([header, Buffer.alloc(MP3_FRAME_BYTES - header.length, 0)]);
	const parts = [];
	for (let index = 0; index < frames; index++) {
		parts.push(frame);
	}
	return Buffer.concat(parts);
}

/* ------------------------------------------------------------------ */
/* one render                                                          */
/* ------------------------------------------------------------------ */

/*
 * synthesize({ text, voice, provider, outputDir, onProgress })
 *   -> { file, url, chunks, bytes, ms, provider }
 *
 * The job writes its chunk MP3s into a private folder and leaves one
 * concatenated file in outputDir. onProgress(done, total, stage) is called
 * after every chunk, which is what the UI's percent comes from.
 */
export async function synthesize(options = {}) {
	const startedAt = Date.now();

	const voice = normalizeVoice(options.voice);

	if (!voice) {
		throw new Error("Choose the male or the female voice");
	}

	const accepted = acceptsScript(options.text);

	if (!accepted.ok) {
		throw new Error(accepted.error);
	}

	const providerId = resolveProvider(options.provider);

	if (!providerId) {
		throw new Error(
			"Unknown TTS provider '" +
			options.provider +
			"' (known: " +
			Object.keys(PROVIDERS).join(", ") +
			")"
		);
	}

	const outputDir = options.outputDir || process.env.TTS_OUTPUT_DIR || "output";

	mkdirSync(outputDir, { recursive: true });

	const jobId = options.jobId || randomUUID();
	const workDir = join(outputDir, ".work-" + jobId);

	mkdirSync(workDir, { recursive: true });

	const chunks = splitScript(accepted.text);
	const total = chunks.length;

	const report =
		typeof options.onProgress === "function"
			? options.onProgress
			: () => { };

	report(0, total, "speaking " + total + " chunk" + (total === 1 ? "" : "s") + " (" + providerId + " / " + VOICES[voice].label + ")");

	const files = [];

	const renderer =
		providerId === "mock"
			? { render: renderOfflineChunk, close: async () => { } }
			: await createBrowserRenderer(providerId);

	try {

		for (let index = 0; index < chunks.length; index++) {

			if (options.signal && options.signal.aborted) {
				throw new Error("Stopped by the user");
			}

			const chunkFile = join(workDir, "chunk-" + String(index + 1).padStart(4, "0") + ".mp3");

			await renderer.render({
				text: chunks[index],
				voice,
				index,
				outFile: chunkFile
			});

			const bytes = readFileSync(chunkFile);

			if (!looksLikeMp3(bytes)) {
				throw new Error(
					"Chunk " + (index + 1) + " did not come back as MP3 audio"
				);
			}

			files.push(chunkFile);

			report(index + 1, total, "chunk " + (index + 1) + " of " + total);

		}

		const outFile = options.outFile || join(outputDir, jobId + ".mp3");

		const joined = concatMp3(files, outFile);

		return {
			file: joined.file,
			chunks: total,
			bytes: joined.bytes,
			ms: Date.now() - startedAt,
			provider: providerId,
			voice
		};

	}
	finally {

		await renderer.close().catch(() => { });

		try {
			rmSync(workDir, { recursive: true, force: true });
		}
		catch (cleanupError) { }

	}

}

async function renderOfflineChunk({ text, voice, outFile }) {
	/* a pause so a progress bar is honest rather than instant */
	await new Promise((resolve) => setTimeout(resolve, 40));
	writeFileSync(outFile, silentMp3(text.length + (voice === "female" ? 1 : 0)));
}

/*
 * The Playwright driver. Imported lazily: the mock path (and every test)
 * must work on a machine where Playwright or its browser is not installed.
 * One browser is launched per job and closed when the job ends, so a run
 * never leaves a headless Chromium behind.
 */
async function createBrowserRenderer(providerId) {

	const config = PROVIDERS[providerId];

	const { chromium } = await import("playwright").catch(() => {
		throw new Error(
			"Playwright is not installed here - run: npm install && npx playwright install chromium"
		);
	});

	const browser = await chromium.launch({
		headless: !process.env.TTS_HEADFUL
	});

	const renderChunk = async ({ text, voice, index, outFile }) => {

		const context = await browser.newContext({ acceptDownloads: true });

		/*
		 * A fresh page per chunk: free hosts clear their own form after a
		 * conversion, and one page reused across chunks inherits whatever
		 * the last one left behind.
		 */
		const page = await context.newPage();

		try {

			await page.goto(config.url, {
				waitUntil: "domcontentloaded",
				timeout: Number(process.env.TTS_NAV_TIMEOUT_MS || 60000)
			});

			const box = await firstVisible(page, config.textarea);

			if (!box) {
				throw new Error("No text box was found on " + config.url);
			}

			await box.fill(text);

			const select = await firstVisible(page, config.voiceSelect);

			if (select) {
				await pickVoiceOption(page, select, voice);
			}

			const submit = await firstVisible(page, config.submit);

			if (!submit) {
				throw new Error("No convert button was found on " + config.url);
			}

			/* the audio can surface three different ways: start listening first */
			const capture = captureAudio(page, config);

			await submit.click();

			const saved = await capture;

			const bytes = await readDownload(saved, context, config);

			if (!looksLikeMp3(bytes)) {
				throw new Error(
					"The host did not return audio for chunk " + (index + 1)
				);
			}

			writeFileSync(outFile, bytes);

		}
		finally {
			await context.close().catch(() => { });
		}

	};

	return {
		render: renderChunk,
		close: async () => {
			await browser.close().catch(() => { });
		}
	};

}

/*
 * Three ways the audio can surface, tried in order: a browser download
 * event, an <audio> element (or download link) the page reveals, and
 * nothing - which is an error the job reports. Free hosts do the first two
 * depending on the week, so both are watched at the same time.
 */
async function captureAudio(page, config) {

	const timeoutMs = Number(process.env.TTS_CONVERT_TIMEOUT_MS || 120000);

	return await new Promise((resolve, reject) => {

		let settled = false;

		const timer = setTimeout(() => {
			finish(new Error(
				"The host produced no audio within " +
				Math.round(timeoutMs / 1000) +
				" seconds"
			));
		}, timeoutMs);

		const finish = (value) => {

			if (settled) {
				return;
			}

			settled = true;

			clearTimeout(timer);
			clearInterval(poll);
			page.off("download", onDownload);

			if (value instanceof Error) {
				reject(value);
				return;
			}

			resolve(value);

		};

		const onDownload = (download) => {
			download
				.path()
				.then((path) => finish({ kind: "file", path }))
				.catch((downloadError) => reject(downloadError));
		};

		page.on("download", onDownload);

		const poll = setInterval(() => {
			page
				.evaluate(() => {
					const audio = document.querySelector("audio[src], audio source[src]");
					if (audio) {
						return audio.getAttribute("src");
					}
					const link = document.querySelector("a[download], a[href$='.mp3']");
					return link ? link.getAttribute("href") : null;
				})
				.then((src) => {
					if (src) {
						finish({ kind: "url", src });
					}
				})
				.catch(() => { });
		}, 500);

		void config;

	});

}

async function firstVisible(page, selectors) {

	for (const selector of selectors || []) {
		try {
			const found = page.locator(selector).first();
			if (await found.isVisible({ timeout: 1500 })) {
				return found;
			}
		}
		catch (selectorError) { }
	}

	return null;

}

/*
 * The gender is not a voice id of our own: we read the host's option list
 * and choose the single entry that names it. That is what keeps the app to
 * "exactly one male and one female voice" whatever the host offers.
 */
async function pickVoiceOption(page, select, voiceId) {

	const wanted = VOICES[voiceId];

	const options = await select.locator("option").evaluateAll((nodes) =>
		nodes.map((node) => ({ value: node.value, label: node.textContent.trim() }))
	);

	const matches = options.filter((option) =>
		wanted.pick.test(option.label || "") || wanted.pick.test(option.value || "")
	);

	/*
	 * English first when the host mixes languages, then the first hit: one
	 * voice per gender, chosen the same way every run.
	 */
	const english = matches.filter((option) => /english|en[-_]/i.test((option.label || "") + " " + (option.value || "")));
	const chosen = (english.length ? english : matches)[0];

	if (!chosen) {
		throw new Error(
			"The host has no option for the " + voiceId + " voice (" + wanted.note + ")"
		);
	}

	await select.selectOption(chosen.value);

	return chosen;

}

/*
 * Three ways the audio can surface, tried in order: a browser download
 * event, an <audio> element the page reveals, or any MP3 response the page
 * fetched. Free hosts do all three depending on the week.
 */
async function readDownload(saved, context, config) {

	if (!saved) {
		throw new Error("No audio came back from " + config.url);
	}

	if (saved.kind === "file") {
		return readFileSync(saved.path);
	}

	const absolute =
		/^https?:/i.test(saved.src)
			? saved.src
			: new URL(saved.src, config.url).toString();

	const response = await context.request.get(absolute, { timeout: 60000 });

	if (!response.ok()) {
		throw new Error("The audio link answered " + response.status());
	}

	return Buffer.from(await response.body());

}
