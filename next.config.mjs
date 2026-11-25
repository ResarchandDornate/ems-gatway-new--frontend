/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",

  typescript: {
    /**
     * Type checking runs in CI, not here.
     *
     * `next build` type-checks the whole project again inside the image, and on
     * the deploy host that took 12.6 minutes — against a 2.3 minute compile and
     * a 15 minute job limit, which it blew, cancelling the deploy. Docker on
     * that Mac is virtualised and the layer cache cannot carry tsbuildinfo, so
     * `incremental` buys nothing there and every deploy pays the full cost.
     *
     * The check itself is not lost: .github/workflows/typecheck.yml runs
     * `tsc --noEmit` on every push and pull request, with a warm cache, and is
     * the gate that should fail. Building the image a second time is the wrong
     * place to discover a type error — by then it is already merged.
     */
    ignoreBuildErrors: true,
  },
  async headers() {
    return [
      {
        // Content-hashed build assets never change for a given URL, so cache
        // them for a year. The blanket no-store below used to override Next's
        // own immutable default here, which made every refresh re-download the
        // whole JS bundle from origin through Cloudflare.
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        // Everything else — HTML and the /api proxy — stays fresh: HTML carries
        // the current chunk URLs, and the API is live data.
        source: "/((?!_next/static/).*)",
        headers: [
          { key: "Cache-Control", value: "no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
