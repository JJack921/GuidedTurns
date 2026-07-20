// SPDX-License-Identifier: MIT

import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GuidedActions } from '../src/actions.js';
import { EXTENSION_TEMPLATE_PATH, resolveExtensionLocation } from '../src/constants.js';
import { initializeExtension } from '../src/runtime.js';

describe('extension runtime', () => {
    let observer;

    afterEach(() => observer?.disconnect());

    it.each(['guided-impersonation', 'guided-turns', 'custom-fork-name'])(
        'resolves templates from the installed %s directory',
        directory => {
            const location = resolveExtensionLocation(
                `https://example.test/scripts/extensions/third-party/${directory}/src/constants.js`,
            );
            expect(location).toEqual({
                directory,
                templatePath: `third-party/${directory}`,
                settingsTemplateUrl: `https://example.test/scripts/extensions/third-party/${directory}/settings.html`,
            });
        },
    );

    it('clears impersonation recovery state when SillyTavern reports a sent message', async () => {
        const settingsHtml = await readFile(`${process.cwd()}/settings.html`, 'utf8');
        document.body.innerHTML = `
            <div id="extensions_settings"></div>
            <form id="send_form">
                <div id="nonQRFormItems"></div>
                <textarea id="send_textarea"></textarea>
            </form>
        `;

        const handlers = new Map();
        const context = {
            ConnectionManagerRequestService: {
                getSupportedProfiles: vi.fn(() => []),
            },
            eventSource: {
                on: vi.fn((eventName, handler) => handlers.set(eventName, handler)),
            },
            eventTypes: {
                MESSAGE_SENT: 'message_sent',
            },
            extensionSettings: {
                connectionManager: { selectedProfile: null },
                disabledExtensions: [],
            },
            renderExtensionTemplateAsync: vi.fn(() => settingsHtml),
        };
        const handleMessageSent = vi.spyOn(GuidedActions.prototype, 'handleMessageSent');
        const guidedRevision = vi.spyOn(GuidedActions.prototype, 'guidedRevision').mockResolvedValue(undefined);
        vi.spyOn(console, 'info').mockImplementation(() => {});

        let actions;
        ({ actions, observer } = await initializeExtension({
            extensionSettings: {},
            saveSettings: vi.fn(),
            core: {},
            getContext: () => context,
            document,
        }));

        expect(context.renderExtensionTemplateAsync).toHaveBeenCalledWith(EXTENSION_TEMPLATE_PATH, 'settings');
        expect(handlers.get('message_sent')).toBeTypeOf('function');
        actions.restoreState = { chatId: null, source: 'outline' };
        actions.onStateChange(actions.getState());
        expect(document.getElementById('gt-restore-impersonation').hidden).toBe(false);

        handlers.get('message_sent')();
        expect(handleMessageSent).toHaveBeenCalledOnce();
        expect(actions.getState().canRestoreImpersonation).toBe(false);
        expect(document.getElementById('gt-restore-impersonation').hidden).toBe(true);

        document.getElementById('gt-revision').click();
        expect(guidedRevision).toHaveBeenCalledOnce();
    });
});
