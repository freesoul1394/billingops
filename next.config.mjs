/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  eslint: {
    // Lambdas are built separately by CDK (esbuild); don't lint them during next build
    dirs: ["app", "src", "middleware.ts"],
  },
  typescript: {
    // Lambdas have their own tsconfig; skip them in Next.js type checking
    ignoreBuild: false,
  },
  webpack: (config) => {
    // Exclude lambdas directory from Next.js webpack compilation
    config.watchOptions = {
      ...config.watchOptions,
      ignored: [...(config.watchOptions?.ignored || []), "**/lambdas/**"],
    };
    return config;
  },
};

export default nextConfig;
