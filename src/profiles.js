// SPDX-License-Identifier: MIT

import { GuidedError } from './errors.js';
import { CURRENT_PROFILE, EXTENSION_LOG_PREFIX } from './constants.js';

export const COMPLETION_MODES = Object.freeze({
    CHAT: 'chat',
    TEXT: 'text',
});

export function isConnectionManagerDisabled(context) {
    const disabled = context?.extensionSettings?.disabledExtensions;
    return Array.isArray(disabled) && disabled.includes('connection-manager');
}

export function activeCompletionMode(context) {
    return context?.mainApi === 'openai' ? COMPLETION_MODES.CHAT : COMPLETION_MODES.TEXT;
}

export function profileCompletionMode(context, profile) {
    const apiMap = context?.CONNECT_API_MAP?.[profile?.api];
    if (apiMap?.selected === 'openai') return COMPLETION_MODES.CHAT;
    if (apiMap?.selected === 'textgenerationwebui') return COMPLETION_MODES.TEXT;
    return null;
}

export function activePresetName(context, mode) {
    const value = mode === COMPLETION_MODES.CHAT
        ? context?.chatCompletionSettings?.preset_settings_openai
        : context?.textCompletionSettings?.preset;
    return typeof value === 'string' ? value.trim() : '';
}

export function getSupportedProfiles(context) {
    if (isConnectionManagerDisabled(context)) return [];
    const service = context?.ConnectionManagerRequestService;
    if (!service?.getSupportedProfiles) return [];
    try {
        return service.getSupportedProfiles().slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
    } catch (error) {
        console.warn(`${EXTENSION_LOG_PREFIX} Could not list connection profiles.`, error);
        return [];
    }
}

export function describeProfile(context, profile) {
    const mode = profileCompletionMode(context, profile);
    return {
        id: profile?.id || '',
        name: profile?.name || 'Unnamed profile',
        api: profile?.api || 'Unknown API',
        model: profile?.model || 'Default model',
        preset: profile?.preset || 'No preset',
        mode,
        modeLabel: mode === COMPLETION_MODES.CHAT ? 'Chat Completion' : mode === COMPLETION_MODES.TEXT ? 'Text Completion' : 'Unsupported',
    };
}

export function resolveProfileId(context, configuredProfileId) {
    if (configuredProfileId !== CURRENT_PROFILE) return configuredProfileId;

    const selectedProfileId = context?.extensionSettings?.connectionManager?.selectedProfile;
    if (!selectedProfileId) {
        throw new GuidedError('No current Connection Manager profile is selected. Select one or choose a dedicated guided profile.', {
            code: 'current_profile_required',
        });
    }
    return selectedProfileId;
}

export function validateGuidedProfile(context, configuredProfileId) {
    if (isConnectionManagerDisabled(context)) {
        throw new GuidedError('Connection Manager is disabled. Enable it before using guided generation.', { code: 'connection_manager_disabled' });
    }

    const service = context?.ConnectionManagerRequestService;
    if (!service?.getProfile || !service?.sendRequest) {
        throw new GuidedError('Connection Manager is unavailable in this SillyTavern installation.', { code: 'connection_manager_unavailable' });
    }
    if (!configuredProfileId) {
        throw new GuidedError('Choose a guided connection profile in Extension Settings first.', { code: 'profile_required' });
    }

    const profileId = resolveProfileId(context, configuredProfileId);

    let profile;
    try {
        profile = service.getProfile(profileId);
    } catch (error) {
        throw new GuidedError('The selected guided profile no longer exists. Choose another profile in Extension Settings.', {
            cause: error,
            code: 'profile_missing',
        });
    }

    if (!service.isProfileSupported?.(profile)) {
        throw new GuidedError('The selected guided profile uses an unsupported connection type.', { code: 'profile_unsupported' });
    }

    const targetMode = profileCompletionMode(context, profile);
    const currentMode = activeCompletionMode(context);
    if (!targetMode || targetMode !== currentMode) {
        throw new GuidedError(
            `The guided profile uses ${targetMode || 'an unsupported mode'}, but the active chat uses ${currentMode}. Choose a profile with the same completion mode.`,
            { code: 'mode_mismatch' },
        );
    }

    const usesCurrentProfile = configuredProfileId === CURRENT_PROFILE;
    const boundPresetName = typeof profile.preset === 'string' ? profile.preset.trim() : '';
    const presetName = boundPresetName || (usesCurrentProfile ? activePresetName(context, targetMode) : '');
    if (!presetName) {
        throw new GuidedError('The selected guided profile has no bound generation preset.', { code: 'preset_required' });
    }

    const presetManagerId = targetMode === COMPLETION_MODES.CHAT ? 'openai' : 'textgenerationwebui';
    const presetManager = context?.getPresetManager?.(presetManagerId);
    const preset = presetManager?.getCompletionPresetByName?.(presetName);
    if (!preset) {
        throw new GuidedError(`The guided profile's preset “${presetName}” could not be found. Update the profile or choose another one.`, {
            code: 'preset_missing',
        });
    }

    return { profile, profileId, mode: targetMode, preset, presetName };
}
