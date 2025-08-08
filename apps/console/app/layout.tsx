import './globals.css';
import Link from 'next/link';
import Providers from '../components/Providers';
import AuthButtons from '../components/AuthButtons';
const AUTH_DISABLED = process.env.AUTH_DISABLED === 'true';

export const metadata = {
  title: 'AI DevOps Console',
  description: 'AI-first build and deploy console',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="app-bg">
        <Providers>
          <header className="header glass">
            <div className="header-inner container">
              <strong className="brand">AI DevOps Console</strong>
              <nav className="nav">
                <Link href="/">Chat</Link>
                <Link href="/runs">Runs</Link>
                <Link href="/deployments">Deployments</Link>
                <Link href="/environments">Environments</Link>
              </nav>
              {!AUTH_DISABLED && (
                <div style={{ marginLeft: 'auto' }}>
                  <AuthButtons />
                </div>
              )}
            </div>
          </header>
          <main className="container">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
