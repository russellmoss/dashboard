// src/app/api/advisor-map/overrides/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ExtendedSession } from '@/types/auth';

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// Geocode an address using Google Maps API
async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  if (!GOOGLE_MAPS_API_KEY) {
    console.warn('GOOGLE_MAPS_API_KEY not configured, skipping geocoding');
    return null;
  }

  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', address);
  url.searchParams.set('key', GOOGLE_MAPS_API_KEY);

  const response = await fetch(url.toString());
  const data = await response.json();

  if (data.status === 'OK' && data.results.length > 0) {
    const result = data.results[0];
    return {
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
    };
  }

  return null;
}

// Build address string for geocoding
function buildAddressString(data: OverrideInput): string {
  const parts: string[] = [];
  if (data.street1) parts.push(data.street1);
  if (data.city) parts.push(data.city);
  if (data.state) parts.push(data.state);
  if (data.postalCode) parts.push(data.postalCode);
  if (data.country) parts.push(data.country);
  return parts.join(', ');
}

// Type for override input
interface OverrideInput {
  primaryKey: string;
  street1?: string | null;
  street2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  lat?: number | null;
  lng?: number | null;
  notes?: string | null;
}

// Simple validation function
function validateOverrideInput(data: any): { valid: boolean; error?: string; data?: OverrideInput } {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Invalid request body' };
  }

  if (!data.primaryKey || typeof data.primaryKey !== 'string' || data.primaryKey.trim() === '') {
    return { valid: false, error: 'Primary key is required' };
  }

  if (data.state && typeof data.state === 'string' && data.state.length > 2) {
    return { valid: false, error: 'State must be a 2-letter abbreviation' };
  }

  if (data.lat !== undefined && data.lat !== null && typeof data.lat !== 'number') {
    return { valid: false, error: 'Latitude must be a number' };
  }

  if (data.lng !== undefined && data.lng !== null && typeof data.lng !== 'number') {
    return { valid: false, error: 'Longitude must be a number' };
  }

  return {
    valid: true,
    data: {
      primaryKey: data.primaryKey.trim(),
      street1: data.street1 || null,
      street2: data.street2 || null,
      city: data.city || null,
      state: data.state || null,
      postalCode: data.postalCode || null,
      country: data.country || null,
      lat: data.lat ?? null,
      lng: data.lng ?? null,
      notes: data.notes || null,
    },
  };
}

// GET - List all overrides
export async function GET() {
  try {
    const session = await getServerSession(authOptions) as ExtendedSession | null;
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only admins, revops_admin, and managers can view overrides
    const userRole = session.permissions?.role;
    if (!userRole || !['admin', 'revops_admin', 'manager'].includes(userRole)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const overrides = await prisma.advisorAddressOverride.findMany({
      orderBy: { updatedAt: 'desc' },
    });

    return NextResponse.json({ overrides });
  } catch (error) {
    console.error('Error fetching overrides:', error);
    return NextResponse.json(
      { error: 'Failed to fetch overrides' },
      { status: 500 }
    );
  }
}

// POST - Create or update an override
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as ExtendedSession | null;
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only admins, revops_admin, and managers can create overrides
    const userRole = session.permissions?.role;
    if (!userRole || !['admin', 'revops_admin', 'manager'].includes(userRole)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const validation = validateOverrideInput(body);

    if (!validation.valid || !validation.data) {
      return NextResponse.json(
        { error: validation.error || 'Validation failed' },
        { status: 400 }
      );
    }

    const data = validation.data;
    const userEmail = session.user.email;

    // If no coordinates provided but we have address info, geocode it
    let lat = data.lat;
    let lng = data.lng;
    let geocoded = false;

    if ((lat === null || lng === null) && (data.city || data.state)) {
      const addressString = buildAddressString(data);
      if (addressString) {
        console.log(`[Override] Geocoding address: ${addressString}`);
        const coords = await geocodeAddress(addressString);
        if (coords) {
          lat = coords.lat;
          lng = coords.lng;
          geocoded = true;
          console.log(`[Override] Geocoded to: ${lat}, ${lng}`);
        } else {
          console.log(`[Override] Geocoding returned no results`);
        }
      }
    }

    // Check if override already exists for this primaryKey
    const existing = await prisma.advisorAddressOverride.findUnique({
      where: { primaryKey: data.primaryKey },
    });

    let override;
    if (existing) {
      // Update existing
      override = await prisma.advisorAddressOverride.update({
        where: { primaryKey: data.primaryKey },
        data: {
          street1: data.street1,
          street2: data.street2,
          city: data.city,
          state: data.state?.toUpperCase(),
          postalCode: data.postalCode,
          country: data.country,
          lat,
          lng,
          notes: data.notes,
          updatedBy: userEmail,
        },
      });
    } else {
      // Create new
      override = await prisma.advisorAddressOverride.create({
        data: {
          primaryKey: data.primaryKey,
          street1: data.street1,
          street2: data.street2,
          city: data.city,
          state: data.state?.toUpperCase(),
          postalCode: data.postalCode,
          country: data.country,
          lat,
          lng,
          notes: data.notes,
          createdBy: userEmail,
          updatedBy: userEmail,
        },
      });
    }

    return NextResponse.json({ override, created: !existing, geocoded });
  } catch (error) {
    console.error('Error saving override:', error);
    return NextResponse.json(
      { error: 'Failed to save override' },
      { status: 500 }
    );
  }
}

// DELETE - Remove an override
export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as ExtendedSession | null;
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only admins and revops_admin can delete overrides
    const userRole = session.permissions?.role;
    if (!userRole || !['admin', 'revops_admin'].includes(userRole)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const primaryKey = searchParams.get('primaryKey');

    if (!primaryKey) {
      return NextResponse.json(
        { error: 'Primary key is required' },
        { status: 400 }
      );
    }

    await prisma.advisorAddressOverride.delete({
      where: { primaryKey },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting override:', error);
    return NextResponse.json(
      { error: 'Failed to delete override' },
      { status: 500 }
    );
  }
}
