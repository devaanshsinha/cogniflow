const EMBEDDING_ENDPOINT =
  process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
const TARGET_DIMENSION = Number.parseInt(
  process.env.EMBEDDING_DIM ?? "768",
  10,
);

export async function getQueryEmbedding(
  text: string,
): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const response = await fetch(`${EMBEDDING_ENDPOINT}/embeddings`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Embedding request failed (${response.status}): ${await response.text()}`,
    );
  }

  const json = (await response.json()) as {
    data: Array<{ embedding: number[] }>;
  };

  const embedding = json.data.at(0)?.embedding;
  if (!embedding) {
    throw new Error("Embedding response missing data");
  }

  return normalizeEmbedding(embedding);
}

function normalizeEmbedding(vector: number[]): number[] {
  if (!Number.isFinite(TARGET_DIMENSION) || TARGET_DIMENSION <= 0) {
    return vector;
  }
  if (vector.length === TARGET_DIMENSION) {
    return vector;
  }
  if (vector.length > TARGET_DIMENSION) {
    return vector.slice(0, TARGET_DIMENSION);
  }
  const padded = new Array(TARGET_DIMENSION).fill(0);
  for (let i = 0; i < vector.length; i += 1) {
    padded[i] = vector[i];
  }
  return padded;
}
