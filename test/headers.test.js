'use strict';

/**
 * Usage tracking headers (SAL-94).
 *
 * Every request to a Kudosity API must identify this integration, its release,
 * and what the request is for — and nothing else. A request path that forgets
 * the headers is invisible in usage reports, so every path is checked here.
 *
 * Operation lists are read from the node descriptions rather than repeated, so
 * adding an operation without giving it an action fails this file.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const dist = (p) => require(path.join(__dirname, '..', 'dist', p));
const { KudosityV1 } = dist('nodes/KudosityV1/KudosityV1.node.js');
const { KudosityV2 } = dist('nodes/KudosityV2/KudosityV2.node.js');
const { KudosityV1Trigger } = dist('nodes/KudosityV1/KudosityV1Trigger.node.js');
const { KudosityV2Trigger } = dist('nodes/KudosityV2/KudosityV2Trigger.node.js');
const { KudosityV1Api } = dist('credentials/KudosityV1Api.credentials.js');
const { KudosityV2Api } = dist('credentials/KudosityV2Api.credentials.js');
const { SOURCE, VERSION } = dist('nodes/shared/tracking.js');
const pkg = require(path.join(__dirname, '..', 'package.json'));

const PHONE = '+61412345678';

function assertTracking(headers, action) {
    assert.ok(headers, 'request has no headers');
    assert.strictEqual(headers['User-Agent'], `kudosity-n8n/${pkg.version}`);
    assert.strictEqual(headers['X-Kudosity-Source'], 'kudosity-n8n');
    assert.strictEqual(headers['X-Kudosity-Source-Version'], pkg.version);
    assert.strictEqual(headers['X-Kudosity-Action'], action);
}

function operationsOf(NodeClass) {
    const op = new NodeClass().description.properties.find((p) => p.name === 'operation');
    return op.options.map((o) => o.value);
}

function execContext(params, creds) {
    const requests = [];
    return {
        requests,
        getInputData: () => [{ json: {} }],
        getCredentials: async () => creds,
        getNodeParameter: (name, _i, fallback) => (name in params ? params[name] : fallback ?? ''),
        getNode: () => ({ name: 'Kudosity' }),
        continueOnFail: () => false,
        helpers: { request: async (opts) => { requests.push(opts); return { id: 'x' }; } },
    };
}

async function run(NodeClass, params, creds) {
    const ctx = execContext(params, creds);
    await NodeClass.prototype.execute.call(ctx);
    assert.strictEqual(ctx.requests.length, 1);
    return ctx.requests[0];
}

describe('tracking constants', () => {
    test('VERSION matches package.json, so a release cannot report a stale version', () => {
        assert.strictEqual(VERSION, pkg.version);
    });

    test('SOURCE is namespaced, not a bare platform name', () => {
        assert.strictEqual(SOURCE, 'kudosity-n8n');
    });
});

describe('V1 node', () => {
    const expected = {
        sendSms: 'sms.send',
        cancelSms: 'sms.cancel',
        getDeliveryStatus: 'status.get',
        formatNumber: 'number.format',
        getSenderIds: 'senderids.get',
        getAccount: 'account.get',
        getNumbers: 'numbers.get',
        getSmsResponses: 'replies.get',
        setForwardUrl: 'number.forward',
    };

    test('every operation has an expected action', () => {
        assert.deepStrictEqual(operationsOf(KudosityV1).sort(), Object.keys(expected).sort());
    });

    for (const [operation, action] of Object.entries(expected)) {
        test(`${operation} sends ${action}, and keeps its auth header`, async () => {
            const req = await run(KudosityV1, { operation, to: PHONE, message: 'Hi' }, { apiKey: 'K', apiSecret: 'S' });
            assertTracking(req.headers, action);
            assert.match(req.headers.Authorization, /^Basic /);
        });
    }
});

describe('V2 node', () => {
    const expected = {
        sendSms: 'sms.send',
        sendMms: 'mms.send',
        sendWhatsapp: 'whatsapp.send',
        sendRcs: 'rcs.send',
    };

    test('every operation has an expected action', () => {
        assert.deepStrictEqual(operationsOf(KudosityV2).sort(), Object.keys(expected).sort());
    });

    for (const [operation, action] of Object.entries(expected)) {
        test(`${operation} sends ${action}, and keeps its auth header`, async () => {
            const req = await run(
                KudosityV2,
                { operation, recipient: PHONE, sender: '+61481074185', message: 'Hi', contentType: 'text' },
                { apiKey: 'K' },
            );
            assertTracking(req.headers, action);
            assert.strictEqual(req.headers['x-api-key'], 'K');
        });
    }
});

describe('triggers', () => {
    function hookContext(params) {
        const requests = [];
        const staticData = {};
        return {
            requests,
            staticData,
            getNodeParameter: (name, fallback) => (name in params ? params[name] : fallback),
            getCredentials: async () => ({ apiKey: 'K', apiSecret: 'S' }),
            getWorkflowStaticData: () => staticData,
            getNodeWebhookUrl: () => 'https://n8n.test/webhook/abc',
            getNode: () => ({ name: 'Trigger' }),
            helpers: { request: async (opts) => { requests.push(opts); return { id: 'wh_1' }; } },
        };
    }

    for (const [name, Trigger, params] of [
        ['V1', KudosityV1Trigger, { number: '61430251585', clearOnDelete: true }],
        ['V2', KudosityV2Trigger, { events: ['SMS_INBOUND'] }],
    ]) {
        test(`${name} subscribe sends trigger.subscribe, unsubscribe sends trigger.unsubscribe`, async () => {
            const methods = new Trigger().webhookMethods.default;
            const ctx = hookContext(params);
            await methods.create.call(ctx);
            await methods.delete.call(ctx);
            assert.strictEqual(ctx.requests.length, 2);
            assertTracking(ctx.requests[0].headers, 'trigger.subscribe');
            assertTracking(ctx.requests[1].headers, 'trigger.unsubscribe');
        });
    }
});

describe('credential tests send connect, the install signal', () => {
    for (const [name, Cred] of [['V1', KudosityV1Api], ['V2', KudosityV2Api]]) {
        test(`${name} credential test`, () => {
            const cred = new Cred();
            assert.ok(cred.test, `${name} credential has no test request`);
            assertTracking(cred.test.request.headers, 'connect');
        });
    }

    test('V1 credential test authenticates with key:secret', () => {
        const auth = new KudosityV1Api().authenticate.properties.auth;
        assert.strictEqual(auth.username, '={{$credentials.apiKey}}');
        assert.strictEqual(auth.password, '={{$credentials.apiSecret}}');
    });
});

describe('privacy', () => {
    test('no header carries message content or phone numbers', async () => {
        const req = await run(
            KudosityV2,
            { operation: 'sendSms', recipient: PHONE, sender: '+61481074185', message: 'secret text' },
            { apiKey: 'K' },
        );
        const tracking = Object.entries(req.headers).filter(([k]) => /^(user-agent|x-kudosity-)/i.test(k));
        for (const [, value] of tracking) {
            assert.ok(!value.includes('secret text') && !value.includes('614'), `leaked into header: ${value}`);
        }
    });
});
