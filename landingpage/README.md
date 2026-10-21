# Getnera site

React + Vite, with Framer Motion, GSAP ScrollTrigger and Lenis smooth scroll.

```
npm install
npm run dev      # http://localhost:5173
npm run build    # outputs static files to dist/
npm run preview  # serve dist/ locally
```

Deploy the contents of `dist/` to any static host.

## Pages

| URL                    | Source                 |
| ---------------------- | ---------------------- |
| `/`                    | `src/pages/Home.jsx`    |
| `/privacy-policy`       | `src/pages/Privacy.jsx` |
| `/terms`               | `src/pages/Terms.jsx`   |

Routes are clean (no `.html`): each page builds to a folder index (`dist/privacy-policy/index.html`), which every static host serves at `/privacy-policy`. `public/_redirects` sends the old `/privacy-policy.html` and `/terms.html` URLs to the new routes on Netlify / Cloudflare Pages; on other hosts add the same two redirects in the host config.

`npm run build` prerenders every page to static HTML (`scripts/prerender.mjs`), so the full legal text is in the page source for crawlers and Meta's review, and React hydrates on top.

## Where the animation lives

- `src/lib/smooth.js`: Lenis, driven by GSAP's ticker and synced with ScrollTrigger
- `src/sections/Hero.jsx` + `ChatDemo.jsx`: word reveal, pointer tilt, parallax, looping WhatsApp conversation
- `src/sections/IntegrationFlow.jsx`: pinned, scroll-scrubbed message flow (Customer → Meta Cloud API → AI → CRM → Team)
- `src/sections/Statement.jsx`: word-by-word scroll reveal
- `src/sections/HowItWorks.jsx`: pinned horizontal scroll on desktop, stacked on mobile
- `prefers-reduced-motion` turns off Lenis and the CSS loops

The original static files are kept in `_legacy/`.
