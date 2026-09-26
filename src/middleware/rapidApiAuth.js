/**
 * Middleware to verify RapidAPI proxy header secret if configured in environment (RAPIDAPI_PROXY_SECRET)
 */
export function rapidApiAuth(req, res, next) {
  const proxySecret = process.env.RAPIDAPI_PROXY_SECRET;

  // If no secret configured, allow request (for development or public deployment)
  if (!proxySecret) {
    return next();
  }

  const headerSecret = req.headers['x-rapidapi-proxy-secret'];

  if (!headerSecret || headerSecret !== proxySecret) {
    return res.status(403).json({
      error: 'Invalid or missing RapidAPI Proxy Secret header (x-rapidapi-proxy-secret).',
      code: 'UNAUTHORIZED',
    });
  }

  next();
}

export default rapidApiAuth;
