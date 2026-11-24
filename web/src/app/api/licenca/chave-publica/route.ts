import { NextResponse } from 'next/server';
import { getPublicLicenseKey } from '@/lib/license';

export async function GET() {
  return NextResponse.json(getPublicLicenseKey());
}
