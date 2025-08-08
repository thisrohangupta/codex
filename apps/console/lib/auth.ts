import type { NextAuthOptions } from 'next-auth';
import GitHubProvider from 'next-auth/providers/github';

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: 'jwt' },
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_ID || 'placeholder',
      clientSecret: process.env.GITHUB_SECRET || 'placeholder',
    }),
  ],
  callbacks: {
    async jwt({ token, profile }) {
      if (profile && 'email' in profile) {
        token.email = (profile as any).email;
      }
      const admins = (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim()).filter(Boolean);
      (token as any).role = admins.includes((token as any).email) ? 'admin' : 'developer';
      return token;
    },
    async session({ session, token }) {
      (session as any).role = (token as any).role || 'developer';
      return session;
    },
  },
};

