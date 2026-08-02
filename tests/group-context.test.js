// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';
import {
    createGroupActionScope,
    prepareGroupPromptContext,
    resolveGroupPromptTarget,
    resolveGroupSpeaker,
} from '../src/group-context.js';
import { captureDryRunPrompt } from '../src/prompt-capture.js';

class EventSource {
    listeners = new Map();

    on(name, handler) {
        const handlers = this.listeners.get(name) || [];
        handlers.push(handler);
        this.listeners.set(name, handlers);
    }

    removeListener(name, handler) {
        this.listeners.set(name, (this.listeners.get(name) || []).filter(item => item !== handler));
    }

    async emit(name, ...args) {
        for (const handler of this.listeners.get(name) || []) await handler(...args);
    }
}

function fixture({ chat = [], disabledMembers = ['bob.png'] } = {}) {
    const characters = [
        { avatar: 'alice.png', name: 'Alice' },
        { avatar: 'bob.png', name: 'Bob' },
        { avatar: 'carol.png', name: 'Carol' },
    ];
    const group = {
        id: 'group-1',
        members: ['alice.png', 'bob.png', 'carol.png'],
        disabled_members: [...disabledMembers],
    };
    return {
        group,
        context: {
            groupId: group.id,
            groups: [group],
            characters,
            chat,
        },
    };
}

describe('group target resolution', () => {
    it('uses the most recent valid assistant speaker for impersonation', () => {
        const { context } = fixture({
            chat: [
                { is_user: false, name: 'Alice', original_avatar: 'alice.png' },
                { is_user: true, name: 'User' },
                { is_user: false, name: 'Carol', original_avatar: 'carol.png' },
            ],
            disabledMembers: ['carol.png'],
        });

        expect(resolveGroupPromptTarget(context, { kind: 'impersonate' })).toMatchObject({
            id: 2,
            avatar: 'carol.png',
            name: 'Carol',
            sourceMessageIndex: 2,
        });
    });

    it('falls back to the first enabled valid member, then the first valid member', () => {
        const enabled = fixture({ disabledMembers: ['bob.png'] });
        enabled.group.members.unshift('deleted.png');
        expect(resolveGroupPromptTarget(enabled.context, { kind: 'impersonate' })).toMatchObject({
            id: 0,
            avatar: 'alice.png',
        });

        const allDisabled = fixture({ disabledMembers: ['alice.png', 'bob.png', 'carol.png'] });
        expect(resolveGroupPromptTarget(allDisabled.context, { kind: 'impersonate' })).toMatchObject({
            id: 0,
            avatar: 'alice.png',
        });
    });

    it('resolves swipe and revision speakers from avatars and unique legacy names', () => {
        const avatar = fixture();
        expect(resolveGroupSpeaker(avatar.context, { original_avatar: 'carol.png', name: 'Unknown' })).toMatchObject({
            id: 2,
            name: 'Carol',
        });

        const legacy = fixture();
        expect(resolveGroupSpeaker(legacy.context, { name: 'Alice' })).toMatchObject({
            id: 0,
            avatar: 'alice.png',
        });
    });

    it.each([
        ['ambiguous', fixture({}), { name: 'Alice' }, 'group_speaker_ambiguous'],
        ['missing', fixture({}), {}, 'group_speaker_missing'],
        ['deleted', fixture({}), { original_avatar: 'deleted.png', name: 'Alice' }, 'group_speaker_deleted'],
    ])('rejects %s group speakers', (_label, value, message, code) => {
        if (_label === 'ambiguous') {
            value.context.characters.push({ avatar: 'alice-2.png', name: 'Alice' });
            value.group.members.push('alice-2.png');
        }
        expect(() => resolveGroupSpeaker(value.context, message)).toThrowError(expect.objectContaining({ code }));
    });
});

describe('group dry-run context', () => {
    it('moves the target first, unmutes only it, passes force_chid, and restores at prompt combination', async () => {
        const { context, group } = fixture({ disabledMembers: ['bob.png', 'carol.png'] });
        const target = resolveGroupSpeaker(context, { original_avatar: 'bob.png' });
        const eventSource = new EventSource();
        context.eventSource = eventSource;
        context.eventTypes = {
            GENERATE_BEFORE_COMBINE_PROMPTS: 'before-combine',
            GENERATE_AFTER_COMBINE_PROMPTS: 'after-combine',
            GENERATE_AFTER_DATA: 'after-data',
        };
        const ensureGroupTarget = vi.fn();
        context.generate = vi.fn(async (_type, options, dryRun) => {
            expect(dryRun).toBe(true);
            expect(options.force_chid).toBe(1);
            expect(group.members).toEqual(['bob.png', 'alice.png', 'carol.png']);
            expect(group.disabled_members).toEqual(['carol.png']);
            await eventSource.emit('after-data', { prompt: ['not-dry-run'] }, false);
            expect(group.members).toEqual(['bob.png', 'alice.png', 'carol.png']);
            await eventSource.emit('before-combine', {});
            expect(ensureGroupTarget).toHaveBeenCalledOnce();
            await eventSource.emit('after-combine', { prompt: ['assembled'] });
            expect(ensureGroupTarget).toHaveBeenCalledTimes(2);
            expect(group.members).toEqual(['alice.png', 'bob.png', 'carol.png']);
            expect(group.disabled_members).toEqual(['bob.png', 'carol.png']);
            await eventSource.emit('after-data', { prompt: ['assembled'] }, true);
        });

        const prompt = await captureDryRunPrompt({
            context,
            type: 'swipe',
            groupTarget: target,
            ensureGroupTarget,
        });
        expect(prompt).toEqual(['assembled']);
        expect(group.members).toEqual(['alice.png', 'bob.png', 'carol.png']);
        expect(group.disabled_members).toEqual(['bob.png', 'carol.png']);
        expect(eventSource.listeners.get('after-combine')).toEqual([]);
        expect(eventSource.listeners.get('before-combine')).toEqual([]);
        expect(eventSource.listeners.get('after-data')).toEqual([]);
    });

    it('restores reordered and muted state when dry-run generation fails', async () => {
        const { context, group } = fixture({ disabledMembers: ['alice.png'] });
        const target = resolveGroupSpeaker(context, { original_avatar: 'carol.png' });
        const eventSource = new EventSource();
        context.eventSource = eventSource;
        context.eventTypes = { GENERATE_AFTER_DATA: 'after-data' };
        context.generate = vi.fn(() => Promise.reject(new Error('failed')));

        await expect(captureDryRunPrompt({ context, type: 'impersonate', groupTarget: target })).rejects.toThrow('failed');
        expect(group.members).toEqual(['alice.png', 'bob.png', 'carol.png']);
        expect(group.disabled_members).toEqual(['alice.png']);
    });

    it('restores reordered and muted state when prompt capture is cancelled', async () => {
        const { context, group } = fixture({ disabledMembers: ['alice.png'] });
        const target = resolveGroupSpeaker(context, { original_avatar: 'carol.png' });
        const eventSource = new EventSource();
        const controller = new AbortController();
        context.eventSource = eventSource;
        context.eventTypes = { GENERATE_AFTER_DATA: 'after-data' };
        context.generate = vi.fn(() => new Promise(() => {}));

        const capture = captureDryRunPrompt({ context, type: 'swipe', groupTarget: target, signal: controller.signal });
        await vi.waitFor(() => expect(group.members[0]).toBe('carol.png'));
        controller.abort();
        await expect(capture).rejects.toMatchObject({ name: 'AbortError' });
        expect(group.members).toEqual(['alice.png', 'bob.png', 'carol.png']);
        expect(group.disabled_members).toEqual(['alice.png']);
    });

    it('restores prior character id and name after the action scope ends', () => {
        const { context } = fixture();
        context.characterId = '4';
        context.name2 = 'Previous';
        const target = resolveGroupSpeaker(context, { original_avatar: 'carol.png' });
        const setCharacterId = vi.fn();
        const setCharacterName = vi.fn();
        const scope = createGroupActionScope({
            context,
            target,
            core: { setCharacterId, setCharacterName },
        });

        expect(setCharacterId).toHaveBeenNthCalledWith(1, 2);
        expect(setCharacterName).toHaveBeenNthCalledWith(1, 'Carol');
        scope.ensureTarget();
        scope.restore();
        scope.restore();
        expect(setCharacterId).toHaveBeenLastCalledWith('4');
        expect(setCharacterName).toHaveBeenLastCalledWith('Previous');
        expect(setCharacterId).toHaveBeenCalledTimes(3);
        expect(setCharacterName).toHaveBeenCalledTimes(3);
    });

    it('does not restore stale character state after leaving the original group', () => {
        const { context } = fixture();
        context.characterId = '4';
        context.name2 = 'Previous';
        const target = resolveGroupSpeaker(context, { original_avatar: 'carol.png' });
        const setCharacterId = vi.fn();
        const setCharacterName = vi.fn();
        let currentContext = context;
        const scope = createGroupActionScope({
            context,
            target,
            core: { setCharacterId, setCharacterName },
            getContext: () => currentContext,
        });

        currentContext = { ...context, groupId: 'group-2' };
        scope.restore();

        expect(setCharacterId).toHaveBeenCalledTimes(1);
        expect(setCharacterName).toHaveBeenCalledTimes(1);
        expect(setCharacterId).not.toHaveBeenCalledWith('4');
        expect(setCharacterName).not.toHaveBeenCalledWith('Previous');
    });

    it('restores arrays explicitly when the prompt hook is not emitted', () => {
        const { context, group } = fixture();
        const target = resolveGroupSpeaker(context, { original_avatar: 'carol.png' });
        const mutation = prepareGroupPromptContext({ context, target });
        expect(group.members[0]).toBe('carol.png');
        mutation.restore();
        expect(group.members).toEqual(['alice.png', 'bob.png', 'carol.png']);
    });
});
