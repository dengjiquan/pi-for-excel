/**
 * Helpers for custom OpenAI-compatible gateway providers.
 */

import type { Api, Model } from "@earendil-works/pi-ai";
import type { CustomProvider } from "../storage/local/custom-providers-store.js";

const OPENAI_GATEWAY_ID_PREFIX = "pi-openai-gateway:";
export const OPENAI_GATEWAY_PROVIDER_PREFIX = "Gateway · ";
const OPENAI_GATEWAY_TYPE = "openai-completions";
const OPENAI_RESPONSES_GATEWAY_TYPE = "openai-responses";

/** Wire protocol the gateway speaks; providers like opencode GO route some
 * models (gpt-5.6-luna, grok-4.6) only through the Responses API. */
export type GatewayApiType = "openai-completions" | "openai-responses";

/** UI choice: "auto" resolves the protocol from the model name at save time. */
export type GatewayApiChoice = "auto" | GatewayApiType;

/**
 * opencode GO route table (https://opencode.ai/docs/go/): responses-only
 * models are gpt-*, grok-*, muse-spark*; everything else is chat completions.
 * Manual override exists for models this table does not know yet.
 */
export function resolveGatewayApiType(modelId: string): GatewayApiType {
  return /^(gpt-|grok-|muse-spark)/i.test(modelId)
    ? "openai-responses"
    : "openai-completions";
}

export const DEFAULT_OPENAI_GATEWAY_CONTEXT_WINDOW = 16_384;
// ponytail: fixed default; expose per-model override in gateway settings if users need lower
const DEFAULT_OPENAI_GATEWAY_MAX_TOKENS = 65_536;

type StoredModel = NonNullable<CustomProvider["models"]>[number];

export interface CustomProvidersStoreLike {
  get(id: string): Promise<CustomProvider | null>;
  set(provider: CustomProvider): Promise<void>;
  delete(id: string): Promise<void>;
  getAll(): Promise<CustomProvider[]>;
}

export interface OpenAiGatewayConfig {
  id: string;
  displayName: string;
  endpointUrl: string;
  modelId: string;
  apiKey: string;
  providerName: string;
  contextWindow: number;
  headers?: Record<string, string>;
  /** Resolved protocol actually used for requests. */
  api: GatewayApiType;
  /** The stored UI choice ("auto" or a locked protocol). */
  apiMode: GatewayApiChoice;
}

export interface SaveOpenAiGatewayInput {
  id?: string;
  displayName?: string;
  endpointUrl: string;
  modelId: string;
  apiKey?: string;
  contextWindow?: number;
  headers?: Record<string, string>;
  api?: GatewayApiChoice;
}

export interface CustomProviderRuntimeInfo {
  providerNames: Set<string>;
  apiKeys: Map<string, string | undefined>;
  defaultModel: Model<Api> | null;
}

function normalizeOptionalString(value: string | null | undefined): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function normalizeRequiredString(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${label} is required.`);
  }

  return trimmed;
}

export function normalizeGatewayEndpointUrl(endpointUrl: string): string {
  const raw = normalizeRequiredString(endpointUrl, "Endpoint URL");

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Endpoint URL must be a valid http:// or https:// URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Endpoint URL must use http:// or https://.");
  }

  parsed.hash = "";
  const normalized = parsed.toString();
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

export function normalizeGatewayModelId(modelId: string): string {
  return normalizeRequiredString(modelId, "Model ID");
}

/**
 * Parse "Header-Name: value" lines into a header record.
 * Blank lines are skipped; a line without ":" is an error.
 */
export function parseGatewayHeaderText(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    const separator = line.indexOf(":");
    if (separator <= 0) {
      throw new Error(`Invalid header line (expected "Name: value"): ${line}`);
    }

    const name = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (name.length === 0 || value.length === 0) {
      throw new Error(`Invalid header line (expected "Name: value"): ${line}`);
    }

    headers[name] = value;
  }
  return headers;
}

/** Render a header record back as "Name: value" lines for editing. */
export function formatGatewayHeaders(
  headers: Record<string, string> | undefined,
): string {
  if (!headers) return "";
  return Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join("\n");
}

export function normalizeGatewayContextWindow(
  contextWindow: number | null | undefined,
): number {
  if (contextWindow == null) {
    return DEFAULT_OPENAI_GATEWAY_CONTEXT_WINDOW;
  }

  if (!Number.isInteger(contextWindow)) {
    throw new Error("Max context tokens must be a whole number.");
  }

  const normalized = contextWindow;
  if (normalized < 1_024) {
    throw new Error("Max context tokens must be at least 1024.");
  }

  return normalized;
}

function deriveDisplayName(
  rawName: string | undefined,
  endpointUrl: string,
): string {
  const explicit = normalizeOptionalString(rawName);
  if (explicit.length > 0) {
    return explicit;
  }

  try {
    const url = new URL(endpointUrl);
    const host =
      url.port.length > 0 ? `${url.hostname}:${url.port}` : url.hostname;
    if (host.trim().length > 0) {
      return host;
    }
  } catch {
    // noop — endpoint URL is validated before this runs.
  }

  return "Custom gateway";
}

function toGatewayProviderName(displayName: string): string {
  return `${OPENAI_GATEWAY_PROVIDER_PREFIX}${displayName}`;
}

function getFirstModel(provider: CustomProvider): StoredModel | null {
  if (!Array.isArray(provider.models) || provider.models.length === 0) {
    return null;
  }

  return provider.models[0] ?? null;
}

export function isOpenAiGatewayProvider(provider: CustomProvider): boolean {
  if (!provider.id.startsWith(OPENAI_GATEWAY_ID_PREFIX)) {
    return false;
  }

  if (
    provider.type !== OPENAI_GATEWAY_TYPE &&
    provider.type !== OPENAI_RESPONSES_GATEWAY_TYPE
  ) {
    return false;
  }

  const model = getFirstModel(provider);
  if (!model) {
    return false;
  }

  const providerName = normalizeOptionalString(model.provider);
  const modelId = normalizeOptionalString(model.id);
  return providerName.length > 0 && modelId.length > 0;
}

function providerToGatewayConfig(
  provider: CustomProvider,
): OpenAiGatewayConfig | null {
  if (!isOpenAiGatewayProvider(provider)) {
    return null;
  }

  const model = getFirstModel(provider);
  if (!model) {
    return null;
  }

  const providerName = normalizeOptionalString(model.provider);
  if (providerName.length === 0) {
    return null;
  }

  const endpointUrl = normalizeOptionalString(provider.baseUrl);
  const modelId = normalizeOptionalString(model.id);
  if (endpointUrl.length === 0 || modelId.length === 0) {
    return null;
  }

  const defaultDisplayName = providerName.startsWith(
    OPENAI_GATEWAY_PROVIDER_PREFIX,
  )
    ? providerName.slice(OPENAI_GATEWAY_PROVIDER_PREFIX.length)
    : providerName;

  return {
    id: provider.id,
    displayName: normalizeOptionalString(provider.name) || defaultDisplayName,
    endpointUrl,
    modelId,
    apiKey: normalizeOptionalString(provider.apiKey),
    providerName,
    contextWindow: normalizeGatewayContextWindow(model.contextWindow),
    ...(provider.headers !== undefined &&
    Object.keys(provider.headers).length > 0
      ? { headers: provider.headers }
      : {}),
    api:
      provider.type === OPENAI_RESPONSES_GATEWAY_TYPE
        ? "openai-responses"
        : "openai-completions",
    apiMode:
      provider.apiMode === "auto" ||
      provider.apiMode === "openai-completions" ||
      provider.apiMode === "openai-responses"
        ? provider.apiMode
        : "auto",
  };
}

function createGatewayModel(args: {
  endpointUrl: string;
  modelId: string;
  providerName: string;
  contextWindow: number;
  headers?: Record<string, string>;
  api: GatewayApiType;
}): Model<Api> {
  const maxTokens = Math.min(
    DEFAULT_OPENAI_GATEWAY_MAX_TOKENS,
    args.contextWindow,
  );

  return {
    id: args.modelId,
    name: args.modelId,
    api: args.api,
    provider: args.providerName,
    baseUrl: args.endpointUrl,
    reasoning: false,
    input: ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: args.contextWindow,
    maxTokens,
    ...(args.headers !== undefined ? { headers: args.headers } : {}),
  };
}

function resolveUniqueProviderName(args: {
  displayName: string;
  existingGateways: OpenAiGatewayConfig[];
  editingId?: string;
}): string {
  const candidateBase = toGatewayProviderName(args.displayName);
  const usedNames = new Set(
    args.existingGateways
      .filter((gateway) => gateway.id !== args.editingId)
      .map((gateway) => gateway.providerName.toLowerCase()),
  );

  if (!usedNames.has(candidateBase.toLowerCase())) {
    return candidateBase;
  }

  let suffix = 2;
  while (suffix < 500) {
    const candidate = `${candidateBase} (${suffix})`;
    if (!usedNames.has(candidate.toLowerCase())) {
      return candidate;
    }

    suffix += 1;
  }

  return `${candidateBase} (${Date.now()})`;
}

export async function listOpenAiGatewayConfigs(
  customProvidersStore: CustomProvidersStoreLike,
): Promise<OpenAiGatewayConfig[]> {
  const providers = await customProvidersStore.getAll();

  return providers
    .map((provider) => providerToGatewayConfig(provider))
    .filter((gateway): gateway is OpenAiGatewayConfig => gateway !== null)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function saveOpenAiGatewayConfig(
  customProvidersStore: CustomProvidersStoreLike,
  input: SaveOpenAiGatewayInput,
): Promise<OpenAiGatewayConfig> {
  const endpointUrl = normalizeGatewayEndpointUrl(input.endpointUrl);
  const modelId = normalizeGatewayModelId(input.modelId);
  const contextWindow = normalizeGatewayContextWindow(input.contextWindow);
  const existingGateways = await listOpenAiGatewayConfigs(customProvidersStore);

  if (input.id) {
    const match = existingGateways.find((gateway) => gateway.id === input.id);
    if (!match) {
      throw new Error("Gateway not found.");
    }
  }

  const displayName = deriveDisplayName(input.displayName, endpointUrl);
  const uniqueProviderNameArgs: {
    displayName: string;
    existingGateways: OpenAiGatewayConfig[];
    editingId?: string;
  } = {
    displayName,
    existingGateways,
  };
  if (input.id !== undefined) {
    uniqueProviderNameArgs.editingId = input.id;
  }
  const providerName = resolveUniqueProviderName(uniqueProviderNameArgs);

  const id = input.id ?? `${OPENAI_GATEWAY_ID_PREFIX}${crypto.randomUUID()}`;
  const apiKey = normalizeOptionalString(input.apiKey);
  const headers = input.headers
    ? Object.fromEntries(
        Object.entries(input.headers)
          .filter(([, value]) => value.trim().length > 0)
          .map(([name, value]) => [name, value.trim()]),
      )
    : undefined;
  const hasHeaders = headers !== undefined && Object.keys(headers).length > 0;
  const normalizedHeaders = hasHeaders ? headers : undefined;

  const apiChoice: GatewayApiChoice = input.api ?? "auto";
  const api: GatewayApiType =
    apiChoice === "auto" ? resolveGatewayApiType(modelId) : apiChoice;

  const provider: CustomProvider = {
    id,
    name: displayName,
    type: api,
    baseUrl: endpointUrl,
    apiMode: apiChoice,
    models: [
      createGatewayModel({
        endpointUrl,
        modelId,
        providerName,
        contextWindow,
        api,
        ...(normalizedHeaders !== undefined
          ? { headers: normalizedHeaders }
          : {}),
      }),
    ],
  };
  if (apiKey.length > 0) {
    provider.apiKey = apiKey;
  }
  if (normalizedHeaders !== undefined) {
    provider.headers = normalizedHeaders;
  }

  await customProvidersStore.set(provider);

  return {
    id,
    displayName,
    endpointUrl,
    modelId,
    apiKey,
    providerName,
    contextWindow,
    ...(provider.headers !== undefined ? { headers: provider.headers } : {}),
    api,
    apiMode: apiChoice,
  };
}

function matchesPersistedCustomModel(
  storedModel: StoredModel,
  persistedModel: Pick<Model<Api>, "api" | "id" | "provider" | "baseUrl">,
): storedModel is Model<Api> {
  return (
    storedModel.api === persistedModel.api &&
    storedModel.id === persistedModel.id
  );
}

export function resolveCustomProviderModel(
  customProviders: CustomProvider[],
  persistedModel: Pick<Model<Api>, "api" | "id" | "provider" | "baseUrl">,
): Model<Api> | null {
  const fallbackMatches: Model<Api>[] = [];

  for (const provider of customProviders) {
    const storedModels = Array.isArray(provider.models) ? provider.models : [];

    for (const storedModel of storedModels) {
      if (!matchesPersistedCustomModel(storedModel, persistedModel)) {
        continue;
      }

      if (storedModel.provider === persistedModel.provider) {
        return storedModel;
      }

      if (storedModel.baseUrl === persistedModel.baseUrl) {
        fallbackMatches.push(storedModel);
      }
    }
  }

  if (fallbackMatches.length !== 1) {
    return null;
  }

  return fallbackMatches[0] ?? null;
}

export async function deleteOpenAiGatewayConfig(
  customProvidersStore: CustomProvidersStoreLike,
  id: string,
): Promise<void> {
  const normalizedId = normalizeOptionalString(id);
  if (!normalizedId.startsWith(OPENAI_GATEWAY_ID_PREFIX)) {
    return;
  }

  const existing = await customProvidersStore.get(normalizedId);
  if (!existing || !isOpenAiGatewayProvider(existing)) {
    return;
  }

  await customProvidersStore.delete(normalizedId);
}

export function collectCustomProviderRuntimeInfo(
  customProviders: CustomProvider[],
): CustomProviderRuntimeInfo {
  const providerNames = new Set<string>();
  const apiKeys = new Map<string, string | undefined>();
  let defaultModel: Model<Api> | null = null;

  for (const provider of customProviders) {
    const apiKey = normalizeOptionalString(provider.apiKey);
    const namesForProvider = new Set<string>();

    const storedModels = Array.isArray(provider.models) ? provider.models : [];

    if (storedModels.length > 0) {
      for (const model of storedModels) {
        const modelProviderName = normalizeOptionalString(model.provider);
        if (modelProviderName.length > 0) {
          namesForProvider.add(modelProviderName);
        }

        if (defaultModel === null) {
          defaultModel = model;
        }
      }
    } else {
      const directName = normalizeOptionalString(provider.name);
      if (directName.length > 0) {
        namesForProvider.add(directName);
      }
    }

    for (const providerName of namesForProvider) {
      providerNames.add(providerName);

      const hasExisting = apiKeys.has(providerName);
      if (apiKey.length > 0) {
        apiKeys.set(providerName, apiKey);
        continue;
      }

      if (!hasExisting) {
        apiKeys.set(providerName, undefined);
      }
    }
  }

  return {
    providerNames,
    apiKeys,
    defaultModel,
  };
}
