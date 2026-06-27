/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  eslint: {
    // Only lint app + src during next build; lambdas are built separately by CDK
    dirs: ["app", "src"],
  },
};

export default nextConfig;
