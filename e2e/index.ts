import worker from "../src/index";

/* A valid 1x1 PNG image (70 bytes) that decodes properly in all browsers. */
const validPng = new Uint8Array([
	137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13,
	73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1,
	8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0,
	13, 73, 68, 65, 84, 120, 218, 99, 100, 248, 207, 80,
	15, 0, 3, 134, 1, 128, 90, 52, 125, 107, 0, 0,
	0, 0, 73, 69, 78, 68, 174, 66, 96, 130
]);

/* A valid 1-second silent WAV audio file for MeloTTS mock */
function mockAudioResponse(): Uint8Array {
	const sampleRate = 44100;
	const durationSec = 1;
	const numChannels = 1;
	const bytesPerSample = 2;
	const totalSamples = Math.floor(sampleRate * durationSec);
	const dataSize = totalSamples * numChannels * bytesPerSample;
	const buffer = new ArrayBuffer(44 + dataSize);
	const view = new DataView(buffer);
	view.setUint32(0, 0x52494646, false); // "RIFF"
	view.setUint32(4, 36 + dataSize, true);
	view.setUint32(8, 0x57415645, false); // "WAVE"
	view.setUint32(12, 0x666d7420, false); // "fmt "
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, numChannels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
	view.setUint16(32, numChannels * bytesPerSample, true);
	view.setUint16(34, 16, true);
	view.setUint32(36, 0x64617461, false); // "data"
	view.setUint32(40, dataSize, true);
	return new Uint8Array(buffer);
}

function mockLlmResponse(input: Record<string, unknown>): { response: string } {
	const prompt = String(input?.prompt || "");

	// Image-prompt jobs: exactly N prompts in the requested style.
	if (prompt.includes("AI IMAGE PROMPTS")) {
		const count = Number((prompt.match(/exactly (\d+) image prompts/) || [])[1] || 10);
		const style = (prompt.match(/video image style: ([^.]+)\./) || [])[1] || "cinematic";
		return {
			response: JSON.stringify({
				prompts: Array.from({ length: count }, (_, i) => `Scene ${i + 1} of the explainer video, ${style}`)
			})
		};
	}

	// Stage 1: SEO Keyword, Title & Heading Planner. The two-set SEO plan
	// asks for a DIFFERENT second set, answered with the alternate fixture
	// (same shorts so the Stage-2 fixture script still validates, but a
	// different long-tail keyword and title).
	if (prompt.includes("SEO strategist") || prompt.includes('"longTail"')) {
		if (prompt.includes("DIFFERENT keyword set")) {
			return {
				response: JSON.stringify({
					title: "Key Light Setup Guide for Beginners",
					headings: [
						"Choosing Your Key Light Position",
						"Dialing In Color Balance Fast"
					],
					longTail: "budget home video studio setup with a key light for beginners",
					short: [
						"key light",
						"soft shadow",
						"color balance",
						"clean backdrop"
					]
				})
			};
		}
		return {
			response: JSON.stringify({
				title: "Smart Key Light Setup Guide for Creators",
				headings: [
					"Choosing Your Key Light Position",
					"Dialing In Color Balance Fast"
				],
				longTail: "home video studio setup with a key light for beginners",
				short: [
					"key light",
					"soft shadow",
					"color balance",
					"clean backdrop"
				]
			})
		};
	}

	// Stage 2: Explainer SRT Writer (satisfies validateSrt + the minimum frequency
	// rule: long-tail keyword at least once, every short keyword at least twice)
	const cues = [
		[
			"00:00:00,000 --> 00:00:04,000",
			"A home video studio setup with a key light for beginners is easy, and a budget home video studio setup with a key light for beginners works too."
		],
		[
			"00:00:04,000 --> 00:00:08,000",
			"Place the lamp slightly above eye level first."
		],
		[
			"00:00:08,000 --> 00:00:12,000",
			"Angle the lamp forty five degrees for depth."
		],
		[
			"00:00:12,000 --> 00:00:16,000",
			"Add diffusion to create a flattering soft shadow on skin."
		],
		[
			"00:00:16,000 --> 00:00:20,000",
			"A gentle soft shadow keeps every frame looking natural."
		],
		[
			"00:00:20,000 --> 00:00:24,000",
			"Next lock in your camera color balance before recording."
		],
		[
			"00:00:24,000 --> 00:00:28,000",
			"Consistent color balance saves hours in editing in 2026."
		],
		[
			"00:00:28,000 --> 00:00:32,000",
			"Keep a clean backdrop behind your chair to hold focus."
		],
		[
			"00:00:32,000 --> 00:00:36,000",
			"Even a simple wall makes a clean backdrop on camera."
		],
		[
			"00:00:36,000 --> 00:00:40,000",
			"Your home video studio setup with a key light for beginners is ready."
		]
	];

	const srt = cues
		.map((c, idx) => `${idx + 1}\n${c[0]}\n${c[1]}`)
		.join("\n\n");

	return { response: srt };
}

const env = {
	AI: {
		run: async (model: string, input: Record<string, unknown>) => {
			const m = String(model || "");
			if (m.includes("llama")) {
				return mockLlmResponse(input || {});
			}
			if (m.includes("melotts") || m.includes("tts")) {
				return mockAudioResponse();
			}
			return validPng;
		}
	}
} as unknown as Env;

export default {
	fetch(request: Request): Promise<Response> {
		return worker.fetch(request, env);
	}
};
