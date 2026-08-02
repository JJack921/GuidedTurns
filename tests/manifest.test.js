// SPDX-License-Identifier: MIT

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('extension manifest', () => {
    it('declares the release metadata and entrypoints', async () => {
        const manifest = JSON.parse(await readFile(`${process.cwd()}/manifest.json`, 'utf8'));
        expect(manifest).toMatchObject({
            name: 'guided-turns',
            display_name: 'Guided Turns',
            js: 'index.js',
            css: 'style.css',
            author: 'JJack921',
            version: '0.6.0',
            minimum_client_version: '1.18.0',
            manifest_version: 3,
            homePage: 'https://github.com/JJack921/GuidedTurns',
            auto_update: true,
        });
    });

    it('declares consistent MIT package and source metadata', async () => {
        const packageJson = JSON.parse(await readFile(`${process.cwd()}/package.json`, 'utf8'));
        const license = await readFile(`${process.cwd()}/LICENSE`, 'utf8');
        expect(packageJson).toMatchObject({ name: 'guided-turns', version: '0.6.0', license: 'MIT' });
        expect(license).toContain('MIT License');
        expect(license).toContain('Copyright (c) 2026 JJack921');
    });
});
