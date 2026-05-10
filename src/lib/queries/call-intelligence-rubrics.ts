import { getCoachingPool } from '@/lib/coachingDb';
import type { RubricListRow } from '@/types/call-intelligence';
import type {
  RubricRoleT,
  RubricStatusT,
  RubricDimensionDefT,
} from '@/lib/sales-coaching-client/schemas';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RawRubricRow {
  id: string;
  name: string;
  role: RubricRoleT;
  version: number;
  edit_version: number;
  status: RubricStatusT;
  dimensions: RubricDimensionDefT[];
  created_by: string;
  created_by_name: string;
  created_by_is_system: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

/**
 * Listing query for the Rubrics tab. Joins reps for created_by_name + flag for
 * the system-rubric Edit→View lock. Defense-in-depth COALESCE on dimensions
 * even though the column is JSONB NOT NULL upstream.
 */
export async function getRubricsForList(
  filter: { role?: RubricRoleT; status?: RubricStatusT } = {},
): Promise<RubricListRow[]> {
  const pool = getCoachingPool();
  const params: unknown[] = [];
  const where: string[] = [];

  if (filter.role) {
    params.push(filter.role);
    where.push(`rubrics.role = $${params.length}`);
  }
  if (filter.status) {
    params.push(filter.status);
    where.push(`rubrics.status = $${params.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // LEFT JOIN reps without is_system filter so seed rubrics (created_by → system rep)
  // can still surface their COALESCE'd 'System' label. UI uses created_by_is_system
  // to drive the Edit→View lock.
  const sql = `
    SELECT
      rubrics.id,
      rubrics.name,
      rubrics.role,
      rubrics.version,
      rubrics.edit_version,
      rubrics.status,
      COALESCE(rubrics.dimensions, '[]'::jsonb) AS dimensions,
      rubrics.created_by,
      COALESCE(r.full_name, 'System') AS created_by_name,
      COALESCE(r.is_system, true) AS created_by_is_system,
      rubrics.created_at,
      rubrics.updated_at
    FROM rubrics
    LEFT JOIN reps r ON r.id = rubrics.created_by
    ${whereSql}
    ORDER BY rubrics.role ASC, rubrics.version DESC
  `;

  const { rows } = await pool.query<RawRubricRow>(sql, params);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    role: row.role,
    version: row.version,
    edit_version: row.edit_version,
    status: row.status,
    dimensions: row.dimensions,
    created_by: row.created_by,
    created_by_name: row.created_by_name,
    created_by_is_system: row.created_by_is_system,
    created_at:
      row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updated_at:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  }));
}

/**
 * S5/Q4 helper — does this rubric have a system-managed creator?
 * Used by the editor server page to set readOnlyReason='system'.
 */
export async function isSystemRubric(rubricId: string): Promise<boolean> {
  if (!UUID_RE.test(rubricId)) return false;
  const pool = getCoachingPool();
  const { rows } = await pool.query<{ is_system: boolean }>(
    `SELECT COALESCE(r.is_system, true) AS is_system
       FROM rubrics
       LEFT JOIN reps r ON r.id = rubrics.created_by
      WHERE rubrics.id = $1`,
    [rubricId],
  );
  return rows[0]?.is_system === true;
}
