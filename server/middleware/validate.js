'use strict';

const { sendError } = require('../lib/http');

function ensureJsonObjectBody(req, res, next) {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Body must be a JSON object');
  }
  return next();
}

function validateWith(validator) {
  return (req, res, next) => {
    const error = validator(req);
    if (typeof error === 'string' && error) {
      return sendError(res, 400, 'VALIDATION_ERROR', error);
    }
    return next();
  };
}

module.exports = {
  ensureJsonObjectBody,
  validateWith,
};
