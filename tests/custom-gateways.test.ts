import assert from "node:assert/strict";
import { test } from "node:test";

import type { CustomProvider } from "../src/storage/local/custom-providers-store.js";

import {
  DEFAULT_OPENAI_GATEWAY_CONTEXT_WINDOW,
  collectCustomProviderRuntimeInfo,
  deleteOpenAiGatewayConfig,
  formatGatewayHeaders,
  listOpenAiGatewayConfigs,
  parseGatewayHeaderText,
  resolveCustomProviderModel,
  saveOpenAiGatewayConfig,
  type CustomProvidersStoreLike,
} from "../src/auth/custom-gateways.ts";

class MemoryCustomProvidersStore implements CustomProvidersStoreLike {
  private readonly providers = new Map<string, CustomProvider>();

  get(id: string): Promise<CustomProvider | null> {
    return Promise.resolve(this.providers.get(id) ?? null);
  }

  set(provider: CustomProvider): Promise<void> {
    this.providers.set(provider.id, provider);
    return Promise.resolve();
  }

  delete(id: string): Promise<void> {
    this.providers.delete(id);
    return Promise.resolve();
  }

  getAll(): Promise<CustomProvider[]> {
    return Promise.resolve(Array.from(this.providers.values()));
  }
}

void test("saveOpenAiGatewayConfig stores normalized endpoint/model/provider", async () => {
  const store = new MemoryCustomProvidersStore();

  const saved = await saveOpenAiGatewayConfig(store, {
    endpointUrl: "https://gateway.example.com/v1/",
    modelId: "gpt-4o-mini",
    apiKey: " sk-test ",
  });

  assert.equal(saved.displayName, "gateway.example.com");
  assert.equal(saved.endpointUrl, "https://gateway.example.com/v1");
  assert.equal(saved.modelId, "gpt-4o-mini");
  assert.equal(saved.apiKey, "sk-test");
  assert.match(saved.providerName, /^Gateway · gateway\.example\.com/);
  assert.equal(saved.contextWindow, DEFAULT_OPENAI_GATEWAY_CONTEXT_WINDOW);

  const listed = await listOpenAiGatewayConfigs(store);
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.providerName, saved.providerName);
  assert.equal(listed[0]?.contextWindow, DEFAULT_OPENAI_GATEWAY_CONTEXT_WINDOW);
});

void test("saveOpenAiGatewayConfig stores custom context window metadata", async () => {
  const store = new MemoryCustomProvidersStore();

  const saved = await saveOpenAiGatewayConfig(store, {
    displayName: "Big context",
    endpointUrl: "https://gateway.example.com/v1",
    modelId: "big-model",
    contextWindow: 131_072,
  });

  assert.equal(saved.contextWindow, 131_072);

  const listed = await listOpenAiGatewayConfigs(store);
  assert.equal(listed[0]?.contextWindow, 131_072);
});

void test("saveOpenAiGatewayConfig clamps maxTokens to the configured context window", async () => {
  const store = new MemoryCustomProvidersStore();

  const saved = await saveOpenAiGatewayConfig(store, {
    displayName: "Tight budget",
    endpointUrl: "https://gateway.example.com/v1",
    modelId: "small-model",
    contextWindow: 2_048,
  });

  const storedModel = (await store.get(saved.id))?.models?.[0];
  assert.equal(storedModel?.contextWindow, 2_048);
  assert.equal(storedModel?.maxTokens, 2_048);
});

void test("saveOpenAiGatewayConfig rejects invalid context window values", async () => {
  const store = new MemoryCustomProvidersStore();

  await assert.rejects(
    saveOpenAiGatewayConfig(store, {
      endpointUrl: "https://gateway.example.com/v1",
      modelId: "too-small",
      contextWindow: 512,
    }),
    /at least 1024/i,
  );
});

void test("gateway provider names stay unique when display names collide", async () => {
  const store = new MemoryCustomProvidersStore();

  const first = await saveOpenAiGatewayConfig(store, {
    displayName: "ACME",
    endpointUrl: "https://acme.example.com/v1",
    modelId: "model-a",
  });

  const second = await saveOpenAiGatewayConfig(store, {
    displayName: "ACME",
    endpointUrl: "https://acme-2.example.com/v1",
    modelId: "model-b",
  });

  assert.notEqual(first.providerName, second.providerName);
  assert.match(second.providerName, /\(2\)$/);
});

void test("resolveCustomProviderModel refreshes renamed gateway models by base URL and model id", async () => {
  const store = new MemoryCustomProvidersStore();

  const firstSave = await saveOpenAiGatewayConfig(store, {
    displayName: "Warehouse API",
    endpointUrl: "https://warehouse.example.com/v1",
    modelId: "supply-chain",
    contextWindow: 16_384,
  });

  const persistedModel = (await store.get(firstSave.id))?.models?.[0];
  assert.ok(persistedModel);
  if (!persistedModel) {
    throw new Error("Persisted model missing");
  }

  await saveOpenAiGatewayConfig(store, {
    id: firstSave.id,
    displayName: "Warehouse API EU",
    endpointUrl: "https://warehouse.example.com/v1",
    modelId: "supply-chain",
    contextWindow: 262_144,
  });

  const refreshed = resolveCustomProviderModel(
    await store.getAll(),
    persistedModel,
  );
  assert.ok(refreshed);
  assert.equal(refreshed?.contextWindow, 262_144);
  assert.match(refreshed?.provider ?? "", /^Gateway · Warehouse API EU/);
});

void test("resolveCustomProviderModel refuses ambiguous base-url fallback matches", async () => {
  const store = new MemoryCustomProvidersStore();

  await saveOpenAiGatewayConfig(store, {
    displayName: "Warehouse API US",
    endpointUrl: "https://warehouse.example.com/v1",
    modelId: "supply-chain",
  });
  await saveOpenAiGatewayConfig(store, {
    displayName: "Warehouse API EU",
    endpointUrl: "https://warehouse.example.com/v1",
    modelId: "supply-chain",
  });

  const resolved = resolveCustomProviderModel(await store.getAll(), {
    api: "openai-completions",
    id: "supply-chain",
    provider: "Gateway · Warehouse API",
    baseUrl: "https://warehouse.example.com/v1",
  });

  assert.equal(resolved, null);
});

void test("deleteOpenAiGatewayConfig only removes managed gateway entries", async () => {
  const store = new MemoryCustomProvidersStore();

  const saved = await saveOpenAiGatewayConfig(store, {
    displayName: "Delete me",
    endpointUrl: "https://delete.example.com/v1",
    modelId: "model-delete",
  });

  await store.set({
    id: "manual-openai-provider",
    name: "Manual provider",
    type: "openai-completions",
    baseUrl: "https://manual.example.com/v1",
    models: [
      {
        id: "manual-model",
        name: "manual-model",
        api: "openai-completions",
        provider: "manual-provider",
        baseUrl: "https://manual.example.com/v1",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 8192,
        maxTokens: 1024,
      },
    ],
  });

  await deleteOpenAiGatewayConfig(store, saved.id);
  await deleteOpenAiGatewayConfig(store, "manual-openai-provider");

  const all = await store.getAll();
  assert.equal(all.length, 1);
  assert.equal(all[0]?.id, "manual-openai-provider");
});

void test("collectCustomProviderRuntimeInfo includes custom provider names and api keys", async () => {
  const store = new MemoryCustomProvidersStore();

  const gateway = await saveOpenAiGatewayConfig(store, {
    displayName: "Runtime Gateway",
    endpointUrl: "https://runtime.example.com/v1",
    modelId: "runtime-model",
    apiKey: "runtime-key",
  });

  await store.set({
    id: "custom-ollama-1",
    name: "Local Ollama",
    type: "ollama",
    baseUrl: "http://localhost:11434",
  });

  const runtimeInfo = collectCustomProviderRuntimeInfo(await store.getAll());

  assert.ok(runtimeInfo.providerNames.has(gateway.providerName));
  assert.ok(runtimeInfo.providerNames.has("Local Ollama"));
  assert.equal(runtimeInfo.apiKeys.get(gateway.providerName), "runtime-key");
  assert.equal(runtimeInfo.apiKeys.get("Local Ollama"), undefined);
  assert.equal(runtimeInfo.defaultModel?.id, "runtime-model");
});

void test("gateway headers round-trip through save and parse", async () => {
  const store = new MemoryCustomProvidersStore();

  const parsed = parseGatewayHeaderText(
    "x-opencode-session: abc-123\r\n\r\n  X-Custom : spaced  \n",
  );
  assert.deepEqual(parsed, {
    "x-opencode-session": "abc-123",
    "X-Custom": "spaced",
  });

  assert.throws(
    () => parseGatewayHeaderText("no-colon-here"),
    /Invalid header line/,
  );
  assert.deepEqual(parseGatewayHeaderText("  \n "), {});
  assert.equal(formatGatewayHeaders(undefined), "");
  assert.equal(
    formatGatewayHeaders({ "x-opencode-session": "abc-123" }),
    "x-opencode-session: abc-123",
  );

  const saved = await saveOpenAiGatewayConfig(store, {
    displayName: "opencode-go",
    endpointUrl: "https://api.opencode.ai/v1",
    modelId: "grok-code",
    apiKey: "sk-test",
    headers: parsed,
  });
  assert.deepEqual(saved.headers, parsed);

  const listed = await listOpenAiGatewayConfigs(store);
  assert.equal(listed.length, 1);
  assert.deepEqual(listed[0]?.headers, parsed);

  // pi-ai merges Model.headers (not provider.headers) into requests.
  const storedModel = (await store.get(saved.id))?.models?.[0];
  assert.deepEqual(storedModel?.headers, parsed);

  // Saving without headers drops the field instead of merging stale values.
  await saveOpenAiGatewayConfig(store, {
    id: saved.id,
    displayName: "opencode-go",
    endpointUrl: "https://api.opencode.ai/v1",
    modelId: "grok-code",
    apiKey: "sk-test",
  });
  const relisted = await listOpenAiGatewayConfigs(store);
  assert.equal(relisted[0]?.headers, undefined);
});

void test("gateway api type selects the responses protocol end to end", async () => {
  const store = new MemoryCustomProvidersStore();

  const saved = await saveOpenAiGatewayConfig(store, {
    displayName: "opencode-go-luna",
    endpointUrl: "https://opencode.ai/zen/go/v1",
    modelId: "gpt-5.6-luna",
    headers: { "x-opencode-session": "sess-1" },
    api: "openai-responses",
  });
  assert.equal(saved.api, "openai-responses");

  const storedProvider = await store.get(saved.id);
  assert.equal(storedProvider?.type, "openai-responses");
  assert.equal(storedProvider?.models?.[0]?.api, "openai-responses");

  const listed = await listOpenAiGatewayConfigs(store);
  assert.equal(listed[0]?.api, "openai-responses");
  assert.equal(listed[0]?.modelId, "gpt-5.6-luna");

  // Default stays chat completions for existing configs.
  const legacy = await saveOpenAiGatewayConfig(store, {
    displayName: "legacy",
    endpointUrl: "https://legacy.example.com/v1",
    modelId: "m",
  });
  assert.equal(legacy.api, "openai-completions");
});

void test("auto api mode resolves the protocol from the model name", async () => {
  const store = new MemoryCustomProvidersStore();

  // gpt-* → responses, no manual switching needed
  const luna = await saveOpenAiGatewayConfig(store, {
    displayName: "go-luna",
    endpointUrl: "https://opencode.ai/zen/go/v1",
    modelId: "gpt-5.6-luna",
  });
  assert.equal(luna.api, "openai-responses");
  assert.equal(luna.apiMode, "auto");

  // glm/deepseek/kimi → completions
  const glm = await saveOpenAiGatewayConfig(store, {
    displayName: "go-glm",
    endpointUrl: "https://opencode.ai/zen/go/v1",
    modelId: "glm-5.3",
  });
  assert.equal(glm.api, "openai-completions");

  // grok-* and muse-spark* → responses
  assert.equal(
    (await saveOpenAiGatewayConfig(store, {
      endpointUrl: "https://opencode.ai/zen/go/v1",
      modelId: "grok-4.6",
    })).api,
    "openai-responses",
  );

  // Explicit lock wins over the name table (unknown future models)
  const locked = await saveOpenAiGatewayConfig(store, {
    endpointUrl: "https://opencode.ai/zen/go/v1",
    modelId: "gpt-future-model",
    api: "openai-completions",
  });
  assert.equal(locked.api, "openai-completions");
  assert.equal(locked.apiMode, "openai-completions");

  // Round-trip preserves the choice
  const listed = await listOpenAiGatewayConfigs(store);
  const reluna = listed.find((g) => g.id === luna.id);
  assert.equal(reluna?.apiMode, "auto");
  assert.equal(reluna?.api, "openai-responses");
});
