// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';
import { captureDryRunPrompt, capturePromptWithPreset } from '../src/prompt-capture.js';

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

describe('dry-run prompt capture', () => {
    it('captures only dry-run generation data and removes its listener', async () => {
        const eventSource = new EventSource();
        const context = {
            eventSource,
            eventTypes: { GENERATE_AFTER_DATA: 'after-data' },
            generate: vi.fn(async (_type, _options, dryRun) => {
                await eventSource.emit('after-data', { prompt: ['wrong'] }, false);
                await eventSource.emit('after-data', { prompt: ['right'] }, dryRun);
            }),
        };
        const prompt = await captureDryRunPrompt({ context, type: 'swipe', quietPrompt: 'guide' });
        expect(prompt).toEqual(['right']);
        expect(context.generate).toHaveBeenCalledWith('swipe', expect.objectContaining({ quiet_prompt: 'guide', quietToLoud: true }), true);
        expect(eventSource.listeners.get('after-data')).toEqual([]);
    });

    it('times out and cleans up if generation never completes', async () => {
        const eventSource = new EventSource();
        const context = {
            eventSource,
            eventTypes: { GENERATE_AFTER_DATA: 'after-data' },
            generate: () => new Promise(() => {}),
        };
        await expect(captureDryRunPrompt({ context, type: 'swipe', timeoutMs: 5 })).rejects.toMatchObject({ code: 'prompt_capture_timeout' });
        expect(eventSource.listeners.get('after-data')).toEqual([]);
    });

    it('honors cancellation', async () => {
        const eventSource = new EventSource();
        const controller = new AbortController();
        const context = {
            eventSource,
            eventTypes: { GENERATE_AFTER_DATA: 'after-data' },
            generate: () => new Promise(() => {}),
        };
        const capture = captureDryRunPrompt({ context, type: 'impersonate', signal: controller.signal });
        controller.abort();
        await expect(capture).rejects.toMatchObject({ name: 'AbortError' });
        expect(eventSource.listeners.get('after-data')).toEqual([]);
    });

    it('cleans up when the dry-run function throws synchronously', async () => {
        const eventSource = new EventSource();
        const context = {
            eventSource,
            eventTypes: { GENERATE_AFTER_DATA: 'after-data' },
            generate: () => {
                throw new Error('dry run failed');
            },
        };
        await expect(captureDryRunPrompt({ context, type: 'swipe' })).rejects.toThrow('dry run failed');
        expect(eventSource.listeners.get('after-data')).toEqual([]);
    });
});

describe('preset-aware prompt capture', () => {
    it('temporarily overlays text-completion settings without changing the selected preset', async () => {
        const liveSettings = { preset: 'Current', temp: 0.7, sampler_priority: ['temperature', 'top_p'] };
        const context = { textCompletionSettings: liveSettings };
        const originalPriority = liveSettings.sampler_priority;
        const capturePrompt = vi.fn(async ({ type }) => {
            expect(type).toBe('swipe');
            expect(liveSettings).toEqual({
                preset: 'Current',
                temp: 0.2,
                sampler_priority: ['top_p', 'temperature'],
            });
            return 'assembled prompt';
        });

        const prompt = await capturePromptWithPreset({
            context,
            mode: 'text',
            preset: { preset: 'Dedicated', temp: 0.2, sampler_priority: ['top_p', 'temperature'] },
            capturePrompt,
            type: 'swipe',
        });

        expect(prompt).toBe('assembled prompt');
        expect(liveSettings).toEqual({ preset: 'Current', temp: 0.7, sampler_priority: originalPriority });
        expect(liveSettings.sampler_priority).toBe(originalPriority);
    });
});
