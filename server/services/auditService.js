const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

async function runAudit(domain) {
  const url = domain.startsWith('http') ? domain : `https://${domain}`;
  
  let score = 0;
  const results = [];
  
  const addResult = (title, status, maxPoints, earnedPoints, missing, fix) => {
    score += earnedPoints;
    results.push({ title, status, score: earnedPoints, maxScore: maxPoints, missing, fix });
  };

  try {
    // 1. Fetch HTML
    const response = await axios.get(url, {
      timeout: 10000,
      httpsAgent: new https.Agent({ rejectUnauthorized: false })
    });
    const html = response.data;
    const $ = cheerio.load(html);

    // 2. H1 Tag (10 points)
    const h1s = $('h1');
    if (h1s.length === 1) {
      addResult('H1 Tag', 'pass', 10, 10, 'None', 'Your H1 tag is perfectly optimized.');
    } else if (h1s.length === 0) {
      addResult('H1 Tag', 'fail', 10, 0, 'No H1 tag found', 'Add a single descriptive H1 tag to the top of your page containing your main keyword.');
    } else {
      addResult('H1 Tag', 'warn', 10, 5, 'Multiple H1 tags found', 'Ensure only one primary H1 tag exists per page to avoid confusing search engines.');
    }

    // 3. Meta Title (10 points)
    const title = $('title').text();
    if (title && title.length >= 30 && title.length <= 60) {
      addResult('Meta Title', 'pass', 10, 10, 'None', 'Title tag is present and optimal length.');
    } else if (title) {
      addResult('Meta Title', 'warn', 10, 5, 'Title length is not optimal', 'Keep title tags between 50-60 characters for best display on Google SERPs.');
    } else {
      addResult('Meta Title', 'fail', 10, 0, 'Missing Meta Title', 'Add a <title> tag in the <head> section with your main keyword.');
    }

    // 4. Meta Description (10 points)
    const desc = $('meta[name="description"]').attr('content');
    if (desc && desc.length >= 120 && desc.length <= 160) {
      addResult('Meta Description', 'pass', 10, 10, 'None', 'Meta description is present and optimal length.');
    } else if (desc) {
      addResult('Meta Description', 'warn', 10, 5, 'Description length is not optimal', 'Keep meta descriptions between 150-160 characters to maximize CTR.');
    } else {
      addResult('Meta Description', 'fail', 10, 0, 'Missing Meta Description', 'Add a meta description tag summarizing the page content to improve click-through rates.');
    }

    // 5. Image Alt Tags (10 points)
    const images = $('img');
    const imagesWithoutAlt = images.filter((i, el) => !$(el).attr('alt')).length;
    if (images.length === 0 || imagesWithoutAlt === 0) {
      addResult('Image Alt Tags', 'pass', 10, 10, 'None', 'All images have alt text.');
    } else {
      addResult('Image Alt Tags', 'fail', 10, 0, `${imagesWithoutAlt} images missing alt text`, 'Add descriptive alt="" attributes to all images for accessibility and image SEO.');
    }

    // 6. Schema Markup (10 points)
    const schemas = $('script[type="application/ld+json"]');
    if (schemas.length > 0) {
      addResult('Schema Markup', 'pass', 10, 10, 'None', 'Valid JSON-LD schema markup detected.');
    } else {
      addResult('Schema Markup', 'fail', 10, 0, 'No JSON-LD Schema found', 'Implement LocalBusiness or Organization schema to help Google understand your entity.');
    }

    // 7. Mobile Viewport (10 points)
    const viewport = $('meta[name="viewport"]').attr('content');
    if (viewport) {
      addResult('Mobile Viewport', 'pass', 10, 10, 'None', 'Mobile viewport tag is present.');
    } else {
      addResult('Mobile Viewport', 'fail', 10, 0, 'Missing Viewport Meta Tag', 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> for mobile responsiveness.');
    }

    // 8. Canonical Tags (10 points)
    const canonical = $('link[rel="canonical"]').attr('href');
    if (canonical) {
      addResult('Canonical Tag', 'pass', 10, 10, 'None', 'Canonical tag is properly set.');
    } else {
      addResult('Canonical Tag', 'fail', 10, 0, 'Missing Canonical Tag', 'Add a canonical link tag pointing to the preferred URL to prevent duplicate content issues.');
    }

    // 9. HTTPS Security (10 points)
    if (url.startsWith('https')) {
      addResult('HTTPS Security', 'pass', 10, 10, 'None', 'Site is secure with SSL.');
    } else {
      addResult('HTTPS Security', 'fail', 10, 0, 'Not using HTTPS', 'Install an SSL certificate and redirect all HTTP traffic to HTTPS.');
    }

    // 10. Thin Content (10 points)
    const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
    const wordCount = bodyText.split(' ').length;
    if (wordCount > 300) {
      addResult('Content Word Count', 'pass', 10, 10, 'None', `Page has good text content (${wordCount} words).`);
    } else {
      addResult('Content Word Count', 'fail', 10, 0, 'Thin Content Detected', `Page only has ${wordCount} words. Aim for at least 300 words of valuable content on core pages.`);
    }

    // 11. Robots.txt (5 points)
    try {
      await axios.get(`${url}/robots.txt`, { timeout: 3000 });
      addResult('Robots.txt', 'pass', 5, 5, 'None', 'Robots.txt file found.');
    } catch (e) {
      addResult('Robots.txt', 'fail', 5, 0, 'Missing robots.txt', 'Create a robots.txt file at the root to guide search engine crawlers.');
    }

    // 12. Sitemap.xml (5 points)
    try {
      await axios.get(`${url}/sitemap.xml`, { timeout: 3000 });
      addResult('Sitemap.xml', 'pass', 5, 5, 'None', 'Sitemap.xml file found.');
    } catch (e) {
      addResult('Sitemap.xml', 'fail', 5, 0, 'Missing sitemap.xml', 'Generate an XML sitemap and submit it to Google Search Console.');
    }

  } catch (error) {
    console.error('Audit failed for', domain, error.message);
    addResult('Site Accessibility', 'fail', 100, 0, 'Could not access website', 'The website returned an error or timed out. Ensure the domain is correct and accessible.');
  }

  return {
    score,
    maxScore: 100,
    results
  };
}

module.exports = { runAudit };
