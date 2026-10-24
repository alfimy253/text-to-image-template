import worker from "../src/index";

const pngSignature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function mockLlmResponse(input: Record<string, unknown>): { response: string } {
	const prompt = String(input?.prompt || "");

	// Stage 1: SEO Keyword, Title & Heading Planner
	if (prompt.includes("SEO strategist") || prompt.includes('"longTail"')) {
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
			"A home video studio setup with a key light for beginners is easy."
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
			if (String(model || "").includes("llama")) {
				return mockLlmResponse(input || {});
			}
			return pngSignature;
		}
	}
} as unknown as Env;

export default {
	fetch(request: Request): Promise<Response> {
		return worker.fetch(request, env);
	}
};
