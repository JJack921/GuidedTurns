// SPDX-License-Identifier: MIT

export class GuidedError extends Error {
    constructor(message, options = {}) {
        super(message, options);
        this.name = 'GuidedError';
        this.code = options.code || 'guided_error';
    }
}

export function createAbortError(reason = 'The guided request was cancelled.') {
    if (typeof DOMException === 'function') {
        return new DOMException(reason, 'AbortError');
    }
    const error = new Error(reason);
    error.name = 'AbortError';
    return error;
}

export function isAbortError(error) {
    return error?.name === 'AbortError';
}
