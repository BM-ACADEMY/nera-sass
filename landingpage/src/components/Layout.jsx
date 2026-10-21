import { useEffect } from 'react'
import { motion, useScroll, useSpring } from 'framer-motion'
import { startSmoothScroll, scrollToTarget } from '../lib/smooth'
import { ScrollTrigger } from '../lib/gsap'
import Nav from './Nav'
import Footer from './Footer'

export default function Layout({ links, children }) {
  const { scrollYProgress } = useScroll()
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 30, mass: 0.3 })

  useEffect(() => {
    const stop = startSmoothScroll()

    // In-page anchors go through Lenis so they glide instead of jumping.
    const onClick = (e) => {
      const a = e.target.closest('a[href^="#"]')
      if (!a) return
      const hash = a.getAttribute('href')
      if (hash.length > 1 && scrollToTarget(hash)) {
        e.preventDefault()
        history.replaceState(null, '', hash)
      }
    }
    document.addEventListener('click', onClick)

    // Honour deep links such as /privacy-policy#data-deletion once layout settles.
    const t = setTimeout(() => {
      ScrollTrigger.refresh()
      if (location.hash.length > 1) scrollToTarget(location.hash, true)
    }, 150)

    return () => {
      clearTimeout(t)
      document.removeEventListener('click', onClick)
      stop()
    }
  }, [])

  return (
    <>
      <motion.div className="scroll-progress" style={{ scaleX: progress }} aria-hidden="true" />
      <Nav links={links} />
      {children}
      <Footer />
    </>
  )
}
