'use strict';

/**
 * Drives the compiled nodes with a fake n8n execution context and asserts the HTTP
 * request each operation would send. No network, no API key.
 *
 * These pin the API contract — host, path, auth header shape and body field names —
 * so a change to any of them is deliberate rather than discovered by a customer.
 * The v2 API takes a raw Authorization header with no Bearer prefix, which is easy
 * to "correct" by accident.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { KudosityV2 } = require(path.join(__dirname, '..', 'dist/nodes/KudosityV2/KudosityV2.node.js'));
const { KudosityV2Trigger } = require(path.join(__dirname, '..', 'dist/nodes/KudosityV2/KudosityV2Trigger.node.js'));

const BASE = 'https://api.transmitmessage.com/v2';

function execContext(params) {
    const requests = [];
    return {
        requests,
        getInputData: () => [{ json: {} }],
        getCredentials: async () => ({ apiKey: 'test-api-key' }),
        getNodeParameter: (name) => (name in params ? params[name] : ''),
        getNode: () => ({ name: 'Kudosity V2' }),
        helpers: { request: async (opts) => { requests.push(opts); return { id: 'msg_1' }; } },
    };
}

async function send(params) {
    const ctx = execContext(params);
    await KudosityV2.prototype.execute.call(ctx);
    assert.strictEqual(ctx.requests.length, 1, 'expected exactly one HTTP request');
    const req = ctx.requests[0];
    return { req, body: JSON.parse(req.body) };
}

const COMMON = { recipient: '+61412345678', sender: '+61481074185' };

describe('send operations', () => {
    test('SMS posts to /sms with the message body', async () => {
        const { req, body } = await send({ ...COMMON, operation: 'sendSms', message: 'Hello' });
        assert.strictEqual(req.method, 'POST');
        assert.strictEqual(req.url, `${BASE}/sms`);
        assert.deepStrictEqual(body, { sender: COMMON.sender, recipient: COMMON.recipient, message: 'Hello' });
    });

    test('MMS sends content_urls as an array', async () => {
        const { req, body } = await send({
            ...COMMON, operation: 'sendMms', mediaUrl: 'https://x.test/a.jpg', subject: 'Subj', message: 'Body',
        });
        assert.strictEqual(req.url, `${BASE}/mms`);
        assert.deepStrictEqual(body.content_urls, ['https://x.test/a.jpg']);
        assert.strictEqual(body.subject, 'Subj');
    });

    test('WhatsApp text nests the message under content.text', async () => {
        const { req, body } = await send({
            ...COMMON, operation: 'sendWhatsapp', contentType: 'text', message: 'Hi',
        });
        assert.strictEqual(req.url, `${BASE}/whatsapp/messages`);
        assert.strictEqual(body.content_type, 'text');
        assert.deepStrictEqual(body.content, { text: { message: 'Hi' } });
    });

    test('WhatsApp template splits comma-separated parameters and defaults the locale', async () => {
        const { body } = await send({
            ...COMMON, operation: 'sendWhatsapp', contentType: 'template',
            templateName: 'welcome', templateParams: 'John, 20%OFF , 31 Dec',
        });
        assert.strictEqual(body.content_type, 'template');
        assert.deepStrictEqual(body.content.template, {
            name: 'welcome',
            locale: 'en',                                   // defaulted, not sent empty
            parameters: ['John', '20%OFF', '31 Dec'],       // trimmed
        });
    });

    test('RCS carries an SMS fallback when a fallback sender is set', async () => {
        const { req, body } = await send({
            ...COMMON, operation: 'sendRcs', message: 'Rich',
            smsFallbackSender: '+61400000000', smsFallbackMessage: 'Plain',
        });
        assert.strictEqual(req.url, `${BASE}/rcs/messages`);
        assert.deepStrictEqual(body.sms_fallback, { sender: '+61400000000', message: 'Plain' });
    });

    test('no fallback key at all when no fallback sender is given', async () => {
        const { body } = await send({ ...COMMON, operation: 'sendRcs', message: 'Rich' });
        assert.ok(!('sms_fallback' in body), 'sms_fallback must be absent, not null or empty');
    });

    test('optional message_ref is omitted rather than sent blank', async () => {
        const { body } = await send({ ...COMMON, operation: 'sendSms', message: 'Hello' });
        assert.ok(!('message_ref' in body));
        const withRef = await send({ ...COMMON, operation: 'sendSms', message: 'Hello', messageRef: 'camp-1' });
        assert.strictEqual(withRef.body.message_ref, 'camp-1');
    });

    test('an unknown operation fails loudly', async () => {
        await assert.rejects(
            () => send({ ...COMMON, operation: 'sendCarrierPigeon' }),
            /Unknown operation/,
        );
    });
});

describe('authentication', () => {
    test('the API key goes in x-api-key, not Authorization', async () => {
        // Confirmed against the live API on 22 Oct 2026. The same key in an
        // Authorization header returns 401 {"status":"Invalid api key"}; in x-api-key
        // it returns 200. Every version before that date had this wrong, and the
        // earlier version of this test pinned the wrong header in place.
        const { req } = await send({ ...COMMON, operation: 'sendSms', message: 'Hello' });
        assert.strictEqual(req.headers['x-api-key'], 'test-api-key');
        assert.strictEqual(req.headers.Authorization, undefined,
            'an Authorization header must not be sent — the v2 API rejects it');
        assert.strictEqual(req.headers['Content-Type'], 'application/json');
    });
});

describe('trigger webhook lifecycle', () => {
    // Shape confirmed against the live API on 22 Oct 2026. ONE webhook carries every
    // selected event type in a filter.event_type array; the label field is `name`.
    // Registering per event type with a `webhook_name` field — what this did before —
    // is rejected with 400 "unknown field webhook_name", so it had never worked.
    const ALL_EVENTS = ['SMS_INBOUND', 'SMS_STATUS', 'MMS_INBOUND', 'MMS_STATUS',
                        'RCS_STATUS', 'OPT_OUT', 'LINK_HIT'];

    function hookContext({ staticData = {}, events = ALL_EVENTS } = {}) {
        const requests = [];
        return {
            requests, staticData,
            getWorkflowStaticData: () => staticData,
            getNodeWebhookUrl: () => 'https://n8n.test/webhook/abc',
            getNodeParameter: (name) => (name === 'events' ? events : undefined),
            getCredentials: async () => ({ apiKey: 'test-api-key' }),
            getNode: () => ({ name: 'Kudosity V2 Trigger' }),
            helpers: { request: async (opts) => { requests.push(opts); return { id: 'wh_1' }; } },
        };
    }

    const methods = KudosityV2Trigger.prototype.webhookMethods ?? new KudosityV2Trigger().webhookMethods;

    test('create registers exactly ONE webhook, whatever the event count', async () => {
        const ctx = hookContext();
        await methods.default.create.call(ctx);
        assert.strictEqual(ctx.requests.length, 1,
            'the API takes all event types on one webhook — do not loop per type');
    });

    test('event types go in filter.event_type as an array', async () => {
        const ctx = hookContext({ events: ['OPT_OUT', 'LINK_HIT'] });
        await methods.default.create.call(ctx);
        const body = JSON.parse(ctx.requests[0].body);
        assert.deepStrictEqual(body.filter, { event_type: ['OPT_OUT', 'LINK_HIT'] });
        assert.strictEqual(body.url, 'https://n8n.test/webhook/abc');
        assert.strictEqual(body.event_type, undefined,
            'a top-level event_type is not part of the API');
    });

    test('the label field is name, never webhook_name', async () => {
        // 400 {"error":"invalid field in request: json: unknown field \"webhook_name\""}
        const ctx = hookContext();
        await methods.default.create.call(ctx);
        const body = JSON.parse(ctx.requests[0].body);
        assert.ok(body.name, 'name is required');
        assert.strictEqual(body.webhook_name, undefined,
            'webhook_name is rejected by the API as an unknown field');
    });

    test('it authenticates with x-api-key', async () => {
        const ctx = hookContext();
        await methods.default.create.call(ctx);
        assert.strictEqual(ctx.requests[0].headers['x-api-key'], 'test-api-key');
        assert.strictEqual(ctx.requests[0].headers.Authorization, undefined);
    });

    test('checkExists is false on a clean slate and true once registered', async () => {
        const ctx = hookContext();
        assert.strictEqual(await methods.default.checkExists.call(ctx), false);
        await methods.default.create.call(ctx);
        assert.strictEqual(await methods.default.checkExists.call(ctx), true,
            'otherwise n8n re-registers on every activation and leaks webhooks');
    });

    test('delete removes the one stored webhook by id', async () => {
        const ctx = hookContext();
        await methods.default.create.call(ctx);
        ctx.requests.length = 0;
        await methods.default.delete.call(ctx);
        assert.strictEqual(ctx.requests.length, 1);
        assert.strictEqual(ctx.requests[0].method, 'DELETE');
        assert.match(ctx.requests[0].url, /\/webhook\/wh_1$/);
        assert.ok(!ctx.staticData.webhookId, 'the local record must be cleared');
    });

    test('delete survives the API being unreachable', async () => {
        const ctx = hookContext();
        await methods.default.create.call(ctx);
        ctx.helpers.request = async () => { throw new Error('ECONNREFUSED'); };
        await assert.doesNotReject(() => methods.default.delete.call(ctx),
            'deactivating a workflow must not fail because Kudosity was down');
    });
});
