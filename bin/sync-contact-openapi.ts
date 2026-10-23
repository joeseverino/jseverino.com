#!/usr/bin/env node
import { jsonText, readJson } from '../src/lib/json.ts';
import { SITE, SITE_ORIGIN } from '../src/lib/site-config.ts';
import { fromRoot } from '../src/lib/site-root.ts';
// Project contracts/contact.v1.json into the OpenAPI document API Shield validates requests against.
//
//   node bin/sync-contact-openapi.ts           # write the projection
//   node bin/sync-contact-openapi.ts --check   # fail if it is stale
import { checkMode } from './lib/args.ts';
import { writeOrCheck } from './lib/projection.ts';

const check = checkMode('usage: node bin/sync-contact-openapi.ts [--check]');
const contract = readJson<{ request: unknown }>(fromRoot('contracts/contact.v1.json'));
const response = (description: string, ref: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: ref } } },
});
const document = {
  openapi: '3.1.0',
  info: {
    title: `${SITE.domain} Contact API`,
    version: '1.0.0',
    description: 'Schema for the public contact form endpoint.',
  },
  servers: [{ url: SITE_ORIGIN }],
  paths: {
    '/api/contact': {
      post: {
        summary: 'Submit a contact form message',
        operationId: 'submitContactMessage',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ContactSubmission' } } },
        },
        responses: {
          200: response('Submission accepted or honeypot submission ignored.', '#/components/schemas/ContactSuccess'),
          400: response('Malformed or invalid submission.', '#/components/schemas/ContactError'),
          413: response('Request body is too large.', '#/components/schemas/ContactError'),
          415: response('Request content type is not JSON.', '#/components/schemas/ContactError'),
          429: response('Too many submissions from the same IP address.', '#/components/schemas/ContactError'),
          500: response('Submission could not be saved.', '#/components/schemas/ContactError'),
        },
      },
    },
  },
  components: {
    schemas: {
      ContactSubmission: contract.request,
      ContactSuccess: {
        type: 'object',
        additionalProperties: false,
        required: ['ok'],
        properties: { ok: { type: 'boolean', enum: [true] } },
      },
      ContactError: {
        type: 'object',
        additionalProperties: false,
        required: ['ok', 'error'],
        properties: { ok: { type: 'boolean', enum: [false] }, error: { type: 'string' } },
      },
    },
  },
};
writeOrCheck([{ file: fromRoot('contracts/contact.openapi.json'), content: jsonText(document) }], { check });
if (check) console.log('ok       contact OpenAPI derives from contracts/contact.v1.json');
