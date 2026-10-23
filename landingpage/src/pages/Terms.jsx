import LegalPage from '../components/LegalPage'

const links = [
  { href: '/', label: 'Home', minor: true },
  { href: '/privacy-policy', label: 'Privacy', minor: true },
  { href: 'https://app.getnera.in/login', label: 'Login' },
  { href: '/#contact', label: 'Request a demo', cta: true },
]

const sections = [
  {
    id: 'agreement',
    title: '1. Agreement',
    body: <p>These terms are an agreement between you (the business using Getnera) and Afra Ventures Private Limited, CIN U62011PY2026PTC009819, 78, Lenin Street, Kosapalayam, Saram, Puducherry 605013, India ("we", "us"). By creating an account or using Getnera, you accept these terms. If you accept on behalf of a business, you confirm you have authority to bind it.</p>,
  },
  {
    id: 'the-service',
    title: '2. The service',
    body: <p>Getnera is software that lets businesses manage WhatsApp conversations, leads and follow-ups, including AI-assisted replies and approved message templates. We may improve or change features over time.</p>,
  },
  {
    id: 'your-account',
    title: '3. Your account',
    body: <p>You must give accurate information, keep login details safe, and are responsible for what happens under your account, including your team members' actions.</p>,
  },
  {
    id: 'whatsapp-and-meta-rules',
    title: '4. WhatsApp and Meta rules',
    body: (
      <>
        <p>Getnera uses the WhatsApp Business Platform provided by Meta. You must follow the <a href="https://www.whatsapp.com/legal/business-policy">WhatsApp Business Policy</a>, the <a href="https://www.whatsapp.com/legal/commerce-policy">WhatsApp Commerce Policy</a> and Meta's terms. In particular, you must:</p>
        <ul>
          <li>message only people who have given you their number and agreed to hear from you on WhatsApp;</li>
          <li>honour opt-out requests promptly;</li>
          <li>not send spam, illegal content, or content WhatsApp prohibits.</li>
        </ul>
        <p>Meta may limit, suspend or ban a WhatsApp number or account for policy breaches. We are not responsible for Meta's decisions, but we will help where we can.</p>
      </>
    ),
  },
  {
    id: 'your-data',
    title: '5. Your data',
    body: <p>You own the data you and your customers put into Getnera. You give us permission to process it only to provide the service, as described in our <a href="/privacy-policy">Privacy Policy</a>. You are responsible for having a lawful basis, such as consent, for the customer data you upload or collect.</p>,
  },
  {
    id: 'ai-features',
    title: '6. AI features',
    body: <p>AI-generated replies are suggestions based on the information you provide. They may be wrong. You are responsible for the content you send and for reviewing AI settings and knowledge base content.</p>,
  },
  {
    id: 'fees',
    title: '7. Fees',
    body: <p>Paid plans are billed as shown at sign-up or in your order. WhatsApp conversation charges set by Meta may apply in addition. Fees are exclusive of GST, which is charged as applicable. Unless stated otherwise, fees already paid are not refundable.</p>,
  },
  {
    id: 'acceptable-use',
    title: '8. Acceptable use',
    body: <p>You must not misuse Getnera, including by trying to break its security, reverse engineer it, overload it, resell it without our permission, or use it for anything unlawful.</p>,
  },
  {
    id: 'suspension-and-termination',
    title: '9. Suspension and termination',
    body: <p>You may stop using Getnera at any time. We may suspend or end your access if you breach these terms, fail to pay, or if Meta requires it. After termination we handle your data as described in our Privacy Policy.</p>,
  },
  {
    id: 'intellectual-property',
    title: '10. Intellectual property',
    body: <p>We own Getnera, its software and brand. You get a limited, non-transferable right to use it during your subscription.</p>,
  },
  {
    id: 'disclaimers-and-liability',
    title: '11. Disclaimers and liability',
    body: <p>Getnera is provided "as is". We work to keep it available but do not guarantee it will be uninterrupted or error-free, or that third-party services such as WhatsApp will always be available. To the extent the law allows, we are not liable for indirect or consequential losses, and our total liability is limited to the fees you paid us in the three months before the claim.</p>,
  },
  {
    id: 'governing-law',
    title: '12. Governing law',
    body: <p>These terms are governed by the laws of India. The courts at Puducherry have exclusive jurisdiction.</p>,
  },
  {
    id: 'changes',
    title: '13. Changes',
    body: <p>We may update these terms. We will post the new version here and tell account holders by email about important changes.</p>,
  },
  {
    id: 'contact',
    title: '14. Contact',
    body: <p>Afra Ventures Private Limited<br />78, Lenin Street, Kosapalayam, Saram, Puducherry 605013, India<br />Email: <a href="mailto:support@getnera.in">support@getnera.in</a><br />Phone: <a href="tel:+918015359971">+91 80153 59971</a></p>,
  },
]

export default function Terms() {
  return (
    <LegalPage
      title="Terms of Service"
      updated="15 October 2026"
      intro="The agreement between your business and Afra Ventures Private Limited for using Getnera."
      sections={sections}
      links={links}
    />
  )
}
