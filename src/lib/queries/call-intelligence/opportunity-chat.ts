import { getCoachingPool } from '@/lib/coachingDb';
import type {
  OpportunityChatThread,
  OpportunityChatThreadSummary,
  OpportunityChatMessage,
  KbChunkForChat,
} from '@/types/call-intelligence-opportunities';
import { PredictionServiceClient, helpers } from '@google-cloud/aiplatform';

// ---------------------------------------------------------------------------
// Vertex AI Embedding
// ---------------------------------------------------------------------------

const GCP_PROJECT = process.env.GCP_PROJECT_ID || '';
const GCP_LOCATION = process.env.VERTEX_AI_LOCATION || 'us-central1';
const EMBEDDING_MODEL = 'text-embedding-004';
const EMBEDDING_ENDPOINT = `projects/${GCP_PROJECT}/locations/${GCP_LOCATION}/publishers/google/models/${EMBEDDING_MODEL}`;

let predictionClient: PredictionServiceClient | null = null;

function getPredictionClient(): PredictionServiceClient {
  if (!predictionClient) {
    predictionClient = new PredictionServiceClient({
      apiEndpoint: `${GCP_LOCATION}-aiplatform.googleapis.com`,
    });
  }
  return predictionClient;
}

export async function embedQueryText(text: string): Promise<number[]> {
  const client = getPredictionClient();
  const instance = helpers.toValue({
    content: text,
    task_type: 'RETRIEVAL_QUERY',
  });
  const [response] = await client.predict({
    endpoint: EMBEDDING_ENDPOINT,
    instances: [instance!],
  });
  const embedding = response.predictions?.[0]?.structValue?.fields?.embeddings
    ?.structValue?.fields?.values?.listValue?.values?.map(
      (v) => v.numberValue ?? 0
    );
  if (!embedding || embedding.length !== 768) {
    throw new Error(`Unexpected embedding dimension: ${embedding?.length}`);
  }
  return embedding;
}

// ---------------------------------------------------------------------------
// Thread operations
// ---------------------------------------------------------------------------

function mapThreadRow(row: {
  id: string;
  title: string | null;
  call_note_ids_hash: string;
  last_message_at: string | null;
  created_at: string;
}): OpportunityChatThread {
  return {
    id: row.id,
    title: row.title,
    callNoteIdsHash: row.call_note_ids_hash,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
  };
}

export async function getThreadById(
  threadId: string,
  sfdcOpportunityId: string,
  userEmail: string,
): Promise<OpportunityChatThread | null> {
  const pool = getCoachingPool();
  const { rows } = await pool.query<{
    id: string;
    title: string | null;
    call_note_ids_hash: string;
    last_message_at: string | null;
    created_at: string;
  }>(
    `SELECT id, title, call_note_ids_hash, last_message_at, created_at
     FROM opportunity_chat_threads
     WHERE id = $1 AND sfdc_opportunity_id = $2 AND user_email = $3`,
    [threadId, sfdcOpportunityId, userEmail],
  );
  return rows[0] ? mapThreadRow(rows[0]) : null;
}

export async function getMostRecentThread(
  sfdcOpportunityId: string,
  userEmail: string,
): Promise<OpportunityChatThread | null> {
  const pool = getCoachingPool();
  const { rows } = await pool.query<{
    id: string;
    title: string | null;
    call_note_ids_hash: string;
    last_message_at: string | null;
    created_at: string;
  }>(
    `SELECT id, title, call_note_ids_hash, last_message_at, created_at
     FROM opportunity_chat_threads
     WHERE sfdc_opportunity_id = $1 AND user_email = $2
     ORDER BY COALESCE(last_message_at, created_at) DESC
     LIMIT 1`,
    [sfdcOpportunityId, userEmail],
  );
  return rows[0] ? mapThreadRow(rows[0]) : null;
}

export async function createThread(
  sfdcOpportunityId: string,
  userEmail: string,
): Promise<OpportunityChatThread> {
  const pool = getCoachingPool();
  const { rows } = await pool.query<{
    id: string;
    title: string | null;
    call_note_ids_hash: string;
    last_message_at: string | null;
    created_at: string;
  }>(
    `INSERT INTO opportunity_chat_threads (id, sfdc_opportunity_id, user_email)
     VALUES (gen_random_uuid(), $1, $2)
     RETURNING id, title, call_note_ids_hash, last_message_at, created_at`,
    [sfdcOpportunityId, userEmail],
  );
  return mapThreadRow(rows[0]);
}

export async function getOrCreateThread(
  sfdcOpportunityId: string,
  userEmail: string,
): Promise<OpportunityChatThread> {
  const existing = await getMostRecentThread(sfdcOpportunityId, userEmail);
  if (existing) return existing;
  return createThread(sfdcOpportunityId, userEmail);
}

export async function listThreads(
  sfdcOpportunityId: string,
  userEmail: string,
): Promise<OpportunityChatThreadSummary[]> {
  const pool = getCoachingPool();
  const { rows } = await pool.query<{
    id: string;
    title: string | null;
    last_message_at: string | null;
    created_at: string;
    message_count: string;
  }>(
    `SELECT t.id, t.title, t.last_message_at, t.created_at,
            COUNT(m.id)::text AS message_count
     FROM opportunity_chat_threads t
     LEFT JOIN opportunity_chat_messages m ON m.thread_id = t.id
     WHERE t.sfdc_opportunity_id = $1 AND t.user_email = $2
     GROUP BY t.id
     ORDER BY COALESCE(t.last_message_at, t.created_at) DESC`,
    [sfdcOpportunityId, userEmail],
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    lastMessageAt: r.last_message_at,
    createdAt: r.created_at,
    messageCount: parseInt(r.message_count, 10),
  }));
}

export async function updateThreadTitle(
  threadId: string,
  title: string,
): Promise<void> {
  const pool = getCoachingPool();
  await pool.query(
    `UPDATE opportunity_chat_threads SET title = $1 WHERE id = $2`,
    [title, threadId],
  );
}

export async function updateThreadHash(
  threadId: string,
  hash: string,
): Promise<void> {
  const pool = getCoachingPool();
  await pool.query(
    `UPDATE opportunity_chat_threads
     SET call_note_ids_hash = $1, last_message_at = NOW()
     WHERE id = $2`,
    [hash, threadId],
  );
}

// ---------------------------------------------------------------------------
// Message operations
// ---------------------------------------------------------------------------

export async function getChatMessages(
  threadId: string,
): Promise<OpportunityChatMessage[]> {
  const pool = getCoachingPool();
  const { rows } = await pool.query<{
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    cited_chunk_ids: string[];
    created_at: string;
  }>(
    `SELECT id, role, content, cited_chunk_ids, created_at
     FROM opportunity_chat_messages
     WHERE thread_id = $1
     ORDER BY created_at ASC`,
    [threadId],
  );
  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    citedChunkIds: r.cited_chunk_ids ?? [],
    createdAt: r.created_at,
  }));
}

export async function getMessageCount(threadId: string): Promise<number> {
  const pool = getCoachingPool();
  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM opportunity_chat_messages WHERE thread_id = $1`,
    [threadId],
  );
  return parseInt(rows[0].count, 10);
}

export async function saveMessage(
  threadId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  citedChunkIds: string[] = [],
): Promise<string> {
  const pool = getCoachingPool();
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO opportunity_chat_messages (id, thread_id, role, content, cited_chunk_ids)
     VALUES (gen_random_uuid(), $1, $2, $3, $4::uuid[])
     RETURNING id`,
    [threadId, role, content, citedChunkIds],
  );
  return rows[0].id;
}

// ---------------------------------------------------------------------------
// KB RAG Search
// ---------------------------------------------------------------------------

export async function searchKbChunksForChat(
  queryEmbedding: number[],
  topK: number = 5,
): Promise<KbChunkForChat[]> {
  const pool = getCoachingPool();
  const vectorLiteral = `[${queryEmbedding.join(',')}]`;
  const { rows } = await pool.query<{
    id: string;
    body_text: string;
    doc_id: string;
    drive_file_id: string;
    distance: number;
  }>(
    `SELECT id, body_text, doc_id, drive_file_id,
            embedding <=> $1::vector AS distance
     FROM knowledge_base_chunks
     WHERE is_active = true
       AND chunk_type = ANY($2::text[])
       AND embedding <=> $1::vector < 0.5
     ORDER BY embedding <=> $1::vector
     LIMIT $3`,
    [vectorLiteral, ['fact', 'playbook'], topK],
  );
  return rows.map((r) => {
    const slug = (r.doc_id || '').split('/').pop() || r.doc_id || 'Unknown';
    const docTitle = slug
      .replace(/[_-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
    const driveUrl = r.drive_file_id
      ? `https://docs.google.com/document/d/${r.drive_file_id}/edit`
      : '';
    return {
      id: r.id,
      bodyText: r.body_text,
      docId: r.doc_id,
      driveFileId: r.drive_file_id,
      docTitle,
      driveUrl,
      distance: r.distance,
    };
  });
}
