/*
 * Account rows + plan labelling contract (worker level):
 *
 *  1. the free plan carries 70,000 AI images per day and the paid plan
 *     1,200, and every credits-aware route reports the same numbers;
 *  2. one row per account: user:<username> holds username, email and the
 *     plan (usertype), and email:<address> mirrors the same email + plan;
 *  3. a legacy row (no email / no usertype, no email index) is healed from
 *     the unique username the first time the settings page reads it;
 *  4. changing a plan keeps user:<username> and email:<address> in step;
 *  5. GET /api/config/users labels every row with the plan detail so the
 *     Accounts table can never show a username without its plan.
 */
import assert from "node:assert/strict";
import test from "node:test";
import workerModule from "../src/index.ts";

/* tsx can hand back a doubly-wrapped default export under --test */
const worker = workerModule.default || workerModule;

const CONFIG_PASSWORD = "#123admin%";
const PW = encodeURIComponent(CONFIG_PASSWORD);

function makeKv(seed = {}) {
	const store = new Map(Object.entries(seed));
	const kv = {
		store,
		ops: 0,
		async get(key) {
			kv.ops += 1;
			return store.has(key) ? store.get(key) : null;
		},
		async put(key, value) {
			kv.ops += 1;
			store.set(key, value);
		},
		async delete(key) {
			kv.ops += 1;
			store.delete(key);
		},
		async list({ prefix = "", limit = 1000 } = {}) {
			kv.ops += 1;
			return {
				keys: [...store.keys()]
					.filter((key) => key.startsWith(prefix))
					.sort()
					.slice(0, limit)
					.map((name) => ({ name })),
				list_complete: true
			};
		}
	};
	return kv;
}

async function call(path, { method = "GET", body = null, kv } = {}) {
	const init = { method };
	if (body) {
		init.body = JSON.stringify(body);
		init.headers = { "Content-Type": "application/json" };
	}
	const response = await worker.fetch(
		new Request("https://studio.test" + path, init),
		{ KV_BINDING: kv },
		{}
	);
	return { status: response.status, body: await response.json() };
}

test("the free plan allows 70,000 AI images per day, paid allows 1,200", async () => {
	const kv = makeKv({
		"user:ana": JSON.stringify({
			username: "ana",
			email: "ana@studio.test",
			usertype: "paid_user",
			createdAt: "2026-01-02T00:00:00Z"
		}),
		"user:ben": JSON.stringify({
			username: "ben",
			email: "ben@studio.test",
			usertype: "free",
			createdAt: "2026-01-03T00:00:00Z"
		}),
		"email:ana@studio.test": JSON.stringify({ username: "ana" }),
		"email:ben@studio.test": JSON.stringify({ username: "ben" })
	});

	const { body } = await call("/api/config/users?pw=" + PW, { kv });
	assert.equal(body.success, true);

	const plans = Object.fromEntries(body.plans.map((plan) => [plan.id, plan]));
	assert.equal(plans.free.limits.images, 70000);
	assert.equal(plans.paid_user.limits.images, 1200);

	const byName = Object.fromEntries(body.users.map((user) => [user.username, user]));
	assert.equal(byName.ben.plan.limits.images, 70000);
	assert.equal(byName.ben.remaining.images, 70000);
	assert.equal(byName.ana.plan.limits.images, 1200);
	assert.equal(byName.ana.remaining.images, 1200);

	/* the listing is labelled: plan label + daily allowance per row */
	assert.equal(byName.ben.planLabel, "Free");
	assert.equal(byName.ben.planImages, 70000);
	assert.equal(byName.ana.planLabel, "Paid");
	assert.equal(byName.ana.planImages, 1200);
});

test("user:<username> and email:<address> describe the same account", async () => {
	const kv = makeKv({
		"user:cy": JSON.stringify({
			username: "cy",
			email: "cy@studio.test",
			usertype: "free",
			salt: "aa",
			hash: "bb",
			createdAt: "2026-02-01T00:00:00Z"
		}),
		/* a pointer written by the older build: username only */
		"email:cy@studio.test": JSON.stringify({ username: "cy" })
	});

	await call("/api/config/users?pw=" + PW, { kv });

	const user = JSON.parse(kv.store.get("user:cy"));
	assert.equal(user.username, "cy");
	assert.equal(user.email, "cy@studio.test");
	assert.equal(user.usertype, "free");

	const index = JSON.parse(kv.store.get("email:cy@studio.test"));
	assert.deepEqual(index, {
		username: "cy",
		email: "cy@studio.test",
		usertype: "free"
	});
});

test("a legacy account row is healed from its unique username", async () => {
	const kv = makeKv({
		/* created before usertype/email were stored on the row */
		"user:legacy": JSON.stringify({ salt: "aa", hash: "bb", createdAt: "2025-01-03T00:00:00Z" }),
		/* the email index is the only place the address exists */
		"email:legacy@studio.test": JSON.stringify({ username: "legacy" })
	});

	const { body } = await call("/api/config/users?pw=" + PW, { kv });
	const row = body.users.find((user) => user.username === "legacy");
	assert.ok(row, "the legacy account is listed");
	assert.equal(row.email, "legacy@studio.test", "the email index fills in the row");
	assert.equal(row.usertype, "free");
	assert.equal(row.planImages, 70000);
	assert.equal(row.planLabel, "Free");

	const healed = JSON.parse(kv.store.get("user:legacy"));
	assert.equal(healed.username, "legacy");
	assert.equal(healed.email, "legacy@studio.test");
	assert.equal(healed.usertype, "free");

	const index = JSON.parse(kv.store.get("email:legacy@studio.test"));
	assert.equal(index.usertype, "free", "the pointer carries the plan too");
});

test("a plan change updates the user row and the email index together", async () => {
	const kv = makeKv({
		"user:dee": JSON.stringify({
			username: "dee",
			email: "dee@studio.test",
			usertype: "free",
			createdAt: "2026-03-01T00:00:00Z"
		}),
		"email:dee@studio.test": JSON.stringify({ username: "dee" })
	});

	const { status, body } = await call("/api/config/users", {
		method: "POST",
		body: { pw: CONFIG_PASSWORD, username: "dee", usertype: "paid_user" },
		kv
	});

	assert.equal(status, 200);
	assert.equal(body.success, true);
	assert.equal(body.email, "dee@studio.test");
	assert.equal(body.plan.limits.images, 1200);

	const user = JSON.parse(kv.store.get("user:dee"));
	assert.equal(user.usertype, "paid_user");
	assert.equal(user.email, "dee@studio.test");

	const index = JSON.parse(kv.store.get("email:dee@studio.test"));
	assert.equal(index.usertype, "paid_user");
	assert.equal(index.email, "dee@studio.test");
	assert.equal(index.username, "dee");
});

test("signup writes the email + plan into both the user row and the index", async () => {
	const kv = makeKv();
	const { status, body } = await call("/api/signup", {
		method: "POST",
		body: {
			username: "Eve",
			email: "Eve@Studio.test",
			password: "secret123"
		},
		kv
	});

	assert.equal(status, 200);
	assert.equal(body.success, true);
	assert.equal(body.user.email, "eve@studio.test");
	assert.equal(body.user.usertype, "free");
	assert.equal(body.plan.limits.images, 70000);

	const user = JSON.parse(kv.store.get("user:eve"));
	assert.equal(user.email, "eve@studio.test");
	assert.equal(user.usertype, "free");

	const index = JSON.parse(kv.store.get("email:eve@studio.test"));
	assert.deepEqual(index, {
		username: "Eve",
		email: "eve@studio.test",
		usertype: "free"
	});
});

test("the accounts page stays inside the KV operation budget", async () => {
	const seed = {};
	for (let i = 0; i < 60; i += 1) {
		const name = "user" + String(i).padStart(2, "0");
		seed["user:" + name] = JSON.stringify({
			username: name,
			email: name + "@studio.test",
			usertype: i % 2 ? "paid_user" : "free",
			createdAt: "2026-04-01T00:00:00Z"
		});
		seed["email:" + name + "@studio.test"] = JSON.stringify({
			username: name,
			email: name + "@studio.test",
			usertype: i % 2 ? "paid_user" : "free"
		});
	}
	const kv = makeKv(seed);
	const { body } = await call("/api/config/users?pw=" + PW, { kv });

	/* 50 accounts are listed, all of them labelled */
	assert.equal(body.shown, 50);
	assert.equal(body.total, 60);
	body.users.forEach((user) => {
		assert.ok(user.email, "every row carries the email from user:<username>");
		assert.ok(user.planLabel, "and the plan label");
	});

	/*
	 * 1 list (users) + 1 list (emails) + up to 50 index reads
	 * + 50 user reads + 50 credits reads, with no repair writes
	 * because every row is already complete.
	 */
	assert.ok(kv.ops <= 160, "operations for one page load: " + kv.ops);
	assert.equal(kv.ops < 160, true);
});
