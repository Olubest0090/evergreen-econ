import { NextResponse } from 'next/server';
import { syncBankDeposits } from '@/lib/bankDeposits';

export async function GET(request: Request) {
  try {
    const result = await syncBankDeposits();
    return NextResponse.json({ success: true, result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
