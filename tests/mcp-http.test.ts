import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MCP_HTTP_ACCEPT,
  parseMcpHttpResponseBody,
} from "../src/tools/mcp-http.ts";

void test("MCP HTTP Accept header supports JSON and SSE", () => {
  assert.equal(MCP_HTTP_ACCEPT, "application/json, text/event-stream");
});

void test("MCP HTTP parses JSON responses", () => {
  const result = parseMcpHttpResponseBody({
    text: '{"jsonrpc":"2.0","id":"request-1","result":{"ok":true}}',
    contentType: "application/json; charset=utf-8",
    requestId: "request-1",
  });

  assert.deepEqual(result, {
    jsonrpc: "2.0",
    id: "request-1",
    result: { ok: true },
  });
});

void test("MCP HTTP extracts the matching JSON-RPC response from SSE", () => {
  const result = parseMcpHttpResponseBody({
    text: [
      "event: message",
      'data: {"jsonrpc":"2.0","method":"notifications/progress"}',
      "",
      "event: message",
      'data: {"jsonrpc":"2.0","id":"request-2","result":{"tools":[]}}',
      "",
    ].join("\n"),
    contentType: "text/event-stream",
    requestId: "request-2",
  });

  assert.deepEqual(result, {
    jsonrpc: "2.0",
    id: "request-2",
    result: { tools: [] },
  });
});
