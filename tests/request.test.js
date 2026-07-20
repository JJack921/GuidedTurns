// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';
import { sendGuidedCompletion, streamGuidedCompletion } from '../src/request.js';

describe('guided request', () => {
    it('uses the selected profile and its bound preset without overrides', async () => {
        const sendRequest = vi.fn().mockResolvedValue({ content: '  result  ' });
        const context = { ConnectionManagerRequestService: { sendRequest } };
        const controller = new AbortController();
        const profile = { id: 'guided' };
        await expect(sendGuidedCompletion({ context, profile, prompt: ['prompt'], signal: controller.signal })).resolves.toBe('result');
        expect(sendRequest).toHaveBeenCalledWith('guided', ['prompt'], undefined, {
            stream: false,
            signal: controller.signal,
            extractData: true,
            includePreset: true,
            includeInstruct: true,
        });
    });

    it('rejects empty output and wraps API failures', async () => {
        const sendRequest = vi.fn().mockResolvedValueOnce({ content: ' ' }).mockRejectedValueOnce(new Error('secret'));
        const context = { ConnectionManagerRequestService: { sendRequest } };
        await expect(sendGuidedCompletion({ context, profile: { id: 'p' }, prompt: 'x' })).rejects.toMatchObject({ code: 'empty_response' });
        await expect(sendGuidedCompletion({ context, profile: { id: 'p' }, prompt: 'x' })).rejects.toMatchObject({ code: 'request_failed' });
    });
});

describe('streamed guided request', () => {
    it('consumes cumulative streaming text, reasoning, and signatures', async () => {
        async function* chunks() {
            yield { text: 'one', state: { reasoning: 'think', signature: 'a' } };
            yield { text: 'one two', state: { reasoning: 'think more', signature: 'b' } };
        }
        const sendRequest = vi.fn().mockResolvedValue(() => chunks());
        const context = { ConnectionManagerRequestService: { sendRequest } };
        const onProgress = vi.fn();
        const controller = new AbortController();
        await expect(streamGuidedCompletion({
            context,
            profile: { id: 'guided' },
            prompt: ['prompt'],
            signal: controller.signal,
            onProgress,
        })).resolves.toEqual({ text: 'one two', reasoning: 'think more', signature: 'b' });
        expect(sendRequest).toHaveBeenCalledOnce();
        expect(sendRequest).toHaveBeenCalledWith('guided', ['prompt'], undefined, {
            stream: true,
            signal: controller.signal,
            extractData: true,
            includePreset: true,
            includeInstruct: true,
        });
        expect(onProgress).toHaveBeenNthCalledWith(1, { text: 'one', reasoning: 'think', signature: 'a' });
        expect(onProgress).toHaveBeenNthCalledWith(2, { text: 'one two', reasoning: 'think more', signature: 'b' });
    });

    it('accepts a directly extracted non-streaming response without retrying', async () => {
        const sendRequest = vi.fn().mockResolvedValue({ content: 'fallback', reasoning: 'thought' });
        const context = { ConnectionManagerRequestService: { sendRequest } };
        const onProgress = vi.fn();
        await expect(streamGuidedCompletion({
            context,
            profile: { id: 'p' },
            prompt: 'x',
            onProgress,
        })).resolves.toEqual({ text: 'fallback', reasoning: 'thought', signature: null });
        expect(sendRequest).toHaveBeenCalledOnce();
        expect(onProgress).toHaveBeenCalledWith({ text: 'fallback', reasoning: 'thought', signature: null });
    });

    it('does not retry failed streams and rejects final responses without content', async () => {
        const failure = vi.fn().mockRejectedValue(new Error('stream failed'));
        const context = { ConnectionManagerRequestService: { sendRequest: failure } };
        await expect(streamGuidedCompletion({ context, profile: { id: 'p' }, prompt: 'x' }))
            .rejects.toMatchObject({ code: 'request_failed' });
        expect(failure).toHaveBeenCalledOnce();

        async function* reasoningOnly() {
            yield { text: '', state: { reasoning: 'unfinished thought' } };
        }
        const empty = vi.fn().mockResolvedValue(() => reasoningOnly());
        await expect(streamGuidedCompletion({
            context: { ConnectionManagerRequestService: { sendRequest: empty } },
            profile: { id: 'p' },
            prompt: 'x',
        })).rejects.toMatchObject({ code: 'empty_response' });
        expect(empty).toHaveBeenCalledOnce();
    });
});
