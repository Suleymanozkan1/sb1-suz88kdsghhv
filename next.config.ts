import type { NextConfig } from "next";

// Content-Security-Policy is set per request with a script nonce in src/middleware.ts (no 'unsafe-inline' for scripts).
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // the Windows installer ships a self-contained server (installer/build-windows.sh sets this)
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  // the PDF management pack reads its fonts from disk at runtime (serverless bundles must include them)
  outputFileTracingIncludes: { "/**/*": ["./assets/fonts/**/*"] },
  serverExternalPackages: ["@prisma/client", "bcryptjs", "pdfkit", "nodemailer"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
