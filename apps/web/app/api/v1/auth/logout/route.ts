import { redirect } from 'next/navigation';
import { endSession } from '@/lib/server/auth/session';

export async function POST() {
  await endSession();
  redirect('/login');
}
