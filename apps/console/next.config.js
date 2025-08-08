/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    // Disable image optimization surface if not used
    unoptimized: true,
  },
  async headers() {
    // Apply cache policy per route type:
    // - API routes: no-store
    // - Next static assets: long-lived immutable cache
    // - App pages (fallback): short cache to allow revalidation
    return [
      {
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
      {
        source: '/_next/static/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/favicon.ico',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=86400' }],
      },
      {
        source: '/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=60' }],
      },
    ];
  },
};

module.exports = nextConfig;
