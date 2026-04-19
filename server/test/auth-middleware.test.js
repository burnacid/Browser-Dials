'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../db');
const requireApiKey = require('../middleware/apiKey');
const requireAuth = require('../middleware/auth');
const { hashPassword } = require('../security');

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

test('requireApiKey rejects missing Authorization header', async () => {
  const req = { headers: {} };
  const res = createResRecorder();
  let nextCalled = false;

  await requireApiKey(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.payload, { error: 'Missing authorization header', code: 'MISSING_AUTH_HEADER' });
});

test('requireApiKey rejects invalid API key', async () => {
  const originalExecute = db.execute;
  db.execute = async () => [[]];

  try {
    const req = { headers: { authorization: 'Bearer bad-key' } };
    const res = createResRecorder();
    let nextCalled = false;

    await requireApiKey(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.payload, { error: 'Invalid API key', code: 'INVALID_API_KEY' });
  } finally {
    db.execute = originalExecute;
  }
});

test('requireApiKey accepts valid API key and sets req.apiKeyId', async () => {
  const originalExecute = db.execute;
  db.execute = async () => [[{ id: 'api-key-id-1' }]];

  try {
    const req = { headers: { authorization: 'Bearer good-key' } };
    const res = createResRecorder();
    let nextCalled = false;

    await requireApiKey(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(req.apiKeyId, 'api-key-id-1');
    assert.equal(res.statusCode, null);
  } finally {
    db.execute = originalExecute;
  }
});

test('requireAuth rejects when user credentials are missing', async () => {
  const req = {
    headers: {
      authorization: 'Bearer good-key',
    },
  };
  const res = createResRecorder();
  let nextCalled = false;

  await requireAuth(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.payload, { error: 'Missing user credentials', code: 'MISSING_USER_CREDENTIALS' });
});

test('requireAuth rejects invalid API key', async () => {
  const originalExecute = db.execute;
  db.execute = async () => [[]];

  try {
    const req = {
      headers: {
        authorization: 'Bearer bad-key',
        'x-sync-user': 'alice',
        'x-sync-password': 'password123',
      },
    };
    const res = createResRecorder();
    let nextCalled = false;

    await requireAuth(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.payload, { error: 'Invalid API key', code: 'INVALID_API_KEY' });
  } finally {
    db.execute = originalExecute;
  }
});

test('requireAuth rejects invalid user credentials', async () => {
  const originalExecute = db.execute;
  let callCount = 0;
  db.execute = async () => {
    callCount += 1;
    if (callCount === 1) {
      return [[{ id: 'api-key-id-1' }]];
    }
    return [[]];
  };

  try {
    const req = {
      headers: {
        authorization: 'Bearer good-key',
        'x-sync-user': 'alice',
        'x-sync-password': 'password123',
      },
    };
    const res = createResRecorder();
    let nextCalled = false;

    await requireAuth(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.payload, { error: 'Invalid user credentials', code: 'INVALID_USER_CREDENTIALS' });
  } finally {
    db.execute = originalExecute;
  }
});

test('requireAuth rejects disabled users', async () => {
  const originalExecute = db.execute;
  let callCount = 0;
  db.execute = async () => {
    callCount += 1;
    if (callCount === 1) {
      return [[{ id: 'api-key-id-1' }]];
    }
    return [[{
      id: 'user-1',
      username: 'alice',
      password_hash: hashPassword('password123'),
      is_active: 0,
    }]];
  };

  try {
    const req = {
      headers: {
        authorization: 'Bearer good-key',
        'x-sync-user': 'alice',
        'x-sync-password': 'password123',
      },
    };
    const res = createResRecorder();
    let nextCalled = false;

    await requireAuth(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.payload, { error: 'User is disabled', code: 'USER_DISABLED' });
  } finally {
    db.execute = originalExecute;
  }
});

test('requireAuth accepts valid key and credentials and sets req.auth', async () => {
  const originalExecute = db.execute;
  let callCount = 0;
  db.execute = async () => {
    callCount += 1;
    if (callCount === 1) {
      return [[{ id: 'api-key-id-1' }]];
    }
    return [[{
      id: 'user-1',
      username: 'alice',
      password_hash: hashPassword('password123'),
      is_active: 1,
    }]];
  };

  try {
    const req = {
      headers: {
        authorization: 'Bearer good-key',
        'x-sync-user': 'alice',
        'x-sync-password': 'password123',
      },
    };
    const res = createResRecorder();
    let nextCalled = false;

    await requireAuth(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.deepEqual(req.auth, {
      apiKeyId: 'api-key-id-1',
      userId: 'user-1',
      username: 'alice',
    });
    assert.equal(res.statusCode, null);
  } finally {
    db.execute = originalExecute;
  }
});
