// SPDX-License-Identifier: MIT

import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_PROFILE, DEFAULT_PROMPTS } from '../src/constants.js';
import { createDefaultSettings } from '../src/settings.js';
import { mountActionBar, mountSettingsUI } from '../src/ui.js';

function settingsMarkup() {
    return `
        <div id="gt-settings">
            <select id="gt-profile-impersonate" data-profile-kind="impersonate"></select>
            <div id="gt-profile-impersonate-summary"></div>
            <select id="gt-profile-swipe" data-profile-kind="swipe"></select>
            <div id="gt-profile-swipe-summary"></div>
            <select id="gt-profile-revision" data-profile-kind="revision"></select>
            <div id="gt-profile-revision-summary"></div>
            <select id="gt-perspective">
                <option value="first">First</option>
                <option value="second">Second</option>
                <option value="third">Third</option>
            </select>
            <input id="gt-debug-mode" type="checkbox">
            ${Object.keys(DEFAULT_PROMPTS).map(key => `
                <textarea data-prompt-key="${key}"></textarea>
                <button class="gt-reset-prompt" data-prompt-key="${key}">Reset</button>
            `).join('')}
            <button id="gt-reset-all-prompts">Reset all</button>
        </div>
    `;
}

function profileContext(profiles) {
    return {
        extensionSettings: {
            disabledExtensions: [],
            connectionManager: { selectedProfile: profiles.find(profile => profile.id === 'chat')?.id ?? profiles[0]?.id ?? null },
        },
        CONNECT_API_MAP: {
            openrouter: { selected: 'openai' },
            koboldcpp: { selected: 'textgenerationwebui' },
        },
        ConnectionManagerRequestService: {
            getSupportedProfiles: vi.fn(() => profiles),
        },
    };
}

describe('settings UI', () => {
    beforeEach(() => {
        document.body.innerHTML = settingsMarkup();
        vi.stubGlobal('confirm', vi.fn(() => true));
    });

    it('shows current and supported profiles and persists independent selections and perspective', () => {
        const settings = createDefaultSettings();
        const saveSettings = vi.fn();
        const profiles = [
            { id: 'text', name: 'Text Helper', api: 'koboldcpp', model: 'local', preset: 'Text Preset' },
            { id: 'chat', name: 'Chat Helper', api: 'openrouter', model: 'remote', preset: 'Chat Preset' },
        ];
        const context = profileContext(profiles);
        const ui = mountSettingsUI({ document, context, settings, saveSettings });
        const profileSelect = document.getElementById('gt-profile-impersonate');
        expect([...profileSelect.options].map(item => item.textContent)).toEqual([
            'Use current Connection Manager profile',
            'Chat Helper — Chat Completion · remote · Chat Preset',
            'Text Helper — Text Completion · local · Text Preset',
        ]);
        profileSelect.value = 'chat';
        profileSelect.dispatchEvent(new Event('change'));
        expect(settings.profileIds.impersonate).toBe('chat');
        expect(settings.profileIds.swipe).toBe(CURRENT_PROFILE);
        expect(settings.profileIds.revision).toBe(CURRENT_PROFILE);
        expect(document.getElementById('gt-profile-impersonate-summary').textContent).toContain('Preset: Chat Preset');

        const swipeProfile = document.getElementById('gt-profile-swipe');
        expect(document.getElementById('gt-profile-swipe-summary').textContent).toContain('Current: Chat Helper');
        swipeProfile.value = 'text';
        swipeProfile.dispatchEvent(new Event('change'));
        expect(settings.profileIds.swipe).toBe('text');

        const revisionProfile = document.getElementById('gt-profile-revision');
        revisionProfile.value = 'chat';
        revisionProfile.dispatchEvent(new Event('change'));
        expect(settings.profileIds.revision).toBe('chat');

        settings.profileIds.swipe = CURRENT_PROFILE;
        context.extensionSettings.connectionManager.selectedProfile = 'text';
        ui.refreshProfiles();
        expect(document.getElementById('gt-profile-swipe-summary').textContent).toContain('Current: Text Helper');

        const perspective = document.getElementById('gt-perspective');
        perspective.value = 'third';
        perspective.dispatchEvent(new Event('change'));
        expect(settings.perspective).toBe('third');
        expect(saveSettings).toHaveBeenCalledTimes(4);
        expect(ui.refreshProfiles).toBeTypeOf('function');
    });

    it('persists the debug mode toggle', () => {
        const settings = createDefaultSettings();
        const saveSettings = vi.fn();
        mountSettingsUI({ document, context: profileContext([]), settings, saveSettings });
        const toggle = document.getElementById('gt-debug-mode');

        expect(toggle.checked).toBe(false);
        toggle.checked = true;
        toggle.dispatchEvent(new Event('change'));

        expect(settings.debugMode).toBe(true);
        expect(saveSettings).toHaveBeenCalledOnce();
    });

    it('resets individual and all prompts', () => {
        const settings = createDefaultSettings();
        const saveSettings = vi.fn();
        mountSettingsUI({ document, context: profileContext([]), settings, saveSettings });
        const first = document.querySelector('textarea[data-prompt-key="impersonateFirst"]');
        first.value = 'custom';
        first.dispatchEvent(new Event('input'));
        expect(settings.prompts.impersonateFirst).toBe('custom');

        document.querySelector('button[data-prompt-key="impersonateFirst"]').click();
        expect(first.value).toBe(DEFAULT_PROMPTS.impersonateFirst);

        first.value = 'another';
        first.dispatchEvent(new Event('input'));
        document.getElementById('gt-reset-all-prompts').click();
        expect(first.value).toBe(DEFAULT_PROMPTS.impersonateFirst);
        expect(settings.prompts).toEqual(DEFAULT_PROMPTS);
    });

    it('groups the refreshed settings and places prompt controls in an advanced drawer', async () => {
        const html = await readFile(`${process.cwd()}/settings.html`, 'utf8');
        document.body.innerHTML = html;
        const root = document.getElementById('gt-settings');
        const drawer = root.querySelector('.gt-prompts-drawer');
        expect(root.querySelectorAll('.gt-settings-section')).toHaveLength(3);
        expect(drawer.classList.contains('inline-drawer')).toBe(true);
        expect(drawer.querySelector('.inline-drawer-toggle').textContent).toContain('Advanced prompts');
        expect(drawer.querySelectorAll('.gt-reset-prompt')).toHaveLength(Object.keys(DEFAULT_PROMPTS).length);
        expect(drawer.querySelector('#gt-reset-all-prompts')).not.toBeNull();
    });
});

describe('action bar', () => {
    it('mounts idempotently, orders and hides restore correctly, and keeps the active action available for cancellation', async () => {
        const extensionCss = await readFile(`${process.cwd()}/style.css`, 'utf8');
        document.head.innerHTML = `<style>.menu_button { display: flex; }</style><style>${extensionCss}</style>`;
        document.body.innerHTML = '<form id="send_form"><div id="nonQRFormItems"></div></form>';
        const onImpersonate = vi.fn();
        const onRestoreImpersonation = vi.fn();
        const onSwipe = vi.fn();
        const onRevision = vi.fn();
        const first = mountActionBar({ document, onImpersonate, onRestoreImpersonation, onSwipe, onRevision });
        const second = mountActionBar({ document, onImpersonate, onRestoreImpersonation, onSwipe, onRevision });
        expect(document.querySelectorAll('#gt-action-bar')).toHaveLength(1);
        expect(document.querySelectorAll('.gt-action-button')).toHaveLength(4);
        expect([...document.getElementById('gt-action-bar').children].map(button => button.id)).toEqual([
            'gt-impersonate',
            'gt-swipe',
            'gt-revision',
            'gt-restore-impersonation',
        ]);
        expect(document.getElementById('gt-action-bar').getAttribute('aria-label')).toBe('Guided Turns actions');
        expect(document.getElementById('gt-impersonate').textContent).toContain('Guided Impersonation');
        const restoreButton = document.getElementById('gt-restore-impersonation');
        expect(restoreButton.hidden).toBe(true);
        expect(getComputedStyle(restoreButton).display).toBe('none');

        second.updateState({ canRestoreImpersonation: true });
        expect(restoreButton.hidden).toBe(false);
        expect(restoreButton.textContent).toContain('Restore Outline');
        restoreButton.click();
        expect(onRestoreImpersonation).toHaveBeenCalledOnce();

        second.updateState({ canRestoreImpersonation: false });
        expect(restoreButton.hidden).toBe(true);
        expect(getComputedStyle(restoreButton).display).toBe('none');

        second.updateState({ activeKind: 'impersonate', canRestoreImpersonation: true });
        expect(document.getElementById('gt-impersonate').disabled).toBe(false);
        expect(restoreButton.disabled).toBe(true);
        expect(document.getElementById('gt-swipe').disabled).toBe(true);
        expect(document.getElementById('gt-revision').disabled).toBe(true);
        expect(document.getElementById('gt-impersonate').textContent).toContain('Cancel');
        expect(document.getElementById('gt-impersonate').classList.contains('gt-is-cancelling')).toBe(true);
        document.getElementById('gt-impersonate').click();
        expect(onImpersonate).toHaveBeenCalledOnce();

        second.updateState({ activeKind: 'revision' });
        expect(document.getElementById('gt-impersonate').disabled).toBe(true);
        expect(document.getElementById('gt-swipe').disabled).toBe(true);
        expect(document.getElementById('gt-revision').disabled).toBe(false);
        expect(document.getElementById('gt-revision').textContent).toContain('Cancel Revision');
        expect(document.querySelector('#gt-revision i').className).toContain('fa-xmark');
        document.getElementById('gt-revision').click();
        expect(onRevision).toHaveBeenCalledOnce();

        second.updateState({ canRestoreImpersonation: true, nativeBusy: true });
        expect(restoreButton.disabled).toBe(true);
        expect(first).not.toBeNull();
    });
});
