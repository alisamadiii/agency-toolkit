'use client';

import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { signOut } from '@/lib/auth-client';

export function SignOutButton() {
  const router = useRouter();
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={async () => {
        await signOut();
        router.push('/sign-in');
      }}
    >
      Sign out
    </Button>
  );
}
