// SPDX-License-Identifier: MIT

import { GuidedError } from './errors.js';

function extractResponse(result) {
    if (typeof result === 'string') {
        return { text: result, reasoning: '', signature: null };
    }
    if (!result || typeof result !== 'object') {
        return { text: '', reasoning: '', signature: null };
    }
    return {
        text: String(result.content || result.text || result.pipe || ''),
        reasoning: String(result.reasoning || result.state?.reasoning || ''),
        signature: result.signature || result.reasoning_signature || result.state?.signature || null,
    };
}

function createRequestOptions({ stream, signal, useLiveSettings }) {
    return {
        stream,
        signal,
        extractData: true,
        includePreset: !useLiveSettings,
        includeInstruct: !useLiveSettings,
    };
}

async function createLivePayload({ context, profile, prompt, mode, useLiveSettings, getResponseLength, getLiveModel }) {
    if (!useLiveSettings) return undefined;
    const service = mode === 'chat' ? context.ChatCompletionService : context.TextCompletionService;
    if (!service?.presetToGeneratePayload) {
        throw new GuidedError('This SillyTavern version does not expose live completion payload conversion.', {
            code: 'live_settings_unavailable',
        });
    }
    const model = getLiveModel?.(mode);
    if (typeof model !== 'string' || !model.trim()) {
        throw new GuidedError('The live model selection is unavailable. Select a model before generating.', {
            code: 'live_model_unavailable',
        });
    }
    // Convert live settings without loading a saved preset.
    let payload;
    if (mode === 'chat') {
        // The host clears the selected logit bias unless bias_presets is supplied.
        const settings = context.chatCompletionSettings;
        payload = await service.presetToGeneratePayload({
            bias_presets: settings?.bias_presets ?? {},
            bias_preset_selected: settings?.bias_preset_selected,
        }, {}, { model, messages: prompt });
    } else {
        const responseLength = getResponseLength?.();
        if (!Number.isFinite(responseLength) || responseLength <= 0) {
            throw new GuidedError('The live text-completion response length is unavailable.', {
                code: 'live_settings_unavailable',
            });
        }
        payload = await service.presetToGeneratePayload({ genamt: responseLength }, {}, { model, prompt });
    }
    // Connection Manager remains responsible for the resolved profile's routing.
    for (const key of ['chat_completion_source', 'api_type', 'api_server', 'secret_id',
        'custom_url', 'vertexai_region', 'zai_endpoint', 'siliconflow_endpoint', 'minimax_endpoint',
        'reverse_proxy', 'proxy_password', 'custom_prompt_post_processing']) {
        delete payload[key];
    }
    return payload;
}

function convertRequestError(error, signal) {
    if (signal?.aborted || error?.name === 'AbortError' || error instanceof GuidedError) return error;
    return new GuidedError('The guided request failed. Check the selected profile and your API connection.', {
        cause: error,
        code: 'request_failed',
    });
}

export async function sendGuidedCompletion({ context, profile, prompt, signal, mode, useLiveSettings = false, getResponseLength, getLiveModel }) {
    try {
        const payload = await createLivePayload({ context, profile, prompt, mode, useLiveSettings, getResponseLength, getLiveModel });
        const result = await context.ConnectionManagerRequestService.sendRequest(
            profile.id,
            prompt,
            undefined,
            createRequestOptions({ stream: false, signal, useLiveSettings }),
            ...(payload ? [{ ...payload, stream: false }] : []),
        );
        const content = extractResponse(result).text.trim();
        if (!content) {
            throw new GuidedError('The guided profile returned an empty response.', { code: 'empty_response' });
        }
        return content;
    } catch (error) {
        throw convertRequestError(error, signal);
    }
}

export async function streamGuidedCompletion({ context, profile, prompt, signal, mode, useLiveSettings = false, getResponseLength, getLiveModel, onProgress = () => {} }) {
    let latest = { text: '', reasoning: '', signature: null };

    try {
        const payload = await createLivePayload({ context, profile, prompt, mode, useLiveSettings, getResponseLength, getLiveModel });
        const response = await context.ConnectionManagerRequestService.sendRequest(
            profile.id,
            prompt,
            undefined,
            createRequestOptions({ stream: true, signal, useLiveSettings }),
            ...(payload ? [{ ...payload, stream: true }] : []),
        );

        if (typeof response === 'function') {
            for await (const chunk of response()) {
                const extracted = extractResponse(chunk);
                latest = {
                    text: extracted.text,
                    reasoning: extracted.reasoning || latest.reasoning,
                    signature: extracted.signature || latest.signature,
                };
                await onProgress({ ...latest });
            }
        } else {
            latest = extractResponse(response);
            await onProgress({ ...latest });
        }

        if (!latest.text.trim()) {
            throw new GuidedError('The guided profile returned an empty response.', { code: 'empty_response' });
        }
        return latest;
    } catch (error) {
        throw convertRequestError(error, signal);
    }
}
