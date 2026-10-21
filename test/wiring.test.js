'use strict';

/**
 * Contract tests against the BUILT package in dist/, not the TypeScript source.
 *
 * These check the wiring that the compiler cannot: n8n resolves credentials, nodes
 * and icons by string at runtime, so a rename that updates a class but not the
 * string it is looked up by compiles cleanly and then fails in the editor. That
 * exact bug existed here — three `getCredentials('kudosityApi')` calls survived the
 * rename to kudosityV2Api.
 *
 *   npm run build && npm test
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));

const declaredNodes = pkg.n8n.nodes.map((p) => path.join(ROOT, p));
const declaredCreds = pkg.n8n.credentials.map((p) => path.join(ROOT, p));

describe('package entry points', () => {
    test('every declared path exists on disk', () => {
        for (const p of [pkg.main, pkg.types, ...pkg.n8n.nodes, ...pkg.n8n.credentials]) {
            assert.ok(fs.existsSync(path.join(ROOT, p)), `${p} is declared but missing — run npm run build`);
        }
    });

    test('main is inside a published directory', () => {
        // files:["dist"] means anything outside dist/ is absent from the tarball,
        // however correct it looks locally.
        const included = pkg.files.some((f) => pkg.main.startsWith(f.replace(/\/$/, '')));
        assert.ok(included, `main "${pkg.main}" is not covered by files: ${JSON.stringify(pkg.files)}`);
    });
});

describe('node descriptions', () => {
    const nodes = declaredNodes.map((p) => {
        const mod = require(p);
        const Cls = Object.values(mod)[0];
        return { file: path.basename(p), description: new Cls().description };
    });

    test('each node has the fields n8n requires', () => {
        for (const { file, description: d } of nodes) {
            for (const field of ['displayName', 'name', 'version', 'inputs', 'outputs']) {
                assert.ok(d[field] !== undefined, `${file}: description.${field} is missing`);
            }
        }
    });

    test('node names are unique', () => {
        const names = nodes.map((n) => n.description.name);
        assert.strictEqual(new Set(names).size, names.length, `duplicate node names: ${names}`);
    });

    test('every icon resolves next to its compiled node', () => {
        for (const [i, { description: d }] of nodes.entries()) {
            if (!d.icon) continue;
            assert.ok(d.icon.startsWith('file:'), `icon "${d.icon}" is not a file reference`);
            const icon = path.join(path.dirname(declaredNodes[i]), d.icon.slice('file:'.length));
            assert.ok(fs.existsSync(icon), `icon missing from dist: ${icon} — the copy-icons step did not run`);
        }
    });
});

describe('credential wiring', () => {
    const credNames = declaredCreds.map((p) => {
        const Cls = Object.values(require(p))[0];
        return new Cls().name;
    });

    test('every credential a node declares actually ships', () => {
        for (const p of declaredNodes) {
            const d = new (Object.values(require(p))[0])().description;
            for (const c of d.credentials ?? []) {
                assert.ok(
                    credNames.includes(c.name),
                    `${path.basename(p)} declares credential "${c.name}", which no shipped credential provides. ` +
                    `Available: ${credNames.join(', ')}`,
                );
            }
        }
    });

    test('every credential requested at RUNTIME also ships', () => {
        // The bug the compiler cannot see. getCredentials() takes a string, so a
        // stale name here survives a rename and only fails once a user runs the node.
        for (const p of declaredNodes) {
            const source = fs.readFileSync(p, 'utf8');
            const requested = [...source.matchAll(/getCredentials\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
            for (const name of requested) {
                assert.ok(
                    credNames.includes(name),
                    `${path.basename(p)} calls getCredentials("${name}") at runtime, but no shipped credential has that name. ` +
                    `Available: ${credNames.join(', ')}`,
                );
            }
        }
    });

    test('names are consistently versioned', () => {
        // Guards the V1/V2 split: a node must not quietly bind to the other API's credential.
        for (const p of declaredNodes) {
            const d = new (Object.values(require(p))[0])().description;
            const version = d.name.match(/V\d+/)?.[0];
            if (!version) continue;
            for (const c of d.credentials ?? []) {
                assert.ok(
                    c.name.includes(version.toLowerCase()) || c.name.includes(version),
                    `node "${d.name}" is ${version} but uses credential "${c.name}" — check the API version binding`,
                );
            }
        }
    });
});
