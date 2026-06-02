import crypto from 'crypto';
import { CarUpError } from '../utils/errors.js';

export default function errorHandler(err, req, res, next) {
  const requestId = `req-${crypto.randomUUID()}`;
  const timestamp = new Date().toISOString();
  
  let statusCode = 500;
  let code = 'INTERNAL_SERVER_ERROR';
  let message = 'An unexpected internal server error occurred';
  let details = null;

  if (err instanceof CarUpError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err instanceof Error) {
    details = err.message;
  } else if (err) {
    details = String(err);
  }

  // Log error with request ID for backend auditing
  console.error(`[${requestId}] Error Handled:`, {
    path: req.path,
    method: req.method,
    statusCode,
    code,
    message,
    details: process.env.NODE_ENV !== 'production' ? details : undefined,
    stack: err instanceof Error ? err.stack : undefined
  });

  // Construct standard error payload
  const errorResponse = {
    success: false,
    error: {
      code,
      message,
      timestamp,
      requestId
    }
  };

  // Only expose diagnostic details outside production viewports
  if (process.env.NODE_ENV !== 'production' && details) {
    errorResponse.error.details = details;
  }

  res.status(statusCode).json(errorResponse);
}
