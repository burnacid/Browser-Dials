'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ensureJsonObjectBody, validateWith } = require('../middleware/validate');

function createResRecorder() {
  return {
    statusCode: null,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

test('ensureJsonObjectBody rejects missing body', () => {
  const req = { body: undefined };
  const res = createResRecorder();
  let calledNext = false;

  ensureJsonObjectBody(req, res, () => {
    calledNext = true;
  });

  assert.equal(calledNext, false);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, { error: 'Body must be a JSON object', code: 'VALIDATION_ERROR' });
});

test('ensureJsonObjectBody rejects array body', () => {
  const req = { body: [] };
  const res = createResRecorder();
  let calledNext = false;

  ensureJsonObjectBody(req, res, () => {
    calledNext = true;
  });

  assert.equal(calledNext, false);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, { error: 'Body must be a JSON object', code: 'VALIDATION_ERROR' });
});

test('ensureJsonObjectBody passes object body', () => {
  const req = { body: { ok: true } };
  const res = createResRecorder();
  let calledNext = false;

  ensureJsonObjectBody(req, res, () => {
    calledNext = true;
  });

  assert.equal(calledNext, true);
  assert.equal(res.statusCode, null);
});

test('validateWith returns 400 when validator returns a message', () => {
  const req = { body: { value: 1 } };
  const res = createResRecorder();
  let calledNext = false;

  const middleware = validateWith(() => 'validation failed');
  middleware(req, res, () => {
    calledNext = true;
  });

  assert.equal(calledNext, false);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, { error: 'validation failed', code: 'VALIDATION_ERROR' });
});

test('validateWith passes when validator returns null', () => {
  const req = { body: { value: 1 } };
  const res = createResRecorder();
  let calledNext = false;

  const middleware = validateWith(() => null);
  middleware(req, res, () => {
    calledNext = true;
  });

  assert.equal(calledNext, true);
  assert.equal(res.statusCode, null);
});
