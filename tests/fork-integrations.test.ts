import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import { streamSimple as streamOpenAiCompletions } from "@earendil-works/pi-ai/api/openai-completions";
import { rewriteDevProxyUrl } from "../src/auth/dev-rewrites.ts";
import { DEV_SERVER_PORT } from "../scripts/generate-dev-manifest.mjs";

const read = (rel: string): string =>
  readFileSync(path.resolve(process.cwd(), rel), "utf8");

void test("dev rewrite routes DeepSeek API calls through Vite proxy", () => {
  assert.equal(
    rewriteDevProxyUrl("https://api.deepseek.com/chat/completions"),
    "/api-proxy/deepseek/chat/completions",
  );
});

void test("runtime proxy decision includes DeepSeek provider", () => {
  const streamProxySource = read("src/auth/stream-proxy.ts");

  assert.match(streamProxySource, /case "deepseek":\s*return true;/);
  assert.match(streamProxySource, /function applyDevProxy/);
  assert.match(streamProxySource, /rewriteDevProxyUrl\(`\$\{baseUrl\}\/`\)/);
  assert.match(streamProxySource, /function normalizeDeepSeekPayload/);
  assert.match(streamProxySource, /role:\s*"system"/);
});

void test("a gateway model's headers reach the wire request", async () => {
  const model: Model<Api> = {
    id: "gpt-5.6-luna",
    name: "Luna",
    api: "openai-completions",
    provider: "Gateway · opencode-go",
    baseUrl: "https://opencode.example/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 16_384,
    maxTokens: 4_096,
    headers: { "x-opencode-session": "sess-1" },
  };
  let sent: Headers | undefined;

  const events = streamOpenAiCompletions(
    model,
    { messages: [] },
    {
      apiKey: "test-key",
      fetch: (_url, init) => {
        sent = new Headers(init?.headers);
        return Promise.resolve(new Response("test endpoint", { status: 400 }));
      },
    },
  );
  await events.result();

  assert.equal(sent?.get("x-opencode-session"), "sess-1");
});

void test("python bridge forces UTF-8 so Chinese output survives on Windows", () => {
  assert.match(
    read("scripts/python-bridge-server.mjs"),
    /args: \["-I", "-X", "utf8", "-c", PYTHON_WRAPPER_CODE\]/,
  );
});

void test("fork dev port contract is 3000 across the manifest and local servers", () => {
  assert.equal(DEV_SERVER_PORT, 3000);
  assert.match(
    read("manifest.xml"),
    /https:\/\/localhost:3000\/src\/taskpane\.html/,
  );
  for (const file of [
    "scripts/cors-proxy-server.mjs",
    "scripts/python-bridge-server.mjs",
    "scripts/tmux-bridge-server.mjs",
  ]) {
    assert.match(read(file), /"https:\/\/localhost:3000"/, file);
  }
});
