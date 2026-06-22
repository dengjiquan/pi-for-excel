import assert from "node:assert/strict";
import { test } from "node:test";

import { pushNamedItems } from "../src/tools/get-workbook-overview.ts";

void test("named formulas show their definition instead of the computed error", () => {
  const lines: string[] = [];
  const items = [
    {
      type: "Error",
      name: "DOUBLE_VALUE",
      value: "#VALUE!",
      formula: "=LAMBDA(value, value * 2)",
    },
  ];

  pushNamedItems(lines, items);

  assert.match(lines.join("\n"), /=LAMBDA\(value, value \* 2\)/);
  assert.doesNotMatch(lines.join("\n"), /#VALUE!/);
});
