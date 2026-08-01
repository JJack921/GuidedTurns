// SPDX-License-Identifier: MIT

import { PROMPT_CAPTURE_TIMEOUT_MS } from './constants.js';
import { createAbortError, GuidedError } from './errors.js';

const CHAT_PRESET_KEY_ALIASES = Object.freeze({
    temperature: 'temp_openai',
    frequency_penalty: 'freq_pen_openai',
    presence_penalty: 'pres_pen_openai',
    top_p: 'top_p_openai',
    top_k: 'top_k_openai',
    top_a: 'top_a_openai',
    min_p: 'min_p_openai',
    repetition_penalty: 'repetition_penalty_openai',
});

function clonePresetValue(value) {
    if (value === undefined || value === null || typeof value !== 'object') return value;
    return structuredClone(value);
}

function getPresetSettings(context, mode) {
    return mode === 'chat' ? context?.chatCompletionSettings : context?.textCompletionSettings;
}

function getPresetSettingsKey(settings, mode, presetKey) {
    if ((mode === 'chat' && presetKey === 'preset_settings_openai') || (mode === 'text' && presetKey === 'preset')) {
        return null;
    }
    const settingsKey = mode === 'chat' ? CHAT_PRESET_KEY_ALIASES[presetKey] ?? presetKey : presetKey;
    return Object.hasOwn(settings, settingsKey) ? settingsKey : null;
}

export async function capturePromptWithPreset({
    context,
    mode,
    preset,
    capturePrompt = captureDryRunPrompt,
    ...captureOptions
}) {
    const liveSettings = getPresetSettings(context, mode);
    if (!liveSettings || typeof liveSettings !== 'object') {
        throw new GuidedError('This SillyTavern version does not expose live completion settings for prompt capture.', {
            code: 'preset_settings_unavailable',
        });
    }

    const snapshot = new Map();
    try {
        for (const [presetKey, value] of Object.entries(preset ?? {})) {
            const settingsKey = getPresetSettingsKey(liveSettings, mode, presetKey);
            if (!settingsKey || snapshot.has(settingsKey)) continue;
            snapshot.set(settingsKey, liveSettings[settingsKey]);
            liveSettings[settingsKey] = clonePresetValue(value);
        }

        return await capturePrompt({ context, ...captureOptions });
    } finally {
        for (const [settingsKey, value] of snapshot) {
            liveSettings[settingsKey] = value;
        }
    }
}

function addListener(eventSource, eventName, handler) {
    eventSource.on(eventName, handler);
    return () => {
        if (typeof eventSource.removeListener === 'function') {
            eventSource.removeListener(eventName, handler);
        } else if (typeof eventSource.off === 'function') {
            eventSource.off(eventName, handler);
        }
    };
}

export async function captureDryRunPrompt({
    context,
    type,
    quietPrompt = '',
    signal,
    timeoutMs = PROMPT_CAPTURE_TIMEOUT_MS,
}) {
    if (!context?.generate || !context?.eventSource || !context?.eventTypes?.GENERATE_AFTER_DATA) {
        throw new GuidedError('This SillyTavern version does not expose the dry-run prompt API.', { code: 'dry_run_unavailable' });
    }
    if (signal?.aborted) throw createAbortError();

    let capturedData = null;
    let timer = null;
    let abortHandler = null;
    const eventName = context.eventTypes.GENERATE_AFTER_DATA;
    const removeListener = addListener(context.eventSource, eventName, (data, dryRun) => {
        if (dryRun === true && data && Object.hasOwn(data, 'prompt')) {
            capturedData = data;
        }
    });

    const abortPromise = new Promise((_, reject) => {
        abortHandler = () => reject(createAbortError());
        signal?.addEventListener('abort', abortHandler, { once: true });
    });
    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new GuidedError('Timed out while assembling the active SillyTavern prompt.', {
            code: 'prompt_capture_timeout',
        })), timeoutMs);
    });

    const generationPromise = Promise.resolve().then(() => context.generate(type, {
        quiet_prompt: quietPrompt,
        quietToLoud: true,
        signal,
    }, true));
    generationPromise.catch(() => {});

    try {
        await Promise.race([generationPromise, abortPromise, timeoutPromise]);
        if (!capturedData || capturedData.prompt === undefined || capturedData.prompt === null) {
            throw new GuidedError('SillyTavern completed the dry run without returning an assembled prompt.', {
                code: 'prompt_capture_empty',
            });
        }
        return capturedData.prompt;
    } finally {
        removeListener();
        clearTimeout(timer);
        signal?.removeEventListener('abort', abortHandler);
    }
}
