export const EXCEL_BUILT_IN_CELL_STYLES = [
  "Normal",
  "Bad",
  "Good",
  "Neutral",
  "Calculation",
  "CheckCell",
  "ExplanatoryText",
  "Hlink",
  "HlinkTrav",
  "Input",
  "LinkedCell",
  "Note",
  "Output",
  "Total",
  "WarningText",
] as const;

export function applyExcelCellStyle(
  ranges: readonly { style: string }[],
  cellStyle: string,
): void {
  for (const range of ranges) range.style = cellStyle;
}
