'use client'

import clsx from 'clsx'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const OGELER = [
  { href: '/', etiket: 'Pano' },
  { href: '/sozlesmeler', etiket: 'Sözleşmeler' },
  { href: '/odeme-paketleri', etiket: 'Ödeme paketleri' },
  { href: '/tasinmazlar', etiket: 'Taşınmazlar' },
  { href: '/kisiler', etiket: 'Malikler' },
  { href: '/birimler', etiket: 'Birimler' },
  { href: '/endeksler', etiket: 'Endeksler' },
  { href: '/yonetim/parametreler', etiket: 'Parametreler' },
  { href: '/yonetim/tatiller', etiket: 'Tatiller' },
  { href: '/yonetim/kullanicilar', etiket: 'Kullanıcılar' },
  { href: '/yonetim/isler', etiket: 'Zamanlanmış işler' },
  { href: '/hesabim', etiket: 'Hesabım' },
]

export function AnaMenu() {
  const yol = usePathname()
  return (
    <nav className="flex flex-col gap-0.5 text-sm" aria-label="Ana menü">
      {OGELER.map((o) => {
        const aktif = o.href === '/' ? yol === '/' : yol.startsWith(o.href)
        return (
          <Link key={o.href} href={o.href} aria-current={aktif ? 'page' : undefined}
            className={clsx('rounded px-2.5 py-1.5', aktif ? 'bg-white font-semibold text-marka shadow-sm' : 'text-slate-700 hover:bg-white/70')}>
            {o.etiket}
          </Link>
        )
      })}
    </nav>
  )
}
