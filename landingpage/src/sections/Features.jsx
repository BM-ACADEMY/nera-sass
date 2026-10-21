import { motion } from 'framer-motion'
import { IconInbox, IconSpark, IconTag, IconBell } from '../components/Icons'

const ease = [0.22, 1, 0.36, 1]

function InboxVisual() {
  const rows = [
    ['RK', 'Rahul K', 'Price for 2BHK?', 'Arun'],
    ['MS', 'Meena S', 'Can I come at 5?', 'Divya'],
    ['JT', 'Joseph T', 'Thanks, received ✅', 'Arun'],
  ]
  return (
    <div className="fv fv-inbox">
      {rows.map(([i, n, m, o], k) => (
        <motion.div key={n} className="fv-row" initial={{ opacity: 0, x: -16 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.3 + k * 0.12, ease }}>
          <span className="avatar sm">{i}</span>
          <span className="fv-row-text"><strong>{n}</strong><small>{m}</small></span>
          <span className="fv-owner">{o}</span>
        </motion.div>
      ))}
    </div>
  )
}

function AIVisual() {
  return (
    <div className="fv fv-ai">
      <div className="fv-q">Do you deliver to Saram?</div>
      <motion.div className="fv-suggest" initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.45, ease }}>
        <span className="bubble-ai"><IconSpark width={11} height={11} /> Suggested from FAQs</span>
        Yes! Free delivery in Saram on orders above ₹500.
      </motion.div>
    </div>
  )
}

function LeadVisual() {
  const stages = [['New', 4], ['Contacted', 3], ['Follow-up', 2], ['Won', 1]]
  return (
    <div className="fv fv-leads">
      {stages.map(([s, n], k) => (
        <div key={s} className="fv-stage">
          <small>{s}</small>
          <motion.div className="fv-bar" initial={{ scaleY: 0 }} whileInView={{ scaleY: 1 }} viewport={{ once: true }} transition={{ delay: 0.3 + k * 0.1, duration: 0.7, ease }} style={{ height: `${n * 14 + 10}px` }} />
        </div>
      ))}
    </div>
  )
}

function TemplateVisual() {
  return (
    <div className="fv fv-tpl">
      <div className="fv-tpl-head">
        <code>appointment_reminder</code>
        <motion.span className="pill pill-green" initial={{ scale: 0 }} whileInView={{ scale: 1 }} viewport={{ once: true }} transition={{ delay: 0.5, type: 'spring', stiffness: 400, damping: 15 }}>Approved</motion.span>
      </div>
      <p>Hi {'{{1}}'}, a reminder of your visit on {'{{2}}'} at {'{{3}}'}. Reply STOP to opt out.</p>
    </div>
  )
}

const FEATURES = [
  { icon: IconInbox, title: 'Shared WhatsApp inbox', text: 'Your whole team works from one official WhatsApp Business number, with every conversation in one place.', visual: InboxVisual },
  { icon: IconSpark, title: 'AI-assisted replies', text: 'Answer common questions instantly from your own price list and FAQs, and hand over to a person when needed.', visual: AIVisual },
  { icon: IconTag, title: 'Lead tracking', text: 'Every enquiry becomes a lead with a status, an owner and a history, so nothing slips through.', visual: LeadVisual },
  { icon: IconBell, title: 'Approved templates and reminders', text: 'Send Meta-approved message templates for confirmations, reminders and follow-ups to customers who have opted in.', visual: TemplateVisual },
]

function spotlight(e) {
  const r = e.currentTarget.getBoundingClientRect()
  e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`)
  e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`)
}

export default function Features() {
  return (
    <section id="features" className="features">
      <div className="wrap">
        <motion.div className="section-head" initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.5 }} transition={{ duration: 0.8, ease }}>
          <p className="eyebrow"><span className="dot" /> Features</p>
          <h2>Everything your team needs to <em>sell on WhatsApp</em>.</h2>
        </motion.div>
        <div className="feature-grid">
          {FEATURES.map(({ icon: Icon, title, text, visual: Visual }, i) => (
            <motion.article
              key={title}
              className="feature-card"
              onPointerMove={spotlight}
              initial={{ opacity: 0, y: 60 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.25 }}
              transition={{ duration: 0.8, delay: (i % 2) * 0.12, ease }}
              whileHover={{ y: -6 }}
            >
              <Visual />
              <div className="feature-body">
                <span className="feature-icon"><Icon /></span>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  )
}
