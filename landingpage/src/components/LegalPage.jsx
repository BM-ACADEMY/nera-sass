import { useEffect, useRef, useState } from 'react'
import { gsap, useGSAP } from '../lib/gsap'
import { prefersReducedMotion } from '../lib/smooth'
import Layout from './Layout'

// Legal text stays fully visible in the prerendered HTML; GSAP only animates
// it in after hydration, so crawlers and no-JS readers always get the content.
export default function LegalPage({ title, updated, intro, sections, links }) {
  const root = useRef(null)
  const [current, setCurrent] = useState(sections[0].id)

  useGSAP(
    () => {
      if (prefersReducedMotion()) return
      gsap.from('.legal-hero .reveal-line > span', { yPercent: 110, duration: 1, stagger: 0.08, ease: 'power4.out' })
      gsap.from('.legal-hero .legal-meta, .legal-toc', { opacity: 0, y: 20, duration: 0.8, delay: 0.3, stagger: 0.1, ease: 'power3.out' })
      gsap.utils.toArray('.legal-section').forEach((el) => {
        gsap.from(el, {
          opacity: 0,
          y: 36,
          duration: 0.8,
          ease: 'power3.out',
          scrollTrigger: { trigger: el, start: 'top 88%', once: true },
        })
      })
    },
    { scope: root },
  )

  // Scroll-spy for the table of contents.
  useEffect(() => {
    const els = sections.map((s) => document.getElementById(s.id)).filter(Boolean)
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setCurrent(visible[0].target.id)
      },
      { rootMargin: '-20% 0px -65% 0px' },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [sections])

  return (
    <Layout links={links}>
      <main className="legal" ref={root}>
        <header className="legal-hero">
          <div className="wrap">
            <h1>
              <span className="reveal-line"><span>{title}</span></span>
            </h1>
            <p className="legal-meta">
              <span className="pill">Effective date: {updated}</span>
              <span>{intro}</span>
            </p>
          </div>
        </header>
        <div className="wrap legal-body">
          <aside className="legal-toc" aria-label="On this page">
            <p>On this page</p>
            <ol>
              {sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className={current === s.id ? 'is-active' : undefined}>{s.title}</a>
                </li>
              ))}
            </ol>
          </aside>
          <article className="legal-content">
            {sections.map((s) => (
              <section key={s.id} id={s.id} className="legal-section">
                <h2>{s.title}</h2>
                {s.body}
              </section>
            ))}
          </article>
        </div>
      </main>
    </Layout>
  )
}
