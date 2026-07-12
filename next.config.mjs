/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  // /welcome is a static scroll-world page in public/ — Next doesn't serve
  // directory indexes from public, so route it to its index.html explicitly
  async rewrites() {
    return [
      { source: '/welcome', destination: '/welcome/index.html' },
      { source: '/welcome/', destination: '/welcome/index.html' },
    ];
  },
};

export default nextConfig;
