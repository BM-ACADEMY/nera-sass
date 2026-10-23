import { useRef } from 'react'
import { gsap, useGSAP } from '../lib/gsap'

const TEXT =
  'Your customers are already on WhatsApp. Getnera makes sure every one of them gets a reply, an owner and a follow-up.'
const HIGHLIGHT = new Set(['reply,', 'owner', 'follow-up.'])

export default function Statement() {
  const root = useRef(null)

  useGSAP(
    () => {
      gsap.fromTo(
        '.st-word',
        { opacity: 0.12 },
        {
          opacity: 1,
          stagger: 0.08,
          ease: 'none',
          scrollTrigger: { trigger: root.current, start: 'top 75%', end: 'bottom 45%', scrub: true },
        },
      )
    },
    { scope: root },
  )

  return (
    <section className="statement" ref={root}>
      <div className="wrap">
        <p className="statement-text">
          {TEXT.split(' ').map((w, i) => (
            <span key={i} className={`st-word ${HIGHLIGHT.has(w) ? 'hl' : ''}`}>{w} </span>
          ))}
        </p>
      </div>
    </section>
  )
}
