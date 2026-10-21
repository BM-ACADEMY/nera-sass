import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useInView } from 'framer-motion'
import { IconCheck, IconSpark, IconTag, IconBell } from '../components/Icons'

// One illustrative conversation, played on a loop: the customer asks, the AI
// answers from the price list, and Getnera files the lead and books a reminder.
const SCRIPT = [
  { kind: 'msg', from: 'in', text: 'Hi! How much is teeth cleaning? Are you open on Sunday?', time: '10:41', delay: 700 },
  { kind: 'typing', delay: 900 },
  { kind: 'msg', from: 'out', ai: true, text: 'Hi Priya 👋 Teeth cleaning is ₹800. On Sunday we are open 10 AM – 2 PM. Shall I book a slot for you?', time: '10:41', delay: 1500 },
  { kind: 'event', key: 'lead', delay: 700 },
  { kind: 'msg', from: 'in', text: 'Yes, 11 AM please', time: '10:42', delay: 1500 },
  { kind: 'typing', delay: 800 },
  { kind: 'msg', from: 'out', ai: true, text: 'Booked ✅ Sunday, 11:00 AM. We will send you a reminder the day before.', time: '10:42', delay: 1400 },
  { kind: 'event', key: 'reminder', delay: 700 },
  { kind: 'event', key: 'status', delay: 900 },
]
const HOLD = 4200

function useScript(active) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (!active) return
    const done = step >= SCRIPT.length
    const t = setTimeout(() => setStep(done ? 0 : step + 1), done ? HOLD : SCRIPT[step].delay)
    return () => clearTimeout(t)
  }, [step, active])

  const applied = SCRIPT.slice(0, step)
  return {
    messages: applied.map((s, i) => ({ ...s, id: i })).filter((s) => s.kind === 'msg'),
    typing: applied.at(-1)?.kind === 'typing',
    events: new Set(applied.filter((s) => s.kind === 'event').map((s) => s.key)),
  }
}

const bubble = {
  initial: { opacity: 0, y: 14, scale: 0.92 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 380, damping: 26 } },
  exit: { opacity: 0, transition: { duration: 0.25 } },
}

export function Phone({ messages, typing, events }) {
  const scroller = useRef(null)
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages.length, typing])

  return (
    <div className="phone">
      <div className="phone-notch" />
      <div className="phone-app">
        <div className="phone-bar">
          <span className="phone-tab">Getnera · Inbox</span>
          <span className="phone-live"><i />Live</span>
        </div>
        <div className="phone-head">
          <div className="avatar">PS</div>
          <div>
            <strong>Priya S</strong>
            <span>+91 98xxx xx021 · WhatsApp</span>
          </div>
          <AnimatePresence>
            {events.has('status') && (
              <motion.span className="pill pill-green" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                Booked
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <div className="phone-chat" ref={scroller}>
          <div className="chat-day">Today</div>
          <AnimatePresence initial={false}>
            {messages.map((m) => (
              <motion.div key={m.id} className={`bubble ${m.from}`} layout {...bubble}>
                {m.ai && <span className="bubble-ai"><IconSpark width={11} height={11} /> AI reply</span>}
                <p>{m.text}</p>
                <span className="bubble-meta">
                  {m.time}
                  {m.from === 'out' && <span className="ticks">✓✓</span>}
                </span>
              </motion.div>
            ))}
            {typing && (
              <motion.div key="typing" className="bubble out typing" {...bubble}>
                <span /><span /><span />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="phone-input">
          <span>Message</span>
          <i />
        </div>
      </div>
    </div>
  )
}

const card = {
  initial: { opacity: 0, y: 24, scale: 0.9, filter: 'blur(6px)' },
  animate: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', transition: { type: 'spring', stiffness: 260, damping: 22 } },
  exit: { opacity: 0, y: -10, scale: 0.95, transition: { duration: 0.3 } },
}

export default function ChatDemo() {
  const ref = useRef(null)
  const inView = useInView(ref, { amount: 0.25 })
  const state = useScript(inView)
  const { events } = state

  return (
    <div className="chat-demo" ref={ref}>
      <Phone {...state} />
      <div className="float-cards" aria-hidden="true">
        <AnimatePresence>
          {events.has('lead') && (
            <motion.div key="lead" className="float-card fc-lead" {...card}>
              <span className="fc-icon"><IconTag /></span>
              <div>
                <small>Lead created</small>
                <strong>Priya S · Teeth cleaning</strong>
                <span className="fc-meta">Owner: Arun · Source: WhatsApp</span>
              </div>
            </motion.div>
          )}
          {events.has('reminder') && (
            <motion.div key="reminder" className="float-card fc-reminder" {...card}>
              <span className="fc-icon"><IconBell /></span>
              <div>
                <small>Template scheduled</small>
                <strong>appointment_reminder</strong>
                <span className="fc-meta">Sat, 6:00 PM · Approved by Meta</span>
              </div>
            </motion.div>
          )}
          {events.has('status') && (
            <motion.div key="status" className="float-card fc-status" {...card}>
              <span className="fc-icon"><IconCheck /></span>
              <div>
                <small>Status changed</small>
                <strong>Interested → Booked</strong>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
