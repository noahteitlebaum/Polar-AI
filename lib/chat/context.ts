import type { ModelOption } from "@/config/models";
import type { ChatTurn, Usage } from "@/lib/providers/types";

// Rough, deliberately high token estimate (~3 chars per token) so reservations err on the safe side.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3) + 4;
}

/**
 * Context policy (docs/ARCHITECTURE.md): walk history newest → oldest and keep turns until the budget is used.
 * The newest user message is always kept. `dropped` tells the UI to show "Older messages not included".
 */
export function buildContext(history: ChatTurn[], budgetTokens: number): { turns: ChatTurn[]; dropped: boolean; tokens: number } {
  const kept: ChatTurn[] = [];
  let tokens = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const t = estimateTokens(history[i].content);
    if (kept.length > 0 && tokens + t > budgetTokens) {
      return { turns: kept.reverse(), dropped: true, tokens };
    }
    kept.push(history[i]);
    tokens += t;
  }
  return { turns: kept.reverse(), dropped: false, tokens };
}

/** Cost in micros (millionths of $). Prices are $ per 1M tokens, so tokens × price is already micros. */
export function costMicros(model: Pick<ModelOption, "inputPrice" | "outputPrice">, usage: Pick<Usage, "input" | "output">): number {
  return Math.ceil(usage.input * model.inputPrice + usage.output * model.outputPrice);
}

/** Upper bound reserved before a call: estimated input (+15% margin) at full price + every allowed output token. */
export function reservationMicros(model: Pick<ModelOption, "inputPrice" | "outputPrice">, inputTokens: number, maxOutput: number): number {
  return Math.ceil(inputTokens * 1.15 * model.inputPrice + maxOutput * model.outputPrice);
}

/** Largest output that still fits the remaining budget (0 if none). */
export function maxOutputFor(model: Pick<ModelOption, "inputPrice" | "outputPrice">, inputTokens: number, remainingMicros: number): number {
  const left = remainingMicros - inputTokens * 1.15 * model.inputPrice;
  return left <= 0 ? 0 : Math.floor(left / model.outputPrice);
}

export const BASE_SYSTEM_PROMPT =
  "You are a helpful assistant for university students, used through Polar AI. " +
  "Earlier assistant turns in this chat may come from a different model of the same family; treat them as the conversation so far.";

export function systemPrompt(modelLabel: string, projectName?: string, projectInstructions?: string): string {
  let s = `${BASE_SYSTEM_PROMPT}\nYou are ${modelLabel}.`;
  if (projectName) s += `\n\nThis chat is part of the student's project "${projectName}".`;
  if (projectInstructions?.trim()) s += `\nProject instructions from the student:\n${projectInstructions.trim()}`;
  return s;
}
