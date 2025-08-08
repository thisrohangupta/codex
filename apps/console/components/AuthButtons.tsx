'use client';
import { useSession, signIn, signOut } from 'next-auth/react';

export default function AuthButtons() {
  const { data: session, status } = useSession();
  if (status === 'loading') return <span>…</span>;
  if (!session)
    return (
      <button onClick={() => signIn('github')} style={{ background: '#0366d6' }}>
        Sign in with GitHub
      </button>
    );
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <span>
        {session.user?.email} ({(session as any).role})
      </span>
      <button onClick={() => signOut()}>Sign out</button>
    </div>
  );
}

