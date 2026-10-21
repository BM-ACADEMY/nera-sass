import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { gsap, useGSAP } from '../lib/gsap'
import { IconUser, IconCloud, IconSpark, IconLayers, IconTeam } from '../components/Icons'

const STEPS = [
  {
    icon: IconUser,
    label: 'Customer',
    short: 'Customer',
    title: 'A customer messages your number',
    text: 'They use the WhatsApp they already have. No app to install, no form to fill.',
    log: [
      ['in', '+91 98xxx xx021', '"Is the Sunday 11 AM slot free?"'],
      ['meta', 'type', 'text · 10:41:07'],
    ],
  },
  {
    icon: IconCloud,
    label: 'WhatsApp Cloud API',
    short: 'Meta API',
    title: 'Meta delivers it to Getnera',
    text: 'Your official WhatsApp Business number runs on Meta’s platform. Every message reaches Getnera by secure webhook within seconds.',
    log: [
      ['post', 'POST', '/webhooks/whatsapp'],
      ['ok', '200 OK', 'messages.received · signature verified'],
    ],
  },
  {
    icon: IconSpark,
    label: 'Getnera AI',
    short: 'AI',
    title: 'AI drafts a reply from your own information',
    text: 'It reads your price list and FAQs, answers the common questions instantly, and hands over to a person when it should.',
    log: [
      ['ai', 'ai.reply', 'source: Price list › Cleaning'],
      ['ok', 'sent', '“Yes, 11 AM is free. Shall I book it?”'],
    ],
  },
  {
    icon: IconLayers,
    label: 'Lead CRM',
    short: 'CRM',
    title: 'The enquiry becomes a lead',
    text: 'Each conversation is linked to a lead with a status, an owner and a full history, so nothing slips through.',
    log: [
      ['crm', 'lead.upsert', 'Priya S · status: Interested'],
      ['crm', 'assign', 'owner: Arun (front desk)'],
    ],
  },
  {
    icon: IconTeam,
    label: 'Team & follow-up',
    short: 'Team',
    title: 'Your team and reminders take it from there',
    text: 'The right person picks up from the shared inbox, and Meta-approved templates handle confirmations and reminders for customers who opted in.',
    log: [
      ['tpl', 'template.schedule', 'appointment_reminder · Sat 18:00'],
      ['ok', 'status', 'Interested → Booked'],
    ],
  },
]

export default function IntegrationFlow() {
  const root = useRef(null)
  const track = useRef(null)
  const activeRef = useRef(0)
  const [active, setActive] = useState(0)

  useGSAP(
    () => {
      const state = { p: 0 }
      const apply = () => {
        track.current.style.setProperty('--p', state.p.toFixed(4))
        const next = Math.min(STEPS.length - 1, Math.floor(state.p * (STEPS.length - 1) + 0.04))
        if (next !== activeRef.current) {
          activeRef.current = next
          setActive(next)
        }
      }

      gsap.to(state, {
        p: 1,
        ease: 'none',
        onUpdate: apply,
        scrollTrigger: {
          trigger: root.current,
          start: 'top top',
          end: () => `+=${window.innerHeight * 2.6}`,
          pin: true,
          scrub: 0.7,
          anticipatePin: 1,
          invalidateOnRefresh: true,
        },
      })

      gsap.from('.flow-head > *', {
        y: 40,
        opacity: 0,
        stagger: 0.1,
        duration: 0.9,
        ease: 'power3.out',
        scrollTrigger: { trigger: root.current, start: 'top 75%' },
      })
    },
    { scope: root },
  )

  const step = STEPS[active]

  return (
    <section id="flow" className="flow" ref={root}>
      <div className="flow-pin">
        <div className="wrap">
          <div className="flow-head">
            <p className="eyebrow eyebrow-dark"><span className="dot" /> How a message moves</p>
            <h2>From <em>“Hi”</em> to a booked customer, in one flow.</h2>
            <p className="flow-sub">Scroll to follow a single WhatsApp message through Getnera.</p>
          </div>

          <div className="flow-track" ref={track} style={{ '--p': 0 }}>
            <div className="flow-line"><div className="flow-line-fill" /></div>
            <div className="flow-packet" aria-hidden="true"><span /></div>
            {STEPS.map((s, i) => {
              const Icon = s.icon
              return (
                <div key={s.label} className={`flow-node ${i <= active ? 'is-on' : ''} ${i === active ? 'is-current' : ''}`}>
                  <div className="flow-node-icon"><Icon /></div>
                  <span className="flow-node-label">
                    <span className="lbl-long">{s.label}</span>
                    <span className="lbl-short">{s.short}</span>
                  </span>
                </div>
              )
            })}
          </div>

          <div className="flow-panel">
            <AnimatePresence mode="wait">
              <motion.div
                key={active}
                className="flow-copy"
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              >
                <span className="flow-step">Step {active + 1} / {STEPS.length}</span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </motion.div>
            </AnimatePresence>

            <div className="terminal" aria-label="Example event log">
              <div className="terminal-bar">
                <i /><i /><i />
                <span>getnera · events</span>
              </div>
              <div className="terminal-body">
                {STEPS.slice(0, active + 1).flatMap((s, si) =>
                  s.log.map(([kind, key, val], li) => (
                    <motion.div
                      key={`${si}-${li}`}
                      className={`log log-${kind} ${si === active ? 'is-new' : ''}`}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: li * 0.12, duration: 0.3 }}
                    >
                      <span className="log-key">{key}</span>
                      <span className="log-val">{val}</span>
                    </motion.div>
                  )),
                )}
                <span className="caret" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
