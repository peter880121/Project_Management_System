"use client";

export class UserRequestError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
export async function sendUserMutation(url: string, method: "POST" | "PATCH", body: unknown) {
  let response: Response;
  try {
    response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch { throw new UserRequestError(0, "无法确认操作结果，请刷新列表确认后再重试"); }
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string" ? payload.error : "操作失败，请重试";
    throw new UserRequestError(response.status, message);
  }
}
