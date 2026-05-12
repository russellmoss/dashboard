/** Mirror of the Phase 2E SQL CASE bucket logic so the eval-detail modal's
 *  match highlight agrees with the cluster query. Single-segment expected_source
 *  values bucket to 'Uncategorized'; otherwise the first two slash-segments. */
export function isGapMatchingBucket(
  gap: { expected_source?: string },
  bucket: string,
  bucketKind: 'kb_path' | 'kb_topic' | 'uncategorized' | undefined,
): boolean {
  if (!bucket || (bucketKind !== 'kb_path' && bucketKind !== 'uncategorized')) return false;
  const src = gap.expected_source ?? '';
  if (!src || !src.includes('/')) {
    return bucket === 'Uncategorized';
  }
  const twoSeg = src.split('/').slice(0, 2).join('/');
  return twoSeg === bucket;
}

export function sortGapsByMatchFirst<T extends { expected_source?: string }>(
  gaps: T[],
  bucket: string,
  bucketKind: 'kb_path' | 'kb_topic' | 'uncategorized' | undefined,
): T[] {
  return [...gaps].sort((a, b) => {
    const am = isGapMatchingBucket(a, bucket, bucketKind) ? 0 : 1;
    const bm = isGapMatchingBucket(b, bucket, bucketKind) ? 0 : 1;
    return am - bm;
  });
}
