// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';
import { CURRENT_PROFILE } from '../src/constants.js';
import { COMPLETION_MODES, describeProfile, getSupportedProfiles, resolveProfileId, validateGuidedProfile } from '../src/profiles.js';

function makeContext({
    mainApi = 'openai',
    disabled = false,
    profile = { id: 'guided', name: 'Guided', api: 'openrouter', model: 'model-b', preset: 'Guided Preset' },
    preset = { temperature: 0.7 },
} = {}) {
    const service = {
        getProfile: vi.fn(id => {
            if (id !== profile?.id) throw new Error('missing');
            return profile;
        }),
        getSupportedProfiles: vi.fn(() => profile ? [profile] : []),
        isProfileSupported: vi.fn(value => Boolean(value)),
        sendRequest: vi.fn(),
    };
    return {
        mainApi,
        extensionSettings: {
            disabledExtensions: disabled ? ['connection-manager'] : [],
            connectionManager: { selectedProfile: profile?.id ?? null },
        },
        CONNECT_API_MAP: {
            openrouter: { selected: 'openai', source: 'openrouter' },
            koboldcpp: { selected: 'textgenerationwebui', type: 'koboldcpp' },
        },
        ConnectionManagerRequestService: service,
        getPresetManager: vi.fn(() => ({ getCompletionPresetByName: vi.fn(() => preset) })),
    };
}

describe('guided profile validation', () => {
    it('validates a same-mode profile and its bound preset', () => {
        const context = makeContext();
        const result = validateGuidedProfile(context, 'guided');
        expect(result.mode).toBe(COMPLETION_MODES.CHAT);
        expect(result.profile.model).toBe('model-b');
        expect(context.getPresetManager).toHaveBeenCalledWith('openai');
    });

    it('resolves the current Connection Manager profile at validation time', () => {
        const context = makeContext();
        expect(resolveProfileId(context, CURRENT_PROFILE)).toBe('guided');
        expect(validateGuidedProfile(context, CURRENT_PROFILE).profileId).toBe('guided');

        context.extensionSettings.connectionManager.selectedProfile = null;
        expect(() => validateGuidedProfile(context, CURRENT_PROFILE))
            .toThrow(expect.objectContaining({ code: 'current_profile_required' }));
    });

    it.each([
        ['disabled manager', makeContext({ disabled: true }), 'guided', 'connection_manager_disabled'],
        ['missing selection', makeContext(), '', 'profile_required'],
        ['missing profile', makeContext({ profile: null }), 'deleted', 'profile_missing'],
        ['mode mismatch', makeContext({ mainApi: 'textgenerationwebui' }), 'guided', 'mode_mismatch'],
        ['missing preset', makeContext({ preset: null }), 'guided', 'preset_missing'],
        ['unbound preset', makeContext({ profile: { id: 'guided', name: 'Guided', api: 'openrouter', model: 'm', preset: '' } }), 'guided', 'preset_required'],
    ])('rejects %s', (_label, context, profileId, code) => {
        expect(() => validateGuidedProfile(context, profileId)).toThrow(expect.objectContaining({ code }));
    });

    it('rejects a profile the Connection Manager cannot request from', () => {
        const context = makeContext();
        context.ConnectionManagerRequestService.isProfileSupported.mockReturnValue(false);
        expect(() => validateGuidedProfile(context, 'guided')).toThrow(expect.objectContaining({ code: 'profile_unsupported' }));
    });

    it('sorts and describes supported profiles', () => {
        const context = makeContext();
        const profileA = { id: 'a', name: 'A', api: 'openrouter', model: 'one', preset: 'p1' };
        const profileZ = { id: 'z', name: 'Z', api: 'openrouter', model: 'two', preset: 'p2' };
        context.ConnectionManagerRequestService.getSupportedProfiles.mockReturnValue([profileZ, profileA]);
        expect(getSupportedProfiles(context).map(profile => profile.id)).toEqual(['a', 'z']);
        expect(describeProfile(context, profileA)).toMatchObject({ modeLabel: 'Chat Completion', preset: 'p1' });
    });
});
