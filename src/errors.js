/**
 * Custom error class representing client input validation failures.
 */
export class ValidationError extends Error {
  /**
   * @param {string} message - Human-readable validation error description
   * @param {string} [code='VALIDATION_ERROR'] - Machine-readable error code
   * @param {any} [details=null] - Optional detailed validation failure info
   */
  constructor(message, code = 'VALIDATION_ERROR', details = null) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
    this.code = code;
    this.details = details;
  }
}
