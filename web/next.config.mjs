/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep web/AGENTS.md hand-maintained; next dev would append its own rules block.
  agentRules: false,
  // The provider console became the Provide workspace.
  async redirects() {
    return [{ source: "/providers", destination: "/provide", permanent: false }];
  },
};

export default nextConfig;
