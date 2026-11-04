'use strict';

/**
 * 0.2.0: List SMS and Track Links on the V2 node, and the legacy "Kudosity" node
 * kept for workflows built with n8n-nodes-kudosity 0.1.x.
 *
 * GET /v2/sms returns { smses, total_records, total_segments } and pages with
 * page + limit (developers.kudosity.com). No network: requests are captured.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const dist = (p) => require(path.join(__dirname, '..', 'dist', p));
const { KudosityV2 } = dist('nodes/KudosityV2/KudosityV2.node.js');
const { Kudosity } = dist('nodes/Kudosity/Kudosity.node.js');
const { KudosityApi } = dist('credentials/KudosityApi.credentials.js');
const { listQuery, PAGE_SIZE } = dist('nodes/shared/listSms.js');

const sms = (n) => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, message: 'x' }));

/** A context whose request() serves `pages` in order (one per call). */
function ctx(params, creds, pages) {
    const requests = [];
    let call = 0;
    return {
        requests,
        getInputData: () => [{ json: {} }],
        getCredentials: async () => creds,
        getNodeParameter: (name, _i, fallback) => (name in params ? params[name] : fallback ?? ''),
        getNode: () => ({ name: 'Kudosity' }),
        continueOnFail: () => false,
        helpers: {
            request: async (opts) => {
                requests.push(opts);
                return pages ? pages[Math.min(call++, pages.length - 1)] : { id: 'sent-1' };
            },
        },
    };
}
const qs = (req) => Object.fromEntries(new URL(req.url).searchParams);

describe('listQuery', () => {
    test('drops empty filters and converts dates to RFC 3339', () => {
        assert.deepStrictEqual(
            listQuery({ sender: '', recipient: '614', start_date: '2026-11-01T00:00:00', status: undefined }),
            { recipient: '614', start_date: new Date('2026-11-01T00:00:00').toISOString() },
        );
    });
});

describe('V2: List SMS', () => {
    test('with a limit: one request, page 1, filters passed, one item per message', async () => {
        const c = ctx({ operation: 'listSms', returnAll: false, limit: 3, filters: { direction: 'IN', order_by: 'CREATED_AT_DESC' } },
            { apiKey: 'K' }, [{ smses: sms(3), total_records: '40', total_segments: '40' }]);
        const [out] = await KudosityV2.prototype.execute.call(c);
        assert.strictEqual(c.requests.length, 1);
        assert.strictEqual(c.requests[0].method, 'GET');
        assert.deepStrictEqual(qs(c.requests[0]), { direction: 'IN', order_by: 'CREATED_AT_DESC', limit: '3', page: '1' });
        assert.strictEqual(c.requests[0].headers['x-api-key'], 'K');
        assert.strictEqual(out.length, 3);
        assert.strictEqual(out[0].json.id, 'm0');
    });

    test('Return All pages until total_records is reached', async () => {
        const c = ctx({ operation: 'listSms', returnAll: true }, { apiKey: 'K' }, [
            { smses: sms(PAGE_SIZE), total_records: String(PAGE_SIZE + 20), total_segments: '0' },
            { smses: sms(20), total_records: String(PAGE_SIZE + 20), total_segments: '0' },
            { smses: sms(99), total_records: '0', total_segments: '0' }, // must not be requested
        ]);
        const [out] = await KudosityV2.prototype.execute.call(c);
        assert.deepStrictEqual(c.requests.map((r) => qs(r).page), ['1', '2']);
        assert.ok(c.requests.every((r) => qs(r).limit === String(PAGE_SIZE)));
        assert.strictEqual(out.length, PAGE_SIZE + 20);
    });

    test('Return All stops on an empty page even if the total is wrong', async () => {
        const c = ctx({ operation: 'listSms', returnAll: true }, { apiKey: 'K' }, [
            { smses: sms(PAGE_SIZE), total_records: '99999', total_segments: '0' },
            { smses: [], total_records: '99999', total_segments: '0' },
        ]);
        const [out] = await KudosityV2.prototype.execute.call(c);
        assert.strictEqual(c.requests.length, 2);
        assert.strictEqual(out.length, PAGE_SIZE);
    });

    test('does not need recipient or sender', async () => {
        const c = ctx({ operation: 'listSms', limit: 1 }, { apiKey: 'K' }, [{ smses: [], total_records: '0', total_segments: '0' }]);
        await assert.doesNotReject(() => KudosityV2.prototype.execute.call(c));
    });
});

describe('V2: Track Links', () => {
    const base = { operation: 'sendSms', recipient: '+61412345678', sender: '+61481074185', message: 'see https://x.test' };
    test('on: sends track_links true', async () => {
        const c = ctx({ ...base, trackLinks: true }, { apiKey: 'K' });
        await KudosityV2.prototype.execute.call(c);
        assert.strictEqual(JSON.parse(c.requests[0].body).track_links, true);
    });
    test('off: field omitted, body unchanged from 0.1.0', async () => {
        const c = ctx({ ...base, trackLinks: false }, { apiKey: 'K' });
        await KudosityV2.prototype.execute.call(c);
        assert.deepStrictEqual(JSON.parse(c.requests[0].body), { sender: base.sender, recipient: base.recipient, message: base.message });
    });
});

describe('legacy node keeps 0.1.x workflows working', () => {
    const d = new Kudosity().description;

    test('same node name and credential as 0.1.6, hidden from the panel', () => {
        assert.strictEqual(d.name, 'kudosity');
        assert.strictEqual(d.version, 1);
        assert.strictEqual(d.hidden, true);
        assert.deepStrictEqual(d.credentials.map((c) => c.name), ['kudosityApi']);
    });

    test('every 0.1.6 parameter still exists under the same name', () => {
        const names = d.properties.map((p) => p.name);
        for (const n of ['resource', 'operation', 'message', 'sender', 'recipient', 'additionalFields', 'returnAll', 'limit', 'filters']) {
            assert.ok(names.includes(n), `missing parameter ${n}`);
        }
        const opt = (name) => d.properties.find((p) => p.name === name).options.map((o) => o.name);
        assert.deepStrictEqual(opt('additionalFields').sort(), ['message_ref', 'track_links']);
        for (const f of ['start_date', 'end_date', 'message_ref', 'sender', 'recipient', 'status', 'direction']) {
            assert.ok(opt('filters').includes(f), `missing filter ${f}`);
        }
        const statuses = d.properties.find((p) => p.name === 'filters').options.find((o) => o.name === 'status').options.map((o) => o.value);
        for (const s of ['SENT', 'DELIVERED', 'HARD_BOUNCE', 'SOFT_BOUNCE']) assert.ok(statuses.includes(s), `0.1.6 status ${s} dropped`);
    });

    test('credential keeps the 0.1.6 name and field names', () => {
        const c = new KudosityApi();
        assert.strictEqual(c.name, 'kudosityApi');
        assert.deepStrictEqual(c.properties.map((p) => p.name), ['apiKey', 'password']);
    });

    test('send: POST /v2/sms with the same body 0.1.6 sent', async () => {
        const c = ctx({ operation: 'send', message: 'Hi', sender: 61481074185, recipient: 61412345678, additionalFields: { message_ref: 'r1', track_links: true } },
            { apiKey: 'K', password: 'S' });
        await Kudosity.prototype.execute.call(c);
        const req = c.requests[0];
        assert.strictEqual(req.url, 'https://api.transmitmessage.com/v2/sms');
        assert.strictEqual(req.headers['x-api-key'], 'K');
        assert.deepStrictEqual(JSON.parse(req.body), { message: 'Hi', sender: '61481074185', recipient: '61412345678', message_ref: 'r1', track_links: true });
    });

    test('list: one item shaped like the API response, as 0.1.6 returned', async () => {
        const c = ctx({ operation: 'list', returnAll: false, limit: 2 }, { apiKey: 'K', password: 'S' },
            [{ smses: sms(2), total_records: '2', total_segments: '2' }]);
        const [out] = await Kudosity.prototype.execute.call(c);
        assert.strictEqual(out.length, 1);
        assert.strictEqual(out[0].json.smses.length, 2);
        assert.strictEqual(out[0].json.total_records, '2');
    });

    test('list: Return All now actually pages (0.1.6 returned one page)', async () => {
        const c = ctx({ operation: 'list', returnAll: true }, { apiKey: 'K', password: 'S' }, [
            { smses: sms(PAGE_SIZE), total_records: String(PAGE_SIZE + 5), total_segments: '0' },
            { smses: sms(5), total_records: String(PAGE_SIZE + 5), total_segments: '0' },
        ]);
        const [out] = await Kudosity.prototype.execute.call(c);
        assert.strictEqual(c.requests.length, 2);
        assert.strictEqual(out[0].json.smses.length, PAGE_SIZE + 5);
    });

    test('sender dropdown: account numbers via v1 Basic auth, as in 0.1.6', async () => {
        const c = ctx({}, { apiKey: 'K', password: 'S' }, [{ numbers: [{ number: 61481074185 }, { number: 61430251585 }] }]);
        const options = await new Kudosity().methods.loadOptions.getSenderOptions.call(c);
        assert.strictEqual(c.requests[0].url, 'https://api.transmitsms.com/get-numbers.json');
        assert.strictEqual(c.requests[0].headers.Authorization, 'Basic ' + Buffer.from('K:S').toString('base64'));
        assert.deepStrictEqual(options, [{ name: '61481074185', value: '61481074185' }, { name: '61430251585', value: '61430251585' }]);
    });
});
