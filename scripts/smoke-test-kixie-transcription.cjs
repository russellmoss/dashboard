/**
 * One-shot smoke test for the Kixie call transcription pipeline.
 *
 * Validates the end-to-end chain on a single real call BEFORE building the
 * production pipeline. If this works, the architecture is sound. If it
 * fails, we catch the failure mode now.
 *
 * Chain: Kixie mp3 URL → AssemblyAI (transcription + diarization) → Claude (10-section notes)
 *
 * Run:
 *   node scripts/smoke-test-kixie-transcription.cjs
 *
 * Inputs (env vars from .env):
 *   ASSEMBLYAI_API_KEY
 *   ANTHROPIC_API_KEY
 *
 * Outputs (in tmp/):
 *   smoke-test-assemblyai-raw.json — full AssemblyAI response
 *   smoke-test-transcript-diarized.txt — formatted Speaker A/B transcript
 *   smoke-test-claude-raw.json — full Claude response
 *   smoke-test-notes.md — final structured 10-section note doc
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk').default;

// ============================================================================
// CONFIG
// ============================================================================

const KIXIE_URL = 'https://calls.kixie.com/c7e13f67-3186-4328-ae0f-b890501994c9.mp3';
const TASK_ID = '00TVS00000mmlxH2AQ';
const FROM_PHONE = '+18479547157';
const TO_PHONE = '+18123441298';

const ASSEMBLYAI_KEY = process.env.ASSEMBLYAI_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = 'claude-sonnet-4-6';

if (!ASSEMBLYAI_KEY) { console.error('Missing ASSEMBLYAI_API_KEY in .env'); process.exit(1); }
if (!ANTHROPIC_KEY) { console.error('Missing ANTHROPIC_API_KEY in .env'); process.exit(1); }

const TMP_DIR = path.join(__dirname, '..', 'tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

// ============================================================================
// STEP 1 — Submit to AssemblyAI
// ============================================================================

async function submitTranscript() {
  log('Submitting to AssemblyAI…');
  const res = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: {
      authorization: ASSEMBLYAI_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      audio_url: KIXIE_URL,
      speaker_labels: true,
      language_detection: true,
      speech_models: ['universal-3-pro', 'universal-2'],
    }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`AssemblyAI submit failed: ${res.status} ${errBody}`);
  }
  const data = await res.json();
  log(`Submitted. Transcript ID: ${data.id}, status: ${data.status}`);
  return data.id;
}

async function pollUntilReady(transcriptId) {
  const start = Date.now();
  let lastStatus = null;
  while (true) {
    const res = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
      headers: { authorization: ASSEMBLYAI_KEY },
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`AssemblyAI poll failed: ${res.status} ${errBody}`);
    }
    const data = await res.json();
    if (data.status !== lastStatus) {
      const elapsed = Math.round((Date.now() - start) / 1000);
      log(`Status: ${data.status} (${elapsed}s elapsed)`);
      lastStatus = data.status;
    }
    if (data.status === 'completed') {
      const elapsed = Math.round((Date.now() - start) / 1000);
      log(`Transcription complete in ${elapsed}s.`);
      return data;
    }
    if (data.status === 'error') {
      throw new Error(`AssemblyAI error: ${data.error}`);
    }
    if (Date.now() - start > 30 * 60 * 1000) {
      throw new Error('Polling timeout (30 min)');
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

function formatDiarizedTranscript(transcript) {
  if (!transcript.utterances || transcript.utterances.length === 0) {
    return `[no diarization — utterances missing]\n\n${transcript.text || ''}`;
  }
  const lines = [];
  for (const u of transcript.utterances) {
    const ts = `[${formatTs(u.start)}-${formatTs(u.end)}]`;
    lines.push(`${ts} Speaker ${u.speaker}: ${u.text}`);
  }
  return lines.join('\n\n');
}

function formatTs(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ============================================================================
// STEP 2 — Generate notes via Claude
// ============================================================================

const SYSTEM_PROMPT = `You are an AI assistant generating structured note documents from sales discovery call transcripts. The notes are used by a Sales Growth Manager (SGM) at Savvy Wealth to handoff a financial advisor prospect for the next call in the recruiting funnel.

# Your Process

You will be given a diarized transcript with Speaker A and Speaker B labels. AssemblyAI does NOT know which speaker is the SGA (Savvy Wealth team member, the recruiter) and which is the Advisor (the prospect). You must work it out from context.

## Step 1 — Identify Speakers

Read the transcript and determine: which speaker is the SGA (asks recruiting questions, represents Savvy Wealth, asks about AUM/clients/firm) and which is the Advisor (answers with their book metrics, talks about their current firm, may complain about pain points).

Output a <speaker_map> block:
<speaker_map>
  <sga>Speaker A or B</sga>
  <advisor>Speaker A or B</advisor>
  <evidence>One sentence explaining why.</evidence>
</speaker_map>

## Step 2 — Extract Verbatim Quotes Containing Numbers

Before writing any note section, extract every sentence from the transcript that contains a number (AUM, fees, client counts, percentages, dates, ages, durations, money amounts). Do NOT paraphrase. Do NOT round. Do NOT change units. If a number appears as "around 25 million," capture it exactly as "around 25 million" — not "$25M".

Output a <quotes> block with one quote per line, attributed to SGA or Advisor.

## Step 3 — Classify Call Type

discovery | follow-up | scheduling | other

Output: <call_type>...</call_type>

## Step 4 — Generate Structured Note Doc

If call_type is "discovery": produce a 10-section note doc per the schema below, ≤2200 chars total. Numbers in any field MUST appear in your <quotes> block verbatim. If you can't find a number for a section in <quotes>, write "(not discussed)" — DO NOT fabricate.

If call_type is anything else: produce a 4-section light note doc: Summary | Key Points | Action Items | Next Steps. ≤1200 chars.

# Discovery Note Schema (10 sections)

1. **All 12 ICP Key Metrics** — background, current firm type, team structure, transferable AUM (NOT stated AUM), fee-based vs brokerage, avg fee/revenue, client count, client origin, PERs, move mindset, timeline. Numbers VERBATIM.
2. **Transferable AUM dig-ins** — clients moved before? relationships at the firm? checked contract for PERs? how were relationships developed?
3. **Client Origin** — referrals/firm-generated/inherited/internal channels? still relationship with prior advisor or WAS/SAN? personally sourced?
4. **Move Mindset** — decided or still feeling it out? talking to other firms? local RIA in mix?
5. **Catalyst & Pain Points** — catalyst for last move? has current firm met expectations? what would they change?
6. **What to Sell** — ONE dominant motivator (frustration / comp / growth / marketing / equity / book ownership). Anchor to a specific advisor quote.
7. **Where to Dig** — yellow/red signals. Specific concerns ("Transferable AUM is fuzzy — he said 25 but hadn't done the math" beats "AUM concerns").
8. **Disclosure Check** — flag any disclosures that surfaced; SGM may ask about them. Don't route to Compliance.
9. **Unprompted Questions** — questions the Advisor asked WITHOUT being prompted. Purer signal than solicited motivators.
10. **Next Steps / Action Items** — what does the SGM need to do on the follow-up call? What did the SGA promise to send/do?

# Critical Rules

- Numbers VERBATIM, anchored in <quotes>. If you write a number not in <quotes>, that's a hallucination and the note will be rejected.
- "Capture what the advisor said unprompted" requires speaker labels. If diarization seems wrong (SGA labeled as advisor), flag it in your <speaker_map> evidence.
- Ignore extended silence, hold music, automated phone tree menus, and pre-call/post-call dead air. Focus on substantive conversation.
- Output your full reasoning chain (speaker_map + quotes + call_type), THEN the structured note doc. No summary or preamble before <speaker_map>.
- Format the structured note as Markdown with ## headings and - bullets.`;

async function generateNotes(diarizedTranscript) {
  log('Sending to Claude for notes generation…');
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
  const start = Date.now();
  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4000,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: `Task ID: ${TASK_ID}\nFrom: ${FROM_PHONE}\nTo: ${TO_PHONE}\n\nDiarized transcript:\n\n${diarizedTranscript}`,
      },
    ],
  });
  const elapsed = Math.round((Date.now() - start) / 1000);
  log(`Claude responded in ${elapsed}s.`);
  log(`  input_tokens: ${response.usage.input_tokens}`);
  log(`  cache_creation_input_tokens: ${response.usage.cache_creation_input_tokens || 0}`);
  log(`  cache_read_input_tokens: ${response.usage.cache_read_input_tokens || 0}`);
  log(`  output_tokens: ${response.usage.output_tokens}`);
  return response;
}

// ============================================================================
// MAIN
// ============================================================================

(async () => {
  log('=== Kixie call transcription smoke test ===');
  log(`URL: ${KIXIE_URL}`);
  log(`Task: ${TASK_ID}`);

  // 1. AssemblyAI
  const transcriptId = await submitTranscript();
  const transcript = await pollUntilReady(transcriptId);

  fs.writeFileSync(
    path.join(TMP_DIR, 'smoke-test-assemblyai-raw.json'),
    JSON.stringify(transcript, null, 2)
  );
  log(`Saved AssemblyAI raw response to tmp/smoke-test-assemblyai-raw.json`);

  const diarized = formatDiarizedTranscript(transcript);
  fs.writeFileSync(
    path.join(TMP_DIR, 'smoke-test-transcript-diarized.txt'),
    diarized
  );
  log(`Saved diarized transcript to tmp/smoke-test-transcript-diarized.txt`);
  log(`  Audio duration: ${transcript.audio_duration}s`);
  log(`  Confidence: ${transcript.confidence}`);
  log(`  Word count: ${transcript.words?.length || 0}`);
  log(`  Utterances: ${transcript.utterances?.length || 0}`);
  log(`  Distinct speakers: ${new Set((transcript.utterances || []).map(u => u.speaker)).size}`);

  // 2. Claude
  const claudeResponse = await generateNotes(diarized);

  fs.writeFileSync(
    path.join(TMP_DIR, 'smoke-test-claude-raw.json'),
    JSON.stringify(claudeResponse, null, 2)
  );

  const notesText = claudeResponse.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n');

  fs.writeFileSync(
    path.join(TMP_DIR, 'smoke-test-notes.md'),
    notesText
  );
  log(`Saved notes to tmp/smoke-test-notes.md`);

  // 3. Cost calculation
  const audioSec = transcript.audio_duration;
  const audioHr = audioSec / 3600;
  const aaiCostCents = Math.ceil(audioHr * 17); // $0.17/hr Universal-2 + diarization
  const inputTokens = claudeResponse.usage.input_tokens;
  const cacheCreate = claudeResponse.usage.cache_creation_input_tokens || 0;
  const cacheRead = claudeResponse.usage.cache_read_input_tokens || 0;
  const outputTokens = claudeResponse.usage.output_tokens;
  // Sonnet 4.6: input $3/MTok, cache write $3.75/MTok, cache read $0.30/MTok, output $15/MTok
  const claudeCostCents =
    ((inputTokens * 3) + (cacheCreate * 3.75) + (cacheRead * 0.30) + (outputTokens * 15)) / 10000;

  log('=== Cost ===');
  log(`  AssemblyAI: $${(aaiCostCents / 100).toFixed(4)} (${audioSec}s = ${audioHr.toFixed(3)}hr)`);
  log(`  Claude: $${(claudeCostCents / 100).toFixed(4)}`);
  log(`  TOTAL: $${((aaiCostCents + claudeCostCents) / 100).toFixed(4)}`);

  log('=== Done. Inspect tmp/smoke-test-*.{json,txt,md} ===');
})().catch((err) => {
  console.error('SMOKE TEST FAILED:', err);
  process.exit(1);
});
