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

function createRequestOptions({ stream, signal }) {
    return {
        stream,
        signal,
        extractData: true,
        includePreset: true,
        includeInstruct: true,
    };
}

function convertRequestError(error, signal) {
    if (signal?.aborted || error?.name === 'AbortError' || error instanceof GuidedError) return error;
    return new GuidedError('The guided request failed. Check the selected profile and your API connection.', {
        cause: error,
        code: 'request_failed',
    });
}

export async function sendGuidedCompletion({ context, profile, prompt, signal }) {
    try {
        const result = await context.ConnectionManagerRequestService.sendRequest(
            profile.id,
            prompt,
            undefined,
            createRequestOptions({ stream: false, signal }),
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

export async function streamGuidedCompletion({ context, profile, prompt, signal, onProgress = () => {} }) {
    let latest = { text: '', reasoning: '', signature: null };

    try {
        const response = await context.ConnectionManagerRequestService.sendRequest(
            profile.id,
            prompt,
            undefined,
            createRequestOptions({ stream: true, signal }),
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
