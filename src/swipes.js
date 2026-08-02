// SPDX-License-Identifier: MIT

import { EXTENSION_LOG_PREFIX } from './constants.js';
import { GuidedError } from './errors.js';
import { isGroupChat } from './group-context.js';

function clone(value) {
    return value === undefined ? undefined : structuredClone(value);
}

function restoreMessage(message, snapshot) {
    for (const key of Object.keys(message)) delete message[key];
    Object.assign(message, clone(snapshot));
}

function snapshotMessageIdentity(message) {
    const identity = {};
    for (const key of ['name', 'original_avatar', 'force_avatar']) {
        if (Object.hasOwn(message || {}, key)) identity[key] = clone(message[key]);
    }
    return identity;
}

function restoreMessageIdentity(message, identity) {
    for (const key of ['name', 'original_avatar', 'force_avatar']) {
        if (Object.hasOwn(identity, key)) message[key] = clone(identity[key]);
        else delete message[key];
    }
}

function targetChangedError(actionLabel) {
    return new GuidedError(`The chat changed while ${actionLabel} was running, so the generated Swipe was discarded.`, {
        code: 'swipe_target_changed',
    });
}

function requestFrame(callback) {
    if (typeof globalThis.requestAnimationFrame === 'function') {
        const id = globalThis.requestAnimationFrame(callback);
        return () => globalThis.cancelAnimationFrame?.(id);
    }
    const id = globalThis.setTimeout(callback, 0);
    return () => globalThis.clearTimeout(id);
}

export function isSwipeableAssistantMessage(message) {
    return Boolean(
        message &&
        !message.is_user &&
        !message.is_system &&
        !message.extra?.isSmallSys &&
        message.extra?.swipeable !== false,
    );
}

export class GuidedSwipeSession {
    constructor({
        context,
        core,
        messageIndex,
        profile,
        startedAt = new Date(),
        now = () => new Date(),
        isTargetCurrent = () => true,
        actionLabel = 'Guided Swipe',
    }) {
        this.context = context;
        this.core = core;
        this.messageIndex = messageIndex;
        this.message = context?.chat?.[messageIndex];
        this.profile = profile;
        this.startedAt = startedAt;
        this.now = now;
        this.isTargetCurrent = isTargetCurrent;
        this.actionLabel = actionLabel;
        this.snapshot = clone(this.message);
        this.messageIdentity = snapshotMessageIdentity(this.message);
        this.newSwipeId = -1;
        this.rawText = '';
        this.reasoning = '';
        this.signature = null;
        this.reasoningHandler = null;
        this.stoppingStrings = null;
        this.cancelFrame = null;
        this.begun = false;
        this.finished = false;
    }

    async begin() {
        if (!this.message) {
            throw new GuidedError('The Swipe target is no longer available.', { code: 'swipe_target_missing' });
        }
        await this.#assertTarget();
        this.begun = true;

        try {
            this.core.ensureSwipes(this.message);
            this.core.syncMesToSwipe(this.messageIndex);

            const currentInfo = this.message.swipe_info?.[this.message.swipe_id ?? 0];
            const isGroupMessage = isGroupChat(this.context);
            const existingGenId = isGroupMessage && Object.hasOwn(this.message.extra || {}, 'gen_id')
                ? this.message.extra.gen_id
                : isGroupMessage ? currentInfo?.extra?.gen_id : undefined;
            const extra = {
                ...(currentInfo?.extra && Object.hasOwn(currentInfo.extra, 'bias') ? { bias: currentInfo.extra.bias } : {}),
                api: this.profile.api,
                model: this.profile.model || '',
                gen_id: existingGenId ?? Date.now(),
                guided_generation: true,
                guided_profile_id: this.profile.id,
                reasoning: '',
            };

            this.newSwipeId = this.message.swipes.length;
            const swipeInfo = {
                send_date: this.startedAt.toISOString(),
                gen_started: this.startedAt,
                gen_finished: null,
                extra: clone(extra),
            };
            this.message.swipes.push('...');
            this.message.swipe_info.push(swipeInfo);
            this.message.swipe_id = this.newSwipeId;
            this.message.mes = '...';
            this.message.send_date = swipeInfo.send_date;
            this.message.gen_started = this.startedAt;
            this.message.gen_finished = null;
            this.message.extra = clone(extra);
            delete this.message.title;
            restoreMessageIdentity(this.message, this.messageIdentity);

            this.#renderFull();
            this.context.swipe?.hide?.({ hideCounters: true });
            this.context.scrollChatToBottom?.({ waitForFrame: true });
            this.reasoningHandler = this.core.ReasoningHandler ? new this.core.ReasoningHandler(this.startedAt) : null;
            this.stoppingStrings = this.core.getStoppingStrings?.(false, false, this.context.mainApi) ?? null;

            const messageSwiped = this.context.eventTypes?.MESSAGE_SWIPED;
            try {
                if (messageSwiped) await this.context.eventSource?.emit?.(messageSwiped, this.messageIndex);
            } catch (eventError) {
                console.warn(`${EXTENSION_LOG_PREFIX} MESSAGE_SWIPED listener failed.`, eventError);
            }

            return this;
        } catch (error) {
            await this.rollback();
            if (error instanceof GuidedError) throw error;
            throw new GuidedError('The new Swipe could not be initialized.', {
                cause: error,
                code: 'swipe_begin_failed',
            });
        }
    }

    hasOutput() {
        return this.rawText.trim().length > 0 || this.reasoning.trim().length > 0;
    }

    async update({ text = '', reasoning = '', signature = null }) {
        if (!this.begun || this.finished) return;
        await this.#assertTarget();

        this.rawText = String(text ?? '');
        this.reasoning = String(reasoning ?? '');
        this.signature = signature ?? this.signature;
        await this.#applyCurrentOutput(true);
        this.#queueRender();
    }

    async commit({ interrupted = false } = {}) {
        if (!this.begun || this.finished) return this.newSwipeId;

        try {
            await this.#assertTarget();
            await this.#applyCurrentOutput(false);
            await this.reasoningHandler?.finish?.(this.messageIndex);
            if (!interrupted && !this.message.mes.trim()) {
                throw new GuidedError('The guided profile returned an empty response.', { code: 'empty_response' });
            }

            if (this.signature) this.message.extra.reasoning_signature = this.signature;
            if (interrupted) this.message.extra.guided_interrupted = true;
            else delete this.message.extra.guided_interrupted;
            const finishedAt = this.now();
            this.message.send_date = finishedAt.toISOString();
            this.message.gen_finished = finishedAt;
            this.#syncSwipeInfo(finishedAt);

            this.#cancelQueuedRender();
            this.#renderFull();
            this.context.swipe?.refresh?.(true, false);

            const messageReceived = this.context.eventTypes?.MESSAGE_RECEIVED;
            const messageRendered = this.context.eventTypes?.CHARACTER_MESSAGE_RENDERED;
            try {
                if (messageReceived) await this.context.eventSource?.emit?.(messageReceived, this.messageIndex, 'swipe');
                if (messageRendered) await this.context.eventSource?.emit?.(messageRendered, this.messageIndex, 'swipe');
            } catch (eventError) {
                console.warn(`${EXTENSION_LOG_PREFIX} A finalized Swipe event listener failed.`, eventError);
            }

            await this.#assertTarget();
            await this.context.saveChat?.();
            this.finished = true;
            this.#restoreControls();
            return this.newSwipeId;
        } catch (error) {
            await this.rollback();
            if (error instanceof GuidedError) throw error;
            throw new GuidedError('The generated response could not be saved as a Swipe.', {
                cause: error,
                code: 'swipe_append_failed',
            });
        }
    }

    async rollback({ render = true } = {}) {
        if (!this.begun || this.finished) return;
        this.#cancelQueuedRender();
        restoreMessage(this.message, this.snapshot);
        this.finished = true;

        try {
            if (render && await this.isTargetCurrent()) {
                this.#renderFull();
                this.context.swipe?.refresh?.(true, false);
            }
        } catch (renderError) {
            console.warn(`${EXTENSION_LOG_PREFIX} The rolled back Swipe could not be re-rendered.`, renderError);
        } finally {
            this.#restoreControls();
        }
    }

    async #assertTarget() {
        if (!await this.isTargetCurrent()) throw targetChangedError(this.actionLabel);
    }

    #cleanText(displayIncompleteSentences) {
        if (typeof this.core.cleanUpMessage !== 'function') return this.rawText;
        return this.core.cleanUpMessage({
            getMessage: this.rawText,
            isImpersonate: false,
            isContinue: false,
            displayIncompleteSentences,
            stoppingStrings: this.stoppingStrings,
        });
    }

    async #applyCurrentOutput(displayIncompleteSentences) {
        const cleanedText = this.#cleanText(displayIncompleteSentences);
        const changed = this.message.mes !== cleanedText;
        this.message.mes = cleanedText;
        this.message.gen_finished = this.now();
        this.message.extra.time_to_first_token ??= this.hasOutput()
            ? this.message.gen_finished.getTime() - this.startedAt.getTime()
            : null;

        if (this.reasoningHandler) {
            this.reasoningHandler.updateReasoning(this.messageIndex, this.reasoning);
            await this.reasoningHandler.process(this.messageIndex, changed, undefined);
        } else {
            this.message.extra.reasoning = this.reasoning;
        }
        if (this.signature) this.message.extra.reasoning_signature = this.signature;
        this.#syncSwipeInfo(this.message.gen_finished);
    }

    #syncSwipeInfo(finishedAt) {
        this.message.swipes[this.newSwipeId] = this.message.mes;
        this.message.swipe_info[this.newSwipeId] = {
            send_date: this.message.send_date,
            gen_started: this.startedAt,
            gen_finished: finishedAt,
            extra: clone(this.message.extra),
        };
    }

    #queueRender() {
        if (this.cancelFrame) return;
        this.cancelFrame = requestFrame(() => {
            this.cancelFrame = null;
            void Promise.resolve(this.isTargetCurrent()).then(isCurrent => {
                if (this.finished || !isCurrent) return;
                try {
                    this.context.updateMessageBlock?.(this.messageIndex, this.message);
                    this.reasoningHandler?.updateDom?.(this.messageIndex);
                } catch (error) {
                    console.warn(`${EXTENSION_LOG_PREFIX} A streamed Swipe frame could not be rendered.`, error);
                }
            }).catch(error => console.warn(`${EXTENSION_LOG_PREFIX} Could not validate a streamed Swipe frame.`, error));
        });
    }

    #cancelQueuedRender() {
        this.cancelFrame?.();
        this.cancelFrame = null;
    }

    #renderFull() {
        const addOneMessage = this.context.addOneMessage || this.core.addOneMessage;
        if (typeof addOneMessage === 'function') {
            addOneMessage(this.message, {
                type: 'swipe',
                forceId: this.messageIndex,
                scroll: true,
                showSwipes: false,
            });
        } else {
            this.context.updateMessageBlock?.(this.messageIndex, this.message);
        }
    }

    #restoreControls() {
        try {
            this.context.swipe?.show?.();
            this.context.swipe?.refresh?.(true, false);
        } catch (error) {
            console.warn(`${EXTENSION_LOG_PREFIX} Swipe controls could not be refreshed.`, error);
        }
    }
}

export async function createGuidedSwipeSession(options) {
    const session = new GuidedSwipeSession(options);
    return await session.begin();
}
