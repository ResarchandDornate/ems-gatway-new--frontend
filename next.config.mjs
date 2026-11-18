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
        // Never cache HTML pages — forces Cloudflare to always fetch fresh
        // HTML from origin, which carries the latest hashed JS chunk URLs.
        source: "/(.*)",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
