// Pure-logic test for the bucket-matching helper exported from
// InsightsEvalDetailModal. The repo's jest config runs `node` environment
// only (no JSDOM/RTL), so the JSX render path can't be exercised here —
// the matching logic is the only piece worth asserting without setting up
// a full React testing stack.
import { isGapMatchingBucket } from '../bucket-match';

describe('isGapMatchingBucket', () => {
  it('matches when expected_source first two segments equal the bucket', () => {
    expect(isGapMatchingBucket(
      { expected_source: 'profile/ideal-candidate-profile/age-bands' },
      'profile/ideal-candidate-profile',
      'kb_path',
    )).toBe(true);
  });

  it('does not match when first two segments differ', () => {
    expect(isGapMatchingBucket(
      { expected_source: 'playbook/sga-discovery/x' },
      'profile/ideal-candidate-profile',
      'kb_path',
    )).toBe(false);
  });

  it('matches Uncategorized when expected_source has no slash (council C3)', () => {
    expect(isGapMatchingBucket(
      { expected_source: 'profile' },
      'Uncategorized',
      'uncategorized',
    )).toBe(true);
  });

  it('matches Uncategorized when expected_source is missing entirely', () => {
    expect(isGapMatchingBucket(
      {},
      'Uncategorized',
      'uncategorized',
    )).toBe(true);
  });

  it('matches Uncategorized when expected_source is empty string', () => {
    expect(isGapMatchingBucket(
      { expected_source: '' },
      'Uncategorized',
      'uncategorized',
    )).toBe(true);
  });

  it('returns false for kb_topic buckets (deferral side — no highlight on gaps)', () => {
    expect(isGapMatchingBucket(
      { expected_source: 'profile/ideal-candidate-profile/x' },
      'revenue_split',
      'kb_topic',
    )).toBe(false);
  });

  it('returns false when bucket is empty', () => {
    expect(isGapMatchingBucket(
      { expected_source: 'profile/ideal-candidate-profile' },
      '',
      'kb_path',
    )).toBe(false);
  });

  it('returns false when bucketKind is undefined', () => {
    expect(isGapMatchingBucket(
      { expected_source: 'profile/ideal-candidate-profile' },
      'profile/ideal-candidate-profile',
      undefined,
    )).toBe(false);
  });

  it('non-Uncategorized bucket does NOT match a single-segment expected_source', () => {
    // Single-segment maps to 'Uncategorized' per SQL CASE; should not match
    // an arbitrary kb_path bucket.
    expect(isGapMatchingBucket(
      { expected_source: 'profile' },
      'profile/ideal-candidate-profile',
      'kb_path',
    )).toBe(false);
  });
});
