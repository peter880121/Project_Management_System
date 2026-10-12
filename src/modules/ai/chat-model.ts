import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";

export type LlmProvider = "openai" | "anthropic" | "google";

const DEFAULT_MODELS: Record<LlmProvider, string> = {
  openai: "gpt-4.1-mini",
  anthropic: "claude-sonnet-5",
  google: "gemini-3.8-flash",
};

export function getConfiguredLlm(): { model: BaseChatModel; provider: LlmProvider; modelName: string } {
  const configuredProvider = process.env.AI_PROVIDER || "openai";
  if (configuredProvider !== "openai" && configuredProvider !== "anthropic" && configuredProvider !== "google") {
    throw new Error("AI_PROVIDER must be openai, anthropic, or google");
  }
  const provider: LlmProvider = configuredProvider;
  const modelName = process.env.AI_MODEL || DEFAULT_MODELS[provider];
  if (provider === "openai") {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
    return { model: new ChatOpenAI({ model: modelName, apiKey: process.env.OPENAI_API_KEY, temperature: 0 }), provider, modelName };
  }
  if (provider === "anthropic") {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");
    return { model: new ChatAnthropic({ model: modelName, anthropicApiKey: process.env.ANTHROPIC_API_KEY, temperature: 0 }), provider, modelName };
  }
  if (!process.env.GOOGLE_API_KEY) throw new Error("GOOGLE_API_KEY is not configured");
  return { model: new ChatGoogleGenerativeAI({ model: modelName, apiKey: process.env.GOOGLE_API_KEY, temperature: 0 }), provider, modelName };
}
