import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  images: {
    // Avatars of the signed-in user and of the accounts SyncLab is installed on.
    // No `search` key, because GitHub appends ?v=4 to every avatar URL.
    remotePatterns: [{ protocol: "https", hostname: "avatars.githubusercontent.com", pathname: "/**" }],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
