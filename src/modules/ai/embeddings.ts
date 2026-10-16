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
    encodingFormat: "float",
    configuration: process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : undefined,
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

export function documentEmbeddingModel() { return process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small"; }

/** Each chunk keeps its model name so retries cannot silently switch vector spaces. */
export async function embedDocumentText(text: string, model = documentEmbeddingModel()): Promise<number[]> {
  if (!process.env.OPENAI_API_KEY) throw new Error("Document embedding credentials are not configured");
  const client = new OpenAIEmbeddings({ model, dimensions: 1536, apiKey: process.env.OPENAI_API_KEY, timeout: 15_000, maxRetries: 0, encodingFormat: "float", configuration: process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : undefined });
  const vector = await client.embedQuery(text);
  if (vector.length !== 1536 || vector.some((value) => !Number.isFinite(value))) throw new Error("Invalid document embedding");
  return vector;
}
