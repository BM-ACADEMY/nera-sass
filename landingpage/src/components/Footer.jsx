import { motion } from 'framer-motion'

const letters = 'Getnera'.split('')

export default function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer-grid">
          <div>
            <p className="footer-strong">Getnera is a product of Afra Ventures Private Limited.</p>
            <p>78, Lenin Street, Kosapalayam, Saram, Puducherry 605013, India</p>
            <p>CIN U62011PY2026PTC009819 · GSTIN 34ABGCA7083D1ZS</p>
          </div>
          <div className="footer-links">
            <a href="/">Home</a>
            <a href="/privacy-policy">Privacy Policy</a>
            <a href="/privacy-policy#data-deletion">Data deletion</a>
            <a href="/terms">Terms of Service</a>
            <a href="https://afraventures.in">afraventures.in</a>
          </div>
          <div className="footer-links">
            <a href="mailto:support@getnera.in">support@getnera.in</a>
            <a href="tel:+918015359971">+91 80153 59971</a>
          </div>
        </div>
        {/* Observe the clipping parent, not the letters: they start outside its box. */}
        <motion.div
          className="footer-word"
          aria-hidden="true"
          initial="hidden"
          whileInView="shown"
          viewport={{ once: true, amount: 0.4 }}
          transition={{ staggerChildren: 0.05 }}
        >
          {letters.map((ch, i) => (
            <motion.span
              key={i}
              variants={{ hidden: { y: '105%' }, shown: { y: '0%' } }}
              transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            >
              {ch}
            </motion.span>
          ))}
        </motion.div>
        <p className="footer-copy">© 2026 Afra Ventures Private Limited</p>
      </div>
    </footer>
  )
}
