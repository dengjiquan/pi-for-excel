import { base64ToBytes } from "../files/encoding.js";
import { resolveSafeBlobUrlMimeType } from "../files/blob-url-safety.js";
import type { WorkspaceFileEntry, WorkspaceFileLocationKind, WorkspaceFileReadResult } from "../files/types.js";
import type {
  FilesWorkspaceAuditContext,
  WorkspaceMutationOptions,
  WorkspaceReadOptions,
} from "../files/workspace.js";
import { getErrorMessage } from "../utils/errors.js";
import { requestConfirmationDialog } from "./confirm-dialog.js";
import { isFilesDialogBuiltInDoc } from "./files-dialog-filtering.js";
import { resolveRenameDestinationPath } from "./files-dialog-paths.js";
import { FILES_TEXT_VIEWER_OVERLAY_ID } from "./overlay-ids.js";
import {
  closeOverlayById,
  createOverlayDialog,
  createOverlayHeader,
} from "./overlay-dialog.js";
import { requestTextInputDialog } from "./text-input-dialog.js";
import { showToast } from "./toast.js";
import { copyText } from "./copy-text.js";
import { saveBlobAsFile } from "../utils/download.js";
import { isEmbeddedAppleWebView } from "../utils/platform.js";
import { t } from "../language/index.js";

export interface FilesDialogDetailActionFileRef {
  path: string;
  locationKind: WorkspaceFileLocationKind;
}

export interface FilesDialogDetailActionsWorkspace {
  readFile(path: string, opts?: WorkspaceReadOptions): Promise<WorkspaceFileReadResult>;
  writeTextFile(
    path: string,
    text: string,
    mimeTypeHint?: string,
    options?: WorkspaceMutationOptions,
  ): Promise<void>;
  downloadFile(path: string, options?: { locationKind?: WorkspaceFileLocationKind }): Promise<void>;
  renameFile(oldPath: string, newPath: string, options?: WorkspaceMutationOptions): Promise<void>;
  deleteFile(path: string, options?: WorkspaceMutationOptions): Promise<void>;
}

export interface CreateFilesDialogDetailActionsOptions {
  file: WorkspaceFileEntry;
  fileRef: FilesDialogDetailActionFileRef;
  workspace: FilesDialogDetailActionsWorkspace;
  auditContext: FilesWorkspaceAuditContext;
  onMutationStateChange: (pending: boolean) => void;
  onAfterRename: (nextPath: string, locationKind: WorkspaceFileLocationKind) => Promise<void>;
  onAfterDelete: () => Promise<void>;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

function closeWindowSafely(windowHandle: Window | null): void {
  if (!windowHandle || windowHandle.closed) {
    return;
  }

  try {
    windowHandle.close();
  } catch {
  }
}

function openBlobInNewTab(blob: Blob, pendingWindow: Window | null): void {
  const url = URL.createObjectURL(blob);
  let opened = false;

  if (pendingWindow && !pendingWindow.closed) {
    try {
      pendingWindow.location.replace(url);
      opened = true;
    } catch {
      closeWindowSafely(pendingWindow);
    }
  }

  if (!opened) {
    opened = window.open(url, "_blank") !== null;
  }

  if (!opened) {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60_000);
}

async function copyTextToClipboard(text: string, fileName: string): Promise<void> {
  if (await copyText(text) === "copied") {
    showToast(t("files-dialog-actions.toast.copied", { fileName }));
  }
}

async function editTextFileInDialog(options: {
  file: WorkspaceFileEntry;
  fileRef: FilesDialogDetailActionFileRef;
  workspace: FilesDialogDetailActionsWorkspace;
  auditContext: FilesWorkspaceAuditContext;
}): Promise<void> {
  closeOverlayById(FILES_TEXT_VIEWER_OVERLAY_ID);
  const dialog = createOverlayDialog({
    overlayId: FILES_TEXT_VIEWER_OVERLAY_ID,
    cardClassName: "pi-welcome-card pi-overlay-card pi-overlay-card--l pi-files-text-viewer",
    restoreFocusOnClose: false,
  });
  const { header } = createOverlayHeader({
    title: options.file.name,
    subtitle: options.file.path,
    closeLabel: t("files-dialog-actions.closeFile"),
    onClose: dialog.close,
  });
  const body = document.createElement("div");
  body.className = "pi-overlay-body pi-files-text-viewer__body";
  const editor = document.createElement("textarea");
  editor.className = "pi-files-text-viewer__content pi-files-text-viewer__editor";
  editor.value = t("files-dialog-actions.loading");
  editor.disabled = true;
  const actions = document.createElement("div");
  actions.className = "pi-files-text-viewer__actions";
  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "pi-overlay-btn pi-overlay-btn--ghost";
  cancelButton.textContent = t("files-dialog-actions.cancel");
  cancelButton.addEventListener("click", dialog.close);
  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "pi-overlay-btn pi-overlay-btn--primary";
  saveButton.textContent = t("files-dialog-actions.save");
  saveButton.disabled = true;
  actions.append(cancelButton, saveButton);
  body.append(editor, actions);
  dialog.card.append(header, body);
  dialog.mount();

  try {
    const result = await options.workspace.readFile(options.file.path, {
      mode: "text",
      maxChars: 16_000_000,
      audit: options.auditContext,
      locationKind: options.fileRef.locationKind,
    });
    if (result.text === undefined || result.truncated) {
      throw new Error("File is too large to open in the viewer.");
    }
    editor.value = result.text;
    editor.disabled = false;
    saveButton.disabled = false;
    saveButton.addEventListener("click", () => {
      void (async () => {
        saveButton.disabled = true;
        saveButton.textContent = t("files-dialog-actions.saving");
        await options.workspace.writeTextFile(options.file.path, editor.value, options.file.mimeType, {
          audit: options.auditContext,
          locationKind: options.fileRef.locationKind,
        });
        showToast(t("files-dialog-actions.toast.saved", { name: options.file.name }));
        dialog.close();
      })().catch((error: unknown) => {
        saveButton.disabled = false;
        saveButton.textContent = t("files-dialog-actions.save");
        showToast(t("files-dialog-actions.toast.saveFailed", { error: getErrorMessage(error) }));
      });
    });
  } catch (error: unknown) {
    dialog.close();
    throw error;
  }
}

async function openFileInBrowser(options: {
  file: WorkspaceFileEntry;
  fileRef: FilesDialogDetailActionFileRef;
  workspace: FilesDialogDetailActionsWorkspace;
  auditContext: FilesWorkspaceAuditContext;
}): Promise<void> {
  const pendingWindow = window.open("", "_blank");

  try {
    if (options.file.kind === "text") {
      const result = await options.workspace.readFile(options.file.path, {
        mode: "text",
        maxChars: 16_000_000,
        audit: options.auditContext,
        locationKind: options.fileRef.locationKind,
      });

      if (result.text === undefined || result.truncated) {
        throw new Error("File is too large to open in a browser tab.");
      }

      const blob = new Blob([result.text], {
        type: resolveSafeBlobUrlMimeType(options.file.mimeType || "text/plain"),
      });

      openBlobInNewTab(blob, pendingWindow);
      return;
    }

    const result = await options.workspace.readFile(options.file.path, {
      mode: "base64",
      maxChars: 16_000_000,
      audit: options.auditContext,
      locationKind: options.fileRef.locationKind,
    });

    if (!result.base64 || result.truncated) {
      throw new Error("File is too large to open in a browser tab.");
    }

    const bytes = base64ToBytes(result.base64);
    const blob = new Blob([toArrayBuffer(bytes)], {
      type: resolveSafeBlobUrlMimeType(options.file.mimeType),
    });

    openBlobInNewTab(blob, pendingWindow);
  } catch (error) {
    closeWindowSafely(pendingWindow);
    throw error;
  }
}

export function createFilesDialogDetailActions(options: CreateFilesDialogDetailActionsOptions): HTMLDivElement {
  const actions = document.createElement("div");
  actions.className = "pi-files-detail-actions";

  const isBuiltIn = isFilesDialogBuiltInDoc(options.file);

  if (options.file.kind === "text") {
    // Built-in docs: copy and download instead of opening a browser tab,
    // which silently fails in the Office WebView.
    const primaryButton = document.createElement("button");
    primaryButton.type = "button";
    primaryButton.className = "pi-overlay-btn pi-overlay-btn--ghost pi-overlay-btn--compact";
    primaryButton.textContent = isBuiltIn
      ? t("files-dialog-actions.copyContent")
      : t("files-dialog-actions.edit");
    primaryButton.addEventListener("click", () => {
      if (!isBuiltIn) {
        void editTextFileInDialog({
          file: options.file,
          fileRef: options.fileRef,
          workspace: options.workspace,
          auditContext: options.auditContext,
        }).catch((error: unknown) => {
          showToast(t("files-dialog-actions.toast.openFailed", { error: getErrorMessage(error) }));
        });
        return;
      }
      void (async () => {
        const result = await options.workspace.readFile(options.file.path, {
          mode: "text",
          maxChars: 16_000_000,
          audit: options.auditContext,
          locationKind: options.fileRef.locationKind,
        });
        if (result.text === undefined) throw new Error("Could not read file.");
        await copyTextToClipboard(result.text, options.file.name);
      })().catch((error: unknown) => {
        showToast(t("files-dialog-actions.toast.copyFailed", { error: getErrorMessage(error) }));
      });
    });

    const downloadButton = document.createElement("button");
    downloadButton.type = "button";
    downloadButton.className = "pi-overlay-btn pi-overlay-btn--ghost pi-overlay-btn--compact";
    downloadButton.textContent = t("files-dialog-actions.download");
    downloadButton.addEventListener("click", () => {
      void (async () => {
        const result = await options.workspace.readFile(options.file.path, {
          mode: "text",
          maxChars: 16_000_000,
          audit: options.auditContext,
          locationKind: options.fileRef.locationKind,
        });
        if (result.text === undefined) throw new Error("Could not read file.");
        saveBlobAsFile(
          new Blob([result.text], { type: resolveSafeBlobUrlMimeType(options.file.mimeType || "text/plain") }),
          options.file.name,
        );
      })().catch((error: unknown) => {
        showToast(t("files-dialog-actions.toast.downloadFailed", { error: getErrorMessage(error) }));
      });
    });

    actions.append(primaryButton, downloadButton);
  } else {
    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "pi-overlay-btn pi-overlay-btn--primary pi-overlay-btn--compact";
    openButton.textContent = t("files-dialog-actions.open");
    openButton.addEventListener("click", () => {
      // Excel for Mac's WKWebView cannot open a blob in any window, and a
      // failed attempt also cancels a download in the same task: save instead.
      if (isEmbeddedAppleWebView()) {
        void options.workspace.downloadFile(options.file.path, {
          locationKind: options.fileRef.locationKind,
        }).then(
          () => showToast(t("files-dialog-actions.toast.savedInstead", { fileName: options.file.name })),
          (error: Error) => showToast(t("files-dialog-actions.toast.openFailed", { error: getErrorMessage(error) })),
        );
        return;
      }
      void openFileInBrowser({
        file: options.file,
        fileRef: options.fileRef,
        workspace: options.workspace,
        auditContext: options.auditContext,
      }).catch((error: unknown) => {
        showToast(t("files-dialog-actions.toast.openFailed", { error: getErrorMessage(error) }));
      });
    });

    const downloadButton = document.createElement("button");
    downloadButton.type = "button";
    downloadButton.className = "pi-overlay-btn pi-overlay-btn--ghost pi-overlay-btn--compact";
    downloadButton.textContent = t("files-dialog-actions.download");
    downloadButton.addEventListener("click", () => {
      void options.workspace.downloadFile(options.file.path, {
        locationKind: options.fileRef.locationKind,
      }).catch((error: unknown) => {
        showToast(t("files-dialog-actions.toast.downloadFailed", { error: getErrorMessage(error) }));
      });
    });

    actions.append(openButton, downloadButton);
  }

  const isReadOnly = options.file.readOnly || isFilesDialogBuiltInDoc(options.file);
  if (isReadOnly) {
    return actions;
  }

  const renameButton = document.createElement("button");
  renameButton.type = "button";
  renameButton.className = "pi-overlay-btn pi-overlay-btn--ghost pi-overlay-btn--compact";
  renameButton.textContent = t("files-dialog-actions.rename");
  renameButton.addEventListener("click", () => {
    void (async () => {
      const nextPathInput = await requestTextInputDialog({
        title: t("files-dialog-actions.renameFileTitle"),
        message: `${options.file.path} — leave off the extension to keep it.`,
        initialValue: options.file.path,
        placeholder: "folder/file.ext",
        confirmLabel: t("files-dialog-actions.rename"),
        cancelLabel: t("files-dialog-actions.cancel"),
        restoreFocusOnClose: false,
      });

      if (nextPathInput === null) {
        return;
      }

      const nextPath = resolveRenameDestinationPath(options.file.path, nextPathInput);
      if (nextPath === options.file.path) {
        return;
      }

      options.onMutationStateChange(true);
      try {
        await options.workspace.renameFile(options.file.path, nextPath, {
          audit: options.auditContext,
          locationKind: options.fileRef.locationKind,
        });

        showToast(t("files-dialog-actions.toast.renamed", { path: nextPath }));
        await options.onAfterRename(nextPath, options.fileRef.locationKind);
      } finally {
        options.onMutationStateChange(false);
      }
    })().catch((error: unknown) => {
      showToast(t("files-dialog-actions.toast.renameFailed", { error: getErrorMessage(error) }));
    });
  });

  const spacer = document.createElement("div");
  spacer.className = "pi-files-detail-actions__spacer";

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "pi-overlay-btn pi-overlay-btn--danger pi-overlay-btn--compact";
  deleteButton.textContent = t("files-dialog-actions.delete");
  deleteButton.addEventListener("click", () => {
    void (async () => {
      const confirmed = await requestConfirmationDialog({
        title: t("files-dialog-actions.deleteFileTitle"),
        message: options.file.path,
        confirmLabel: t("files-dialog-actions.delete"),
        cancelLabel: t("files-dialog-actions.cancel"),
        confirmButtonTone: "danger",
        restoreFocusOnClose: false,
      });

      if (!confirmed) {
        return;
      }

      options.onMutationStateChange(true);
      try {
        await options.workspace.deleteFile(options.file.path, {
          audit: options.auditContext,
          locationKind: options.fileRef.locationKind,
        });

        showToast(t("files-dialog-actions.toast.deleted", { name: options.file.name }));
        await options.onAfterDelete();
      } finally {
        options.onMutationStateChange(false);
      }
    })().catch((error: unknown) => {
      showToast(t("files-dialog-actions.toast.deleteFailed", { error: getErrorMessage(error) }));
    });
  });

  actions.append(renameButton, spacer, deleteButton);
  return actions;
}
