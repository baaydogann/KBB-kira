import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'KBB Kira Takip',
  description: 'Konya Büyükşehir Belediyesi kira sözleşmeleri takip sistemi',
}

export default function KokYerlesim({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body className="min-h-screen">{children}</body>
    </html>
  )
}
