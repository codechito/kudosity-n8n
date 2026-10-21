'use strict';

/**
 * Drives the compiled v1 node and asserts what it would send.
 *
 * Endpoints and field names here come from the Kudosity Salesforce package's
 * working production calls, not from documentation. These tests are what stops
 * them drifting away from that proven shape.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { KudosityV1 } = require(path.join(__dirname, '..', 'dist/nodes/KudosityV1/KudosityV1.node.js'));
const { KudosityV1Trigger } = require(path.join(__dirname, '..', 'dist/nodes/KudosityV1/KudosityV1Trigger.node.js'));

const BASE = 'https://api.transmitsms.com';

function execContext(params, creds = { apiKey: 'KEY', apiSecret: 'SECRET' }) {
    const requests = [];
    return {
        requests,
        getInputData: () => [{ json: {} }],
        getCredentials: async () => creds,
        getNodeParameter: (name, _i, fallback) => (name in params ? params[name] : fallback ?? ''),
        getNode: () => ({ name: 'Kudosity V1' }),
        helpers: { request: async (opts) => { requests.push(opts); return { error: { code: 'SUCCESS' } }; } },
    };
}

async function call(params, creds) {
    const ctx = execContext(params, creds);
    await KudosityV1.prototype.execute.call(ctx);
    assert.strictEqual(ctx.requests.length, 1);
    const req = ctx.requests[0];
    const form = req.body
        ? Object.fromEntries(new URLSearchParams(req.body))
        : Object.fromEntries(new URL(req.url).searchParams);
    return { req, form };
}

describe('v1 authentication', () => {
    test('sends HTTP Basic over key:secret', async () => {
        const { req } = await call({ operation: 'sendSms', to: '+61412345678', message: 'Hi' });
        const expected = 'Basic ' + Buffer.from('KEY:SECRET').toString('base64');
        assert.strictEqual(req.headers.Authorization, expected);
    });

    test('an empty secret still produces a valid Basic header', async () => {
        // Whether v1 ACCEPTS key-only is unverified against the live API. This only
        // asserts the node produces a well-formed header so the question can be
        // answered by trying it, rather than failing on a malformed request.
        const { req } = await call(
            { operation: 'sendSms', to: '+61412345678', message: 'Hi' },
            { apiKey: 'KEY', apiSecret: '' },
        );
        assert.strictEqual(req.headers.Authorization, 'Basic ' + Buffer.from('KEY:').toString('base64'));
    });

    test('a missing secret is treated as empty, not as the string "undefined"', async () => {
        const { req } = await call(
            { operation: 'sendSms', to: '+61412345678', message: 'Hi' },
            { apiKey: 'KEY' },
        );
        const decoded = Buffer.from(req.headers.Authorization.replace('Basic ', ''), 'base64').toString();
        assert.strictEqual(decoded, 'KEY:');
    });

    test('v1 is form-encoded, not JSON', async () => {
        const { req } = await call({ operation: 'sendSms', to: '+61412345678', message: 'Hi' });
        assert.strictEqual(req.headers['Content-Type'], 'application/x-www-form-urlencoded');
        assert.doesNotMatch(req.body, /^\{/, 'body must be form-encoded, not a JSON object');
    });
});

describe('v1 operations', () => {
    test('Send SMS posts to /send-sms.json with to and message', async () => {
        const { req, form } = await call({ operation: 'sendSms', to: '+61412345678', message: 'Hello' });
        assert.strictEqual(req.method, 'POST');
        assert.strictEqual(req.url, `${BASE}/send-sms.json`);
        assert.strictEqual(form.to, '+61412345678');
        assert.strictEqual(form.message, 'Hello');
    });

    test('optional send fields are omitted when unset rather than sent empty', async () => {
        const { form } = await call({ operation: 'sendSms', to: '+6141', message: 'Hi', additionalFields: {
            countrycode: '', validity: 0, send_at: '', dlr_callback: 'https://n8n.test/wh',
        } });
        assert.ok(!('countrycode' in form), 'blank countrycode must not be sent');
        assert.ok(!('validity' in form), 'validity 0 means unset and must not be sent');
        assert.ok(!('send_at' in form));
        assert.strictEqual(form.dlr_callback, 'https://n8n.test/wh', 'set fields must still come through');
    });

    test('Cancel SMS posts an id', async () => {
        const { req, form } = await call({ operation: 'cancelSms', messageId: '12345' });
        assert.strictEqual(req.url, `${BASE}/cancel-sms.json`);
        assert.strictEqual(form.id, '12345');
    });

    test('Format Number is a GET with parameters in the query string', async () => {
        const { req, form } = await call({ operation: 'formatNumber', msisdn: '0412345678', countrycode: 'AU' });
        assert.strictEqual(req.method, 'GET');
        assert.ok(req.url.startsWith(`${BASE}/format-number.json?`), `query string missing: ${req.url}`);
        assert.strictEqual(form.msisdn, '0412345678');
        assert.strictEqual(form.countrycode, 'AU');
        assert.ok(req.body === undefined, 'a GET must not carry a body');
    });

    test('Get Sender IDs and Get Account are parameterless GETs', async () => {
        for (const [operation, endpoint] of [['getSenderIds', '/get-sender-ids.json'], ['getAccount', '/get-client.json']]) {
            const ctx = execContext({ operation });
            await KudosityV1.prototype.execute.call(ctx);
            const req = ctx.requests[0];
            assert.strictEqual(req.method, 'GET');
            assert.strictEqual(req.url, `${BASE}${endpoint}`, `${operation} hit the wrong endpoint`);
        }
    });

    test('Set Number Forward URL posts number and forward_url', async () => {
        const { req, form } = await call({
            operation: 'setForwardUrl', number: '61412345678', forwardUrl: 'https://n8n.test/webhook/abc',
        });
        assert.strictEqual(req.url, `${BASE}/edit-number-options.json`);
        assert.strictEqual(form.number, '61412345678');
        assert.strictEqual(form.forward_url, 'https://n8n.test/webhook/abc');
    });

    test('an unknown operation fails loudly', async () => {
        await assert.rejects(() => call({ operation: 'teleport' }), /Unknown operation/);
    });
});

describe('v1 trigger', () => {
    const methods = new KudosityV1Trigger().webhookMethods;

    function hookContext({ staticData = {}, number = '61412345678', clearOnDelete = true } = {}) {
        const requests = [];
        return {
            requests, staticData,
            getWorkflowStaticData: () => staticData,
            getNodeWebhookUrl: () => 'https://n8n.test/webhook/abc',
            getNodeParameter: (name, fallback) => {
                if (name === 'number') return number;
                if (name === 'clearOnDelete') return clearOnDelete;
                return fallback;
            },
            getCredentials: async () => ({ apiKey: 'KEY', apiSecret: 'SECRET' }),
            getNode: () => ({ name: 'Kudosity V1 Trigger' }),
            helpers: { request: async (opts) => { requests.push(opts); return { error: { code: 'SUCCESS' } }; } },
        };
    }

    test('create registers the webhook URL as the number forward URL', async () => {
        // v1 registration is real, just different from v2: one forward_url per
        // number via edit-number-options.json, as the Eloqua integration does.
        const ctx = hookContext();
        await methods.default.create.call(ctx);

        assert.strictEqual(ctx.requests.length, 1);
        const url = new URL(ctx.requests[0].url);
        assert.strictEqual(url.origin + url.pathname, `${BASE}/edit-number-options.json`);
        assert.strictEqual(url.searchParams.get('number'), '61412345678');
        assert.strictEqual(url.searchParams.get('forward_url'), 'https://n8n.test/webhook/abc');
        assert.strictEqual(ctx.requests[0].headers.Authorization,
            'Basic ' + Buffer.from('KEY:SECRET').toString('base64'));
    });

    test('create refuses without a number rather than registering nothing', async () => {
        await assert.rejects(() => methods.default.create.call(hookContext({ number: '' })),
            /virtual number is required/);
    });

    test('checkExists tracks locally, since forward_url cannot be read back', async () => {
        const ctx = hookContext();
        assert.strictEqual(await methods.default.checkExists.call(ctx), false);
        await methods.default.create.call(ctx);
        assert.strictEqual(await methods.default.checkExists.call(ctx), true);
    });

    test('checkExists is false again if the number changed', async () => {
        const ctx = hookContext();
        await methods.default.create.call(ctx);
        const moved = hookContext({ staticData: ctx.staticData, number: '61499999999' });
        assert.strictEqual(await methods.default.checkExists.call(moved), false,
            'pointing the trigger at a different number must re-register');
    });

    test('delete clears the forward URL by default', async () => {
        const ctx = hookContext();
        await methods.default.create.call(ctx);
        ctx.requests.length = 0;
        await methods.default.delete.call(ctx);
        assert.strictEqual(new URL(ctx.requests[0].url).searchParams.get('forward_url'), '');
    });

    test('delete leaves the remote value alone when asked to', async () => {
        // Blanking a forward_url another system depends on is worse than leaving a
        // stale one, which simply 404s against an inactive webhook.
        const ctx = hookContext({ clearOnDelete: false });
        await methods.default.create.call(ctx);
        ctx.requests.length = 0;
        await methods.default.delete.call(ctx);
        assert.strictEqual(ctx.requests.length, 0, 'no API call should be made');
        assert.ok(!ctx.staticData.forwardUrlRegisteredFor, 'but the local record must still be cleared');
    });

    test('delete survives the API being unreachable', async () => {
        const ctx = hookContext();
        await methods.default.create.call(ctx);
        ctx.helpers.request = async () => { throw new Error('ECONNREFUSED'); };
        await assert.doesNotReject(() => methods.default.delete.call(ctx),
            'deactivating a workflow must not fail because Kudosity was down');
    });

    test('normalises v1 field-name variants and keeps the raw payload', async () => {
        const ctx = {
            getBodyData: () => ({ mobile: '61412345678', message_id: '999', response: 'STOP', datetime: '2026-10-21' }),
            getQueryData: () => ({}),
            getNodeParameter: () => 'any',
        };
        const [[item]] = (await KudosityV1Trigger.prototype.webhook.call(ctx)).workflowData;

        assert.strictEqual(item.json.phone, '61412345678');   // from `mobile`
        assert.strictEqual(item.json.id, '999');              // from `message_id`
        assert.strictEqual(item.json.message, 'STOP');        // from `response`
        assert.ok(item.json.raw, 'the untouched payload must be preserved');
    });

    test('reads query parameters too, since v1 does not always use the body', async () => {
        const ctx = {
            getBodyData: () => ({}),
            getQueryData: () => ({ msisdn: '61400000000', status: 'delivered' }),
            getNodeParameter: () => 'any',
        };
        const [[item]] = (await KudosityV1Trigger.prototype.webhook.call(ctx)).workflowData;
        assert.strictEqual(item.json.phone, '61400000000');
        assert.strictEqual(item.json.status, 'delivered');
    });
});
