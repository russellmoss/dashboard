'use client';

import { ReactNode } from 'react';
import { ErrorBoundary } from './ErrorBoundary';

interface SectionErrorBoundaryProps {
  children: ReactNode;
  onReset?: () => void;
}

export function ChartErrorBoundary({ children, onReset }: SectionErrorBoundaryProps) {
  return (
    <ErrorBoundary
      fallbackTitle="Chart Failed to Load"
      fallbackMessage="There was a problem rendering this chart. This might be due to invalid data or a temporary issue. Click 'Try Again' to reload."
      onReset={onReset}
    >
      {children}
    </ErrorBoundary>
  );
}

export function TableErrorBoundary({ children, onReset }: SectionErrorBoundaryProps) {
  return (
    <ErrorBoundary
      fallbackTitle="Table Failed to Load"
      fallbackMessage="There was a problem displaying this data table. The data might be temporarily unavailable."
      onReset={onReset}
    >
      {children}
    </ErrorBoundary>
  );
}

export function CardErrorBoundary({ children, onReset }: SectionErrorBoundaryProps) {
  return (
    <ErrorBoundary
      fallbackTitle="Failed to Load"
      fallbackMessage="This metric could not be loaded. Please try again."
      onReset={onReset}
    >
      {children}
    </ErrorBoundary>
  );
}

export function FilterErrorBoundary({ children, onReset }: SectionErrorBoundaryProps) {
  return (
    <ErrorBoundary
      fallbackTitle="Filters Unavailable"
      fallbackMessage="The filter controls failed to load. You can still view the dashboard with default settings."
      onReset={onReset}
    >
      {children}
    </ErrorBoundary>
  );
}
