// SPDX-License-Identifier: MIT

import { EXTENSION_LOG_PREFIX, PERSPECTIVE_PROMPT_KEYS } from './constants.js';
import { GuidedError, isAbortError } from './errors.js';
import { captureDryRunPrompt, capturePromptWithPreset } from './prompt-capture.js';
import { expandPrompt, expandPromptTemplate } from './prompts.js';
import { validateGuidedProfile } from './profiles.js';
import { sendGuidedCompletion, streamGuidedCompletion } from './request.js';
import { createGuidedSwipeSession, isSwipeableAssistantMessage } from './swipes.js';

async function getChatIdentity(context) {
    if (typeof context?.getCurrentChatId === 'function') {
        return await context.getCurrentChatId();
    }
    return context?.chatId ?? null;
}

function isGroupChat(context) {
    return context?.groupId !== null && context?.groupId !== undefined && context?.groupId !== '';
}

function setComposerValue(composer, value) {
    composer.value = value;
    composer.dispatchEvent(new Event('input', { bubbles: true }));
}

function snapshotForDebug(value) {
    try {
        return structuredClone(value);
    } catch {
        return value;
    }
}

function logDebugRequest(settings, kind, profile, prompt) {
    if (!settings.debugMode) return;

    console.log(`${EXTENSION_LOG_PREFIX} Debug profile for ${kind}:`, {
        id: profile?.id ?? '',
        name: profile?.name ?? '',
        api: profile?.api ?? '',
        model: profile?.model ?? '',
        preset: profile?.preset ?? '',
    });
    console.log(`${EXTENSION_LOG_PREFIX} Debug prompt for ${kind}:`, snapshotForDebug(prompt));
}

export class GuidedActions {
    constructor({
        getContext,
        getSettings,
        getComposer,
        core,
        notify,
        onStateChange = () => {},
        capturePrompt = captureDryRunPrompt,
        requestCompletion = sendGuidedCompletion,
        requestSwipeCompletion = streamGuidedCompletion,
        createSwipeSession = createGuidedSwipeSession,
        now = () => new Date(),
    }) {
        this.getContext = getContext;
        this.getSettings = getSettings;
        this.getComposer = getComposer;
        this.core = core;
        this.notify = notify;
        this.onStateChange = onStateChange;
        this.capturePrompt = capturePrompt;
        this.requestCompletion = requestCompletion;
        this.requestSwipeCompletion = requestSwipeCompletion;
        this.createSwipeSession = createSwipeSession;
        this.now = now;
        this.active = null;
        this.nativeBusy = false;
        this.restoreState = null;
    }

    getState() {
        return {
            activeKind: this.active?.kind || null,
            canRestoreImpersonation: Boolean(this.restoreState),
            nativeBusy: this.nativeBusy,
        };
    }

    setNativeBusy(value) {
        this.nativeBusy = Boolean(value);
        this.onStateChange(this.getState());
    }

    handleChatChanged() {
        this.#clearRestoreState();
        this.active?.controller.abort();
    }

    handleMessageSent() {
        this.#clearRestoreState();
    }

    cancelActive(kind = null) {
        if (this.active && (!kind || this.active.kind === kind)) {
            this.active.controller.abort();
            return true;
        }
        return false;
    }

    async restoreImpersonation() {
        const restoreState = this.restoreState;
        if (!restoreState) return;

        try {
            const composer = this.getComposer();
            if (!composer) throw new GuidedError('The SillyTavern composer could not be found.', { code: 'composer_missing' });

            const chatId = await getChatIdentity(this.getContext());
            if (this.restoreState !== restoreState || chatId !== restoreState.chatId) {
                this.#clearRestoreState();
                return;
            }

            setComposerValue(composer, restoreState.source);
            this.#clearRestoreState();
            this.notify.info('Original outline restored.');
        } catch (error) {
            this.#reportError(error);
        }
    }

    async impersonate() {
        if (this.cancelActive('impersonate')) return;
        if (this.active) {
            this.notify.warning('Another guided request is already running.');
            return;
        }

        try {
            const context = this.#validateCommonState();
            const composer = this.getComposer();
            if (!composer) throw new GuidedError('The SillyTavern composer could not be found.', { code: 'composer_missing' });

            const chatId = await getChatIdentity(context);
            const source = composer.value;
            const settings = this.getSettings();
            const { profile, mode, preset } = validateGuidedProfile(context, settings.profileIds.impersonate);
            const promptKey = PERSPECTIVE_PROMPT_KEYS[settings.perspective];
            const substituteParams = context.substituteParams || (value => value);
            const effectiveInput = source.trim()
                ? source
                : String(substituteParams(settings.prompts.impersonateEmpty) ?? settings.prompts.impersonateEmpty);
            const quietPrompt = expandPrompt(settings.prompts[promptKey], effectiveInput, substituteParams);

            await this.#run('impersonate', context, async signal => {
                const prompt = await capturePromptWithPreset({
                    context,
                    mode,
                    preset,
                    capturePrompt: this.capturePrompt,
                    type: 'impersonate',
                    quietPrompt,
                    signal,
                });
                logDebugRequest(settings, 'impersonate', profile, prompt);
                const result = await this.requestCompletion({ context, profile, prompt, signal });
                const currentContext = this.getContext();
                const currentComposer = this.getComposer();
                const currentChatId = await getChatIdentity(currentContext);

                if (currentChatId !== chatId || currentComposer !== composer || composer.value !== source) {
                    throw new GuidedError('The chat or composer changed while the impersonation was running, so the result was not applied.', {
                        code: 'impersonation_target_changed',
                    });
                }

                setComposerValue(composer, result);
                this.restoreState = { chatId, source };
                this.notify.success('Impersonation is ready for review.');
            });
        } catch (error) {
            this.#reportError(error);
        }
    }

    async guidedSwipe() {
        await this.#guidedAssistantResponse({
            kind: 'swipe',
            actionLabel: 'Guided Swipe',
            profileKey: 'swipe',
            createQuietPrompt: ({ settings, guidance, context }) => guidance.trim()
                ? expandPrompt(settings.prompts.guidedSwipe, guidance, context.substituteParams)
                : '',
        });
    }

    async guidedRevision() {
        await this.#guidedAssistantResponse({
            kind: 'revision',
            actionLabel: 'Guided Revision',
            profileKey: 'revision',
            requireGuidance: true,
            createQuietPrompt: ({ settings, guidance, sourceMessage, context }) => expandPromptTemplate(
                settings.prompts.guidedRevision,
                { input: guidance, message: sourceMessage },
                context.substituteParams,
            ),
        });
    }

    async #guidedAssistantResponse({
        kind,
        actionLabel,
        profileKey,
        requireGuidance = false,
        createQuietPrompt,
    }) {
        if (this.cancelActive(kind)) return;
        if (this.active) {
            this.notify.warning('Another guided request is already running.');
            return;
        }

        try {
            const context = this.#validateCommonState();
            const composer = this.getComposer();
            if (!composer) throw new GuidedError('The SillyTavern composer could not be found.', { code: 'composer_missing' });

            const settings = this.getSettings();
            const guidance = composer.value;
            if (requireGuidance && !guidance.trim()) {
                throw new GuidedError(`${actionLabel} requires a correction or improvement instruction in the composer.`, {
                    code: 'revision_guidance_required',
                });
            }
            const { profile, mode, preset } = validateGuidedProfile(context, settings.profileIds[profileKey]);
            const messageIndex = context.chat.length - 1;
            const targetMessage = context.chat[messageIndex];
            if (!isSwipeableAssistantMessage(targetMessage)) {
                throw new GuidedError(`${actionLabel} requires the last chat message to be a swipeable assistant response.`, {
                    code: 'swipe_target_invalid',
                });
            }
            if (typeof context.swipe?.isAllowed === 'function' && !context.swipe.isAllowed()) {
                throw new GuidedError('Swiping is currently disabled or unavailable.', { code: 'swipe_unavailable' });
            }

            const chatId = await getChatIdentity(context);
            const sourceMessage = String(targetMessage.mes ?? '');
            const sourceSwipeId = targetMessage.swipe_id ?? null;
            const quietPrompt = createQuietPrompt({ settings, guidance, sourceMessage, context });
            const startedAt = this.now();
            const isTargetCurrent = async () => {
                const currentContext = this.getContext();
                const currentChatId = await getChatIdentity(currentContext);
                return currentChatId === chatId &&
                    currentContext.chat.length - 1 === messageIndex &&
                    currentContext.chat[messageIndex] === targetMessage;
            };
            const isSourceCurrent = async () => await isTargetCurrent() &&
                String(targetMessage.mes ?? '') === sourceMessage &&
                (targetMessage.swipe_id ?? null) === sourceSwipeId;

            await this.#run(kind, context, async signal => {
                const prompt = await capturePromptWithPreset({
                    context,
                    mode,
                    preset,
                    capturePrompt: this.capturePrompt,
                    type: 'swipe',
                    quietPrompt,
                    signal,
                });
                if (!await isSourceCurrent()) {
                    throw new GuidedError(`The source response changed while ${actionLabel} was running, so the result was not added.`, {
                        code: 'swipe_target_changed',
                    });
                }

                const session = await this.createSwipeSession({
                    context: this.getContext(),
                    core: this.core,
                    messageIndex,
                    profile,
                    startedAt,
                    now: this.now,
                    isTargetCurrent,
                    actionLabel,
                });

                try {
                    logDebugRequest(settings, kind, profile, prompt);
                    await this.requestSwipeCompletion({
                        context,
                        profile,
                        prompt,
                        signal,
                        onProgress: chunk => session.update(chunk),
                    });
                } catch (error) {
                    if (!await isTargetCurrent()) {
                        await session.rollback({ render: false });
                        throw new GuidedError(`The chat changed while ${actionLabel} was running, so the generated Swipe was discarded.`, {
                            cause: error,
                            code: 'swipe_target_changed',
                        });
                    }

                    if (session.hasOutput()) {
                        await session.commit({ interrupted: true });
                        if (signal.aborted || isAbortError(error)) {
                            this.notify.info(`${actionLabel} cancelled; the partial Swipe was kept.`);
                        } else {
                            console.error(`${EXTENSION_LOG_PREFIX} ${actionLabel} ended early; partial output was kept.`, error);
                            this.notify.warning(`${actionLabel} ended early; the partial Swipe was kept.`);
                        }
                        return;
                    }

                    await session.rollback();
                    throw error;
                }

                await session.commit();
                this.notify.success(`${actionLabel} added.`);
            }, kind === 'revision' ? 'Guided Revision cancelled.' : undefined);
        } catch (error) {
            this.#reportError(error);
        }
    }

    #validateCommonState() {
        const documentGenerating = globalThis.document?.body?.dataset?.generating === 'true';
        if (this.nativeBusy || documentGenerating) {
            throw new GuidedError('Wait for the current SillyTavern generation to finish.', { code: 'native_generation_busy' });
        }
        const context = this.getContext();
        if (isGroupChat(context)) {
            throw new GuidedError('Group chats are not supported yet.', { code: 'group_chat_unsupported' });
        }
        return context;
    }

    async #run(kind, context, task, abortMessage = 'Guided request cancelled.') {
        const controller = new AbortController();
        this.active = { kind, controller };

        try {
            this.onStateChange(this.getState());
            context.deactivateSendButtons?.();
            await task(controller.signal);
        } catch (error) {
            if (error instanceof GuidedError && ['swipe_target_changed', 'impersonation_target_changed'].includes(error.code)) {
                this.#reportError(error);
            } else if (controller.signal.aborted || isAbortError(error)) {
                this.notify.info(abortMessage);
            } else {
                this.#reportError(error);
            }
        } finally {
            try {
                context.activateSendButtons?.();
            } finally {
                this.active = null;
                this.onStateChange(this.getState());
            }
        }
    }

    #clearRestoreState() {
        if (!this.restoreState) return;
        this.restoreState = null;
        this.onStateChange(this.getState());
    }

    #reportError(error) {
        if (isAbortError(error)) {
            this.notify.info('Guided request cancelled.');
            return;
        }
        const message = error instanceof GuidedError ? error.message : 'Guided generation failed unexpectedly.';
        this.notify.error(message);
        console.error(EXTENSION_LOG_PREFIX, error);
    }
}
