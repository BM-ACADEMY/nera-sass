import Lenis from 'lenis'
import { gsap, ScrollTrigger } from './gsap'

let lenis = null

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Lenis drives the scroll and GSAP's ticker drives Lenis, so ScrollTrigger
// and smooth scrolling stay on the same frame.
export function startSmoothScroll() {
  if (prefersReducedMotion()) return () => {}
  lenis = new Lenis({
    duration: 1.15,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
  })
  lenis.on('scroll', ScrollTrigger.update)
  const tick = (time) => lenis?.raf(time * 1000)
  gsap.ticker.add(tick)
  gsap.ticker.lagSmoothing(0)
  return () => {
    gsap.ticker.remove(tick)
    lenis?.destroy()
    lenis = null
  }
}

export function scrollToTarget(target, immediate = false) {
  const el = typeof target === 'string' ? document.querySelector(target) : target
  if (!el) return false
  if (lenis) lenis.scrollTo(el, { offset: -88, immediate })
  else el.scrollIntoView({ behavior: immediate ? 'auto' : 'smooth' })
  return true
}
