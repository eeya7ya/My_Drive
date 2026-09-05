/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /**
   * The eSpark drive used to live at /espark; keep old links working. The
   * registry records that slug too, so the drive route would redirect it
   * anyway — doing it here saves the lookup and keeps working if the row is
   * ever removed.
   *
   * Nothing else can be redirected from this file. The site's other old
   * addresses were the main drive's root-level links — /literature/papers/x.pdf
   * — and their first segment is a folder name that only the database knows.
   * A pattern broad enough to catch them (/:segment/:path*) is exactly the rule
   * that made every unknown address render a drive, so those are resolved in
   * app/[drive]/[[...path]]/page.tsx instead, where the drive's own top-level
   * names are checked before anything is redirected and everything else 404s.
   */
  async redirects() {
    return [
      { source: "/espark", destination: "/advec", permanent: true },
      { source: "/espark/:path*", destination: "/advec/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
