/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The eSpark drive used to live at /espark; keep old links working.
  async redirects() {
    return [
      { source: "/espark", destination: "/advec", permanent: true },
      { source: "/espark/:path*", destination: "/advec/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
