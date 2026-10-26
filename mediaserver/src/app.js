/**
 * HTTP surface of the media server.
 *
 *   POST   /internal/files/:scope        store a file (body = raw bytes)      x-media-key
 *   GET    /internal/files/:scope/:id    read a file back (for Meta upload)   x-media-key
 *   DELETE /internal/files/:scope/:id    delete a file                        x-media-key
 *   GET    /f/:scope/:id/:name?exp&sig   public signed link (browser, Meta)
 *   GET    /health
 *
 * /internal/* is only for the API; nginx should not expose it (see deploy/nginx).
 */
const crypto = require('crypto');
const express = require('express');
const { Readable, pipeline } = require('stream');
const { createStore, MediaError } = require('./store');
const signing = require('./signing');

// Types a browser could run as a page: always downloaded, never shown inline.
const ACTIVE_TYPES = /^(text\/html|application\/xhtml|image\/svg|text\/xml|application\/xml|application\/javascript|text\/javascript)/i;

function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;
  let start;
  let end;
  if (match[1] === '') {
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  return start <= end && start < size ? { start, end } : null;
}

const contentDisposition = (type, name) => (name
  ? `${type}; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`
  : type);

function createApp(config, storage) {
  const store = createStore({ storage, masterKey: config.masterKey, maxBytes: config.maxBytes });
  const app = express();
  app.disable('x-powered-by');

  const internalKey = Buffer.from(config.internalKey);
  const internalOnly = (req, res, next) => {
    const given = Buffer.from(String(req.headers['x-media-key'] || ''));
    if (given.length !== internalKey.length || !crypto.timingSafeEqual(given, internalKey)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  };

  // Sends a decrypted file (or one byte range of it) to the response.
  async function sendFile(req, res, file, { disposition = 'inline', name = '', cacheSeconds = 0 } = {}) {
    const { size, mime } = file.header;
    let start = 0;
    let end = size - 1;
    let range = null;
    if (req.headers.range && size > 0) {
      range = parseRange(req.headers.range, size);
      if (!range) {
        res.setHeader('Content-Range', `bytes */${size}`);
        return res.status(416).end();
      }
      ({ start, end } = range);
    }
    // Decrypt the first chunk before any header goes out, so a damaged file
    // answers 500 instead of a cut-off 200.
    const chunks = store.read(file, start, end);
    const first = req.method === 'HEAD' ? { done: true } : await chunks.next();

    const active = ACTIVE_TYPES.test(mime);
    res.setHeader('Content-Type', mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Disposition', contentDisposition(active ? 'attachment' : disposition, name));
    res.setHeader('Cache-Control', cacheSeconds > 0 ? `private, max-age=${cacheSeconds}` : 'no-store');

    if (range) res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', String(Math.max(0, end - start + 1)));
    if (req.method === 'HEAD') return res.end();

    async function* body() {
      if (!first.done) yield first.value;
      yield* chunks;
    }
    pipeline(Readable.from(body()), res, (err) => {
      if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') console.error('[media] stream failed:', err.message);
    });
  }

  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.post('/internal/files/:scope', internalOnly, async (req, res) => {
    const declared = Number(req.headers['content-length']);
    if (declared > config.maxBytes) throw new MediaError(413, 'File is too large');
    const mime = String(req.headers['x-media-type'] || req.headers['content-type'] || 'application/octet-stream');
    const saved = await store.save(req.params.scope, req, mime);
    res.status(201).json(saved);
  });

  app.get('/internal/files/:scope/:id', internalOnly, async (req, res) => {
    await sendFile(req, res, await store.open(req.params.scope, req.params.id), { disposition: 'attachment' });
  });

  app.delete('/internal/files/:scope/:id', internalOnly, async (req, res) => {
    await store.remove(req.params.scope, req.params.id);
    res.json({ deleted: true });
  });

  app.get('/f/:scope/:id{/:name}', async (req, res) => {
    const { scope, id } = req.params;
    const name = req.params.name || '';
    const { exp, sig } = req.query;
    if (!signing.verify(config.signingSecret, { scope, id, name, exp, sig })) {
      return res.status(403).setHeader('Cache-Control', 'no-store').json({ error: 'This link has expired or is not valid' });
    }
    const origin = req.headers.origin;
    if (origin && config.allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    const file = await store.open(scope, id);
    const cacheSeconds = Math.min(3600, Number(exp) - Math.floor(Date.now() / 1000));
    await sendFile(req, res, file, { disposition: req.query.dl === '1' ? 'attachment' : 'inline', name, cacheSeconds });
  });

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err instanceof MediaError ? err.status : 500;
    if (status >= 500) console.error('[media]', err.message);
    if (res.headersSent) return res.destroy();
    res.status(status).json({ error: status >= 500 ? 'Media server error' : err.message });
  });

  return app;
}

module.exports = { createApp, parseRange };
