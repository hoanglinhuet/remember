import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Chặn build nếu có lỗi type - đây là lý do chính chuyển sang TS.
  typescript: { ignoreBuildErrors: false },
};

export default config;
