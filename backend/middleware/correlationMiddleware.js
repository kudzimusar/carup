import crypto from 'crypto';

function firstHeaderValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

export default function correlationMiddleware(req, res, next) {
  const incomingRequestId = firstHeaderValue(req.headers['x-request-id']);
  const incomingCorrelationId = firstHeaderValue(req.headers['x-correlation-id']);
  const requestId = incomingRequestId || incomingCorrelationId || `req-${crypto.randomUUID()}`;

  req.requestId = requestId;
  req.correlationId = requestId;

  res.setHeader('x-request-id', requestId);
  res.setHeader('x-correlation-id', requestId);

  next();
}
