import { useRef } from 'react'
import { motion, useScroll, useTransform, useMotionValue, useSpring } from 'framer-motion'
import ChatDemo from './ChatDemo'
import Magnetic from '../components/Magnetic'
import { IconArrow } from '../components/Icons'

const words = [
  ['Every'], ['WhatsApp'], ['enquiry,'], ['answered', true], ['and'], ['followed', true], ['up.', true],
]

const ease = [0.22, 1, 0.36, 1]
const container = { animate: { transition: { staggerChildren: 0.07, delayChildren: 0.25 } } }
const word = {
  initial: { y: '110%', rotate: 4 },
  animate: { y: '0%', rotate: 0, transition: { duration: 0.9, ease } },
}
const fade = (delay) => ({
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.8, delay, ease } },
})

export default function Hero() {
  const ref = useRef(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const visualY = useTransform(scrollYProgress, [0, 1], [0, 140])
  const copyY = useTransform(scrollYProgress, [0, 1], [0, -60])
  const copyOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0])
  const orbY = useTransform(scrollYProgress, [0, 1], [0, 220])

  // Subtle 3D tilt that follows the pointer.
  const mx = useMotionValue(0)
  const my = useMotionValue(0)
  const rotY = useSpring(useTransform(mx, [-0.5, 0.5], [-9, 9]), { stiffness: 120, damping: 18 })
  const rotX = useSpring(useTransform(my, [-0.5, 0.5], [7, -7]), { stiffness: 120, damping: 18 })
  const onMove = (e) => {
    const r = ref.current.getBoundingClientRect()
    mx.set((e.clientX - r.left) / r.width - 0.5)
    my.set((e.clientY - r.top) / r.height - 0.5)
  }

  return (
    <section className="hero" ref={ref} onPointerMove={onMove}>
      <motion.div className="hero-bg" style={{ y: orbY }} aria-hidden="true">
        <span className="orb orb-a" />
        <span className="orb orb-b" />
        <span className="orb orb-c" />
      </motion.div>
      <div className="hero-grid" aria-hidden="true" />

      <div className="wrap hero-inner">
        <motion.div className="hero-copy" style={{ y: copyY, opacity: copyOpacity }}>
          <motion.p className="eyebrow" {...fade(0.1)}>
            <span className="dot" /> AI-powered WhatsApp CRM
          </motion.p>
          <motion.h1 className="hero-title" variants={container} initial="initial" animate="animate">
            {words.map(([w, em], i) => (
              <span key={i}>
                <span className="word-mask">
                  <motion.span className={em ? 'word em' : 'word'} variants={word}>{w}</motion.span>
                </span>{' '}
              </span>
            ))}
          </motion.h1>
          <motion.p className="lead" {...fade(0.85)}>
            Getnera brings your business WhatsApp, leads and team into one place. Customers get fast replies, and your team never misses a follow-up.
          </motion.p>
          <motion.div className="hero-actions" {...fade(1)}>
            <Magnetic>
              <a className="btn btn-primary" href="mailto:support@getnera.in?subject=Getnera%20demo">
                Request a demo <IconArrow width={18} height={18} />
              </a>
            </Magnetic>
            <a className="btn btn-ghost" href="#flow">See how it works</a>
          </motion.div>
          <motion.ul className="hero-points" {...fade(1.15)}>
            <li>Official WhatsApp Business Platform</li>
            <li>One number for your whole team</li>
          </motion.ul>
        </motion.div>

        <motion.div className="hero-visual" style={{ y: visualY, rotateX: rotX, rotateY: rotY }}>
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 60 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 1.1, delay: 0.4, ease }}
          >
            <ChatDemo />
          </motion.div>
        </motion.div>
      </div>

      <motion.a href="#features" className="scroll-cue" aria-label="Scroll to features" {...fade(1.4)}>
        <span />
      </motion.a>
    </section>
  )
}
