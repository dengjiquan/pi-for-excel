import { isRecord } from "../utils/type-guards.js";

export const MCP_HTTP_ACCEPT = "application/json, text/event-stream";
export const MCP_SESSION_HEADER = "Mcp-Session-Id";

function parseJson(text: string): unknown {
  return text.trim().length > 0 ? JSON.parse(text) : null;
}

function findResponseById(value: unknown, requestId: string): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (isRecord(item) && item.id === requestId) {
        return item;
      }
    }
    return null;
  }

  return isRecord(value) && value.id === requestId ? value : null;
}

export function parseMcpHttpResponseBody(args: {
  text: string;
  contentType: string | null;
  requestId: string;
}): unknown {
  const { text, contentType, requestId } = args;
  if (!contentType?.toLowerCase().includes("text/event-stream")) {
    return parseJson(text);
  }

  const eventData: string[] = [];
  let currentData: string[] = [];

  const flushEvent = (): void => {
    if (currentData.length > 0) {
      eventData.push(currentData.join("\n"));
      currentData = [];
    }
  };

  for (const line of text.split(/\r?\n/u)) {
    if (line.length === 0) {
      flushEvent();
      continue;
    }

    if (line.startsWith("data:")) {
      currentData.push(line.slice(5).trimStart());
    }
  }
  flushEvent();

  for (const data of eventData) {
    const payload = parseJson(data);
    const response = findResponseById(payload, requestId);
    if (response !== null) {
      return response;
    }
  }

  throw new Error("MCP SSE response did not contain the requested JSON-RPC response.");
}
