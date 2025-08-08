/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { appDir: true },
  images: {
    // Disable image optimization to avoid legacy DoS vector when not used
    unoptimized: true,
  },
  async headers() {
    // Prevent unintended edge caching to reduce cache-poisoning risks
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
