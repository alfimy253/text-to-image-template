/** Local-only integration fixture: real workerd KV, deterministic AI. */
import worker from "../src/index";
import { mockEnv } from "./index";
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const response = await worker.fetch(request, { ...env, AI: mockEnv.AI }, ctx);
		const headers = new Headers(response.headers);
		headers.set("X-Studio-Test-Fixture", "accounting-261");
		return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
	}
};
