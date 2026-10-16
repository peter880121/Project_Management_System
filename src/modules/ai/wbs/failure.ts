import { ZodError } from "zod";

export type WbsFailureCode = "LLM_CONFIGURATION_MISSING_OR_INVALID" | "MODEL_TIMEOUT" | "MODEL_AUTH_FAILED" | "MODEL_RATE_LIMIT" | "MODEL_RESPONSE_INVALID" | "MODEL_REQUEST_FAILED";
export class WbsResponseError extends Error {}
export class WbsTimeoutError extends Error {}
export function classifyWbsFailure(error: unknown): WbsFailureCode {
  if (error instanceof ZodError || error instanceof SyntaxError || error instanceof WbsResponseError) return "MODEL_RESPONSE_INVALID";
  if (error instanceof WbsTimeoutError || error instanceof Error && ["AbortError", "TimeoutError", "APIConnectionTimeoutError"].includes(error.name)) return "MODEL_TIMEOUT";
  if (error && typeof error === "object" && "status" in error) {
    if (error.status === 401 || error.status === 403) return "MODEL_AUTH_FAILED";
    if (error.status === 429) return "MODEL_RATE_LIMIT";
  }
  return "MODEL_REQUEST_FAILED";
}
export function wbsFailureMessage(code?: WbsFailureCode): string {
  const messages: Record<WbsFailureCode, string> = {
    LLM_CONFIGURATION_MISSING_OR_INVALID: "AI 模型配置缺失或无效，请检查模型与凭据配置后重试。",
    MODEL_TIMEOUT: "AI 生成超时，请缩小需求范围后重试，或先手动创建任务。",
    MODEL_AUTH_FAILED: "AI 服务认证失败，请检查模型服务凭据与访问权限。",
    MODEL_RATE_LIMIT: "AI 服务当前限流，请稍后重试。",
    MODEL_RESPONSE_INVALID: "AI 返回的任务结构未通过校验，自动纠正后仍未成功。请缩小拆解范围后重试，或手动创建任务。",
    MODEL_REQUEST_FAILED: "AI 模型请求失败，请检查服务连接与模型配置后重试，或手动创建任务。",
  };
  return messages[code ?? "MODEL_REQUEST_FAILED"];
}
