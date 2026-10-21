import { motion } from 'framer-motion'
import Magnetic from '../components/Magnetic'
import { IconArrow, IconMail, IconPhone } from '../components/Icons'

const ease = [0.22, 1, 0.36, 1]

export default function Contact() {
  return (
    <section id="contact" className="contact">
      <div className="wrap">
        <motion.div
          className="contact-card"
          initial={{ opacity: 0, y: 80, scale: 0.96 }}
          whileInView={{ opacity: 1, y: 0, scale: 1 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 1, ease }}
        >
          <div className="contact-glow" aria-hidden="true" />
          <p className="eyebrow eyebrow-dark"><span className="dot" /> Talk to us</p>
          <h2>Ready to answer every <em>enquiry</em>?</h2>
          <p className="contact-lead">See Getnera on your own WhatsApp number. We’ll set it up with you.</p>
          <Magnetic strength={0.25}>
            <a className="btn btn-primary btn-lg" href="mailto:support@getnera.in?subject=Getnera%20demo">
              Request a demo <IconArrow width={20} height={20} />
            </a>
          </Magnetic>
          <div className="contact-links">
            <a href="mailto:support@getnera.in"><IconMail width={18} height={18} /> support@getnera.in</a>
            <a href="tel:+918015359971"><IconPhone width={18} height={18} /> +91 80153 59971</a>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
