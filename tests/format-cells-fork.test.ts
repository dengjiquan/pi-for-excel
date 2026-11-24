import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildBorderInstructions,
  normalizeBorderParams,
} from "../src/tools/format-cells-borders.ts";
import {
  applyExcelCellStyle,
  EXCEL_BUILT_IN_CELL_STYLES,
} from "../src/tools/format-cells-cell-style.ts";

void test("format_cells border shorthand none is normalized and clears all edges", () => {
  const borderParams = normalizeBorderParams({
    borders: "BordersNone",
  });

  const instructions = buildBorderInstructions(borderParams, {}, undefined);

  assert.deepEqual(borderParams, {
    shorthand: "none",
  });

  assert.deepEqual(instructions, {
    operations: [
      { edge: "EdgeTop", weight: "none" },
      { edge: "EdgeBottom", weight: "none" },
      { edge: "EdgeLeft", weight: "none" },
      { edge: "EdgeRight", weight: "none" },
      { edge: "InsideHorizontal", weight: "none" },
      { edge: "InsideVertical", weight: "none" },
    ],
    appliedText: "none borders",
  });
});

void test("format_cells rejects invalid border values instead of falling back", () => {
  assert.throws(
    () => normalizeBorderParams({ borders: "remove-all" }),
    /Invalid borders/u,
  );
});

void test("format_cells applies an Excel built-in Cell Style to every target area", () => {
  const ranges = [{ style: "Normal" }, { style: "Normal" }];

  applyExcelCellStyle(ranges, "Input");

  assert.deepEqual(ranges, [{ style: "Input" }, { style: "Input" }]);
  assert.ok(EXCEL_BUILT_IN_CELL_STYLES.includes("WarningText"));
});
