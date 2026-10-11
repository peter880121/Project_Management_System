import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@zilliz/milvus2-sdk-node"],
};

export default nextConfig;
