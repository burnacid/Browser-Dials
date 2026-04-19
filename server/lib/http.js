'use strict';

function sendError(res, status, code, message, details) {
  const payload = {
    error: message,
    code,
  };

  if (details !== undefined) {
    payload.details = details;
  }

  return res.status(status).json(payload);
}

module.exports = {
  sendError,
};
