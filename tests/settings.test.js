// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import {
    CURRENT_PROFILE,
    DEFAULT_PROMPTS,
    EXTENSION_NAME,
    PERSPECTIVES,
    PERSPECTIVE_PROMPT_KEYS,
} from '../src/constants.js';
import {
    createDefaultSettings,
    initializeSettings,
    normalizeSettings,
    resetAllPrompts,
    resetPrompt,
} from '../src/settings.js';

describe('settings', () => {
    it('defines strict ownership and output boundaries for every impersonation perspective', () => {
        for (const promptKey of Object.values(PERSPECTIVE_PROMPT_KEYS)) {
            const prompt = DEFAULT_PROMPTS[promptKey];
            expect(prompt).toContain('Draft exactly one role-play message for {{user}}.');
            expect(prompt).toContain('Do not write dialogue, thoughts, actions, reactions, decisions, or outcomes for {{char}} or any other character.');
            expect(prompt).toContain('Do not continue the scene beyond {{user}}\'s turn; leave other characters free to respond.');
            expect(prompt).toContain('status blocks, trackers, statistics, inventories, metadata, or code fences');
            expect(prompt).toContain('<outline>\n{{input}}\n</outline>');
            expect(prompt.match(/{{\s*input\s*}}/gi)).toHaveLength(1);
        }

        expect(DEFAULT_PROMPTS.impersonateFirst).toContain('first person using I/me/my');
        expect(DEFAULT_PROMPTS.impersonateSecond).toContain('second person using you/your');
        expect(DEFAULT_PROMPTS.impersonateThird).toContain('third person using {{user}}\'s appropriate name and pronouns');
        expect(DEFAULT_PROMPTS.impersonateEmpty).toContain('Do not control another character, resolve their response');
        expect(DEFAULT_PROMPTS.guidedRevision).toContain('<response>\n{{message}}\n</response>');
        expect(DEFAULT_PROMPTS.guidedRevision).toContain('<requested_changes>\n{{input}}\n</requested_changes>');
        expect(DEFAULT_PROMPTS.guidedRevision).toContain('Preserve its wording, tone, structure, details, and intent');
        expect(DEFAULT_PROMPTS.guidedRevision.match(/{{\s*message\s*}}/gi)).toHaveLength(1);
        expect(DEFAULT_PROMPTS.guidedRevision.match(/{{\s*input\s*}}/gi)).toHaveLength(1);
    });

    it('creates independent default prompt objects', () => {
        const first = createDefaultSettings();
        const second = createDefaultSettings();
        first.prompts.guidedSwipe = 'changed';
        first.profileIds.swipe = 'changed';
        expect(second.prompts.guidedSwipe).toBe(DEFAULT_PROMPTS.guidedSwipe);
        expect(second.profileIds.swipe).toBe(CURRENT_PROFILE);
        expect(second.profileIds.revision).toBe(CURRENT_PROFILE);
        expect(second.includeRevisionChatHistory).toBe(true);
    });

    it('normalizes incomplete and invalid saved settings', () => {
        const normalized = normalizeSettings({
            profileIds: { impersonate: 'profile-1', swipe: '', revision: 42 },
            perspective: 'invalid',
            prompts: { impersonateFirst: 'custom', guidedSwipe: 42 },
        });
        expect(normalized).toEqual({
            debugMode: false,
            includeRevisionChatHistory: true,
            profileIds: {
                impersonate: 'profile-1',
                swipe: CURRENT_PROFILE,
                revision: CURRENT_PROFILE,
            },
            perspective: PERSPECTIVES.FIRST,
            prompts: {
                ...DEFAULT_PROMPTS,
                impersonateFirst: 'custom',
            },
        });
    });

    it('initializes a clean guided-turns namespace and preserves its object reference', () => {
        const original = { profileIds: { swipe: 'reroller' }, prompts: { guidedSwipe: 'mine' } };
        const container = { [EXTENSION_NAME]: original };
        const result = initializeSettings(container, EXTENSION_NAME);
        expect(result).toBe(original);
        expect(container[EXTENSION_NAME]).toBe(original);
        expect(Object.keys(result).sort()).toEqual(['debugMode', 'includeRevisionChatHistory', 'perspective', 'profileIds', 'prompts']);
        expect(result.profileIds).toEqual({
            impersonate: CURRENT_PROFILE,
            swipe: 'reroller',
            revision: CURRENT_PROFILE,
        });
        expect(result.prompts.guidedSwipe).toBe('mine');
        expect(result.prompts.impersonateThird).toBe(DEFAULT_PROMPTS.impersonateThird);
    });

    it('does not import settings from the retired namespace', () => {
        const retired = { profileIds: { impersonate: 'legacy-profile' } };
        const container = { 'guided-impersonation': retired };
        const result = initializeSettings(container, EXTENSION_NAME);
        expect(result).toEqual(createDefaultSettings());
        expect(container['guided-impersonation']).toBe(retired);
    });

    it('preserves independent profile selections', () => {
        expect(normalizeSettings({
            profileIds: { impersonate: 'writer', swipe: 'reroller', revision: 'editor' },
        }).profileIds).toEqual({
            impersonate: 'writer',
            swipe: 'reroller',
            revision: 'editor',
        });
    });

    it('preserves the revision chat history preference', () => {
        expect(normalizeSettings({ includeRevisionChatHistory: false }).includeRevisionChatHistory).toBe(false);
    });

    it('preserves customized and intentionally blank prompts', () => {
        const prompts = {
            impersonateFirst: 'custom first',
            impersonateSecond: 'custom second',
            impersonateThird: 'custom third',
            impersonateEmpty: 'custom empty',
            guidedSwipe: 'custom swipe',
        };

        expect(normalizeSettings({ prompts }).prompts).toEqual({
            ...prompts,
            guidedRevision: DEFAULT_PROMPTS.guidedRevision,
        });
    });

    it('resets one or all prompts', () => {
        const settings = createDefaultSettings();
        settings.prompts.impersonateFirst = 'one';
        settings.prompts.guidedSwipe = 'two';
        resetPrompt(settings, 'guidedSwipe');
        expect(settings.prompts.guidedSwipe).toBe(DEFAULT_PROMPTS.guidedSwipe);
        expect(settings.prompts.impersonateFirst).toBe('one');
        resetAllPrompts(settings);
        expect(settings.prompts).toEqual(DEFAULT_PROMPTS);
    });
});
