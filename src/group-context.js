// SPDX-License-Identifier: MIT

import { GuidedError } from './errors.js';

function sameIdentity(left, right) {
    const normalize = value => value === undefined || value === null || value === '' ? null : String(value);
    return normalize(left) === normalize(right);
}

function getGroupId(context) {
    return context?.groupId ?? null;
}

function getGroup(context) {
    const groupId = getGroupId(context);
    const groups = Array.isArray(context?.groups) ? context.groups : [];
    const group = groups.find(item => sameIdentity(item?.id, groupId));
    if (group) return group;

    if (context?.group && sameIdentity(context.group.id, groupId)) return context.group;
    return null;
}

function getCharacters(context) {
    return Array.isArray(context?.characters) ? context.characters : [];
}

function getMemberLookupValues(member) {
    if (member && typeof member === 'object') {
        return [member.avatar, member.name, member.id].filter(value => value !== undefined && value !== null);
    }
    return [member];
}

function findMemberCharacter(context, member) {
    const characters = getCharacters(context);
    const lookupValues = getMemberLookupValues(member);
    const avatarMatches = characters.filter(character => lookupValues.some(value => value === character?.avatar));
    if (avatarMatches.length === 1) return avatarMatches[0];
    if (avatarMatches.length > 1) return null;

    const nameMatches = characters.filter(character => lookupValues.some(value => value === character?.name));
    return nameMatches.length === 1 ? nameMatches[0] : null;
}

function createMemberRecord(context, member, index, group) {
    const character = findMemberCharacter(context, member);
    if (!character) return null;

    const id = getCharacters(context).indexOf(character);
    if (id < 0 || character.avatar === undefined || character.avatar === null || !String(character.name ?? '').trim()) {
        return null;
    }

    return {
        group,
        member,
        memberIndex: index,
        character,
        id,
        avatar: character.avatar,
        name: String(character.name),
    };
}

function getMemberRecords(context, group = getGroup(context)) {
    if (!group || !Array.isArray(group.members)) return [];
    return group.members
        .map((member, index) => createMemberRecord(context, member, index, group))
        .filter(Boolean);
}

function getSpeakerAvatar(message) {
    const value = message?.original_avatar;
    if (value === undefined || value === null || String(value).trim() === '') return null;
    return String(value);
}

function throwSpeakerError(code, message) {
    throw new GuidedError(message, { code });
}

export function isGroupChat(context) {
    const groupId = getGroupId(context);
    return groupId !== null && groupId !== undefined && String(groupId).trim() !== '';
}

export function resolveGroupSpeaker(context, message) {
    const group = getGroup(context);
    if (!group || !Array.isArray(group.members)) {
        throwSpeakerError('group_missing', 'The active group could not be resolved. Reload the group chat and try again.');
    }

    const records = getMemberRecords(context, group);
    const sourceAvatar = getSpeakerAvatar(message);
    if (sourceAvatar) {
        const matches = records.filter(record => String(record.avatar) === sourceAvatar || String(record.member) === sourceAvatar);
        if (matches.length === 1) return matches[0];
        if (matches.length > 1) {
            throwSpeakerError('group_speaker_ambiguous', 'The last group response has an ambiguous speaker.');
        }
        throwSpeakerError('group_speaker_deleted', 'The last group response speaker is missing from this group or has been deleted.');
    }

    const sourceName = String(message?.name ?? '').trim();
    if (!sourceName) {
        throwSpeakerError('group_speaker_missing', 'The last group response does not identify a group speaker.');
    }

    const matches = records.filter(record => record.name === sourceName);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
        throwSpeakerError('group_speaker_ambiguous', `The last group response's speaker name “${sourceName}” matches multiple group members.`);
    }
    throwSpeakerError('group_speaker_missing', `The last group response's speaker “${sourceName}” is not a valid group member.`);
}

function tryResolveGroupSpeaker(context, message) {
    try {
        return resolveGroupSpeaker(context, message);
    } catch {
        return null;
    }
}

function targetFromRecord(record, sourceMessage = null, sourceMessageIndex = null) {
    return {
        ...record,
        sourceMessage,
        sourceMessageIndex,
    };
}

export function resolveGroupPromptTarget(context, { kind, message } = {}) {
    if (!isGroupChat(context)) return null;

    const group = getGroup(context);
    if (!group || !Array.isArray(group.members)) {
        throwSpeakerError('group_missing', 'The active group could not be resolved. Reload the group chat and try again.');
    }

    if (kind === 'assistant') return targetFromRecord(resolveGroupSpeaker(context, message), message);

    if (kind !== 'impersonate') {
        throw new GuidedError('This guided action does not support group chats.', { code: 'group_action_unsupported' });
    }

    const chat = Array.isArray(context.chat) ? context.chat : [];
    for (let index = chat.length - 1; index >= 0; index -= 1) {
        const candidate = chat[index];
        if (!candidate || candidate.is_user || candidate.is_system) continue;
        const speaker = tryResolveGroupSpeaker(context, candidate);
        if (speaker) return targetFromRecord(speaker, candidate, index);
    }

    const records = getMemberRecords(context, group);
    const enabled = records.find(record => !Array.isArray(group.disabled_members) || !group.disabled_members.some(member => memberMatchesRecord(context, member, record)));
    if (enabled) return targetFromRecord(enabled);
    if (records[0]) return targetFromRecord(records[0]);

    throwSpeakerError('group_target_missing', 'The active group has no valid character to use for the guided prompt.');
}

function memberMatchesRecord(context, member, record) {
    if (record.member !== undefined && (member === record.member || String(member) === String(record.member))) return true;
    const character = findMemberCharacter(context, member);
    if (!character) return false;
    return character === record.character ||
        (record.avatar !== undefined && character.avatar === record.avatar) ||
        (record.name !== undefined && character.name === record.name);
}

export function createGroupActionScope({ context, target, core, getContext = () => context } = {}) {
    if (!target || !isGroupChat(context)) {
        return {
            ensureTarget() {},
            restore() {},
        };
    }

    const previousCharacterId = context?.characterId;
    const previousCharacterName = context?.name2;
    const originalGroupId = getGroupId(context);
    const setCharacterId = core?.setCharacterId;
    const setCharacterName = core?.setCharacterName;
    let restored = false;

    const ensureTarget = () => {
        if (typeof setCharacterId === 'function') setCharacterId(target.id);
        if (typeof setCharacterName === 'function') setCharacterName(target.name);
    };

    ensureTarget();

    return {
        ensureTarget,
        restore() {
            if (restored) return;
            restored = true;
            if (!sameIdentity(getGroupId(getContext()), originalGroupId)) return;
            if (typeof setCharacterId === 'function') setCharacterId(previousCharacterId);
            if (typeof setCharacterName === 'function') setCharacterName(previousCharacterName);
        },
    };
}

export function prepareGroupPromptContext({ context, target } = {}) {
    if (!target || !isGroupChat(context)) return { restore() {} };

    const group = getGroup(context);
    if (!group || !Array.isArray(group.members)) {
        throwSpeakerError('group_missing', 'The active group could not be resolved. Reload the group chat and try again.');
    }

    const originalMembers = group.members.slice();
    const originalDisabledMembers = Array.isArray(group.disabled_members) ? group.disabled_members.slice() : null;
    let targetIndex = target.memberIndex ?? -1;
    if (targetIndex >= 0 && targetIndex < originalMembers.length && !memberMatchesRecord(context, originalMembers[targetIndex], target)) {
        targetIndex = -1;
    }
    if (targetIndex < 0) {
        targetIndex = originalMembers.findIndex(member => memberMatchesRecord(context, member, target));
    }
    if (targetIndex < 0 || targetIndex >= originalMembers.length) {
        throwSpeakerError('group_target_missing', 'The guided group target is no longer available.');
    }

    const targetMember = originalMembers[targetIndex];
    group.members.splice(0, group.members.length, targetMember, ...originalMembers.filter((_member, index) => index !== targetIndex));
    if (originalDisabledMembers) {
        group.disabled_members.splice(
            0,
            group.disabled_members.length,
            ...originalDisabledMembers.filter(member => !memberMatchesRecord(context, member, target)),
        );
    }

    let restored = false;
    return {
        restore() {
            if (restored) return;
            restored = true;
            group.members.splice(0, group.members.length, ...originalMembers);
            if (originalDisabledMembers) {
                group.disabled_members.splice(0, group.disabled_members.length, ...originalDisabledMembers);
            }
        },
    };
}

export function groupIdentity(context) {
    return getGroupId(context);
}

export function sameGroupIdentity(left, right) {
    return sameIdentity(left, right);
}
