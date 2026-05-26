/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output → a self-contained server bundle for the Docker image (infra/docker/web.Dockerfile).
  output: 'standalone',
  reactStrictMode: true,
};

export default nextConfig;
