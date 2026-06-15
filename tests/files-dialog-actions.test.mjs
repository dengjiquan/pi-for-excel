import assert from "node:assert/strict";
import { test } from "node:test";

import { createFilesDialogDetailActions } from "../src/ui/files-dialog-actions.ts";
import { installFakeDom } from "./fake-dom.test.ts";

function makeFile(path, overrides = {}) {
  return {
    path,
    name: path.split("/").at(-1) ?? path,
    size: 10,
    modifiedAt: 0,
    mimeType: "text/plain",
    kind: "text",
    sourceKind: "workspace",
    readOnly: false,
    ...overrides,
  };
}

function buildReadResult(path) {
  return {
    ...makeFile(path),
    text: "hello",
  };
}

function createWorkspaceStub() {
  return {
    readFile: (path) => Promise.resolve(buildReadResult(path)),
    writeTextFile: () => Promise.resolve(),
    downloadFile: () => Promise.resolve(),
    renameFile: () => Promise.resolve(),
    deleteFile: () => Promise.resolve(),
  };
}

function getButtonLabels(root) {
  return Array.from(root.querySelectorAll("button"))
    .map((button) => button.textContent?.trim() ?? "")
    .filter((text) => text.length > 0);
}

function findButton(root, label) {
  return Array.from(root.querySelectorAll("button"))
    .find((button) => button.textContent?.trim() === label);
}

async function flushAsyncActions() {
  await Promise.resolve();
  await Promise.resolve();
}

test("detail actions show open/download only for read-only files", () => {
  const { restore } = installFakeDom();

  try {
    const actions = createFilesDialogDetailActions({
      file: makeFile("assistant-docs/docs/README.md", {
        sourceKind: "builtin-doc",
        locationKind: "builtin-doc",
        readOnly: true,
      }),
      fileRef: {
        path: "assistant-docs/docs/README.md",
        locationKind: "builtin-doc",
      },
      workspace: createWorkspaceStub(),
      auditContext: {
        actor: "user",
        source: "test",
      },
      onAfterRename: () => Promise.resolve(),
      onAfterDelete: () => Promise.resolve(),
    });

    // Built-in docs use clipboard copy instead of Open (blob URLs fail in Office WebView).
    assert.deepEqual(getButtonLabels(actions), ["Copy content", "Download"]);
  } finally {
    restore();
  }
});

test("detail actions include rename/delete for writable files", () => {
  const { restore } = installFakeDom();

  try {
    const actions = createFilesDialogDetailActions({
      file: makeFile("notes/plan.md"),
      fileRef: {
        path: "notes/plan.md",
        locationKind: "workspace",
      },
      workspace: createWorkspaceStub(),
      auditContext: {
        actor: "user",
        source: "test",
      },
      onAfterRename: () => Promise.resolve(),
      onAfterDelete: () => Promise.resolve(),
    });

    assert.deepEqual(getButtonLabels(actions), ["Edit", "Download", "Rename", "Delete"]);
  } finally {
    restore();
  }
});

test("edit opens writable text files and saves changes", async () => {
  const { document, restore } = installFakeDom();
  let saved = null;

  try {
    const workspace = createWorkspaceStub();
    workspace.writeTextFile = (path, text, mimeType, options) => {
      saved = { path, text, mimeType, options };
      return Promise.resolve();
    };

    const actions = createFilesDialogDetailActions({
      file: makeFile("skills/pricing/SKILL.md"),
      fileRef: {
        path: "skills/pricing/SKILL.md",
        locationKind: "workspace",
      },
      workspace,
      auditContext: {
        actor: "user",
        source: "test",
      },
      onAfterRename: () => Promise.resolve(),
      onAfterDelete: () => Promise.resolve(),
    });

    const editButton = findButton(actions, "Edit");
    assert.ok(editButton);
    editButton.dispatchEvent(new Event("click"));
    await flushAsyncActions();

    const viewer = document.getElementById("pi-files-text-viewer-overlay");
    assert.ok(viewer);
    assert.equal(viewer.style.zIndex, "300");

    const editor = document.querySelectorAll("textarea")[0];
    assert.ok(editor);
    assert.equal(editor.value, "hello");
    editor.value = "updated skill";

    const saveButton = findButton(viewer, "Save");
    assert.ok(saveButton);
    saveButton.dispatchEvent(new Event("click"));
    await flushAsyncActions();

    assert.deepEqual(saved, {
      path: "skills/pricing/SKILL.md",
      text: "updated skill",
      mimeType: "text/plain",
      options: {
        audit: { actor: "user", source: "test" },
        locationKind: "workspace",
      },
    });
  } finally {
    restore();
  }
});

test("download uses the WebView-safe text path for writable text files", async () => {
  const { restore } = installFakeDom();
  let readCount = 0;
  let workspaceDownloadCount = 0;

  try {
    const workspace = createWorkspaceStub();
    workspace.readFile = (path) => {
      readCount += 1;
      return Promise.resolve(buildReadResult(path));
    };
    workspace.downloadFile = () => {
      workspaceDownloadCount += 1;
      return Promise.resolve();
    };

    const actions = createFilesDialogDetailActions({
      file: makeFile("skills/pricing/SKILL.md"),
      fileRef: {
        path: "skills/pricing/SKILL.md",
        locationKind: "workspace",
      },
      workspace,
      auditContext: {
        actor: "user",
        source: "test",
      },
      onAfterRename: () => Promise.resolve(),
      onAfterDelete: () => Promise.resolve(),
    });

    const downloadButton = findButton(actions, "Download");
    assert.ok(downloadButton);
    downloadButton.dispatchEvent(new Event("click"));
    await flushAsyncActions();

    assert.equal(readCount, 1);
    assert.equal(workspaceDownloadCount, 0);
  } finally {
    restore();
  }
});

test("rename dialog appears above the files workspace", () => {
  const { document, restore } = installFakeDom();

  try {
    const actions = createFilesDialogDetailActions({
      file: makeFile("skills/pricing/SKILL.md"),
      fileRef: {
        path: "skills/pricing/SKILL.md",
        locationKind: "workspace",
      },
      workspace: createWorkspaceStub(),
      auditContext: {
        actor: "user",
        source: "test",
      },
      onAfterRename: () => Promise.resolve(),
      onAfterDelete: () => Promise.resolve(),
    });

    const renameButton = findButton(actions, "Rename");
    assert.ok(renameButton);
    renameButton.dispatchEvent(new Event("click"));

    const renameDialog = document.getElementById("pi-text-input-dialog-overlay");
    assert.ok(renameDialog);
    assert.equal(renameDialog.style.zIndex, "300");
  } finally {
    restore();
  }
});
