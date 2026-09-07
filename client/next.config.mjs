/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // `pg` is a Node-only library with dynamic requires. Keep it external so Next
  // doesn't try to bundle it into the route-handler server build.
  experimental: {
    serverComponentsExternalPackages: ['pg'],
  },
};

export default nextConfig;
