#!/usr/bin/env node
'use strict';

/**
 * Copies node icons into dist/ alongside the compiled JavaScript.
 *
 * Replaces the `gulp build:icons` step from the n8n starter template. gulp was
 * referenced by the build script but never added to devDependencies and no
 * gulpfile existed, so `npm run build` failed before producing anything. n8n only
 * requires that the icon sits next to its compiled node; how it gets there is not
 * part of the contract, so this avoids pulling in gulp and its dependency tree.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCES = ['nodes', 'credentials'];
const ICON_EXT = new Set(['.svg', '.png']);

function copyIcons(dir) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return 0;

    let copied = 0;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        const rel = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            copied += copyIcons(rel);
        } else if (ICON_EXT.has(path.extname(entry.name).toLowerCase())) {
            const target = path.join(ROOT, 'dist', rel);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.copyFileSync(path.join(ROOT, rel), target);
            copied++;
        }
    }
    return copied;
}

const total = SOURCES.reduce((n, dir) => n + copyIcons(dir), 0);
if (total === 0) {
    console.error('No icons found — n8n will render the node without one.');
    process.exit(1);
}
console.log(`Copied ${total} icon${total === 1 ? '' : 's'} into dist/`);
