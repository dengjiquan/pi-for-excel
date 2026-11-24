import type { Agent, AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai";

import { showToast } from "../../ui/toast.js";
import { t } from "../../language/index.js";
import { hideCommandMenu } from "../../commands/command-menu.js";
import { executeSlashCommand } from "../../commands/slash-command-execution.js";
import type { ActionQueue } from "../action-queue.js";
import type { QueueDisplay } from "../queue-display.js";
import type { TabState } from "../tab-state.js";

export interface SubmitTarget {
  agent: Agent;
  actionQueue: Pick<ActionQueue, "enqueuePrompt" | "enqueueCommand" | "isBusy">;
  queueDisplay: Pick<QueueDisplay, "add">;
  tab?: Pick<TabState, "attachments" | "setAttachments">;
}

export function submitComposerText(args: {
  text: string;
  followUp: boolean;
  images?: ImageContent[] | undefined;
  target: SubmitTarget | null;
}): boolean {
  const { followUp, target } = args;
  const images = args.images ?? [];
  let text = args.text.trim();
  if (!text && !target?.tab?.attachments.length && images.length === 0) return false;

  if (!target) {
    showToast(t("editor-actions.toast.noActiveSession"));
    return false;
  }

  const { agent, actionQueue, queueDisplay } = target;
  const isStreaming = agent.state.isStreaming;

  if (args.text.startsWith("/")) {
    const spaceIdx = text.search(/\s/u);
    const name = spaceIdx > 0 ? text.slice(1, spaceIdx) : text.slice(1);
    const commandArgs = spaceIdx > 0 ? text.slice(spaceIdx + 1).trim() : "";

    const result = executeSlashCommand({
      name,
      args: commandArgs,
      busy: actionQueue.isBusy(),
      enqueueCommand: actionQueue.enqueueCommand,
      beforeExecute: hideCommandMenu,
      onError: () => {
        showToast(t("slash-command.toast.failed"));
      },
    });

    if (result === "not-found") {
      showToast(t("turn.toast.unknownCommand", { command: name }));
      return false;
    }
    if (result === "busy-blocked") {
      showToast(t("shortcuts.toast.cantRunBusy", { command: name }));
      return false;
    }
    return true;
  }

  const paths = target.tab?.attachments ?? [];
  if (paths.length > 0) {
    text = [text, `Attached files in Files (read these as part of this message): ${paths.map((path) => JSON.stringify(path)).join(", ")}`].filter(Boolean).join("\n\n");
  }

  if (isStreaming) {
    const message: AgentMessage = {
      role: "user",
      content: [{ type: "text", text }, ...images],
      timestamp: Date.now(),
    };
    if (followUp) {
      agent.followUp(message);
      queueDisplay.add("follow-up", text, message);
    } else {
      agent.steer(message);
      queueDisplay.add("steer", text, message);
    }
    target.tab?.setAttachments([]);
    return true;
  }

  actionQueue.enqueuePrompt(text, images);
  target.tab?.setAttachments([]);
  return true;
}
