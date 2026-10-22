#!/usr/bin/env node
'use strict';

/**
 * Drives the COMPILED nodes against the real Kudosity API and prints what went out
 * and what came back.
 *
 * The unit tests assert request shape against a fake. This asserts nothing — it
 * reports. Its job is to answer the questions that cannot be settled offline:
 *
 *   - does v1 authenticate with the key alone, or does it need the secret?
 *   - what does a real error body actually look like? (base.imljson in the Make app
 *     and the n8n error handling both guess at this)
 *   - do the responses match what the tests expect?
 *
 * Credentials come from the environment and are never printed. Nothing here sends a
 * message unless you pass --send.
 *
 *   node scripts/live-check.js                 read-only checks
 *   node scripts/live-check.js --send +614...  also sends one real SMS per API
 *
 * Reads KUDOSITY_V1_KEY, KUDOSITY_V1_SECRET (optional), KUDOSITY_V2_KEY.
 */

const https = require('https');
const fs = require('fs');
const { URL } = require('url');
const path = require('path');

const V1 = require(path.join(__dirname, '..', 'dist/nodes/KudosityV1/KudosityV1.node.js')).KudosityV1;
const V2 = require(path.join(__dirname, '..', 'dist/nodes/KudosityV2/KudosityV2.node.js')).KudosityV2;

// Minimal env-file reader. dotenv is not a dependency of this package and is not
// worth adding for one script — the package ships with none beyond n8n-workflow.
// Pass KUDOSITY_ENV=/path/to/file, or rely on the shell's environment.
(function loadEnvFile() {
    const file = process.env.KUDOSITY_ENV;
    if (!file || !fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!m || line.trim().startsWith('#')) continue;
        if (!(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
})();

const argv = process.argv.slice(2);
const sendTo = argv.includes('--send') ? argv[argv.indexOf('--send') + 1] : null;

// ── A real request helper, shaped like n8n's ─────────────────────────────────
function request(opts) {
    return new Promise((resolve, reject) => {
        const url = new URL(opts.url);
        const req = https.request(
            {
                method: opts.method || 'GET',
                hostname: url.hostname,
                path: url.pathname + url.search,
                headers: opts.headers || {},
                timeout: 30000,
            },
            (res) => {
                let body = '';
                res.on('data', (d) => (body += d));
                res.on('end', () => {
                    if (res.statusCode >= 400) {
                        const err = new Error(`HTTP ${res.statusCode}`);
                        err.statusCode = res.statusCode;
                        err.body = body;
                        return reject(err);
                    }
                    resolve(body);
                });
            },
        );
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('timeout')));
        if (opts.body) req.write(opts.body);
        req.end();
    });
}

function context(credentials, params) {
    const sent = [];
    return {
        sent,
        getInputData: () => [{ json: {} }],
        getCredentials: async () => credentials,
        getNodeParameter: (name, _i, fallback) => (name in params ? params[name] : fallback ?? ''),
        getNode: () => ({ name: 'live-check' }),
        helpers: {
            request: async (opts) => {
                sent.push(opts);
                return request(opts);
            },
        },
    };
}

// Redact by matching the header NAME, not by listing known ones. The first version
// redacted only `Authorization`; when the v2 node moved to `x-api-key` the key was
// printed in full while the script still claimed it had printed no credential.
// Anything that looks like it carries a secret is masked, and the shape is preserved
// so the output still shows which scheme was used.
const SECRET_HEADER = /auth|key|token|secret/i;

// Responses carry credentials too. get-client.json returns the account's apikey and
// apisecret in its body, so printing a response verbatim leaks them just as surely as
// printing a header would. Redacting only the request side was not enough.
const SECRET_FIELD = /^(api_?key|api_?secret|secret|token|password|auth)$/i;

function redactBody(value) {
    if (Array.isArray(value)) return value.map(redactBody);
    if (value && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = SECRET_FIELD.test(k) ? '<redacted>' : redactBody(v);
        }
        return out;
    }
    return value;
}

/** Last line of defence: mask any known secret wherever it appears in printed text. */
function scrub(text) {
    let out = String(text);
    for (const v of [process.env.KUDOSITY_V1_KEY, process.env.KUDOSITY_V1_SECRET, process.env.KUDOSITY_V2_KEY]) {
        if (v && v.length > 3) out = out.split(v).join('<redacted>');
    }
    return out;
}

const redact = (headers = {}) => {
    const out = {};
    for (const [name, value] of Object.entries(headers)) {
        if (!SECRET_HEADER.test(name)) {
            out[name] = value;
            continue;
        }
        const v = String(value);
        out[name] = v.startsWith('Basic ') ? 'Basic <redacted>'
                  : v.startsWith('Bearer ') ? 'Bearer <redacted>'
                  : '<redacted>';
    }
    return out;
};

async function run(label, Node, credentials, params) {
    const ctx = context(credentials, params);
    process.stdout.write(`\n── ${label}\n`);
    try {
        const out = await Node.prototype.execute.call(ctx);
        const req = ctx.sent[0] || {};
        console.log(scrub(`   ${req.method} ${req.url}`));
        console.log(`   headers  ${JSON.stringify(redact(req.headers))}`);
        if (req.body) console.log(scrub(`   body     ${String(req.body).slice(0, 200)}`));
        console.log(`   RESULT   OK`);
        console.log(scrub(`   response ${JSON.stringify(redactBody(out[0][0].json)).slice(0, 500)}`));
        return { ok: true };
    } catch (err) {
        const req = ctx.sent[0] || {};
        console.log(scrub(`   ${req.method || '?'} ${req.url || '?'}`));
        console.log(`   headers  ${JSON.stringify(redact(req.headers || {}))}`);
        if (req.body) console.log(scrub(`   body     ${String(req.body).slice(0, 200)}`));
        console.log(`   RESULT   ${err.statusCode ? 'HTTP ' + err.statusCode : 'FAILED'} — ${err.message}`);
        if (err.body) {
            let shown = String(err.body);
            try { shown = JSON.stringify(redactBody(JSON.parse(shown))); } catch { /* not JSON, scrub below */ }
            console.log(scrub(`   ERROR BODY:\n     ${shown.slice(0, 800)}`));
        }
        return { ok: false, status: err.statusCode, body: err.body };
    }
}

async function main() {
    const v1Key = process.env.KUDOSITY_V1_KEY;
    const v1Secret = process.env.KUDOSITY_V1_SECRET || '';
    const v2Key = process.env.KUDOSITY_V2_KEY;

    console.log('\nCREDENTIALS');
    console.log('  V1 key    :', v1Key ? 'set' : 'MISSING');
    console.log('  V1 secret :', v1Secret ? 'set' : 'not set — this is the case we want to test');
    console.log('  V2 key    :', v2Key ? 'set' : 'MISSING');

    if (v1Key) {
        console.log('\n' + '='.repeat(70) + '\nV1  (api.transmitsms.com, HTTP Basic)');

        // The question. Key alone first, deliberately.
        const keyOnly = await run('Get Account — key only, NO secret',
            V1, { apiKey: v1Key, apiSecret: '' }, { operation: 'getAccount' });

        // A 401 on the key-only attempt does NOT mean the secret is required — a wrong
        // key gives the same 401. The question is only answerable by comparing the two
        // attempts, so the verdict waits until both have run.
        let withSecret = null;
        if (!keyOnly.ok && v1Secret) {
            withSecret = await run('Get Account — key + secret', V1,
                { apiKey: v1Key, apiSecret: v1Secret }, { operation: 'getAccount' });
        }

        console.log('\n   >>> VERDICT:');
        if (keyOnly.ok) {
            console.log('       v1 ACCEPTS the key alone. The secret can stay optional in both n8n and Make.');
        } else if (withSecret && withSecret.ok) {
            console.log('       v1 REQUIRES the secret — key alone was rejected, key+secret worked.');
            console.log('       Make apiSecret required in credentials/KudosityV1Api.credentials.ts');
            console.log('       and in kudosity-make/connections/kudosity-v1/parameters.imljson.');
        } else if (withSecret) {
            console.log('       INCONCLUSIVE — both attempts failed. The key itself is probably wrong,');
            console.log('       or the account lacks v1 access. Nothing can be concluded about the secret.');
        } else {
            console.log('       INCONCLUSIVE — key alone was rejected and no secret was supplied to');
            console.log('       compare against. A wrong key produces this same 401. Set');
            console.log('       KUDOSITY_V1_SECRET and re-run before concluding anything.');
        }

        const creds = keyOnly.ok ? { apiKey: v1Key, apiSecret: '' } : { apiKey: v1Key, apiSecret: v1Secret };
        await run('Get Numbers', V1, creds, { operation: 'getNumbers' });
        await run('Get Sender IDs', V1, creds, { operation: 'getSenderIds' });
        await run('Format Number (0412345678, AU)', V1, creds,
            { operation: 'formatNumber', msisdn: '0412345678', countrycode: 'AU' });

        // Deliberate failure, to capture the real error shape.
        await run('Format Number with a bad key — ERROR SHAPE', V1,
            { apiKey: 'DEFINITELY_NOT_A_KEY', apiSecret: '' },
            { operation: 'formatNumber', msisdn: '0412345678', countrycode: 'AU' });

        if (sendTo) {
            await run(`Send SMS to ${sendTo}`, V1, creds,
                { operation: 'sendSms', to: sendTo, message: 'Kudosity n8n live check (v1)', from: '', additionalFields: {} });
        }
    }

    if (v2Key) {
        console.log('\n' + '='.repeat(70) + '\nV2  (api.transmitmessage.com, raw key header)');

        await run('Send SMS with a bad key — ERROR SHAPE', V2,
            { apiKey: 'DEFINITELY_NOT_A_KEY' },
            { operation: 'sendSms', recipient: '+61400000000', sender: '+61400000001', message: 'x' });

        if (sendTo) {
            await run(`Send SMS to ${sendTo}`, V2, { apiKey: v2Key },
                { operation: 'sendSms', recipient: sendTo, sender: '', message: 'Kudosity n8n live check (v2)' });
        }
    }

    console.log('\nDone. Credential-looking headers and response fields were masked,\nand any known key or secret is scrubbed from every line.\n');
}

main().catch((e) => { console.error('live-check failed:', e.message); process.exit(1); });
