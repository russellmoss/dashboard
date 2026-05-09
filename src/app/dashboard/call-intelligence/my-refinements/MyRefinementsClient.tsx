'use client';

import { MyRefinementsTable } from '@/components/call-intelligence/MyRefinementsTable';

interface Props {
  highlight: string | null;
}

export default function MyRefinementsClient({ highlight }: Props) {
  return <MyRefinementsTable highlightEvaluationId={highlight} />;
}
