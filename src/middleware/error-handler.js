export function notFound(req, res) {
  res.status(404).json({ error: `API-Endpunkt nicht gefunden: ${req.path}` });
}

export function errorHandler(error, _req, res, _next) {
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600
    ? error.status : 500;
  if (status >= 500) console.error(error);
  res.status(status).json({
    error: status >= 500 ? 'Interner Serverfehler.' : error.message,
  });
}
