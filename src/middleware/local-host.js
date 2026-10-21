const LOOPBACK_ALIASES = new Set(['127.0.0.1', '127.0.0.0', '::1', '[::1]']);

// Keep local browser pages on one host before any login cookies are issued.
export function localHost(req, res, next) {
  if (!['GET', 'HEAD'].includes(req.method) || !LOOPBACK_ALIASES.has(req.hostname) ||
      /^\/(?:api|assets|socket\.io)(?:\/|$)/.test(req.path) || req.path === '/favicon.ico') {
    return next();
  }
  const port = req.socket.localPort;
  // The destination host is fixed; the original URL is only appended as a path.
  res.redirect(307, `http://localhost:${port}${req.originalUrl}`);
}
