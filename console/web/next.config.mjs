/** @type {import('next').NextConfig} */
const nextConfig = {
  // The runtime stage copies `.next/standalone`, so the image ships a server rather than a
  // node_modules tree it has to resolve at boot.
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
