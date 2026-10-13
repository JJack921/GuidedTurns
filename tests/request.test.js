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


describe('live settings requests', () => {
    it.each([
        ['chat', false], ['chat', true], ['text', false], ['text', true],
    ])('uses live %s parameters with streaming=%s', async (mode, stream) => {
        const prompt = mode === 'chat' ? [{ role: 'user', content: 'guide' }] : 'assembled instruct prompt';
        const converter = vi.fn((preset, _overrides, input) => ({
            ...input,
            temperature: 0.37,
            max_tokens: mode === 'chat' ? 321 : preset.genamt,
            api_server: 'live-server',
            chat_completion_source: 'live-source',
            custom_prompt_post_processing: 'live-processing',
            reverse_proxy: 'live-proxy',
            secret_id: 'live-secret',
        }));
        const sendRequest = vi.fn().mockResolvedValue({ content: 'result' });
        const context = {
            ConnectionManagerRequestService: { sendRequest },
            chatCompletionSettings: { bias_presets: { Custom: [] }, bias_preset_selected: 'Custom' },
            ChatCompletionService: { presetToGeneratePayload: converter },
            TextCompletionService: { presetToGeneratePayload: converter },
        };
        const onProgress = vi.fn();
        const request = stream ? streamGuidedCompletion : sendGuidedCompletion;
        await request({ context, profile: { id: 'current', model: 'profile-model' }, prompt,
            mode, useLiveSettings: true, getResponseLength: () => 456, getLiveModel: () => 'live-model', onProgress });
        expect(converter).toHaveBeenCalledWith(mode === 'chat'
            ? { bias_presets: { Custom: [] }, bias_preset_selected: 'Custom' }
            : { genamt: 456 }, {}, {
            model: 'live-model', [mode === 'chat' ? 'messages' : 'prompt']: prompt,
        });
        expect(sendRequest).toHaveBeenCalledWith('current', prompt, undefined, {
            stream, signal: undefined, extractData: true, includePreset: false, includeInstruct: false,
        }, {
            model: 'live-model', [mode === 'chat' ? 'messages' : 'prompt']: prompt,
            temperature: 0.37, max_tokens: mode === 'chat' ? 321 : 456, stream,
        });
        if (stream) expect(onProgress).toHaveBeenCalledOnce();
    });

    it.each([sendGuidedCompletion, streamGuidedCompletion])('reads unsaved model changes on each request', async request => {
        let liveModel = 'first-model';
        const sendRequest = vi.fn().mockResolvedValue({ content: 'result' });
        const getLiveModel = vi.fn(() => liveModel);
        const context = {
            ConnectionManagerRequestService: { sendRequest },
            chatCompletionSettings: {},
            ChatCompletionService: {
                presetToGeneratePayload: vi.fn(async (_preset, _overrides, input) => ({ ...input })),
            },
        };
        const profile = { id: 'current', model: 'glm-5.3-exl3' };
        const options = { context, profile, prompt: [], mode: 'chat', useLiveSettings: true, getLiveModel };
        await request(options);
        liveModel = 'new-served-model';
        await request(options);
        expect(sendRequest.mock.calls.map(call => call[4].model)).toEqual(['first-model', 'new-served-model']);
        expect(getLiveModel).toHaveBeenCalledWith('chat');
        expect(profile.model).toBe('glm-5.3-exl3');
    });

    it('rejects missing live model selection instead of using the saved model', async () => {
        const sendRequest = vi.fn();
        await expect(sendGuidedCompletion({
            context: {
                ConnectionManagerRequestService: { sendRequest },
                ChatCompletionService: { presetToGeneratePayload: vi.fn() },
            },
            profile: { id: 'current', model: 'old-model' }, mode: 'chat', prompt: [], useLiveSettings: true,
            getLiveModel: () => '',
        })).rejects.toMatchObject({ code: 'live_model_unavailable' });
        expect(sendRequest).not.toHaveBeenCalled();
    });

    it('reports unsupported live conversion without sending a request or falling back to saved settings', async () => {
        const sendRequest = vi.fn();
        await expect(sendGuidedCompletion({
            context: { ConnectionManagerRequestService: { sendRequest } },
            profile: { id: 'current' }, mode: 'chat', prompt: [], useLiveSettings: true,
        })).rejects.toMatchObject({ code: 'live_settings_unavailable' });
        expect(sendRequest).not.toHaveBeenCalled();
    });

    it('requires the live text response length', async () => {
        const sendRequest = vi.fn();
        const converter = vi.fn();
        await expect(sendGuidedCompletion({
            context: { ConnectionManagerRequestService: { sendRequest }, TextCompletionService: { presetToGeneratePayload: converter } },
            profile: { id: 'current' }, mode: 'text', prompt: 'prompt', useLiveSettings: true, getLiveModel: () => 'live-model',
        })).rejects.toMatchObject({ code: 'live_settings_unavailable' });
        expect(converter).not.toHaveBeenCalled();
        expect(sendRequest).not.toHaveBeenCalled();
    });
});
