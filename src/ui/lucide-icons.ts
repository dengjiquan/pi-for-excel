/**
 * Thin wrapper around Lucide + mini-lit iconDOM for imperative DOM code.
 *
 * Overlay builders that construct DOM via `document.createElement` cannot
 * use Lit's `html` tagged template. This module re-exports `iconDOM` and
 * the Lucide glyphs used across overlay dialogs so each file doesn't need
 * to duplicate imports.
 */

import { iconDOM } from "@mariozechner/mini-lit";
import { t } from "../language/index.js";
import type { IconNode } from "lucide";
import {
  AlertTriangle,
  Check,
  ClipboardList,
  Copy,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  Image,
  Link,
  NotebookPen,
  Package,
  Paperclip,
  Plug,
  Puzzle,
  Search,
  Terminal,
  Upload,
  Zap,
} from "lucide";

export type { IconNode };

/** Create a 16×16 SVG element for use in imperative DOM code. */
export function lucide(glyph: IconNode): SVGElement {
  return iconDOM(glyph, "sm");
}

export {
  AlertTriangle,
  Check,
  ClipboardList,
  Copy,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  Image,
  Link,
  NotebookPen,
  Package,
  Paperclip,
  Plug,
  Puzzle,
  Search,
  Terminal,
  Upload,
  Zap,
};

/* ── Reusable copy button ──────────────────────────────────── */

export interface CopyButtonOptions {
  /** Text to copy to clipboard (string or function for dynamic content) */
  text: string | (() => string);
  /** CSS class for the button */
  className?: string;
  /** Tooltip when not copied */
  title?: string;
  /** Callback after successful copy */
  onCopied?: () => void;
}

let resetCopyTimeout: ReturnType<typeof setTimeout> | undefined;

/**
 * Create a copy button that copies text to clipboard on click.
 * Shows a check icon briefly after successful copy.
 */
export function createCopyButton(options: CopyButtonOptions): HTMLButtonElement {
  const {
    text,
    className = "pi-copy-btn",
    title = t("copy.toClipboard"),
    onCopied,
  } = options;

  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.appendChild(lucide(Copy));

  const renderCopyIcon = (): void => {
    button.replaceChildren(lucide(Copy));
    button.title = title;
    button.setAttribute("aria-label", title);
  };

  const renderCopiedIcon = (): void => {
    button.replaceChildren(lucide(Check));
    button.title = t("copy.copied");
    button.setAttribute("aria-label", t("copy.copied"));
  };

  button.addEventListener("click", () => {
    const textToCopy = typeof text === "function" ? text() : text;
    void navigator.clipboard.writeText(textToCopy).then(() => {
      if (resetCopyTimeout) clearTimeout(resetCopyTimeout);
      renderCopiedIcon();
      onCopied?.();
      resetCopyTimeout = setTimeout(renderCopyIcon, 1400);
    });
  });

  return button;
}
