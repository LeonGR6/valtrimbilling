import test from 'node:test'
import assert from 'node:assert/strict'
import { canOpenImportSource, createCustomerServiceImportSourceRepository } from '../src/features/customer-service/services/customerServiceImportSourceRepository.js'
import { toCustomerServiceIntakeRecord } from '../src/features/customer-service/services/customerServiceIntakeRecord.js'

const importId = '00000000-0000-4000-8000-000000000123'
const pdf = { attachmentId: 'PDF', fileId: 12, originalFilename: 'order.pdf', mimeType: 'application/pdf', sizeBytes: 2400, isInline: false,
  retention: 'STORED', storedFileAvailable: true, analysis: null }
const image = { attachmentId: 'IMG', fileId: 13, originalFilename: 'door.png', mimeType: 'image/png', sizeBytes: 1300, isInline: true,
  retention: 'STORED', storedFileAvailable: true, analysis: null }
const response = (attachments = [], sourceStatus = 'AVAILABLE', sourceContractVersion = 1) => ({ importId, sourceStatus, sourceContractVersion,
  webLink: 'https://outlook.office.com/mail/id/example', attachments })
const normalized = (attachments = [], sourceStatus = 'AVAILABLE', sourceContractVersion = 1) => ({
  sourceStatus, sourceContractVersion, webLink: response().webLink, attachments,
  available: ['AVAILABLE', 'LEGACY'].includes(sourceStatus) })
const signed = { ...pdf, importId, signedUrl: 'https://example.supabase.co/storage/private-pdf?token=test',
  downloadUrl: 'https://example.supabase.co/storage/private-pdf?download=order.pdf&token=test', expiresIn: 300 }
const extraction = (attachmentId = 'IMG', text = 'Adjust entry door') => ({ sourceId: `attachment:${attachmentId}`, status: 'ANALYZED',
  text, model: 'vision-test', structuredData: { contacts: [], serviceItems: [], warnings: [] }, error: null })
const graphImage = (attachmentId = 'IMG', analysis = extraction(attachmentId)) => ({ ...image, attachmentId,
  fileId: null, retention: 'GRAPH_ONLY', storedFileAvailable: false, analysis })

test('opening an import lists authorized files without fetching URLs, binaries, paths or worker credentials', async () => {
  const calls = []
  const repository = createCustomerServiceImportSourceRepository({ getClient: async () => ({
    rpc: async (name, params) => {
      calls.push({ name, params })
      return { data: response([{ ...pdf, bucketId: 'customer-service-imports', objectPath: 'private/path' }, image]) }
    }, functions: { invoke: () => assert.fail('File URLs must only be requested on selection.') },
  }) })
  assert.deepEqual(await repository.list(importId), normalized([pdf, image]))
  assert.deepEqual(calls, [{ name: 'read_customer_service_import_sources', params: { p_import_id: importId } }])
})

test('a rejected original is distinct from an available email with zero attachments', async () => {
  const unavailable = createCustomerServiceImportSourceRepository({ getClient: async () => ({ rpc: async () => ({ data: response([], 'REJECTED') }) }) })
  const empty = createCustomerServiceImportSourceRepository({ getClient: async () => ({ rpc: async () => ({ data: response() }) }) })
  assert.equal((await unavailable.list(importId)).available, false)
  assert.equal((await empty.list(importId)).available, true)
  assert.deepEqual((await empty.list(importId)).attachments, [])
})

test('permission, session and network failures are errors rather than empty attachment lists', async () => {
  for (const code of ['42501', 'P0002', 'NETWORK_ERROR']) {
    const repository = createCustomerServiceImportSourceRepository({ getClient: async () => ({ rpc: async () => ({ error: { code } }) }) })
    await assert.rejects(repository.list(importId), code === '42501' ? /permission/ : /could not be loaded/)
  }
})

test('the attachment list rejects another import, duplicate files, missing identity and unsupported files', async () => {
  for (const data of [
    { ...response([pdf]), importId: '00000000-0000-4000-8000-000000000999' },
    response([pdf, pdf]), response([{ ...pdf, fileId: 0 }]), response([{ ...pdf, sizeBytes: -1 }]),
    response([{ ...pdf, mimeType: 'image/svg+xml' }]), response(null),
  ]) {
    const repository = createCustomerServiceImportSourceRepository({ getClient: async () => ({ rpc: async () => ({ data }) }) })
    await assert.rejects(repository.list(importId), /did not confirm/)
  }
})

test('selecting a file sends only its two identities and every refresh obtains fresh private URLs', async () => {
  const calls = []
  const repository = createCustomerServiceImportSourceRepository({ getClient: async () => ({ functions: { invoke: async (name, params) => {
    calls.push({ name, params })
    return { data: { ...signed, signedUrl: `${signed.signedUrl}&generation=${calls.length}` } }
  } } }) })
  const first = await repository.urls(importId, pdf)
  const refreshed = await repository.urls(importId, pdf)
  assert.notEqual(first.signedUrl, refreshed.signedUrl)
  assert.equal(first.expiresIn, 300)
  assert.deepEqual(calls[0], { name: 'customer-service-import-source', params: { body: { importId, fileId: 12 } } })
})

test('wrong file identity, unexpected metadata and unsafe links never become a document source', async () => {
  for (const changes of [
    { fileId: 13 }, { importId: '00000000-0000-4000-8000-000000000999' },
    { originalFilename: 'different.pdf' }, { sizeBytes: 1 }, { mimeType: 'image/png' },
    { expiresIn: 0 }, { signedUrl: 'javascript:alert(1)' }, { downloadUrl: 'https://user:password@example.com/private' },
  ]) {
    const repository = createCustomerServiceImportSourceRepository({ getClient: async () => ({ functions: { invoke: async () => ({ data: { ...signed, ...changes } }) } }) })
    await assert.rejects(repository.urls(importId, pdf), /did not confirm|valid private file link/)
  }
})

test('failed URL generation can be retried without importing, uploading or changing the request', async () => {
  let attempts = 0
  const repository = createCustomerServiceImportSourceRepository({ getClient: async () => ({ functions: { invoke: async () => (
    ++attempts === 1 ? { error: { message: 'Expired session' } } : { data: signed }
  ) } }) })
  await assert.rejects(repository.urls(importId, pdf), /may have been deleted/)
  assert.equal((await repository.urls(importId, pdf)).fileId, pdf.fileId)
})

test('invalid identities are rejected before accessing Supabase', async () => {
  const repository = createCustomerServiceImportSourceRepository({ getClient: () => assert.fail('Invalid identities must not reach the server.') })
  await assert.rejects(repository.list('not-a-uuid'), /identity/)
  await assert.rejects(repository.urls(importId, { ...pdf, fileId: '../another-file' }), /identity/)
})

test('V2 lists all images by attachment identity even when every fileId is null, without any file request', async () => {
  const attachments = [graphImage('A'), graphImage('a', extraction('a', null)), pdf]
  const calls = []
  const repository = createCustomerServiceImportSourceRepository({ getClient: async () => ({
    rpc: async (name, params) => { calls.push({ name, params }); return { data: response(attachments, 'AVAILABLE', 2) } },
    functions: { invoke: () => assert.fail('Listing metadata must not request binary files or signed URLs.') },
    storage: { from: () => assert.fail('The viewer must not read or upload Storage directly.') },
  }) })
  const result = await repository.list(importId)
  assert.deepEqual(result, normalized(attachments, 'AVAILABLE', 2))
  assert.equal(result.attachments[1].analysis.text, null)
  assert.equal(canOpenImportSource(result.attachments[0]), false)
  assert.equal(canOpenImportSource(result.attachments[1]), false)
  assert.equal(canOpenImportSource(result.attachments[2]), true)
  assert.equal(calls.length, 1)
})

test('new images, missing stored files and invented image storage are refused before requesting private URLs', async () => {
  const repository = createCustomerServiceImportSourceRepository({ getClient: () => assert.fail('An unretained image must not reach a file endpoint.') })
  for (const attachment of [graphImage(), { ...graphImage(), fileId: 99 },
    { ...graphImage(), fileId: 99, storedFileAvailable: true }, { ...pdf, storedFileAvailable: false },
    { ...image, fileId: null, storedFileAvailable: false }]) {
    assert.equal(canOpenImportSource(attachment), false)
    await assert.rejects(repository.urls(importId, attachment), /no file is stored/)
  }
})

test('pending, failed and successful no-text image analysis remain distinct', async () => {
  const failed = { sourceId: 'attachment:FAILED', status: 'FAILED', text: null, model: null, structuredData: null,
    error: { code: 'SOURCE_UNAVAILABLE', message: 'Original image unavailable', retryable: true, diagnosticCode: 'GRAPH_UNAVAILABLE' } }
  const repository = createCustomerServiceImportSourceRepository({ getClient: async () => ({ rpc: async () => ({
    data: response([graphImage('PENDING', null), graphImage('FAILED', failed), graphImage('DONE', extraction('DONE', null))], 'AVAILABLE', 2),
  }) }) })
  const result = await repository.list(importId)
  assert.equal(result.attachments[0].analysis, null)
  assert.equal(result.attachments[1].analysis.status, 'FAILED')
  assert.deepEqual(result.attachments[1].analysis.error, { code: 'SOURCE_UNAVAILABLE', message: 'Original image unavailable', retryable: true })
  assert.equal(result.attachments[2].analysis.status, 'ANALYZED')
  assert.equal(result.attachments[2].analysis.text, null)
})

test('V2 rejects malformed retention, contradictory storage, foreign analysis and duplicate identities', async () => {
  for (const attachments of [
    [graphImage('DUP'), graphImage('DUP')], [{ ...graphImage(), fileId: 12 }],
    [{ ...graphImage(), storedFileAvailable: true }], [{ ...graphImage(), retention: 'STORED', fileId: 12, storedFileAvailable: true }],
    [{ ...pdf, retention: 'GRAPH_ONLY', fileId: null, storedFileAvailable: false }],
    [graphImage('IMG', extraction('FOREIGN'))], [graphImage('IMG', { ...extraction(), text: {} })],
    [graphImage('IMG', { ...extraction(), status: 'PENDING' })],
    [graphImage('IMG', { ...extraction(), status: 'FAILED', structuredData: null, error: null })],
    [pdf, { ...pdf, attachmentId: 'OTHER-PDF' }],
  ]) {
    const repository = createCustomerServiceImportSourceRepository({ getClient: async () => ({ rpc: async () => ({ data: response(attachments, 'AVAILABLE', 2) }) }) })
    await assert.rejects(repository.list(importId), /did not confirm/)
  }
})

test('binary echoes in source metadata, extracted text, facts or provider fields never enter the viewer state', async () => {
  for (const attachment of [
    { ...graphImage(), contentBytes: 'forbidden' },
    graphImage('IMG', { ...extraction(), text: 'data:image/png;base64,AAAA' }),
    graphImage('IMG', { ...extraction(), structuredData: { image_url: 'forbidden' } }),
    graphImage('IMG', { ...extraction(), structuredData: { nested: { bytes: [1, 2] } } }),
    graphImage('IMG', { ...extraction(), text: `iVBORw0KGgo${'A'.repeat(64)}` }),
  ]) {
    const repository = createCustomerServiceImportSourceRepository({ getClient: async () => ({ rpc: async () => ({ data: response([attachment], 'AVAILABLE', 2) }) }) })
    await assert.rejects(repository.list(importId), /did not confirm/)
  }
})

test('a missing historical reference keeps its extraction and cannot be mistaken for a new Graph-only image', async () => {
  const historical = { ...image, fileId: null, storedFileAvailable: false, analysis: extraction() }
  const repository = createCustomerServiceImportSourceRepository({ getClient: async () => ({ rpc: async () => ({ data: response([historical]) }) }) })
  const result = await repository.list(importId)
  assert.equal(result.attachments[0].retention, 'STORED')
  assert.equal(result.attachments[0].analysis.text, 'Adjust entry door')
  assert.equal(canOpenImportSource(result.attachments[0]), false)
})

test('source status and schema failures are errors, never an attachment-free success', async () => {
  for (const data of [{ ...response(), sourceStatus: 'UNKNOWN' }, { ...response(), sourceContractVersion: 9 },
    { ...response(), sourceContractVersion: undefined }]) {
    const repository = createCustomerServiceImportSourceRepository({ getClient: async () => ({ rpc: async () => ({ data }) }) })
    await assert.rejects(repository.list(importId), /did not confirm/)
  }
  const leaseError = createCustomerServiceImportSourceRepository({ getClient: async () => ({ rpc: async () => ({ error: { code: '55000' } }) }) })
  await assert.rejects(leaseError.list(importId), /could not be loaded/)
})

test('reloading the viewer reads fresh metadata without saving binary data, URLs or changes to the request', async () => {
  let calls = 0
  const original = graphImage()
  const repository = createCustomerServiceImportSourceRepository({ getClient: async () => ({ rpc: async (name) => {
    assert.equal(name, 'read_customer_service_import_sources')
    calls++
    return { data: { ...response([structuredClone(original)], 'AVAILABLE', 2), webLink: calls === 1 ? 'javascript:alert(1)' : response().webLink } }
  } }) })
  const first = await repository.list(importId)
  first.attachments[0].analysis.text = 'In-memory display edit'
  const second = await repository.list(importId)
  assert.equal(first.webLink, null)
  assert.equal(second.webLink, response().webLink)
  assert.equal(second.attachments[0].analysis.text, 'Adjust entry door')
  assert.equal(original.analysis.text, 'Adjust entry door')
  assert.equal(calls, 2)
})

test('a recovery PDF retains the original email metadata/body separately after a reload and human correction', () => {
  const record = {
    request: { id: 501, folio: 'CS-1501', email_import_id: importId, workflow_stage: 'NEEDS_REVIEW' },
    property: {}, contacts: [], items: [{ id: 1, item_number: 1, description: 'Human-corrected work' }], workflowHistory: [],
    emailImport: { id: importId, source_payload: {
      from: { emailAddress: { name: 'Builder', address: 'builder@example.com' } },
      toRecipients: [{ emailAddress: { name: 'Valtrim', address: 'victor@example.com' } }],
      ccRecipients: [{ emailAddress: { address: 'coordinator@example.com' } }],
      subject: 'Retained email', body: { contentType: 'html', content: '<p>Original work order</p>' },
      sentDateTime: '2026-10-27T15:00:00Z', receivedDateTime: '2026-10-27T15:01:00Z',
      webLink: 'https://outlook.office.com/mail/id/example', attachments: [{ name: 'original.png' }],
    } },
    source: { source_type: 'PDF', file_status: 'AVAILABLE', recovery_pdf_sha256: 'a'.repeat(64),
      recovery_pdf_filename: 'recovery.pdf', recovery_pdf_size_bytes: 2400,
      sender_email: 'manually-supplied@example.com', subject: 'Recovery source', email_text: '',
      extracted_text: 'Recovery OCR', extraction_payload: { recovery: true },
      file: { id: 44, original_filename: 'recovery.pdf', bucket_id: 'manual-pdf', object_path: 'separate' } },
  }
  const original = structuredClone(record.emailImport)
  const request = toCustomerServiceIntakeRecord(record)
  assert.equal(request.sourceEmail.from, 'builder@example.com')
  assert.equal(request.sourceEmail.fromName, 'Builder')
  assert.deepEqual(request.sourceEmail.to, ['Valtrim · victor@example.com'])
  assert.deepEqual(request.sourceEmail.cc, ['coordinator@example.com'])
  assert.equal(request.sourceEmail.sentAt, '2026-10-27T15:00:00Z')
  assert.equal(request.sourceEmail.receivedAt, '2026-10-27T15:01:00Z')
  assert.equal(request.sourceEmail.webLink, record.emailImport.source_payload.webLink)
  assert.equal(request.sourceEmail.body, '<p>Original work order</p>')
  assert.deepEqual(request.sourceEmail.attachmentNames, ['original.png'])
  assert.equal(request.sourceDocument.storage.originalFilename, 'recovery.pdf')
  assert.equal(request.sourceDocument.extraction.text, 'Recovery OCR')
  assert.equal(request.sourceDocument.recoveryPdf.originalFilename, 'recovery.pdf')
  assert.equal(request.requestedWorkItems[0].description, 'Human-corrected work')
  assert.equal(request.workflowStage, 'NEEDS_REVIEW')
  assert.deepEqual(record.emailImport, original)
  assert.deepEqual(toCustomerServiceIntakeRecord(structuredClone(record)).sourceEmail, request.sourceEmail)
  record.emailImport.source_payload.webLink = 'javascript:alert(1)'
  assert.equal(toCustomerServiceIntakeRecord(record).sourceEmail.webLink, null)
})
