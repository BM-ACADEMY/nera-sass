import { useRef } from 'react'
import { motion, useSpring } from 'framer-motion'

const spring = { stiffness: 220, damping: 16, mass: 0.4 }

// Pulls its child toward the pointer a little, then springs back.
export default function Magnetic({ children, strength = 0.35 }) {
  const ref = useRef(null)
  const x = useSpring(0, spring)
  const y = useSpring(0, spring)

  const onMove = (e) => {
    if (e.pointerType !== 'mouse') return
    const r = ref.current.getBoundingClientRect()
    x.set((e.clientX - (r.left + r.width / 2)) * strength)
    y.set((e.clientY - (r.top + r.height / 2)) * strength)
  }
  const reset = () => {
    x.set(0)
    y.set(0)
  }

  return (
    <motion.div ref={ref} className="magnetic" style={{ x, y }} onPointerMove={onMove} onPointerLeave={reset}>
      {children}
    </motion.div>
  )
}
