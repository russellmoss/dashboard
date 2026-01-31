// src/types/metabase.ts
// ═══════════════════════════════════════════════════════════════════════
// METABASE TYPES
// Type definitions for Metabase embedding integration
// ═══════════════════════════════════════════════════════════════════════

/**
 * Metabase embed resource types
 */
export type MetabaseResourceType = 'dashboard' | 'question';

/**
 * Parameters for Metabase embed token generation
 */
export interface MetabaseEmbedParams {
  resource: {
    dashboard?: number;
    question?: number;
  };
  params?: Record<string, string | number | boolean | null>;
}

/**
 * Metabase embed token payload (JWT claims)
 */
export interface MetabaseTokenPayload {
  resource: {
    dashboard?: number;
    question?: number;
  };
  params: Record<string, string | number | boolean | null>;
  exp: number;
}

/**
 * Configuration for the Chart Builder embed
 */
export interface ChartBuilderConfig {
  siteUrl: string;
  iframeUrl: string;
  theme?: 'light' | 'dark';
  bordered?: boolean;
  titled?: boolean;
}
