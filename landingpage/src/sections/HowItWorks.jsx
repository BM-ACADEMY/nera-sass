import { useRef } from 'react'
import { gsap, useGSAP } from '../lib/gsap'
import { IconLink, IconBook, IconTeam, IconBell } from '../components/Icons'

const STEPS = [
  { icon: IconLink, title: 'Connect your WhatsApp Business number', text: 'Sign in with Facebook and link your official number through Meta. Your customers keep messaging the number they already know.' },
  { icon: IconBook, title: 'Add your price list and FAQs', text: 'Getnera uses your own information to answer common questions, so replies sound like your business.' },
  { icon: IconTeam, title: 'Invite your team', text: 'Everyone works from one shared inbox. Assign conversations and leads to the right person.' },
  { icon: IconBell, title: 'Follow up automatically', text: 'Send approved templates for confirmations and reminders to customers who opted in, on time, every time.' },
]

export default function HowItWorks() {
  const root = useRef(null)

  useGSAP(
    () => {
      const mm = gsap.matchMedia()

      // Desktop: pin the section and scroll the cards sideways.
      mm.add('(min-width: 900px)', () => {
        const rail = root.current.querySelector('.how-rail')
        const distance = () => rail.scrollWidth - window.innerWidth + 48
        const tween = gsap.to(rail, {
          x: () => -distance(),
          ease: 'none',
          scrollTrigger: {
            trigger: root.current,
            start: 'top top',
            end: () => `+=${distance()}`,
            pin: true,
            scrub: 0.8,
            invalidateOnRefresh: true,
          },
        })
        gsap.to(root.current.querySelector('.how-progress-fill'), {
          scaleX: 1,
          ease: 'none',
          scrollTrigger: { trigger: root.current, start: 'top top', end: () => `+=${distance()}`, scrub: true, invalidateOnRefresh: true },
        })
        gsap.utils.toArray(root.current.querySelectorAll('.how-card')).forEach((card) => {
          gsap.from(card.querySelector('.how-card-inner'), {
            rotate: 4,
            y: 40,
            opacity: 0.3,
            ease: 'power2.out',
            scrollTrigger: { trigger: card, containerAnimation: tween, start: 'left 95%', end: 'left 55%', scrub: true },
          })
        })
      })

      // Mobile: a plain stacked list that rises in.
      mm.add('(max-width: 899px)', () => {
        gsap.utils.toArray(root.current.querySelectorAll('.how-card')).forEach((card) => {
          gsap.from(card, { y: 50, opacity: 0, duration: 0.8, ease: 'power3.out', scrollTrigger: { trigger: card, start: 'top 85%' } })
        })
      })

      return () => mm.revert()
    },
    { scope: root },
  )

  return (
    <section className="how" ref={root} aria-labelledby="how-title">
      <div className="how-rail">
        <div className="how-intro">
          <p className="eyebrow"><span className="dot" /> Getting started</p>
          <h2 id="how-title">Live in an afternoon, <em>not a quarter</em>.</h2>
          <p>Four steps from your first login to your first automated follow-up.</p>
          <div className="how-progress"><div className="how-progress-fill" /></div>
        </div>
        {STEPS.map(({ icon: Icon, title, text }, i) => (
          <article key={title} className="how-card">
            <div className="how-card-inner">
              <span className="how-num">0{i + 1}</span>
              <span className="how-icon"><Icon /></span>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
