import type { NextConfig } from 'next'

const gelistirme = process.env.NODE_ENV === 'development'

// Next App Router hidrasyon için satır içi script kullanır; nonce'suz CSP'de
// 'unsafe-inline' gerekir. Geliştirmede React Refresh eval kullandığı için
// 'unsafe-eval' yalnızca orada açılır.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${gelistirme ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

const nextConfig: NextConfig = {
  serverExternalPackages: ['@node-rs/argon2'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
      {
        // Sözleşme PDF'leri uygulama içinde iframe ile gösterilir.
        source: '/api/belgeler/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "default-src 'none'; frame-ancestors 'self'" },
        ],
      },
    ]
  },
}

export default nextConfig
