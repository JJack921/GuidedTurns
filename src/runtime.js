// SPDX-License-Identifier: MIT

import { GuidedActions } from './actions.js';
import {
    EXTENSION_DISPLAY_NAME,
    EXTENSION_LOG_PREFIX,
    EXTENSION_NAME,
    EXTENSION_TEMPLATE_PATH,
    SETTINGS_TEMPLATE_URL,
} from './constants.js';
import { initializeSettings } from './settings.js';
import { mountActionBar, mountSettingsUI } from './ui.js';

function createNotifier() {
    const call = (method, message) => {
        const toastr = globalThis.toastr;
        if (toastr?.[method]) toastr[method](message, EXTENSION_DISPLAY_NAME);
        else console[method === 'error' ? 'error' : 'log'](`${EXTENSION_LOG_PREFIX} ${message}`);
    };
    return {
        error: message => call('error', message),
        warning: message => call('warning', message),
        info: message => call('info', message),
        success: message => call('success', message),
    };
}

async function mountSettingsTemplate(context, document) {
    if (document.getElementById('gt-settings')) return;
    let html;
    if (typeof context.renderExtensionTemplateAsync === 'function') {
        html = await context.renderExtensionTemplateAsync(EXTENSION_TEMPLATE_PATH, 'settings');
    } else {
        const response = await fetch(SETTINGS_TEMPLATE_URL);
        if (!response.ok) throw new Error(`Could not load settings template (${response.status}).`);
        html = await response.text();
    }
    document.getElementById('extensions_settings')?.insertAdjacentHTML('beforeend', html);
}

function subscribe(eventSource, eventName, handler) {
    if (eventName) eventSource?.on?.(eventName, handler);
}

export async function initializeExtension({
    extensionSettings,
    saveSettings,
    core,
    getContext = () => globalThis.SillyTavern.getContext(),
    document = globalThis.document,
}) {
    const settings = initializeSettings(extensionSettings, EXTENSION_NAME);
    const context = getContext();
    await mountSettingsTemplate(context, document);

    const notify = createNotifier();
    let actionUi = null;
    let actions;

    const ensureActionUi = () => {
        actionUi = mountActionBar({
            document,
            onImpersonate: () => actions.impersonate(),
            onRestoreImpersonation: () => actions.restoreImpersonation(),
            onSwipe: () => actions.guidedSwipe(),
            onRevision: () => actions.guidedRevision(),
        }) || actionUi;
        actionUi?.updateState(actions.getState());
    };

    actions = new GuidedActions({
        getContext,
        getSettings: () => settings,
        getComposer: () => document.getElementById('send_textarea'),
        core,
        notify,
        onStateChange: state => actionUi?.updateState(state),
    });

    const settingsUi = mountSettingsUI({
        document,
        context,
        settings,
        saveSettings,
        onSettingsChanged: ensureActionUi,
    });

    ensureActionUi();
    const observer = new MutationObserver(() => {
        if (!document.getElementById('gt-action-bar') && document.getElementById('send_form')) ensureActionUi();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const { eventSource, eventTypes } = context;
    subscribe(eventSource, eventTypes?.GENERATION_STARTED, (_type, _options, dryRun) => {
        if (dryRun !== true && !actions.active) actions.setNativeBusy(true);
    });
    subscribe(eventSource, eventTypes?.GENERATION_ENDED, () => actions.setNativeBusy(false));
    subscribe(eventSource, eventTypes?.GENERATION_STOPPED, () => {
        actions.cancelActive();
        actions.setNativeBusy(false);
    });
    subscribe(eventSource, eventTypes?.CHAT_CHANGED, () => {
        actions.handleChatChanged();
        ensureActionUi();
    });
    subscribe(eventSource, eventTypes?.MESSAGE_SENT, () => actions.handleMessageSent());

    const refreshProfileEvents = [
        eventTypes?.CONNECTION_PROFILE_CREATED,
        eventTypes?.CONNECTION_PROFILE_UPDATED,
        eventTypes?.CONNECTION_PROFILE_DELETED,
        eventTypes?.CONNECTION_PROFILE_LOADED,
    ];
    for (const eventName of refreshProfileEvents) {
        subscribe(eventSource, eventName, settingsUi.refreshProfiles);
    }

    console.info(`${EXTENSION_LOG_PREFIX} Extension initialized.`);
    return { actions, settings, observer };
}
