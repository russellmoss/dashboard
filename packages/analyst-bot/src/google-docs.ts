// packages/analyst-bot/src/google-docs.ts
// ============================================================================
// Google Docs + Drive client for report generation
// ============================================================================
//
// Auth: JWT with service account from GOOGLE_DOCS_CREDENTIALS_JSON env var.
// The private key stored in Cloud Run env vars has literal "\n" (two chars)
// that must be replaced with actual newline chars before JWT construction.
//
// KEY GOTCHAS (from exploration-results.md):
// - Use endOfSegmentLocation: {} to append at end of doc (avoids index tracking)
// - updateParagraphStyle REQUIRES fields: 'namedStyleType' — omitting causes 400
// - Table cell population must be done bottom-up (sort by index descending)
// - InsertInlineImage requires a publicly-accessible URI
// - After uploading chart to Drive, create anyone/reader permission before embed

import { google, docs_v1, drive_v3 } from 'googleapis';

let docsClient: docs_v1.Docs | null = null;
let driveClient: drive_v3.Drive | null = null;

/**
 * Parse credentials from GOOGLE_DOCS_CREDENTIALS_JSON env var and build a JWT.
 * Uses google.auth.JWT (not direct google-auth-library import) for type compatibility.
 */
function getAuth(): InstanceType<typeof google.auth.JWT> {
  const credsJson = process.env.GOOGLE_DOCS_CREDENTIALS_JSON;
  if (!credsJson) {
    throw new Error('GOOGLE_DOCS_CREDENTIALS_JSON is not set');
  }

  const creds = JSON.parse(credsJson);

  // CRITICAL: Cloud Run stores \n as literal two characters in env vars.
  // Must replace before passing to JWT constructor.
  const privateKey = creds.private_key.replace(/\\n/g, '\n');

  return new google.auth.JWT({
    email: creds.client_email,
    key: privateKey,
    scopes: [
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/drive',
    ],
  });
}

function getDocs(): docs_v1.Docs {
  if (!docsClient) {
    docsClient = google.docs({ version: 'v1', auth: getAuth() });
  }
  return docsClient;
}

function getDrive(): drive_v3.Drive {
  if (!driveClient) {
    driveClient = google.drive({ version: 'v3', auth: getAuth() });
  }
  return driveClient;
}

// Root Google Drive folder for all analyst bot reports
const REPORTS_ROOT_FOLDER_ID = '1Gxyv3Ce70IMiTB9Vxg_2ZDKfoIMktT65';

/**
 * Find or create a per-user subfolder under the reports root folder.
 * Pattern copied from src/app/api/sqo-lag-export/route.ts — same SA, same approach.
 * Caches folder IDs in-memory to avoid repeated Drive API calls.
 */
const userFolderCache = new Map<string, string>();

async function getOrCreateUserFolder(userName: string): Promise<string> {
  const cached = userFolderCache.get(userName);
  if (cached) return cached;

  try {
    const drive = getDrive();
    // Search for existing folder by name
    const search = await drive.files.list({
      q: `name='${userName.replace(/'/g, "\\'")}' and '${REPORTS_ROOT_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id,name)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    if (search.data.files && search.data.files.length > 0) {
      const folderId = search.data.files[0].id!;
      userFolderCache.set(userName, folderId);
      return folderId;
    }

    // Create new subfolder
    const folder = await drive.files.create({
      requestBody: {
        name: userName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [REPORTS_ROOT_FOLDER_ID],
      },
      supportsAllDrives: true,
    });
    const folderId = folder.data.id!;
    userFolderCache.set(userName, folderId);
    return folderId;
  } catch (err) {
    console.error(`[google-docs] Failed to create user folder for ${userName}:`, (err as Error).message);
    return REPORTS_ROOT_FOLDER_ID; // fallback to root folder
  }
}

/**
 * Create a new Google Doc in the user's subfolder. Returns the doc ID and URL.
 *
 * CRITICAL: Must use drive.files.create with parents:[folderId], NOT
 * docs.documents.create — the SA has zero Drive storage quota, so creating
 * docs in the SA's root Drive fails with "quota exceeded". Creating directly
 * in a shared folder bypasses this limitation.
 */
export async function createDoc(
  title: string,
  userName: string
): Promise<{ docId: string; docUrl: string }> {
  try {
    const drive = getDrive();
    const folderId = await getOrCreateUserFolder(userName);

    const res = await drive.files.create({
      requestBody: {
        name: title,
        mimeType: 'application/vnd.google-apps.document',
        parents: [folderId],
      },
      supportsAllDrives: true,
      fields: 'id,webViewLink',
    });
    const docId = res.data.id!;
    const docUrl = res.data.webViewLink ?? `https://docs.google.com/document/d/${docId}/edit`;
    return { docId, docUrl };
  } catch (err) {
    throw new Error(`[google-docs] Failed to create doc: ${(err as Error).message}`);
  }
}

/**
 * Append a heading to the end of the document.
 * Uses endOfSegmentLocation to avoid manual index tracking.
 */
export async function appendHeading(
  docId: string,
  text: string,
  level: 1 | 2 | 3 = 1
): Promise<void> {
  try {
    const docs = getDocs();

    // First, insert the text at the end of the document
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [
          {
            insertText: {
              endOfSegmentLocation: {},
              text: text + '\n',
            },
          },
        ],
      },
    });

    // Fetch the document to find the index of the text we just inserted
    const doc = await docs.documents.get({ documentId: docId });
    const body = doc.data.body?.content ?? [];
    const lastElement = body[body.length - 2]; // -2 because last is always empty paragraph
    if (!lastElement?.startIndex) return;

    const namedStyleMap: Record<number, string> = {
      1: 'HEADING_1',
      2: 'HEADING_2',
      3: 'HEADING_3',
    };

    // Apply heading style to the paragraph we just inserted
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [
          {
            updateParagraphStyle: {
              range: {
                startIndex: lastElement.startIndex,
                endIndex: lastElement.endIndex! - 1,
              },
              paragraphStyle: {
                namedStyleType: namedStyleMap[level] ?? 'HEADING_1',
              },
              fields: 'namedStyleType', // REQUIRED — omitting causes 400 error
            },
          },
        ],
      },
    });
  } catch (err) {
    console.error(`[google-docs] appendHeading failed:`, (err as Error).message);
    throw err;
  }
}

/**
 * Append a paragraph of plain text to the end of the document.
 */
export async function appendParagraph(docId: string, text: string): Promise<void> {
  if (!text || !text.trim()) return; // Docs API rejects empty insertText
  try {
    const docs = getDocs();
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [
          {
            insertText: {
              endOfSegmentLocation: {},
              text: text + '\n\n',
            },
          },
        ],
      },
    });
  } catch (err) {
    console.error(`[google-docs] appendParagraph failed:`, (err as Error).message);
    throw err;
  }
}

/**
 * Append a table to the end of the document.
 *
 * CRITICAL: Table cell population must be done bottom-up (sort by index descending).
 * After inserting an empty table, we fetch the doc to get the cell indices, then
 * populate cells from the last row/cell to the first. This prevents index shifts
 * from invalidating subsequent insertions.
 */
export async function appendTable(
  docId: string,
  headers: string[],
  rows: string[][]
): Promise<void> {
  if (headers.length === 0) return;

  try {
    const docs = getDocs();
    const numRows = rows.length + 1; // +1 for header row
    const numCols = headers.length;

    // Insert an empty table at the end of the document
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [
          {
            insertTable: {
              endOfSegmentLocation: {},
              rows: numRows,
              columns: numCols,
            },
          },
        ],
      },
    });

    // Fetch the document to find the table's cell indices
    const doc = await docs.documents.get({ documentId: docId });
    const body = doc.data.body?.content ?? [];

    // Find the last table in the document (the one we just inserted)
    let table: docs_v1.Schema$Table | null = null;
    for (let i = body.length - 1; i >= 0; i--) {
      if (body[i].table) {
        table = body[i].table!;
        break;
      }
    }
    if (!table || !table.tableRows) return;

    // Build cell insertions — MUST be sorted by index descending (bottom-up)
    // to prevent index shifts from invalidating subsequent insertions
    const insertions: Array<{ index: number; text: string }> = [];

    // Header row (row 0)
    for (let c = 0; c < numCols; c++) {
      const cell = table.tableRows[0]?.tableCells?.[c];
      const idx = cell?.content?.[0]?.startIndex;
      if (idx != null) {
        insertions.push({ index: idx, text: headers[c] ?? '' });
      }
    }

    // Data rows
    for (let r = 0; r < rows.length; r++) {
      const tableRow = table.tableRows[r + 1]; // +1 to skip header
      if (!tableRow?.tableCells) continue;
      for (let c = 0; c < numCols; c++) {
        const cell = tableRow.tableCells[c];
        const idx = cell?.content?.[0]?.startIndex;
        if (idx != null) {
          insertions.push({ index: idx, text: rows[r][c] ?? '' });
        }
      }
    }

    // Sort by index DESCENDING — bottom-up to prevent index shift corruption
    // Filter out empty text — Docs API rejects insertText with empty string
    const nonEmpty = insertions.filter((ins) => ins.text.length > 0);
    nonEmpty.sort((a, b) => b.index - a.index);

    // Batch insert all cell contents
    if (nonEmpty.length > 0) {
      await docs.documents.batchUpdate({
        documentId: docId,
        requestBody: {
          requests: nonEmpty.map((ins) => ({
            insertText: {
              location: { index: ins.index },
              text: ins.text,
            },
          })),
        },
      });
    }

    // Bold the header row
    const headerRow = table.tableRows[0];
    if (headerRow?.tableCells) {
      // Re-fetch doc since indices shifted after insertions
      const updated = await docs.documents.get({ documentId: docId });
      const updatedBody = updated.data.body?.content ?? [];
      let updatedTable: docs_v1.Schema$Table | null = null;
      for (let i = updatedBody.length - 1; i >= 0; i--) {
        if (updatedBody[i].table) {
          updatedTable = updatedBody[i].table!;
          break;
        }
      }
      if (updatedTable?.tableRows?.[0]?.tableCells) {
        const hRow = updatedTable.tableRows[0];
        const startIdx = hRow.tableCells![0]?.content?.[0]?.startIndex;
        const endCell = hRow.tableCells![hRow.tableCells!.length - 1];
        const endIdx = endCell?.content?.[endCell.content!.length - 1]?.endIndex;
        if (startIdx != null && endIdx != null) {
          await docs.documents.batchUpdate({
            documentId: docId,
            requestBody: {
              requests: [{
                updateTextStyle: {
                  range: { startIndex: startIdx, endIndex: endIdx },
                  textStyle: { bold: true },
                  fields: 'bold',
                },
              }],
            },
          });
        }
      }
    }
  } catch (err) {
    console.error(`[google-docs] appendTable failed:`, (err as Error).message);
    throw err;
  }
}

/**
 * Upload a chart PNG to Google Drive, make it publicly readable, embed it in the
 * doc via InsertInlineImage, then delete the temp Drive file.
 *
 * InsertInlineImage requires a publicly-accessible URI (Docs API fetches server-side).
 * We create an anyone/reader permission on the temp Drive file, use the direct
 * download URL for embedding, then clean up the temp file.
 */
export async function embedChartImage(docId: string, chartBuffer: Buffer): Promise<void> {
  let tempFileId: string | null = null;

  try {
    const drive = getDrive();
    const docs = getDocs();

    // 1. Upload chart PNG to Drive as a temp file
    const { Readable } = require('stream');
    const stream = new Readable();
    stream.push(chartBuffer);
    stream.push(null);

    const uploadRes = await drive.files.create({
      requestBody: {
        name: `chart_${Date.now()}.png`,
        mimeType: 'image/png',
        parents: [REPORTS_ROOT_FOLDER_ID], // Upload to shared folder to bypass SA storage quota
      },
      media: {
        mimeType: 'image/png',
        body: stream,
      },
      supportsAllDrives: true,
      fields: 'id',
    });
    tempFileId = uploadRes.data.id!;

    // 2. Make the file publicly readable (required for InsertInlineImage)
    await drive.permissions.create({
      fileId: tempFileId,
      requestBody: {
        type: 'anyone',
        role: 'reader',
      },
      supportsAllDrives: true,
    });

    // 3. Build the direct download URL
    const imageUri = `https://drive.google.com/uc?export=download&id=${tempFileId}`;

    // 4. Insert the image at the end of the document
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [
          {
            insertInlineImage: {
              endOfSegmentLocation: {},
              uri: imageUri,
              objectSize: {
                width: { magnitude: 500, unit: 'PT' },
                height: { magnitude: 312, unit: 'PT' }, // 800x500 aspect ratio
              },
            },
          },
          {
            insertText: {
              endOfSegmentLocation: {},
              text: '\n',
            },
          },
        ],
      },
    });
  } catch (err) {
    console.error(`[google-docs] embedChartImage failed:`, (err as Error).message);
    // Don't throw — chart embed failure should not block the entire report
  } finally {
    // 5. Delete the temp Drive file (cleanup)
    if (tempFileId) {
      try {
        const drive = getDrive();
        await drive.files.delete({ fileId: tempFileId, supportsAllDrives: true });
      } catch (cleanupErr) {
        console.error(`[google-docs] Failed to clean up temp chart file ${tempFileId}:`, (cleanupErr as Error).message);
      }
    }
  }
}

/**
 * Share a Google Doc with a user (writer access).
 * Uses Drive permissions API. Sends email notification by default.
 */
export async function shareDoc(docId: string, email: string): Promise<void> {
  try {
    const drive = getDrive();
    await drive.permissions.create({
      fileId: docId,
      requestBody: {
        type: 'user',
        role: 'writer',
        emailAddress: email,
      },
      supportsAllDrives: true,
      sendNotificationEmail: false,
    });
  } catch (err) {
    console.error(`[google-docs] shareDoc failed for ${email}:`, (err as Error).message);
    // Don't throw — sharing failure should not block the report. User can request access.
  }
}
