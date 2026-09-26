/**
 * Custom error class representing client input validation failures.
 */
export class ValidationError extends Error {
  /**
   * @param {string} message - Human-readable validation error description
   * @param {any} [details=null] - Optional detailed validation failure info
   */
  constructor(message, details = null) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
    this.details = details;
  }
}
