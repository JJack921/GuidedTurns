// SPDX-License-Identifier: MIT

import {
    DEFAULT_PROMPTS,
    DEFAULT_SETTINGS,
    PERSPECTIVES,
} from './constants.js';

const VALID_PERSPECTIVES = new Set(Object.values(PERSPECTIVES));

export function createDefaultSettings() {
    return {
        debugMode: DEFAULT_SETTINGS.debugMode,
        includeRevisionChatHistory: DEFAULT_SETTINGS.includeRevisionChatHistory,
        profileIds: { ...DEFAULT_SETTINGS.profileIds },
        perspective: DEFAULT_SETTINGS.perspective,
        prompts: { ...DEFAULT_PROMPTS },
    };
}

export function normalizeSettings(value) {
    const defaults = createDefaultSettings();
    const source = value && typeof value === 'object' ? value : {};
    const sourcePrompts = source.prompts && typeof source.prompts === 'object' ? source.prompts : {};
    const sourceProfileIds = source.profileIds && typeof source.profileIds === 'object' ? source.profileIds : {};

    return {
        debugMode: typeof source.debugMode === 'boolean' ? source.debugMode : defaults.debugMode,
        includeRevisionChatHistory: typeof source.includeRevisionChatHistory === 'boolean'
            ? source.includeRevisionChatHistory
            : defaults.includeRevisionChatHistory,
        profileIds: Object.fromEntries(Object.entries(defaults.profileIds).map(([key, fallback]) => [
            key,
            typeof sourceProfileIds[key] === 'string' && sourceProfileIds[key] ? sourceProfileIds[key] : fallback,
        ])),
        perspective: VALID_PERSPECTIVES.has(source.perspective) ? source.perspective : defaults.perspective,
        prompts: Object.fromEntries(Object.entries(DEFAULT_PROMPTS).map(([key, fallback]) => [
            key,
            typeof sourcePrompts[key] === 'string' ? sourcePrompts[key] : fallback,
        ])),
    };
}

export function initializeSettings(settingsContainer, extensionName) {
    const existing = settingsContainer[extensionName];
    const normalized = normalizeSettings(existing);

    if (existing && typeof existing === 'object') {
        for (const key of Object.keys(existing)) {
            delete existing[key];
        }
        Object.assign(existing, normalized);
        settingsContainer[extensionName] = existing;
        return existing;
    }

    settingsContainer[extensionName] = normalized;
    return normalized;
}

export function resetPrompt(settings, promptKey) {
    if (!Object.hasOwn(DEFAULT_PROMPTS, promptKey)) {
        throw new Error(`Unknown prompt key: ${promptKey}`);
    }
    settings.prompts[promptKey] = DEFAULT_PROMPTS[promptKey];
    return settings.prompts[promptKey];
}

export function resetAllPrompts(settings) {
    settings.prompts = { ...DEFAULT_PROMPTS };
    return settings.prompts;
}
