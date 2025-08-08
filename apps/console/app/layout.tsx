import './globals.css';
import Link from 'next/link';
import Providers from '../components/Providers';
import dynamic from 'next/dynamic';
const AuthButtons = dynamic(() => import('../components/AuthButtons'), { ssr: false });

export const metadata = {
  title: 'AI DevOps Console',
  description: 'AI-first build and deploy console',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header style={{ padding: '12px 16px', borderBottom: '1px solid #eee', display: 'flex', gap: 16 }}>
          <strong>AI DevOps Console</strong>
          <nav style={{ display: 'flex', gap: 12 }}>
            <Link href="/">Chat</Link>
            <Link href="/runs">Runs</Link>
            <Link href="/deployments">Deployments</Link>
            <Link href="/environments">Environments</Link>
          </nav>
          <div style={{ marginLeft: 'auto' }}>
            <AuthButtons />
          </div>
        </header>
        <Providers>
          <main style={{ padding: 16, maxWidth: 1100, margin: '0 auto' }}>{children}</main>
        </Providers>
      </body>
    </html>
  );
}
