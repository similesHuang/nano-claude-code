import type Anthropic from "@anthropic-ai/sdk";

// ── 恢复策略类型 ──────────────────────────────────────────

export type RecoveryKind = "continue" | "compact" | "backoff" | "fail";

export interface RecoveryDecision {
  kind: RecoveryKind;
  reason: string;
}

export interface ErrorRecoveryConfig {
  maxRecoveryAttempts?: number;
  backoffBaseDelay?: number;
  backoffMaxDelay?: number;
}

// ── 默认常量 ─────────────────────────────────────────────

const DEFAULT_MAX_RECOVERY_ATTEMPTS = 3;
const DEFAULT_BACKOFF_BASE_DELAY = 1000;   // ms
const DEFAULT_BACKOFF_MAX_DELAY = 30000;   // ms

const CONTINUATION_MESSAGE =
  "Output limit hit. Continue directly from where you stopped — " +
  "no recap, no repetition. Pick up mid-sentence if needed.";

// ── 策略选择（纯函数，仅用于 API 异常分类） ──────────────

export function chooseRecovery(errorText: string): RecoveryDecision {
  const lower = errorText.toLowerCase();

  if (
    lower.includes("overlong_prompt") ||
    (lower.includes("prompt") && lower.includes("long"))
  ) {
    return { kind: "compact", reason: "context too large" };
  }

  if (
    ["timeout", "rate", "unavailable", "connection", "econnreset", "socket"]
      .some((w) => lower.includes(w))
  ) {
    return { kind: "backoff", reason: "transient transport failure" };
  }

  return { kind: "fail", reason: "unknown or non-recoverable error" };
}

// ── ErrorRecovery 类 ─────────────────────────────────────
//
// 职责分两层，对应 Python 参考代码的两层循环：
//
//   callWithRetry   — 内层 for：处理 API 调用异常（compact / backoff）
//   handleMaxTokens — 外层状态检查：处理 max_tokens 续写
//
// agentLoop 调用示意：
//   while (...) {
//     response = errorRecovery.callWithRetry(callFn, messages, compactFn)
//     if (!response) break
//     if (errorRecovery.handleMaxTokens(response, messages)) continue
//     // 正常工具处理 ...
//   }

export class ErrorRecovery {
  private readonly maxAttempts: number;
  private readonly baseDelay: number;
  private readonly maxDelay: number;

  /** max_tokens 连续恢复计数，非 max_tokens 成功后归零 */
  private continueCount = 0;

  constructor(config: ErrorRecoveryConfig = {}) {
    this.maxAttempts = config.maxRecoveryAttempts ?? DEFAULT_MAX_RECOVERY_ATTEMPTS;
    this.baseDelay = config.backoffBaseDelay ?? DEFAULT_BACKOFF_BASE_DELAY;
    this.maxDelay = config.backoffMaxDelay ?? DEFAULT_BACKOFF_MAX_DELAY;
  }

  // ── 内层：API 调用重试（compact / backoff） ─────────────

  /**
   * 带重试地发起 API 调用。
   * 成功立即返回 response；异常根据类型 compact 或 backoff 后重试。
   * 重试耗尽返回 null。
   */
  async callWithRetry(
    callFn: () => Promise<Anthropic.Message>,
    messages: Anthropic.MessageParam[],
    compactFn: (msgs: Anthropic.MessageParam[]) => Promise<Anthropic.MessageParam[]>,
  ): Promise<Anthropic.Message | null> {
    let hasCompacted = false;
    for (let attempt = 0; attempt <= this.maxAttempts; attempt++) {
      try {
        return await callFn(); // 成功 → 直接返回
      } catch (error) {
        const errorText = error instanceof Error ? error.message : String(error);
        const decision = chooseRecovery(errorText);

        if (decision.kind === "compact") {
          if (hasCompacted) {
            // 已经 compact 过仍然 overlong，熔断
            this.continueCount = 0;
            return null;
          }
          const compacted = await compactFn(messages);
          messages.length = 0;
          messages.push(...compacted);
          hasCompacted = true;
          continue; // compact 后重试
        }

        if (decision.kind === "backoff" && attempt < this.maxAttempts) {
          await sleep(this.computeBackoff(attempt));
          continue; // 退避后重试
        }

        // fail 或重试耗尽
        this.continueCount = 0;
        return null;
      }
    }

    this.continueCount = 0;
    return null;
  }

  // ── 外层：max_tokens 续写检查 ───────────────────────────

  /**
   * 检查响应是否因 max_tokens 被截断，若是则注入续写消息。
   * @returns true — 需要 continue 重新调用 API；false — 正常流转
   */
  handleMaxTokens(
    response: Anthropic.Message,
    messages: Anthropic.MessageParam[],
  ): boolean {
    if (response.stop_reason !== "max_tokens") {
      this.continueCount = 0;
      return false;
    }

    this.continueCount++;
    if (this.continueCount > this.maxAttempts) {
      return false; // 续写次数耗尽，让上层按现有内容处理
    }

    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: CONTINUATION_MESSAGE });
    return true;
  }

  // ── 内部工具 ───────────────────────────────────────────

  private computeBackoff(attempt: number): number {
    const delay = Math.min(this.baseDelay * 2 ** attempt, this.maxDelay);
    const jitter = Math.random() * this.baseDelay * 0.5;
    return delay + jitter;
  }
}

// ── 辅助 ─────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
