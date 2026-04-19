'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const db = require('../db');
const profilesRouter = require('../routes/profiles');
const dialsRouter = require('../routes/dials');

function buildTestAppForProfiles() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.auth = { userId: 'user-1' };
    next();
  });
  app.use('/profiles', profilesRouter);
  return app;
}

function buildTestAppForDials() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.auth = { userId: 'user-1' };
    next();
  });
  app.use('/profiles/:profileId/dials', dialsRouter);
  return app;
}

async function withServer(app, fn) {
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('profiles create rejects non-object body', async () => {
  const app = buildTestAppForProfiles();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/profiles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([]),
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.code, 'VALIDATION_ERROR');
    assert.equal(payload.error, 'Body must be a JSON object');
  });
});

test('profiles update rejects empty partial update payload', async () => {
  const app = buildTestAppForProfiles();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/profiles/p1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.code, 'VALIDATION_ERROR');
    assert.equal(payload.error, 'Nothing to update');
  });
});

test('profiles update accepts single-field partial update', async () => {
  const originalExecute = db.execute;
  let call = 0;
  db.execute = async () => {
    call += 1;
    if (call === 1) {
      return [{ affectedRows: 1 }];
    }
    return [[{ id: 'p1', user_id: 'user-1', name: 'Renamed', position: 0 }]];
  };

  const app = buildTestAppForProfiles();

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/profiles/p1`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed' }),
      });

      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.name, 'Renamed');
    });
  } finally {
    db.execute = originalExecute;
  }
});

test('dials create rejects non-object body', async () => {
  const app = buildTestAppForDials();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/profiles/p1/dials`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([]),
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.code, 'VALIDATION_ERROR');
    assert.equal(payload.error, 'Body must be a JSON object');
  });
});

test('dials update rejects empty partial update payload', async () => {
  const app = buildTestAppForDials();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/profiles/p1/dials/d1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.code, 'VALIDATION_ERROR');
    assert.equal(payload.error, 'Nothing to update');
  });
});

test('dials update accepts single-field partial update', async () => {
  const originalExecute = db.execute;
  let call = 0;
  db.execute = async () => {
    call += 1;
    if (call === 1) {
      return [{ affectedRows: 1 }];
    }
    return [[{ id: 'd1', profile_id: 'p1', title: 'Only title', url: 'https://example.com' }]];
  };

  const app = buildTestAppForDials();

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/profiles/p1/dials/d1`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Only title' }),
      });

      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.title, 'Only title');
    });
  } finally {
    db.execute = originalExecute;
  }
});
