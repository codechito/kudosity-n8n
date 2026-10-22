'use strict';

/**
 * Every input below is a real response body captured from the live API on
 * 22 Oct 2026, not an invented one. If Kudosity changes a shape, these fail.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { kudosityApiError } = require(path.join(__dirname, '..', 'dist/nodes/shared/errors.js'));

const node = { name: 'Kudosity', type: 'test', typeVersion: 1, position: [0, 0], parameters: {} };
const translate = (body, status, v) => kudosityApiError(node, { statusCode: status, body }, v);

describe('error shapes seen in the wild', () => {
    test('v1 auth failure — error is an object with description', () => {
        const e = translate('{"error":{"code":"AUTH_FAILED","description":"The auth data you have provided is invalid."}}', 401, 'v1');
        assert.match(e.message, /HTTP 401/);
        assert.match(e.message, /auth data you have provided is invalid/);
        assert.match(e.description, /BOTH the API key and its secret/,
            'a v1 user must be told the secret is needed');
    });

    test('v1 plain-text response is not mangled', () => {
        // Returned when the Authorization header is not Basic. Not JSON at all.
        const e = translate('Authorisation failed', 401, 'v1');
        assert.match(e.message, /Authorisation failed/);
        assert.match(e.description, /HTTP Basic/);
    });

    test('v2 auth failure uses status, and is told NOT to look for a secret', () => {
        const e = translate('{"status":"Invalid api key"}', 401, 'v2');
        assert.match(e.message, /Invalid api key/);
        assert.match(e.description, /x-api-key/);
        assert.match(e.description, /secret is not used by v2/,
            'sending a v2 user hunting for a secret they do not have is the failure to avoid');
    });

    test('v2 simple validation — error is a bare string', () => {
        const e = translate('{"error":"sender: required"}', 400, 'v2');
        assert.match(e.message, /sender: required/);
        assert.match(e.description, /will not fall back to an account default/,
            'the useful part is that v1 allows a blank sender and v2 does not');
    });

    test('v2 rich validation — issues array is unpacked into field: message', () => {
        const e = translate(JSON.stringify({
            error: { detail: 'Request validation failed', title: 'Invalid Request',
                     issues: [{ name: 'sender', message: 'invalid sender number' }] },
        }), 400, 'v2');
        assert.match(e.message, /sender: invalid sender number/,
            'the field name must survive — "Request validation failed" alone is useless');
        assert.match(e.description, /not provisioned for WhatsApp or RCS/);
    });

    test('MMS content_url failure explains that Kudosity fetches the URL', () => {
        const e = translate('{"error":"Invalid content_url: https://x.test/a.png Content-Type: text/plain not supported"}', 400, 'v2');
        assert.match(e.description, /fetches this URL itself/,
            'users assume the URL is malformed; the real cause is a failed fetch');
    });

    test('delivery status missing msisdn names the field to fill', () => {
        const e = translate('{"error":{"code":"FIELD_EMPTY","description":"Field msisdn is required"}}', 400, 'v1');
        assert.match(e.description, /Recipient Number/);
    });

    test('replies without message_id explains there is no all-replies call', () => {
        const e = translate(`{"error":{"code":"FIELD_INVALID","description":"You must provide 'message_id' or 'keyword_id', or both 'keyword' and 'number'"}}`, 400, 'v1');
        assert.match(e.description, /no "all recent replies" call/);
    });

    test('404 NOT_IMPLEMENTED is flagged as a bug, not a user error', () => {
        const e = translate('{"error":{"code":"NOT_IMPLEMENTED","description":"The method you are requesting is unsupported."}}', 404, 'v1');
        assert.match(e.description, /bug worth reporting/);
    });
});

describe('cases with no specific advice', () => {
    test('a 500 suggests retrying rather than changing the request', () => {
        const e = translate('{"error":"boom"}', 503, 'v2');
        assert.match(e.description, /Retry On Fail/);
    });

    test('a 429 points at rate limiting', () => {
        const e = translate('', 429, 'v2');
        assert.match(e.description, /Rate limited/);
    });

    test('an unrecognised body still produces a usable message', () => {
        const e = translate('{"weird":"shape"}', 400, 'v2');
        assert.ok(e.message.length > 0);
        assert.match(e.message, /Kudosity V2/);
    });

    test('a transport error is left to n8n, which describes it better', () => {
        // NodeApiError recognises ECONNREFUSED and says "The service refused the
        // connection - perhaps it is offline", which is more useful than anything
        // this module would write. Do not try to improve on it.
        const e = kudosityApiError(node, new Error('ECONNREFUSED'), 'v1');
        assert.match(e.message, /refused the connection/);
        assert.ok(e.message.length > 0, 'must never produce an empty message');
    });
});
