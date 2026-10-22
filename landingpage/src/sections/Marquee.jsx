const industries = [
  'Clinics', 'Real estate', 'Salons & spas', 'Coaching institutes', 'Retail stores',
  'Travel agencies', 'Restaurants', 'Car dealers', 'Interior studios', 'Gyms',
]

export default function Marquee() {
  const row = [...industries, ...industries]
  return (
    <section className="marquee" aria-label="Built for businesses that sell on WhatsApp">
      <p className="marquee-label">Built for businesses that sell on WhatsApp</p>
      <div className="marquee-mask">
        <div className="marquee-row">
          {row.map((name, i) => (
            <span key={i} aria-hidden={i >= industries.length}>
              {name}
              <i />
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}
