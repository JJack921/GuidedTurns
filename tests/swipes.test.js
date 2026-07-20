// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';
import { createGuidedSwipeSession, isSwipeableAssistantMessage } from '../src/swipes.js';

function fixture({ saveFails = false } = {}) {
    const message = {
        mes: 'current',
        is_user: false,
        is_system: false,
        swipe_id: 1,
        swipes: ['original', 'current'],
        swipe_info: [
            { extra: { reasoning: 'old' } },
            { extra: { bias: 'keep', media: ['stale'], reasoning: 'stale', token_count: 99 } },
        ],
        extra: { media: ['stale'], reasoning: 'stale', token_count: 99 },
    };
    const emitted = [];
    const context = {
        mainApi: 'openai',
        chat: [message],
        saveChat: saveFails ? vi.fn().mockRejectedValue(new Error('save failed')) : vi.fn().mockResolvedValue(undefined),
        addOneMessage: vi.fn(),
        updateMessageBlock: vi.fn(),
        scrollChatToBottom: vi.fn(),
        swipe: { hide: vi.fn(), show: vi.fn(), refresh: vi.fn() },
        eventSource: {
            emit: vi.fn(async (...args) => {
                emitted.push(args);
            }),
        },
        eventTypes: {
            MESSAGE_SWIPED: 'message-swiped',
            MESSAGE_RECEIVED: 'message-received',
            CHARACTER_MESSAGE_RENDERED: 'character-message-rendered',
        },
    };
    class ReasoningHandler {
        constructor() {
            this.reasoning = '';
            this.updateDom = vi.fn();
        }

        updateReasoning(_messageIndex, reasoning) {
            this.reasoning = reasoning || this.reasoning;
        }

        async process(messageIndex) {
            context.chat[messageIndex].extra.reasoning = this.reasoning;
            context.chat[messageIndex].extra.reasoning_type = this.reasoning ? 'model' : null;
        }

        async finish(messageIndex) {
            if (this.reasoning) context.chat[messageIndex].extra.reasoning_duration = 750;
        }
    }
    const core = {
        ensureSwipes: vi.fn(),
        syncMesToSwipe: vi.fn(),
        cleanUpMessage: vi.fn(({ getMessage }) => getMessage.trim()),
        getStoppingStrings: vi.fn(() => ['STOP']),
        ReasoningHandler,
    };
    return { message, context, core, emitted };
}

describe('guided swipes', () => {
    it('recognizes eligible assistant messages', () => {
        expect(isSwipeableAssistantMessage({ is_user: false, is_system: false, extra: {} })).toBe(true);
        expect(isSwipeableAssistantMessage({ is_user: true })).toBe(false);
        expect(isSwipeableAssistantMessage({ is_system: true })).toBe(false);
        expect(isSwipeableAssistantMessage({ extra: { swipeable: false } })).toBe(false);
    });

    it('renders a selected placeholder immediately, streams text and thinking, then saves aligned metadata', async () => {
        const { message, context, core, emitted } = fixture();
        const session = await createGuidedSwipeSession({
            context,
            core,
            messageIndex: 0,
            profile: { id: 'guided', api: 'openrouter', model: 'model-b' },
            startedAt: new Date('2026-01-01T00:00:00Z'),
            now: () => new Date('2026-01-01T00:00:01Z'),
        });

        expect(message.swipe_id).toBe(2);
        expect(message.swipes).toEqual(['original', 'current', '...']);
        expect(context.addOneMessage).toHaveBeenCalledWith(message, expect.objectContaining({ type: 'swipe', forceId: 0 }));
        expect(context.swipe.hide).toHaveBeenCalledWith({ hideCounters: true });
        expect(emitted[0]).toEqual(['message-swiped', 0]);

        await session.update({ text: '  guided result  ', reasoning: 'private thought', signature: 'sig' });
        expect(message.mes).toBe('guided result');
        expect(message.swipes[2]).toBe('guided result');
        expect(message.extra.reasoning).toBe('private thought');
        await vi.waitFor(() => expect(context.updateMessageBlock).toHaveBeenCalledWith(0, message));

        const id = await session.commit();
        expect(id).toBe(2);
        expect(message.swipe_info).toHaveLength(message.swipes.length);
        expect(message.swipe_info[2].extra).toMatchObject({
            bias: 'keep',
            api: 'openrouter',
            model: 'model-b',
            reasoning: 'private thought',
            reasoning_duration: 750,
            reasoning_signature: 'sig',
            guided_generation: true,
        });
        expect(message.swipe_info[2].extra).not.toHaveProperty('media');
        expect(message.swipe_info[2].extra).not.toHaveProperty('token_count');
        expect(context.saveChat).toHaveBeenCalledOnce();
        expect(emitted).toEqual([
            ['message-swiped', 0],
            ['message-received', 0, 'swipe'],
            ['character-message-rendered', 0, 'swipe'],
        ]);
        expect(context.swipe.show).toHaveBeenCalled();
        expect(context.swipe.refresh).toHaveBeenCalledWith(true, false);
    });

    it('marks streamed partial output as interrupted when requested', async () => {
        const { message, context, core } = fixture();
        const session = await createGuidedSwipeSession({
            context,
            core,
            messageIndex: 0,
            profile: { id: 'guided', api: 'openrouter', model: 'm' },
        });
        await session.update({ text: 'partial', reasoning: 'thinking' });
        expect(session.hasOutput()).toBe(true);
        await session.commit({ interrupted: true });
        expect(message.extra.guided_interrupted).toBe(true);
        expect(message.swipe_info[2].extra.guided_interrupted).toBe(true);
    });

    it('restores the exact message snapshot when rolled back', async () => {
        const { message, context, core } = fixture();
        const before = structuredClone(message);
        const session = await createGuidedSwipeSession({
            context,
            core,
            messageIndex: 0,
            profile: { id: 'guided', api: 'openrouter', model: 'm' },
        });
        await session.rollback();
        expect(message).toEqual(before);
        expect(context.addOneMessage).toHaveBeenCalledTimes(2);
        expect(context.saveChat).not.toHaveBeenCalled();
    });

    it('cancels a queued streamed DOM frame during rollback', async () => {
        const { context, core } = fixture();
        const session = await createGuidedSwipeSession({
            context,
            core,
            messageIndex: 0,
            profile: { id: 'guided', api: 'openrouter', model: 'm' },
        });
        await session.update({ text: 'partial' });
        await session.rollback();
        await new Promise(resolve => setTimeout(resolve, 30));
        expect(context.updateMessageBlock).not.toHaveBeenCalled();
    });

    it('rolls back the message if saving fails', async () => {
        const { message, context, core } = fixture({ saveFails: true });
        const before = structuredClone(message);
        const session = await createGuidedSwipeSession({
            context,
            core,
            messageIndex: 0,
            profile: { id: 'guided', api: 'openrouter', model: 'm' },
        });
        await session.update({ text: 'not saved' });
        await expect(session.commit()).rejects.toMatchObject({ code: 'swipe_append_failed' });
        expect(message).toEqual(before);
    });

    it('rejects a changed target and can roll back without touching the new chat UI', async () => {
        const { message, context, core } = fixture();
        let current = true;
        const session = await createGuidedSwipeSession({
            context,
            core,
            messageIndex: 0,
            profile: { id: 'guided', api: 'openrouter', model: 'm' },
            isTargetCurrent: () => current,
        });
        current = false;
        await expect(session.update({ text: 'late' })).rejects.toMatchObject({ code: 'swipe_target_changed' });
        await session.rollback({ render: false });
        expect(message.mes).toBe('current');
        expect(context.addOneMessage).toHaveBeenCalledOnce();
    });
});
