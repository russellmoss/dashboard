import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Test database connection
    const userCount = await prisma.user.count();
    
    // Try to find the admin user
    const adminUser = await prisma.user.findUnique({
      where: { email: 'russell.moss@savvywealth.com' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
      },
    });

    return NextResponse.json({
      success: true,
      userCount,
      adminUser: adminUser || null,
      databaseUrl: process.env.DATABASE_URL 
        ? `${process.env.DATABASE_URL.substring(0, 20)}...` 
        : 'NOT SET',
      envVars: {
        hasDatabaseUrl: !!process.env.DATABASE_URL,
        hasPostgresUrl: !!process.env.POSTGRES_URL,
        hasPostgresPrismaUrl: !!process.env.POSTGRES_PRISMA_URL,
      },
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      databaseUrl: process.env.DATABASE_URL 
        ? `${process.env.DATABASE_URL.substring(0, 20)}...` 
        : 'NOT SET',
      envVars: {
        hasDatabaseUrl: !!process.env.DATABASE_URL,
        hasPostgresUrl: !!process.env.POSTGRES_URL,
        hasPostgresPrismaUrl: !!process.env.POSTGRES_PRISMA_URL,
      },
    }, { status: 500 });
  }
}
