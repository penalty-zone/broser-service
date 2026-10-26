/**
 * Custom error classes for reCAPTCHA solving
 */

class RecaptchaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RecaptchaError';
  }
}

class RecaptchaNotFoundError extends RecaptchaError {
  constructor(message = 'reCAPTCHA not found on the page') {
    super(message);
    this.name = 'RecaptchaNotFoundError';
  }
}

class RecaptchaSolveError extends RecaptchaError {
  constructor(message = 'Failed to solve reCAPTCHA') {
    super(message);
    this.name = 'RecaptchaSolveError';
  }
}

class RecaptchaRateLimitError extends RecaptchaError {
  constructor(message = 'reCAPTCHA rate limit exceeded') {
    super(message);
    this.name = 'RecaptchaRateLimitError';
  }
}

class CapSolverError extends RecaptchaError {
  constructor(message = 'CapSolver API error') {
    super(message);
    this.name = 'CapSolverError';
  }
}

class AudioTranscriptionError extends RecaptchaError {
  constructor(message = 'Audio transcription failed') {
    super(message);
    this.name = 'AudioTranscriptionError';
  }
}

module.exports = {
  RecaptchaError,
  RecaptchaNotFoundError,
  RecaptchaSolveError,
  RecaptchaRateLimitError,
  CapSolverError,
  AudioTranscriptionError
};