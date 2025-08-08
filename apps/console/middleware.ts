import { NextResponse, type NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const res = NextResponse.next();

  // Security headers
  const isProd = process.env.NODE_ENV === 'production';
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "connect-src 'self' http://localhost:* https:",
    "font-src 'self' data:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');

  res.headers.set('Content-Security-Policy', csp);
  res.headers.set('Referrer-Policy', 'no-referrer');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  if (isProd) {
    res.headers.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains; preload');
  }

  return res;
}

export const config = {
  // Apply to everything except Next internal assets
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

