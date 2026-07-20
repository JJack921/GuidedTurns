// SPDX-License-Identifier: MIT

import { CURRENT_PROFILE, DEFAULT_PROMPTS, EXTENSION_DISPLAY_NAME } from './constants.js';
import { describeProfile, getSupportedProfiles, isConnectionManagerDisabled } from './profiles.js';
import { resetAllPrompts, resetPrompt } from './settings.js';

function option(document, value, label) {
    const element = document.createElement('option');
    element.value = value;
    element.textContent = label;
    return element;
}

export function mountSettingsUI({ document, context, settings, saveSettings, onSettingsChanged = () => {} }) {
    const root = document.getElementById('gt-settings');
    if (!root) throw new Error(`${EXTENSION_DISPLAY_NAME} settings template was not mounted.`);

    const profileSelects = [...root.querySelectorAll('select[data-profile-kind]')];
    const perspectiveSelect = root.querySelector('#gt-perspective');
    const debugModeToggle = root.querySelector('#gt-debug-mode');

    const updateProfileSummary = (profileKind, profiles) => {
        const profileSelect = root.querySelector(`select[data-profile-kind="${profileKind}"]`);
        const profileSummary = root.querySelector(`#${profileSelect.id}-summary`);
        profileSummary.classList.remove('gt-error');
        if (isConnectionManagerDisabled(context)) {
            profileSummary.textContent = 'Connection Manager is disabled.';
            profileSummary.classList.add('gt-error');
            return;
        }
        const configuredProfileId = settings.profileIds[profileKind];
        let resolvedProfileId = configuredProfileId;
        let prefix = '';
        if (configuredProfileId === CURRENT_PROFILE) {
            resolvedProfileId = context?.extensionSettings?.connectionManager?.selectedProfile;
            prefix = 'Current: ';
            if (!resolvedProfileId) {
                profileSummary.textContent = 'No Connection Manager profile is currently selected.';
                profileSummary.classList.add('gt-error');
                return;
            }
        }
        const profile = profiles.find(entry => entry.id === resolvedProfileId);
        if (!profile) {
            profileSummary.textContent = configuredProfileId === CURRENT_PROFILE
                ? 'The current Connection Manager profile is unavailable or unsupported.'
                : 'The saved profile no longer exists. Choose another profile.';
            profileSummary.classList.add('gt-error');
            return;
        }
        const info = describeProfile(context, profile);
        profileSummary.textContent = `${prefix}${info.name} · ${info.modeLabel} · ${info.api} · ${info.model} · Preset: ${info.preset}`;
    };

    const refreshProfiles = () => {
        const profiles = getSupportedProfiles(context);
        for (const profileSelect of profileSelects) {
            const profileKind = profileSelect.dataset.profileKind;
            const configuredProfileId = settings.profileIds[profileKind];
            profileSelect.replaceChildren(option(document, CURRENT_PROFILE, 'Use current Connection Manager profile'));
            for (const profile of profiles) {
                const info = describeProfile(context, profile);
                profileSelect.append(option(document, profile.id, `${info.name} — ${info.modeLabel} · ${info.model} · ${info.preset}`));
            }
            if (configuredProfileId !== CURRENT_PROFILE && !profiles.some(profile => profile.id === configuredProfileId)) {
                const missing = option(document, configuredProfileId, 'Missing saved profile');
                missing.disabled = true;
                profileSelect.append(missing);
            }
            profileSelect.value = configuredProfileId;
            profileSelect.disabled = isConnectionManagerDisabled(context);
            updateProfileSummary(profileKind, profiles);
        }
    };

    for (const profileSelect of profileSelects) {
        profileSelect.addEventListener('change', () => {
            settings.profileIds[profileSelect.dataset.profileKind] = profileSelect.value;
            saveSettings();
            refreshProfiles();
            onSettingsChanged();
        });
    }

    perspectiveSelect.value = settings.perspective;
    perspectiveSelect.addEventListener('change', () => {
        settings.perspective = perspectiveSelect.value;
        saveSettings();
        onSettingsChanged();
    });

    debugModeToggle.checked = settings.debugMode;
    debugModeToggle.addEventListener('change', () => {
        settings.debugMode = debugModeToggle.checked;
        saveSettings();
    });

    for (const textarea of root.querySelectorAll('textarea[data-prompt-key]')) {
        const promptKey = textarea.dataset.promptKey;
        textarea.value = settings.prompts[promptKey];
        textarea.addEventListener('input', () => {
            settings.prompts[promptKey] = textarea.value;
            saveSettings();
        });
    }

    for (const button of root.querySelectorAll('.gt-reset-prompt')) {
        button.addEventListener('click', () => {
            const promptKey = button.dataset.promptKey;
            const value = resetPrompt(settings, promptKey);
            root.querySelector(`textarea[data-prompt-key="${promptKey}"]`).value = value;
            saveSettings();
        });
    }

    root.querySelector('#gt-reset-all-prompts').addEventListener('click', () => {
        if (!globalThis.confirm(`Reset all ${EXTENSION_DISPLAY_NAME} prompts to their defaults?`)) return;
        resetAllPrompts(settings);
        for (const [promptKey, value] of Object.entries(DEFAULT_PROMPTS)) {
            root.querySelector(`textarea[data-prompt-key="${promptKey}"]`).value = value;
        }
        saveSettings();
    });

    refreshProfiles();
    return { refreshProfiles };
}

function setButtonContent(button, iconClass, label) {
    button.replaceChildren();
    const icon = button.ownerDocument.createElement('i');
    icon.className = iconClass;
    icon.setAttribute('aria-hidden', 'true');
    const text = button.ownerDocument.createElement('span');
    text.textContent = label;
    button.append(icon, text);
    button.setAttribute('aria-label', label);
}

export function mountActionBar({ document, onImpersonate, onRestoreImpersonation, onSwipe, onRevision }) {
    const sendForm = document.getElementById('send_form');
    if (!sendForm) return null;

    let bar = document.getElementById('gt-action-bar');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'gt-action-bar';
        bar.setAttribute('role', 'group');
        bar.setAttribute('aria-label', `${EXTENSION_DISPLAY_NAME} actions`);
        const anchor = document.getElementById('nonQRFormItems');
        if (anchor?.parentNode) {
            anchor.parentNode.insertBefore(bar, anchor.nextSibling);
        } else {
            sendForm.append(bar);
        }
    }

    const ensureButton = (id, title) => {
        let button = document.getElementById(id);
        if (!button) {
            button = document.createElement('button');
            button.id = id;
            button.type = 'button';
            button.className = 'menu_button interactable gt-action-button';
            button.title = title;
            bar.append(button);
        }
        return button;
    };

    const impersonateButton = ensureButton('gt-impersonate', 'Generate a user message from an optional composer outline');
    const swipeButton = ensureButton('gt-swipe', 'Regenerate the last assistant response with optional guidance');
    const revisionButton = ensureButton('gt-revision', 'Revise the last assistant response using the composer instruction');
    const restoreButton = ensureButton('gt-restore-impersonation', 'Restore the composer outline from before the last impersonation');
    restoreButton.classList.add('gt-action-button--tertiary');
    bar.append(impersonateButton, swipeButton, revisionButton, restoreButton);
    impersonateButton.onclick = onImpersonate;
    restoreButton.onclick = onRestoreImpersonation;
    swipeButton.onclick = onSwipe;
    revisionButton.onclick = onRevision;
    setButtonContent(restoreButton, 'fa-solid fa-rotate-left', 'Restore Outline');

    const updateState = ({ activeKind = null, canRestoreImpersonation = false, nativeBusy = false } = {}) => {
        const impersonating = activeKind === 'impersonate';
        const swiping = activeKind === 'swipe';
        const revising = activeKind === 'revision';
        impersonateButton.disabled = nativeBusy || swiping || revising;
        restoreButton.disabled = nativeBusy || Boolean(activeKind);
        restoreButton.hidden = !canRestoreImpersonation;
        swipeButton.disabled = nativeBusy || impersonating || revising;
        revisionButton.disabled = nativeBusy || impersonating || swiping;
        impersonateButton.setAttribute('aria-busy', String(impersonating));
        swipeButton.setAttribute('aria-busy', String(swiping));
        revisionButton.setAttribute('aria-busy', String(revising));
        impersonateButton.classList.toggle('gt-is-cancelling', impersonating);
        swipeButton.classList.toggle('gt-is-cancelling', swiping);
        revisionButton.classList.toggle('gt-is-cancelling', revising);
        setButtonContent(
            impersonateButton,
            impersonating ? 'fa-solid fa-xmark' : 'fa-solid fa-user-pen',
            impersonating ? 'Cancel Impersonation' : 'Guided Impersonation',
        );
        setButtonContent(
            swipeButton,
            swiping ? 'fa-solid fa-xmark' : 'fa-solid fa-forward',
            swiping ? 'Cancel Swipe' : 'Guided Swipe',
        );
        setButtonContent(
            revisionButton,
            revising ? 'fa-solid fa-xmark' : 'fa-solid fa-pen-to-square',
            revising ? 'Cancel Revision' : 'Guided Revision',
        );
    };

    updateState();
    return { updateState };
}
