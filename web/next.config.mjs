/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep web/AGENTS.md hand-maintained; next dev would append its own rules block.
  agentRules: false,
};

export default nextConfig;
