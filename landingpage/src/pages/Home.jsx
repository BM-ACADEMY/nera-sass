import Layout from '../components/Layout'
import Hero from '../sections/Hero'
import Marquee from '../sections/Marquee'
import IntegrationFlow from '../sections/IntegrationFlow'
import Statement from '../sections/Statement'
import Features from '../sections/Features'
import HowItWorks from '../sections/HowItWorks'
import Contact from '../sections/Contact'

const links = [
  { href: '#features', label: 'Features', minor: true },
  { href: '#flow', label: 'How it works', minor: true },
  { href: 'https://app.getnera.in/login', label: 'Login' },
  { href: '#contact', label: 'Request a demo', cta: true },
]

export default function Home() {
  return (
    <Layout links={links}>
      <main>
        <Hero />
        <Marquee />
        <IntegrationFlow />
        <Statement />
        <Features />
        <HowItWorks />
        <Contact />
      </main>
    </Layout>
  )
}
