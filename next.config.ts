import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This project's root is a subfolder of a larger monorepo checkout;
  // pin Turbopack's root so it doesn't try to infer it from an ancestor
  // lockfile/VCS root outside this folder.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
