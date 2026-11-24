import { iconDOM } from "./icons.js";
import { t } from "../language/index.js";
import type { IconNode } from "lucide";
import {
  AlertTriangle,
  Archive,
  Check,
  CircleX,
  ClipboardList,
  Copy,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  Folder,
  FolderOpen,
  Image,
  Info,
  Keyboard,
  Link,
  NotebookPen,
  Package,
  Paperclip,
  Plug,
  Puzzle,
  Ruler,
  Search,
  Server,
  ShieldCheck,
  Terminal,
  Upload,
  Zap,
} from "lucide";

export type { IconNode };

export function lucide(glyph: IconNode): SVGElement {
  return iconDOM(glyph, "sm");
}

export {
  AlertTriangle,
  Archive,
  Check,
  CircleX,
  ClipboardList,
  Copy,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  Folder,
  FolderOpen,
  Image,
  Info,
  Keyboard,
  Link,
  NotebookPen,
  Package,
  Paperclip,
  Plug,
  Puzzle,
  Ruler,
  Search,
  Server,
  ShieldCheck,
  Terminal,
  Upload,
  Zap,
};

export interface CopyButtonOptions {
  text: string | (() => string);
  className?: string;
  title?: string;
  onCopied?: () => void;
}

let resetCopyTimeout: ReturnType<typeof setTimeout> | undefined;

export function createCopyButton(
  options: CopyButtonOptions,
): HTMLButtonElement {
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
