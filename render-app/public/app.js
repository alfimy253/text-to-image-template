/*
 * The page's whole job: hand the script to /api/tts, then poll the job and
 * show what the server reports. Nothing is stored in the browser.
 */

const form = document.getElementById("tts-form");
const scriptEl = document.getElementById("script");
const countEl = document.getElementById("count");
const chunksEl = document.getElementById("chunks");
const statusEl = document.getElementById("status");
const fillEl = document.getElementById("fill");
const resultEl = document.getElementById("result");
const playerEl = document.getElementById("player");
const downloadEl = document.getElementById("download");
const metaEl = document.getElementById("meta");
const goBtn = document.getElementById("go");
const stopBtn = document.getElementById("stop");

const MAX_CHARS = 20000;
const CHUNK_CHARS = 280;

/* the same packing rule the server uses, so the counter is honest */
function chunkCount(text) {
	const clean = String(text || "").replace(/\s+/g, " ").trim();
	if (!clean) {
		return 0;
	}
	const sentences = clean.split(/(?<=[.!?;:])\s+/);
	let chunks = 1;
	let current = "";
	for (const sentence of sentences) {
		if (!current) {
			current = sentence;
			continue;
		}
		if ((current + " " + sentence).length <= CHUNK_CHARS) {
			current += " " + sentence;
			continue;
		}
		chunks += 1;
		current = sentence;
	}
	return chunks;
}

function setStatus(message, tone) {
	statusEl.textContent = message;
	statusEl.className = "status" + (tone ? " " + tone : "");
}

function setPercent(value) {
	fillEl.style.width = Math.max(0, Math.min(100, value)) + "%";
}

scriptEl.addEventListener("input", () => {
	const length = scriptEl.value.length;
	countEl.textContent = length.toLocaleString("en-US");
	chunksEl.textContent = String(chunkCount(scriptEl.value));
	countEl.parentElement.classList.toggle("over", length > MAX_CHARS);
});

let jobId = null;
let polling = null;

function busy(on) {
	goBtn.disabled = on;
	stopBtn.hidden = !on;
	scriptEl.readOnly = on;
}

form.addEventListener("submit", async (event) => {

	event.preventDefault();

	const text = scriptEl.value.trim();

	if (!text) {
		setStatus("Nothing to speak — paste a script first.", "error");
		return;
	}

	if (text.length > MAX_CHARS) {
		setStatus("The script is " + text.length.toLocaleString("en-US") + " characters; the limit is 20,000.", "error");
		return;
	}

	const voice = (form.querySelector("input[name='voice']:checked") || {}).value || "male";

	resultEl.hidden = true;
	setPercent(0);
	busy(true);
	setStatus("Asking the voice…");

	try {

		const response = await fetch("/api/tts", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				apiKey: "1290890909&aPiky2026",
				script: text,
				voice: voice
			})
		});

		const data = await response.json().catch(() => ({}));

		if (!response.ok || !data.success) {
			throw new Error(data.error || ("HTTP " + response.status));
		}

		jobId = data.jobId;
		setStatus("Speaking " + data.chunks + " chunk(s) with the " + voice + " voice…");
		poll(data.statusUrl);

	}
	catch (error) {
		busy(false);
		setStatus(error.message || String(error), "error");
	}

});

function poll(statusUrl) {

	clearInterval(polling);

	polling = setInterval(async () => {

		let view;

		try {
			const response = await fetch(statusUrl);
			view = await response.json();
		}
		catch (pollError) {
			return;
		}

		if (!view || !view.success) {
			return;
		}

		setPercent(view.percent);
		setStatus(view.message || view.stage);

		if (view.stage === "done") {
			finish(view);
		}
		else if (view.stage === "error") {
			clearInterval(polling);
			busy(false);
			setStatus(view.error || "The render failed.", "error");
		}

	}, 600);

}

function finish(view) {

	clearInterval(polling);
	busy(false);
	setPercent(100);

	const seconds = Math.max(1, Math.round((view.ms || 0) / 1000));

	setStatus(
		"Done — " +
		view.done +
		" chunk(s) spoken in " +
		seconds +
		"s",
		"ok"
	);

	playerEl.src = view.url;
	downloadEl.href = view.url;
	metaEl.textContent =
		(view.bytes / 1024).toFixed(0) + " KB · " + view.provider + " · " + view.voice + " voice";
	resultEl.hidden = false;

}

stopBtn.addEventListener("click", async () => {

	if (!jobId) {
		return;
	}

	try {
		await fetch("/api/job/" + jobId, { method: "POST" });
	}
	catch (stopError) { }

	clearInterval(polling);
	busy(false);
	setStatus("Stopped.", "error");

});
