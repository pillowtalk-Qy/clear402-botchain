/** @type {import("next").NextConfig} */
const nextConfig = {
  transpilePackages: ["@clear402/shared"],
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1"]
};

export default nextConfig;
