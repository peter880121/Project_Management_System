import { OpenAIEmbeddings } from "@langchain/openai";
import { TASK_HISTORY_EMBEDDING_DIMENSION } from "@/modules/vector/task-history";

let embeddings: OpenAIEmbeddings | undefined;

function getEmbeddings(): OpenAIEmbeddings {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required for task-history embeddings");
  embeddings ??= new OpenAIEmbeddings({
    model: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
    dimensions: TASK_HISTORY_EMBEDDING_DIMENSION,
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 15_000,
    maxRetries: 1,
  });
  return embeddings;
}

export async function embedTaskText(text: string): Promise<number[]> {
  const vector = await getEmbeddings().embedQuery(text);
  if (vector.length !== TASK_HISTORY_EMBEDDING_DIMENSION || vector.some((value) => !Number.isFinite(value))) {
    throw new Error("Embedding provider returned an invalid 1536-dimension vector");
  }
  return vector;
}
