// SPDX-License-Identifier: MIT

import { PROMPT_CAPTURE_TIMEOUT_MS } from './constants.js';
import { createAbortError, GuidedError } from './errors.js';

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
