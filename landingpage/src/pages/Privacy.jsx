import LegalPage from '../components/LegalPage'

const links = [
  { href: '/', label: 'Home', minor: true },
  { href: '/terms', label: 'Terms', minor: true },
  { href: '/#contact', label: 'Request a demo', cta: true },
]

const mail = <a href="mailto:support@getnera.in">support@getnera.in</a>

const sections = [
  {
    id: 'who-we-are',
    title: '1. Who we are',
    body: <p>Getnera ("Getnera", "we", "us") is a software product operated by Afra Ventures Private Limited, CIN U62011PY2026PTC009819, 78, Lenin Street, Kosapalayam, Saram, Puducherry 605013, India. This policy explains how we handle personal data when businesses use Getnera and when people message those businesses through Getnera.</p>,
  },
  {
    id: 'our-role',
    title: '2. Our role',
    body: <p>For data about our customers' own accounts (the business and its team members), we decide how that data is used. For the messages and contact details of a business's customers, the business decides how that data is used and we process it on the business's behalf and on its instructions.</p>,
  },
  {
    id: 'what-we-collect',
    title: '3. What we collect',
    body: (
      <ul>
        <li><strong>Account data:</strong> name, business name, email, phone number and login details of the people who use Getnera.</li>
        <li><strong>WhatsApp data:</strong> when a business connects its WhatsApp Business account, we receive and store messages, media, phone numbers, profile names, message status (sent, delivered, read) and template details through the WhatsApp Business Platform operated by Meta.</li>
        <li><strong>Lead and contact data:</strong> details a business records about its customers in Getnera, such as names, phone numbers, notes and lead status.</li>
        <li><strong>Usage data:</strong> logs, device and browser information, and IP addresses, used to run and secure the service.</li>
        <li><strong>Billing data:</strong> invoices and payment records. Card details are handled by our payment provider and are not stored by us.</li>
      </ul>
    ),
  },
  {
    id: 'how-we-use-it',
    title: '4. How we use it',
    body: (
      <>
        <ul>
          <li>To provide Getnera: show conversations, send and receive WhatsApp messages, manage leads and send approved message templates.</li>
          <li>To generate suggested or automated replies when the business has turned on AI features.</li>
          <li>To keep the service secure, prevent abuse and fix problems.</li>
          <li>To bill for the service and meet legal, tax and accounting obligations.</li>
          <li>To contact account holders about their account and service changes.</li>
        </ul>
        <p>We do not sell personal data. We do not use the messages of a business's customers for advertising.</p>
      </>
    ),
  },
  {
    id: 'meta-and-whatsapp',
    title: '5. Meta and WhatsApp',
    body: <p>Getnera uses the WhatsApp Business Platform provided by Meta Platforms, Inc. and its affiliates. Messages sent and received through Getnera pass through Meta's systems and are also subject to <a href="https://www.whatsapp.com/legal/business-policy">WhatsApp's Business Policy</a> and <a href="https://www.whatsapp.com/legal/privacy-policy">WhatsApp's Privacy Policy</a>. We access a business's WhatsApp account only with the permissions the business grants, and only to provide Getnera.</p>,
  },
  {
    id: 'who-else-sees-it',
    title: '6. Who else sees it',
    body: (
      <>
        <p>We share data only with service providers that help us run Getnera, under contracts that limit their use of it:</p>
        <ul>
          <li>Meta, to send and receive WhatsApp messages;</li>
          <li>cloud hosting and database providers;</li>
          <li>AI service providers, only when AI features are turned on, to generate replies;</li>
          <li>payment, email and analytics providers.</li>
        </ul>
        <p>We may disclose data where Indian law requires it, or to protect our rights and users' safety.</p>
      </>
    ),
  },
  {
    id: 'how-long-we-keep-it',
    title: '7. How long we keep it',
    body: <p>We keep account and WhatsApp data while the business's account is active. After an account is closed, we delete or anonymise its data within 90 days, except billing and records we must keep under Indian tax and company law.</p>,
  },
  {
    id: 'data-deletion',
    title: '8. Data deletion',
    body: (
      <>
        <p>A business can delete conversations and contacts inside Getnera at any time, or ask us to delete its whole account and data by emailing <a href="mailto:support@getnera.in?subject=Getnera%20data%20deletion%20request">support@getnera.in</a> with the subject "Getnera data deletion request" from the account's registered email.</p>
        <p>If you messaged a business that uses Getnera and want your data deleted, contact that business first. You can also email us with your phone number and the business's name, and we will pass on your request and help the business act on it.</p>
        <p>We confirm deletion requests within 7 days and complete them within 30 days.</p>
        <p>If you connected Getnera using Facebook, you can also remove its access at any time from your Facebook settings under Business Integrations.</p>
      </>
    ),
  },
  {
    id: 'your-rights',
    title: '9. Your rights',
    body: <p>Under India's Digital Personal Data Protection Act, 2023 and other applicable law, you can ask to access, correct or delete your personal data, withdraw consent, and nominate someone to act for you. Email {mail}.</p>,
  },
  {
    id: 'security',
    title: '10. Security',
    body: <p>We protect data with encryption in transit, encrypted storage of access tokens, access controls and logging. No system is perfectly secure, and we will notify affected businesses and authorities of a breach as the law requires.</p>,
  },
  {
    id: 'children',
    title: '11. Children',
    body: <p>Getnera is a business tool and is not intended for anyone under 18.</p>,
  },
  {
    id: 'changes',
    title: '12. Changes',
    body: <p>We may update this policy. We will post the new version here with a new effective date, and tell account holders by email about important changes.</p>,
  },
  {
    id: 'contact',
    title: '13. Contact and grievance officer',
    body: <p>Afra Ventures Private Limited<br />78, Lenin Street, Kosapalayam, Saram, Puducherry 605013, India<br />Email: {mail}<br />Phone: <a href="tel:+918015359971">+91 80153 59971</a></p>,
  },
]

export default function Privacy() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="15 October 2026"
      intro="How Getnera handles personal data, WhatsApp data and deletion requests."
      sections={sections}
      links={links}
    />
  )
}
