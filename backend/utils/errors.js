export class CarUpError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_SERVER_ERROR', details = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends CarUpError {
  constructor(message = 'Validation failed', details = null) {
    super(message, 400, 'VALIDATION_FAILED', details);
  }
}

export class UnauthorizedError extends CarUpError {
  constructor(message = 'Unauthorized access', details = null) {
    super(message, 401, 'UNAUTHORIZED_ACCESS', details);
  }
}

export class ForbiddenError extends CarUpError {
  constructor(message = 'Insufficient permissions', details = null) {
    super(message, 403, 'INSUFFICIENT_PERMISSIONS', details);
  }
}

export class NotFoundError extends CarUpError {
  constructor(message = 'Resource not found', details = null) {
    super(message, 404, 'RESOURCE_NOT_FOUND', details);
  }
}

export class ConflictError extends CarUpError {
  constructor(message = 'Resource conflict', details = null) {
    super(message, 409, 'CONFLICT', details);
  }
}

export class DatabaseError extends CarUpError {
  constructor(message = 'Database query failed', details = null) {
    super(message, 500, 'DATABASE_ERROR', details);
  }
}
