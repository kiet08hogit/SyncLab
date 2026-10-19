import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lockfiles also live under server/. Pin the root to this app so Vercel does
  // not treat the git root as the Turbopack root and fail to load next/font.
  turbopack: {
    root: path.dirname(fileURLToPath(import.meta.url)),
  },
  cacheComponents: true,
  partialPrefetching: true,
  images: {
    // Avatars of the signed-in user and of the accounts SyncLab is installed on.
    // No `search` key, because GitHub appends ?v=4 to every avatar URL.
    remotePatterns: [{ protocol: "https", hostname: "avatars.githubusercontent.com", pathname: "/**" }],
  },
};

export default nextConfig;
