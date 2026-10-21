export function notFound(req, res) {
  res.status(404).json({ error: `API-Endpunkt nicht gefunden: ${req.path}` });
}

export function errorHandler(error, _req, res, _next) {
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600
    ? error.status : 500;
  if (status >= 500) {
    if (error.expose === true) console.warn(`${error.constructor.name} [${error.code ?? status}]: ${error.message}`);
    else console.error(error);
  }
  if (Number.isInteger(error.retryAfter) && error.retryAfter > 0) res.set('Retry-After', String(error.retryAfter));
  res.status(status).json({
    error: status >= 500 && error.expose !== true ? 'Interner Serverfehler.' : error.message,
  });
}
