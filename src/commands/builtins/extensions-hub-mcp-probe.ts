import { APP_NAME, APP_VERSION } from "../../app/metadata.js";
import { type IntegrationSettingsStore } from "../../integrations/store.js";
import {
  getEnabledProxyBaseUrl,
  resolveOutboundRequestUrl,
} from "../../tools/external-fetch.js";
import { type McpServerConfig } from "../../tools/mcp-config.js";
import {
  MCP_HTTP_ACCEPT,
  MCP_SESSION_HEADER,
  parseMcpHttpResponseBody,
} from "../../tools/mcp-http.js";
import {
  getHttpErrorReason,
  runWithTimeoutAbort,
} from "../../utils/network.js";
function isExtensionsHubMcpProbePayloadShape(
  value: DynamicValue,
): value is DynamicObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const MCP_PROBE_TIMEOUT_MS = 8_000;
const MCP_PROTOCOL_VERSION = "2025-03-26";

function parseToolCountFromListResponse(value: DynamicValue): number {
  if (!isExtensionsHubMcpProbePayloadShape(value)) return 0;
  if (!isExtensionsHubMcpProbePayloadShape(value.result)) return 0;
  const tools = value.result.tools;
  return Array.isArray(tools) ? tools.length : 0;
}

async function postJsonRpc(args: {
  server: McpServerConfig;
  method: string;
  params?: DynamicValue;
  settings: IntegrationSettingsStore;
  expectResponse?: boolean;
  sessionId?: string | undefined;
}): Promise<{
  response: DynamicValue;
  proxied: boolean;
  proxyBaseUrl?: string;
  sessionId?: string | undefined;
} | null> {
  const {
    server,
    method,
    params,
    settings,
    expectResponse = true,
    sessionId,
  } = args;

  const proxyBaseUrl = await getEnabledProxyBaseUrl(settings);
  const resolved = resolveOutboundRequestUrl({
    targetUrl: server.url,
    ...(proxyBaseUrl !== undefined ? { proxyBaseUrl } : {}),
  });

  const body: DynamicObject = {
    jsonrpc: "2.0",
    method,
  };

  if (params !== undefined) {
    body.params = params;
  }

  const requestId = expectResponse ? crypto.randomUUID() : undefined;
  if (requestId) body.id = requestId;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: MCP_HTTP_ACCEPT,
  };

  if (server.token) {
    headers.Authorization = `Bearer ${server.token}`;
  }

  if (sessionId) {
    headers[MCP_SESSION_HEADER] = sessionId;
  }

  return runWithTimeoutAbort({
    signal: undefined,
    timeoutMs: MCP_PROBE_TIMEOUT_MS,
    timeoutErrorMessage: `MCP request timed out after ${MCP_PROBE_TIMEOUT_MS}ms.`,
    run: async (requestSignal) => {
      const response = await fetch(resolved.requestUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: requestSignal,
      });

      if (!response.ok) {
        const text = await response.text();
        const reason = getHttpErrorReason(response.status, text);
        throw new Error(`MCP request failed (${response.status}): ${reason}`);
      }

      if (!expectResponse) {
        return {
          response: null,
          proxied: resolved.proxied,
          ...(resolved.proxyBaseUrl !== undefined
            ? { proxyBaseUrl: resolved.proxyBaseUrl }
            : {}),
          sessionId: response.headers.get(MCP_SESSION_HEADER) ?? sessionId,
        };
      }

      const text = await response.text();
      const payload: DynamicValue = parseMcpHttpResponseBody({
        text,
        contentType: response.headers.get("Content-Type"),
        requestId: requestId ?? "",
      }) as DynamicValue;

      return {
        response: payload,
        proxied: resolved.proxied,
        ...(resolved.proxyBaseUrl !== undefined
          ? { proxyBaseUrl: resolved.proxyBaseUrl }
          : {}),
        sessionId: response.headers.get(MCP_SESSION_HEADER) ?? sessionId,
      };
    },
  });
}

export async function probeMcpServer(
  server: McpServerConfig,
  settings: IntegrationSettingsStore,
): Promise<{ toolCount: number; proxied: boolean; proxyBaseUrl?: string }> {
  const initializeResult = await postJsonRpc({
    server,
    method: "initialize",
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: APP_NAME,
        version: APP_VERSION,
      },
    },
    settings,
  });
  const sessionId = initializeResult?.sessionId;

  await postJsonRpc({
    server,
    method: "notifications/initialized",
    settings,
    expectResponse: false,
    sessionId,
  });

  const list = await postJsonRpc({
    server,
    method: "tools/list",
    params: {},
    settings,
    sessionId,
  });

  if (!list) {
    throw new Error("MCP tools/list returned no response.");
  }

  return {
    toolCount: parseToolCountFromListResponse(list.response),
    proxied: list.proxied,
    ...(list.proxyBaseUrl !== undefined
      ? { proxyBaseUrl: list.proxyBaseUrl }
      : {}),
  };
}
