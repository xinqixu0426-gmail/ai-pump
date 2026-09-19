import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiTarget = process.env.NEXT_PUBLIC_API_PROXY_TARGET || 'http://localhost:3002';
const distDir = process.env.NEXT_DIST_DIR || '.next';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir,
  outputFileTracingRoot: __dirname,
  devIndicators: false,
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiTarget}/api/:path*`,
      },
      {
        source: '/drawings/:path*',
        destination: `${apiTarget}/drawings/:path*`,
      },
    ];
  },
};

export default nextConfig;
