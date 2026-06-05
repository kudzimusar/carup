import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const {
  createVerificationSession,
  getVerificationSession,
  submitVerificationSession,
  uploadVerificationSessionImage,
} = await import('../services/identity/verificationSessionService.js');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class MockQuery {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this.filters = [];
    this.operation = 'select';
    this.payload = null;
  }

  select() {
    return this;
  }

  eq(key, value) {
    this.filters.push({ key, value });
    return this;
  }

  insert(payload) {
    this.operation = 'insert';
    this.payload = payload;
    return this;
  }

  update(payload) {
    this.operation = 'update';
    this.payload = payload;
    return this;
  }

  maybeSingle() {
    return this.execute({ single: true, maybe: true });
  }

  single() {
    return this.execute({ single: true, maybe: false });
  }

  then(resolve, reject) {
    return this.execute({ single: false, maybe: false }).then(resolve, reject);
  }

  rows() {
    if (!this.client.data[this.table]) this.client.data[this.table] = [];
    return this.client.data[this.table];
  }

  matches(row) {
    return this.filters.every(filter => row[filter.key] === filter.value);
  }

  async execute({ single, maybe }) {
    if ((this.table === 'trust_audit_events' || this.table === 'organization_audit_logs') && this.operation === 'insert' && this.client.failAudit) {
      return { data: null, error: { message: `${this.table} failed` } };
    }

    if (this.operation === 'insert') {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      const inserted = rows.map(row => ({
        id: row.id || `session-${++this.client.sequence}`,
        ...clone(row),
      }));
      this.rows().push(...inserted);
      return single ? { data: clone(inserted[0]), error: null } : { data: clone(inserted), error: null };
    }

    if (this.operation === 'update') {
      const updated = [];
      for (const row of this.rows()) {
        if (this.matches(row)) {
          Object.assign(row, clone(this.payload));
          updated.push(clone(row));
        }
      }
      if (single) {
        if (!updated.length && !maybe) return { data: null, error: { message: 'No rows updated' } };
        return { data: updated[0] || null, error: null };
      }
      return { data: updated, error: null };
    }

    const rows = this.rows().filter(row => this.matches(row)).map(clone);
    if (single) {
      if (!rows.length && !maybe) return { data: null, error: { message: 'No rows found' } };
      return { data: rows[0] || null, error: null };
    }
    return { data: rows, error: null };
  }
}

function createMockClient() {
  return {
    sequence: 0,
    failAudit: false,
    data: {
      verification_sessions: [],
      trust_audit_events: [],
      organization_audit_logs: [],
      organization_users: [],
      ocr_documents: [{ id: 'ocr-1', file_path: 'placeholder' }],
    },
    from(table) {
      return new MockQuery(this, table);
    },
  };
}

const owner = { id: 'owner-1', userId: 'owner-1', role: 'owner', tenantId: null };
const image = 'data:image/jpeg;base64,' + Buffer.from('not-a-real-document').toString('base64');

test('creates verification session and writes audit event', async () => {
  const client = createMockClient();
  const session = await createVerificationSession(client, owner, {
    documentType: 'national_id',
    doubleSided: true,
  });

  assert.equal(session.status, 'draft');
  assert.equal(session.double_sided, true);
  assert.equal(session.uploaded_sides.front, false);
  assert.equal(client.data.trust_audit_events.at(-1).event_type, 'VERIFICATION_SESSION_CREATED');
});

test('uploads images to private storage and returns sanitized session', async () => {
  const client = createMockClient();
  const uploads = [];
  const session = await createVerificationSession(client, owner, { documentType: 'passport', doubleSided: false });

  const updated = await uploadVerificationSessionImage(client, owner, session.id, 'front', { image }, {
    storage: {
      uploadToStorage: async (bucket, path, buffer, mimeType) => {
        uploads.push({ bucket, path, bytes: buffer.length, mimeType });
        return path;
      },
    },
  });

  assert.equal(uploads[0].bucket, 'ocr-documents');
  assert.match(uploads[0].path, /^owner-1\/session-1\/front-/);
  assert.equal(updated.uploaded_sides.front, true);
  assert.equal(Object.hasOwn(updated, 'front_storage_path'), false);
  assert.equal(client.data.verification_sessions[0].front_storage_path, uploads[0].path);
});

test('submit requires all requested sides before OCR', async () => {
  const client = createMockClient();
  const session = await createVerificationSession(client, owner, { documentType: 'national_id', doubleSided: true });
  await uploadVerificationSessionImage(client, owner, session.id, 'front', { image }, {
    storage: { uploadToStorage: async () => 'front-path.jpg' },
  });
  await uploadVerificationSessionImage(client, owner, session.id, 'selfie', { image }, {
    storage: { uploadToStorage: async () => 'selfie-path.jpg' },
  });

  await assert.rejects(() => submitVerificationSession(client, owner, session.id), /back document/);
});

test('submit runs OCR from private storage and records verified status without raw image response', async () => {
  const client = createMockClient();
  const session = await createVerificationSession(client, owner, { documentType: 'passport', doubleSided: false });
  await uploadVerificationSessionImage(client, owner, session.id, 'front', { image }, {
    storage: { uploadToStorage: async () => 'front-path.jpg' },
  });
  await uploadVerificationSessionImage(client, owner, session.id, 'selfie', { image }, {
    storage: { uploadToStorage: async () => 'selfie-path.jpg' },
  });

  const result = await submitVerificationSession(client, owner, session.id, {
    storage: {
      downloadFromStorage: async () => ({ buffer: Buffer.from('stored-private-bytes'), mimeType: 'image/jpeg' }),
    },
    ocr: {
      extractDocumentData: async (_docType, dataUri) => {
        assert.match(dataUri, /^data:image\/jpeg;base64,/);
        return {
          success: true,
          ocrDocumentId: 'ocr-1',
          extractedData: {
            confidenceScore: 0.96,
            first_name: 'Ruvimbo',
            last_name: 'Chigumba',
            national_id_number: 'ZN0943248',
            country: 'Zimbabwe',
            additional_fields: {
              expiry: '2030-05-18',
              private_note: 'should not surface',
            },
          },
        };
      },
    },
  });

  assert.equal(result.status, 'verified');
  assert.equal(result.ocr_result.first_name, 'Ruvimbo');
  assert.equal(result.ocr_result.additional_fields.expiry, '2030-05-18');
  assert.equal(result.ocr_result.additional_fields.private_note, undefined);
  assert.equal(Object.hasOwn(result, 'front_storage_path'), false);
  assert.equal(client.data.ocr_documents[0].file_path, client.data.verification_sessions[0].front_storage_path);
  assert.ok(client.data.trust_audit_events.some(event => event.event_type === 'VERIFICATION_OCR_COMPLETED'));
});

test('OCR failure marks session ocr_failed and remains fetchable as sanitized status', async () => {
  const client = createMockClient();
  const session = await createVerificationSession(client, owner, { documentType: 'passport', doubleSided: false });
  await uploadVerificationSessionImage(client, owner, session.id, 'front', { image }, {
    storage: { uploadToStorage: async () => 'front-path.jpg' },
  });
  await uploadVerificationSessionImage(client, owner, session.id, 'selfie', { image }, {
    storage: { uploadToStorage: async () => 'selfie-path.jpg' },
  });

  const result = await submitVerificationSession(client, owner, session.id, {
    storage: {
      downloadFromStorage: async () => ({ buffer: Buffer.from('stored-private-bytes'), mimeType: 'image/jpeg' }),
    },
    ocr: {
      extractDocumentData: async () => {
        throw new Error('OCR provider unavailable');
      },
    },
  });

  assert.equal(result.status, 'ocr_failed');
  assert.match(result.failure_reason, /OCR provider unavailable/);
  assert.equal(Object.hasOwn(result, 'front_storage_path'), false);

  const fetched = await getVerificationSession(client, owner, session.id);
  assert.equal(fetched.status, 'ocr_failed');
});

test('audit failure blocks session creation', async () => {
  const client = createMockClient();
  client.failAudit = true;

  await assert.rejects(
    () => createVerificationSession(client, owner, { documentType: 'passport', doubleSided: false }),
    /Verification audit failed/
  );
});
