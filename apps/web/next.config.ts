import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The engine and its native/SDK deps must run as real Node modules in
  // route handlers, not be bundled by Next.
  serverExternalPackages: [
    'crosswalk-mcp',
    'better-sqlite3',
    '@anthropic-ai/sdk',
    'playwright'
  ]
};

export default nextConfig;
