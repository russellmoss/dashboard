// src/lib/metabase.ts
// ═══════════════════════════════════════════════════════════════════════
// METABASE INTEGRATION
// Utilities for Metabase embedding with signed JWTs
// ═══════════════════════════════════════════════════════════════════════

import * as jwt from 'jsonwebtoken';
import type { MetabaseEmbedParams, MetabaseTokenPayload, ChartBuilderConfig } from '@/types/metabase';

const METABASE_SITE_URL = process.env.METABASE_SITE_URL;
const METABASE_SECRET_KEY = process.env.METABASE_SECRET_KEY;

/**
 * Validates that Metabase environment variables are configured
 */
export function validateMetabaseConfig(): { valid: boolean; error?: string } {
  if (!METABASE_SITE_URL) {
    return { valid: false, error: 'METABASE_SITE_URL is not configured' };
  }
  if (!METABASE_SECRET_KEY) {
    return { valid: false, error: 'METABASE_SECRET_KEY is not configured' };
  }
  return { valid: true };
}

/**
 * Generates a signed JWT token for Metabase embedding
 *
 * @param params - Resource and parameters for the embed
 * @param expirationMinutes - Token expiration in minutes (default: 60)
 * @returns Signed JWT token string
 */
export function generateEmbedToken(
  params: MetabaseEmbedParams,
  expirationMinutes: number = 60
): string {
  if (!METABASE_SECRET_KEY) {
    throw new Error('METABASE_SECRET_KEY is not configured');
  }

  const payload: MetabaseTokenPayload = {
    resource: params.resource,
    params: params.params || {},
    exp: Math.round(Date.now() / 1000) + (expirationMinutes * 60),
  };

  return jwt.sign(payload, METABASE_SECRET_KEY);
}

/**
 * Generates the full embed URL for a Metabase dashboard
 *
 * @param dashboardId - Metabase dashboard ID
 * @param params - Optional filter parameters
 * @param theme - Optional theme ('light' | 'dark')
 * @returns Full embed URL with signed token
 */
export function getDashboardEmbedUrl(
  dashboardId: number,
  params?: Record<string, string | number | boolean | null>,
  theme?: 'light' | 'dark'
): string {
  if (!METABASE_SITE_URL) {
    throw new Error('METABASE_SITE_URL is not configured');
  }

  const token = generateEmbedToken({
    resource: { dashboard: dashboardId },
    params,
  });

  let url = `${METABASE_SITE_URL}/embed/dashboard/${token}`;

  // Add theme parameter if specified
  if (theme) {
    url += `#theme=${theme}`;
  }

  return url;
}

/**
 * Generates the full embed URL for a Metabase question (saved chart)
 *
 * @param questionId - Metabase question ID
 * @param params - Optional filter parameters
 * @param theme - Optional theme ('light' | 'dark')
 * @returns Full embed URL with signed token
 */
export function getQuestionEmbedUrl(
  questionId: number,
  params?: Record<string, string | number | boolean | null>,
  theme?: 'light' | 'dark'
): string {
  if (!METABASE_SITE_URL) {
    throw new Error('METABASE_SITE_URL is not configured');
  }

  const token = generateEmbedToken({
    resource: { question: questionId },
    params,
  });

  let url = `${METABASE_SITE_URL}/embed/question/${token}`;

  if (theme) {
    url += `#theme=${theme}`;
  }

  return url;
}

/**
 * Gets the Chart Builder configuration for full Metabase access
 * This provides direct access to Metabase (not embedded specific content)
 *
 * @param theme - Optional theme preference
 * @returns ChartBuilderConfig object
 */
export function getChartBuilderConfig(theme?: 'light' | 'dark'): ChartBuilderConfig {
  const config = validateMetabaseConfig();
  if (!config.valid) {
    throw new Error(config.error);
  }

  return {
    siteUrl: METABASE_SITE_URL!,
    iframeUrl: METABASE_SITE_URL!,
    theme,
    bordered: false,
    titled: false,
  };
}

/**
 * Builds URL parameters string for Metabase
 */
export function buildMetabaseParams(params: Record<string, string | number | boolean | null>): string {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined) {
      searchParams.append(key, String(value));
    }
  });

  return searchParams.toString();
}

// ═══════════════════════════════════════════════════════════════════════
// METABASE API CLIENT
// Functions for fetching questions, dashboards, and collections
// ═══════════════════════════════════════════════════════════════════════

const METABASE_API_EMAIL = process.env.METABASE_API_EMAIL;
const METABASE_API_PASSWORD = process.env.METABASE_API_PASSWORD;

// Session token cache (in-memory, will reset on server restart)
let sessionToken: string | null = null;
let sessionExpiry: number = 0;

/**
 * Authenticates with Metabase and returns a session token
 */
async function getMetabaseSessionToken(): Promise<string> {
  // Return cached token if still valid (with 5 min buffer)
  if (sessionToken && Date.now() < sessionExpiry - 300000) {
    return sessionToken;
  }

  if (!METABASE_SITE_URL || !METABASE_API_EMAIL || !METABASE_API_PASSWORD) {
    throw new Error('Metabase API credentials not configured');
  }

  const response = await fetch(`${METABASE_SITE_URL}/api/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      username: METABASE_API_EMAIL,
      password: METABASE_API_PASSWORD,
    }),
  });

  if (!response.ok) {
    throw new Error(`Metabase authentication failed: ${response.status}`);
  }

  const data = await response.json();
  sessionToken = data.id;
  // Sessions typically last 14 days, but we'll refresh after 1 hour
  sessionExpiry = Date.now() + 3600000;

  return sessionToken!;
}

/**
 * Makes an authenticated request to the Metabase API
 */
async function metabaseApiRequest<T>(endpoint: string): Promise<T> {
  const token = await getMetabaseSessionToken();

  const response = await fetch(`${METABASE_SITE_URL}${endpoint}`, {
    headers: {
      'X-Metabase-Session': token,
    },
  });

  if (!response.ok) {
    throw new Error(`Metabase API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Metabase question/card type
 */
export interface MetabaseQuestion {
  id: number;
  name: string;
  description: string | null;
  display: string;
  collection_id: number | null;
  collection?: {
    id: number;
    name: string;
  };
  creator?: {
    common_name: string;
  };
  created_at: string;
  updated_at: string;
  archived: boolean;
  enable_embedding: boolean;
}

/**
 * Metabase dashboard type
 */
export interface MetabaseDashboard {
  id: number;
  name: string;
  description: string | null;
  collection_id: number | null;
  collection?: {
    id: number;
    name: string;
  };
  creator?: {
    common_name: string;
  };
  created_at: string;
  updated_at: string;
  archived: boolean;
  enable_embedding: boolean;
}

/**
 * Metabase collection type
 */
export interface MetabaseCollection {
  id: number | 'root';
  name: string;
  description: string | null;
  personal_owner_id: number | null;
}

/**
 * Fetches all saved questions (cards) from Metabase
 * @param publishedOnly - If true, only returns questions with embedding enabled
 */
export async function getMetabaseQuestions(publishedOnly: boolean = true): Promise<MetabaseQuestion[]> {
  try {
    const questions = await metabaseApiRequest<MetabaseQuestion[]>('/api/card');
    // Filter out archived questions
    let filtered = questions.filter(q => !q.archived);

    // If publishedOnly, only return questions with embedding enabled
    if (publishedOnly) {
      filtered = filtered.filter(q => q.enable_embedding);
    }

    return filtered.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error('Failed to fetch Metabase questions:', error);
    return [];
  }
}

/**
 * Fetches all dashboards from Metabase
 * @param publishedOnly - If true, only returns dashboards with embedding enabled
 */
export async function getMetabaseDashboards(publishedOnly: boolean = true): Promise<MetabaseDashboard[]> {
  try {
    const dashboards = await metabaseApiRequest<MetabaseDashboard[]>('/api/dashboard');
    // Filter out archived dashboards
    let filtered = dashboards.filter(d => !d.archived);

    // If publishedOnly, only return dashboards with embedding enabled
    if (publishedOnly) {
      filtered = filtered.filter(d => d.enable_embedding);
    }

    return filtered.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error('Failed to fetch Metabase dashboards:', error);
    return [];
  }
}

/**
 * Fetches all collections from Metabase
 */
export async function getMetabaseCollections(): Promise<MetabaseCollection[]> {
  try {
    const collections = await metabaseApiRequest<MetabaseCollection[]>('/api/collection');
    // Filter out personal collections
    return collections.filter(c => !c.personal_owner_id);
  } catch (error) {
    console.error('Failed to fetch Metabase collections:', error);
    return [];
  }
}

/**
 * Checks if Metabase API is configured
 */
export function isMetabaseApiConfigured(): boolean {
  return !!(METABASE_SITE_URL && METABASE_API_EMAIL && METABASE_API_PASSWORD);
}
