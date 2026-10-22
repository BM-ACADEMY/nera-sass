import { useState } from 'react'
import { motion, useScroll, useMotionValueEvent } from 'framer-motion'
import { Logo } from './Icons'

export default function Nav({ links }) {
  const { scrollY } = useScroll()
  const [hidden, setHidden] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useMotionValueEvent(scrollY, 'change', (y) => {
    const prev = scrollY.getPrevious() ?? 0
    setHidden(y > prev && y > 240)
    setScrolled(y > 24)
  })

  return (
    <motion.header
      className={`nav ${scrolled ? 'is-scrolled' : ''}`}
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: hidden ? -100 : 0, opacity: 1 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="wrap nav-inner">
        <a className="brand" href="/" aria-label="Getnera home">
          <Logo />
          <span>Getnera</span>
        </a>
        <nav className="nav-links">
          {links.map((l) => (
            <a key={l.href} href={l.href} className={l.cta ? 'nav-cta' : l.minor ? 'nav-minor' : undefined}>
              {l.label}
            </a>
          ))}
        </nav>
      </div>
    </motion.header>
  )
}
