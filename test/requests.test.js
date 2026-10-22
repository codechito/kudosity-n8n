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
    // n8n always supplies this — the parameter is required and defaults to
    // ['SMS_INBOUND'] — so the fake supplies it too rather than testing a state
    // the editor cannot produce.
    const ALL_EVENTS = ['SMS_INBOUND', 'SMS_STATUS', 'MMS_INBOUND', 'MMS_STATUS',
                        'RCS_STATUS', 'OPT_OUT', 'LINK_HIT'];

    function hookContext({ staticData = {}, events = ALL_EVENTS } = {}) {
        const requests = [];
        return {
            requests,
            staticData,
            getWorkflowStaticData: () => staticData,
            getNodeWebhookUrl: () => 'https://n8n.test/webhook/abc',
            getNodeParameter: (name) => (name === 'events' ? events : undefined),
            getCredentials: async () => ({ apiKey: 'test-api-key' }),
            getNode: () => ({ name: 'Kudosity V2 Trigger' }),
            helpers: { request: async (opts) => { requests.push(opts); return { id: `wh_${requests.length}` }; } },
        };
    }

    const methods = KudosityV2Trigger.prototype.webhookMethods ?? new KudosityV2Trigger().webhookMethods;

    test('create registers one webhook per selected event type, each with the n8n callback URL', async () => {
        const ctx = hookContext();
        await methods.default.create.call(ctx);

        assert.ok(ctx.requests.length > 0, 'no webhooks registered');
        for (const req of ctx.requests) {
            assert.strictEqual(req.method, 'POST');
            assert.strictEqual(req.url, `${BASE}/webhook`);
            assert.strictEqual(req.headers['x-api-key'], 'test-api-key');
            const body = JSON.parse(req.body);
            assert.strictEqual(body.url, 'https://n8n.test/webhook/abc');
            assert.ok(body.event_type, 'event_type must be set on each registration');
            assert.ok(body.webhook_name.startsWith('n8n - '), 'webhook_name should identify n8n as the owner');
        }

        const types = ctx.requests.map((r) => JSON.parse(r.body).event_type);
        assert.strictEqual(new Set(types).size, types.length, 'each event type must register exactly once');
        assert.deepStrictEqual(types.sort(), [...ALL_EVENTS].sort());
    });

    test('only the selected event types are registered', async () => {
        const ctx = hookContext({ events: ['OPT_OUT', 'LINK_HIT'] });
        await methods.default.create.call(ctx);
        const types = ctx.requests.map((r) => JSON.parse(r.body).event_type);
        assert.deepStrictEqual(types.sort(), ['LINK_HIT', 'OPT_OUT'],
            'subscribing to two events must not register all seven');
    });

    test('checkExists is false on a clean slate and true once an id is stored', async () => {
        assert.strictEqual(await methods.default.checkExists.call(hookContext()), false);

        const seeded = hookContext();
        await methods.default.create.call(seeded);
        assert.strictEqual(await methods.default.checkExists.call(seeded), true,
            'after create, stored ids must make checkExists report true — otherwise n8n re-registers on every activation');
    });

    test('delete issues a DELETE per stored webhook id', async () => {
        const ctx = hookContext();
        await methods.default.create.call(ctx);
        const registered = ctx.requests.length;

        ctx.requests.length = 0;
        await methods.default.delete.call(ctx);

        assert.strictEqual(ctx.requests.length, registered, 'every registered webhook must be removed');
        for (const req of ctx.requests) {
            assert.strictEqual(req.method, 'DELETE');
            assert.match(req.url, new RegExp(`^${BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/webhook/`));
        }
    });
});
