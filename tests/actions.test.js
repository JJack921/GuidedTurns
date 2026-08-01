// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GuidedActions } from '../src/actions.js';
import { CURRENT_PROFILE } from '../src/constants.js';
import { createAbortError, GuidedError } from '../src/errors.js';

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

function createHarness({
    perspective = 'first',
    composerText = 'an outline',
    chat = [{ mes: 'assistant reply', is_user: false, is_system: false, extra: {} }],
} = {}) {
    document.body.innerHTML = '<textarea id="send_textarea"></textarea>';
    const composer = document.getElementById('send_textarea');
    composer.value = composerText;

    const profile = { id: 'guided', name: 'Guided', api: 'openrouter', model: 'model-b', preset: 'Preset B' };
    const context = {
        mainApi: 'openai',
        groupId: null,
        chatId: 'chat-1',
        chat,
        getCurrentChatId: vi.fn(() => 'chat-1'),
        substituteParams: vi.fn(value => value.replaceAll('{{user}}', 'Alice')),
        extensionSettings: {
            disabledExtensions: [],
            connectionManager: { selectedProfile: 'guided' },
        },
        CONNECT_API_MAP: { openrouter: { selected: 'openai', source: 'openrouter' } },
        chatCompletionSettings: {
            preset_settings_openai: 'Current Preset',
            temp_openai: 1,
            prompts: [{ identifier: 'current', content: 'Current preset prompt' }],
            prompt_order: [{ character_id: 100001, order: [{ identifier: 'current', enabled: true }] }],
        },
        ConnectionManagerRequestService: {
            getProfile: vi.fn(() => profile),
            isProfileSupported: vi.fn(() => true),
            sendRequest: vi.fn(),
        },
        getPresetManager: vi.fn(() => ({
            getCompletionPresetByName: vi.fn(() => ({
                preset_settings_openai: 'Preset B',
                temperature: 0.8,
                prompts: [{ identifier: 'guided', content: 'Guided preset prompt' }],
                prompt_order: [{ character_id: 100001, order: [{ identifier: 'guided', enabled: true }] }],
            })),
        })),
        deactivateSendButtons: vi.fn(),
        activateSendButtons: vi.fn(),
        swipe: { isAllowed: vi.fn(() => true) },
    };
    const settings = {
        debugMode: false,
        profileIds: { impersonate: 'guided', swipe: 'guided', revision: 'guided' },
        perspective,
        prompts: {
            impersonateFirst: 'FIRST {{user}} {{input}}',
            impersonateSecond: 'SECOND {{user}} {{input}}',
            impersonateThird: 'THIRD {{user}} {{input}}',
            impersonateEmpty: 'EMPTY {{user}}',
            guidedSwipe: 'SWIPE {{user}} {{input}}',
            guidedRevision: 'REVISE {{user}} [{{message}}] WITH [{{input}}]',
        },
    };
    const notify = {
        error: vi.fn(),
        warning: vi.fn(),
        info: vi.fn(),
        success: vi.fn(),
    };
    const capturePrompt = vi.fn().mockResolvedValue(['captured prompt']);
    const requestCompletion = vi.fn().mockResolvedValue('generated output');
    const swipeSession = {
        update: vi.fn().mockResolvedValue(undefined),
        commit: vi.fn().mockResolvedValue(1),
        rollback: vi.fn().mockResolvedValue(undefined),
        hasOutput: vi.fn(() => false),
    };
    const createSwipeSession = vi.fn().mockResolvedValue(swipeSession);
    const requestSwipeCompletion = vi.fn().mockImplementation(async ({ onProgress }) => {
        await onProgress({ text: 'generated output', reasoning: '', signature: null });
        return { text: 'generated output', reasoning: '', signature: null };
    });
    const onStateChange = vi.fn();
    const actions = new GuidedActions({
        getContext: () => context,
        getSettings: () => settings,
        getComposer: () => composer,
        core: {},
        notify,
        onStateChange,
        capturePrompt,
        requestCompletion,
        requestSwipeCompletion,
        createSwipeSession,
    });

    return {
        actions,
        capturePrompt,
        composer,
        context,
        createSwipeSession,
        notify,
        profile,
        requestCompletion,
        requestSwipeCompletion,
        settings,
        swipeSession,
        onStateChange,
    };
}

describe('GuidedActions impersonation', () => {
    it('assembles the prompt with the profile preset and restores live settings afterward', async () => {
        const harness = createHarness();
        const originalPrompts = harness.context.chatCompletionSettings.prompts;
        const originalPromptOrder = harness.context.chatCompletionSettings.prompt_order;
        harness.capturePrompt.mockImplementation(async ({ context }) => {
            expect(context.chatCompletionSettings).toMatchObject({
                preset_settings_openai: 'Current Preset',
                temp_openai: 0.8,
                prompts: [{ identifier: 'guided', content: 'Guided preset prompt' }],
                prompt_order: [{ character_id: 100001, order: [{ identifier: 'guided', enabled: true }] }],
            });
            return ['captured prompt'];
        });

        await harness.actions.impersonate();

        expect(harness.context.chatCompletionSettings).toMatchObject({ temp_openai: 1 });
        expect(harness.context.chatCompletionSettings.prompts).toBe(originalPrompts);
        expect(harness.context.chatCompletionSettings.prompt_order).toBe(originalPromptOrder);
    });

    it('restores live settings when profile-based prompt capture fails', async () => {
        const harness = createHarness();
        const originalSettings = { ...harness.context.chatCompletionSettings };
        harness.capturePrompt.mockImplementation(async ({ context }) => {
            expect(context.chatCompletionSettings.prompts[0].identifier).toBe('guided');
            throw new Error('dry run failed');
        });

        await harness.actions.impersonate();

        expect(harness.context.chatCompletionSettings).toEqual(originalSettings);
        expect(harness.notify.error).toHaveBeenCalledWith('Guided generation failed unexpectedly.');
    });

    it('restores live settings when profile-based prompt capture is aborted', async () => {
        const harness = createHarness();
        const originalSettings = { ...harness.context.chatCompletionSettings };
        harness.capturePrompt.mockImplementation(({ context, signal }) => new Promise((_, reject) => {
            expect(context.chatCompletionSettings.prompts[0].identifier).toBe('guided');
            signal.addEventListener('abort', () => reject(createAbortError()), { once: true });
        }));

        const running = harness.actions.impersonate();
        await vi.waitFor(() => expect(harness.actions.getState().activeKind).toBe('impersonate'));
        harness.actions.cancelActive('impersonate');
        await running;

        expect(harness.context.chatCompletionSettings).toEqual(originalSettings);
        expect(harness.notify.info).toHaveBeenCalledWith('Guided request cancelled.');
    });

    it('keeps current-profile mode while applying its resolved bound preset', async () => {
        const harness = createHarness();
        harness.settings.profileIds.impersonate = CURRENT_PROFILE;
        harness.capturePrompt.mockImplementation(async ({ context }) => {
            expect(context.chatCompletionSettings.prompts[0].identifier).toBe('guided');
            return ['captured prompt'];
        });

        await harness.actions.impersonate();

        expect(harness.context.ConnectionManagerRequestService.getProfile).toHaveBeenCalledWith('guided');
        expect(harness.requestCompletion).toHaveBeenCalledWith(expect.objectContaining({ profile: harness.profile }));
        expect(harness.context.chatCompletionSettings.prompts[0].identifier).toBe('current');
    });

    it('logs the resolved profile and exact captured prompt only in debug mode', async () => {
        const harness = createHarness();
        harness.settings.debugMode = true;

        await harness.actions.impersonate();

        expect(console.log).toHaveBeenNthCalledWith(1, '[Guided Turns] Debug profile for impersonate:', {
            id: 'guided',
            name: 'Guided',
            api: 'openrouter',
            model: 'model-b',
            preset: 'Preset B',
        });
        expect(console.log).toHaveBeenNthCalledWith(2, '[Guided Turns] Debug prompt for impersonate:', ['captured prompt']);
    });

    it('does not log request details when debug mode is disabled', async () => {
        const harness = createHarness();

        await harness.actions.impersonate();

        expect(console.log).not.toHaveBeenCalled();
    });

    it.each([
        ['first', 'FIRST Alice an outline'],
        ['second', 'SECOND Alice an outline'],
        ['third', 'THIRD Alice an outline'],
    ])('uses the %s-person prompt, replaces the composer, and explicitly restores the outline', async (perspective, expectedPrompt) => {
        const harness = createHarness({ perspective });
        await harness.actions.impersonate();
        expect(harness.capturePrompt).toHaveBeenCalledWith(expect.objectContaining({
            type: 'impersonate',
            quietPrompt: expectedPrompt,
        }));
        expect(harness.composer.value).toBe('generated output');
        expect(harness.requestCompletion).toHaveBeenCalledWith(expect.objectContaining({ profile: harness.profile }));
        expect(harness.notify.success).toHaveBeenCalledWith('Impersonation is ready for review.');
        expect(harness.actions.getState().canRestoreImpersonation).toBe(true);

        await harness.actions.restoreImpersonation();
        expect(harness.composer.value).toBe('an outline');
        expect(harness.capturePrompt).toHaveBeenCalledOnce();
        expect(harness.actions.getState().canRestoreImpersonation).toBe(false);
        expect(harness.notify.info).toHaveBeenCalledWith('Original outline restored.');
    });

    it.each(['', '  \n'])('uses the macro-expanded shared fallback and restores exact empty input %#', async composerText => {
        const harness = createHarness({ composerText });
        await harness.actions.impersonate();
        expect(harness.capturePrompt).toHaveBeenCalledWith(expect.objectContaining({
            quietPrompt: 'FIRST Alice EMPTY Alice',
        }));
        expect(harness.composer.value).toBe('generated output');

        await harness.actions.restoreImpersonation();
        expect(harness.composer.value).toBe(composerText);
    });

    it('keeps restore available after edits to the generated draft', async () => {
        const harness = createHarness();
        await harness.actions.impersonate();
        harness.composer.value = 'edited generated draft';

        await harness.actions.restoreImpersonation();

        expect(harness.composer.value).toBe('an outline');
        expect(harness.actions.getState().canRestoreImpersonation).toBe(false);
    });

    it('runs another impersonation instead of implicitly restoring and replaces the recovery point', async () => {
        const harness = createHarness();
        harness.requestCompletion
            .mockResolvedValueOnce('first generated output')
            .mockResolvedValueOnce('second generated output');

        await harness.actions.impersonate();
        harness.composer.value = 'edited first output';
        await harness.actions.impersonate();

        expect(harness.capturePrompt).toHaveBeenLastCalledWith(expect.objectContaining({
            quietPrompt: 'FIRST Alice edited first output',
        }));
        expect(harness.requestCompletion).toHaveBeenCalledTimes(2);
        expect(harness.composer.value).toBe('second generated output');

        await harness.actions.restoreImpersonation();
        expect(harness.composer.value).toBe('edited first output');
    });

    it('preserves the previous recovery point when a later impersonation fails', async () => {
        const harness = createHarness();
        await harness.actions.impersonate();
        harness.composer.value = 'new draft';
        harness.requestCompletion.mockRejectedValueOnce(new Error('request failed'));

        await harness.actions.impersonate();
        await harness.actions.restoreImpersonation();

        expect(harness.composer.value).toBe('an outline');
    });

    it('clears restore availability when a message is sent or the chat changes', async () => {
        const sent = createHarness();
        await sent.actions.impersonate();
        sent.actions.handleMessageSent();
        expect(sent.actions.getState().canRestoreImpersonation).toBe(false);

        const changed = createHarness();
        await changed.actions.impersonate();
        changed.actions.handleChatChanged();
        expect(changed.actions.getState().canRestoreImpersonation).toBe(false);
        expect(changed.onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({
            canRestoreImpersonation: false,
        }));
    });

    it('resolves independent profile selections for all three actions', async () => {
        const impersonation = createHarness();
        impersonation.settings.profileIds.impersonate = 'writer';
        await impersonation.actions.impersonate();
        expect(impersonation.context.ConnectionManagerRequestService.getProfile).toHaveBeenCalledWith('writer');

        const swipe = createHarness();
        swipe.settings.profileIds.swipe = 'reroller';
        await swipe.actions.guidedSwipe();
        expect(swipe.context.ConnectionManagerRequestService.getProfile).toHaveBeenCalledWith('reroller');

        const revision = createHarness();
        revision.settings.profileIds.revision = 'editor';
        await revision.actions.guidedRevision();
        expect(revision.context.ConnectionManagerRequestService.getProfile).toHaveBeenCalledWith('editor');
    });

    it('does not overwrite a composer edited while generation is running', async () => {
        const harness = createHarness();
        harness.requestCompletion.mockImplementation(async () => {
            harness.composer.value = 'user edited this';
            return 'generated output';
        });
        await harness.actions.impersonate();
        expect(harness.composer.value).toBe('user edited this');
        expect(harness.notify.error).toHaveBeenCalledWith(expect.stringContaining('composer changed'));
    });
});

describe('GuidedActions swipe and coordination', () => {
    it.each([
        ['Guided Swipe', actions => actions.guidedSwipe()],
        ['Guided Revision', actions => actions.guidedRevision()],
    ])('assembles %s with the profile preset prompt templates', async (_label, invoke) => {
        const harness = createHarness({ composerText: 'change it' });
        harness.capturePrompt.mockImplementation(async ({ context }) => {
            expect(context.chatCompletionSettings.prompts[0].identifier).toBe('guided');
            return ['captured prompt'];
        });

        await invoke(harness.actions);

        expect(harness.context.chatCompletionSettings.prompts[0].identifier).toBe('current');
    });

    it('logs the swipe profile and captured prompt in debug mode', async () => {
        const harness = createHarness();
        harness.settings.debugMode = true;

        await harness.actions.guidedSwipe();

        expect(console.log).toHaveBeenCalledWith('[Guided Turns] Debug profile for swipe:', expect.objectContaining({
            id: 'guided',
            preset: 'Preset B',
        }));
        expect(console.log).toHaveBeenCalledWith('[Guided Turns] Debug prompt for swipe:', ['captured prompt']);
    });

    it('preserves guidance, streams progress, and commits against the snapshotted message', async () => {
        const harness = createHarness({ composerText: 'make it tense' });
        await harness.actions.guidedSwipe();
        expect(harness.capturePrompt).toHaveBeenCalledWith(expect.objectContaining({
            type: 'swipe',
            quietPrompt: 'SWIPE Alice make it tense',
        }));
        expect(harness.composer.value).toBe('make it tense');
        expect(harness.createSwipeSession).toHaveBeenCalledWith(expect.objectContaining({
            context: harness.context,
            messageIndex: 0,
            profile: harness.profile,
        }));
        expect(harness.swipeSession.update).toHaveBeenCalledWith(expect.objectContaining({ text: 'generated output' }));
        expect(harness.swipeSession.commit).toHaveBeenCalledWith();
    });

    it('uses an empty quiet prompt for an unguided profile-based swipe', async () => {
        const harness = createHarness({ composerText: '' });
        await harness.actions.guidedSwipe();
        expect(harness.capturePrompt).toHaveBeenCalledWith(expect.objectContaining({ quietPrompt: '' }));
    });

    it('rolls back and discards a result if the target message changes', async () => {
        const harness = createHarness();
        harness.requestSwipeCompletion.mockImplementation(async () => {
            harness.context.chat[0] = { mes: 'replacement', is_user: false, is_system: false, extra: {} };
            throw new GuidedError('target changed', { code: 'swipe_target_changed' });
        });
        await harness.actions.guidedSwipe();
        expect(harness.swipeSession.rollback).toHaveBeenCalledWith({ render: false });
        expect(harness.swipeSession.commit).not.toHaveBeenCalled();
        expect(harness.notify.error).toHaveBeenCalledWith(expect.stringContaining('discarded'));
    });

    it('keeps a partial Swipe after an interrupted stream', async () => {
        const harness = createHarness();
        harness.swipeSession.hasOutput.mockReturnValue(true);
        harness.requestSwipeCompletion.mockImplementation(({ signal }) => new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(createAbortError()), { once: true });
        }));
        const running = harness.actions.guidedSwipe();
        await vi.waitFor(() => expect(harness.actions.getState().activeKind).toBe('swipe'));
        harness.actions.cancelActive('swipe');
        await running;
        expect(harness.swipeSession.commit).toHaveBeenCalledWith({ interrupted: true });
        expect(harness.notify.info).toHaveBeenCalledWith(expect.stringContaining('partial Swipe was kept'));
    });

    it('rolls back a cancelled Swipe when no output arrived', async () => {
        const harness = createHarness();
        harness.requestSwipeCompletion.mockImplementation(({ signal }) => new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(createAbortError()), { once: true });
        }));
        const running = harness.actions.guidedSwipe();
        await vi.waitFor(() => expect(harness.actions.getState().activeKind).toBe('swipe'));
        harness.actions.cancelActive('swipe');
        await running;
        expect(harness.swipeSession.rollback).toHaveBeenCalledWith();
        expect(harness.swipeSession.commit).not.toHaveBeenCalled();
        expect(harness.notify.info).toHaveBeenCalledWith('Guided request cancelled.');
    });

    it('rejects invalid targets and native generation overlap', async () => {
        const invalid = createHarness({ chat: [{ mes: 'user', is_user: true }] });
        await invalid.actions.guidedSwipe();
        expect(invalid.notify.error).toHaveBeenCalledWith(expect.stringContaining('swipeable assistant'));

        const busy = createHarness();
        busy.actions.setNativeBusy(true);
        await busy.actions.impersonate();
        expect(busy.notify.error).toHaveBeenCalledWith(expect.stringContaining('current SillyTavern generation'));
    });

    it.each([
        ['Guided Impersonation', actions => actions.impersonate()],
        ['Guided Swipe', actions => actions.guidedSwipe()],
        ['Guided Revision', actions => actions.guidedRevision()],
    ])('rejects %s in group chats', async (_label, invoke) => {
        const harness = createHarness({ composerText: 'make it warmer' });
        harness.context.groupId = 'group-1';
        await invoke(harness.actions);
        expect(harness.notify.error).toHaveBeenCalledWith('Group chats are not supported yet.');
        expect(harness.capturePrompt).not.toHaveBeenCalled();
    });

    it('cancels an in-flight action when its button is invoked again', async () => {
        const harness = createHarness();
        harness.capturePrompt.mockImplementation(({ signal }) => new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(createAbortError()), { once: true });
        }));
        const running = harness.actions.impersonate();
        await vi.waitFor(() => expect(harness.actions.getState().activeKind).toBe('impersonate'));
        await harness.actions.impersonate();
        await running;
        expect(harness.actions.getState().activeKind).toBeNull();
        expect(harness.notify.info).toHaveBeenCalledWith('Guided request cancelled.');
        expect(harness.context.activateSendButtons).toHaveBeenCalledOnce();
    });
});

describe('GuidedActions revision', () => {
    it('injects the selected response, preserves guidance, and streams a new Swipe', async () => {
        const harness = createHarness({ composerText: 'fix the tense' });

        await harness.actions.guidedRevision();

        expect(harness.capturePrompt).toHaveBeenCalledWith(expect.objectContaining({
            type: 'swipe',
            quietPrompt: 'REVISE Alice [assistant reply] WITH [fix the tense]',
        }));
        expect(harness.composer.value).toBe('fix the tense');
        expect(harness.createSwipeSession).toHaveBeenCalledWith(expect.objectContaining({
            context: harness.context,
            messageIndex: 0,
            profile: harness.profile,
            actionLabel: 'Guided Revision',
        }));
        expect(harness.swipeSession.update).toHaveBeenCalledWith(expect.objectContaining({ text: 'generated output' }));
        expect(harness.swipeSession.commit).toHaveBeenCalledWith();
        expect(harness.notify.success).toHaveBeenCalledWith('Guided Revision added.');
    });

    it.each(['', '  \n'])('requires nonblank guidance %#', async composerText => {
        const harness = createHarness({ composerText });

        await harness.actions.guidedRevision();

        expect(harness.notify.error).toHaveBeenCalledWith(expect.stringContaining('requires a correction or improvement instruction'));
        expect(harness.capturePrompt).not.toHaveBeenCalled();
        expect(harness.createSwipeSession).not.toHaveBeenCalled();
    });

    it('discards the revision if the selected source changes during prompt capture', async () => {
        const message = {
            mes: 'current response',
            is_user: false,
            is_system: false,
            swipe_id: 1,
            extra: {},
        };
        const harness = createHarness({ chat: [message], composerText: 'make it shorter' });
        harness.capturePrompt.mockImplementation(async () => {
            message.mes = 'another selected Swipe';
            message.swipe_id = 2;
            return ['captured prompt'];
        });

        await harness.actions.guidedRevision();

        expect(harness.createSwipeSession).not.toHaveBeenCalled();
        expect(harness.notify.error).toHaveBeenCalledWith(expect.stringContaining('source response changed'));
    });

    it('keeps a partial revised Swipe when cancellation interrupts its stream', async () => {
        const harness = createHarness({ composerText: 'improve it' });
        harness.swipeSession.hasOutput.mockReturnValue(true);
        harness.requestSwipeCompletion.mockImplementation(({ signal }) => new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(createAbortError()), { once: true });
        }));

        const running = harness.actions.guidedRevision();
        await vi.waitFor(() => expect(harness.actions.getState().activeKind).toBe('revision'));
        harness.actions.cancelActive('revision');
        await running;

        expect(harness.swipeSession.commit).toHaveBeenCalledWith({ interrupted: true });
        expect(harness.notify.info).toHaveBeenCalledWith('Guided Revision cancelled; the partial Swipe was kept.');
    });

    it('rolls back a cancelled revision when no output arrived', async () => {
        const harness = createHarness({ composerText: 'improve it' });
        harness.requestSwipeCompletion.mockImplementation(({ signal }) => new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(createAbortError()), { once: true });
        }));

        const running = harness.actions.guidedRevision();
        await vi.waitFor(() => expect(harness.actions.getState().activeKind).toBe('revision'));
        harness.actions.cancelActive('revision');
        await running;

        expect(harness.swipeSession.rollback).toHaveBeenCalledWith();
        expect(harness.swipeSession.commit).not.toHaveBeenCalled();
        expect(harness.notify.info).toHaveBeenCalledWith('Guided Revision cancelled.');
    });
});
