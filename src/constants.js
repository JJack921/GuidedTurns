// SPDX-License-Identifier: MIT

export const EXTENSION_NAME = 'guided-turns';
export const EXTENSION_DISPLAY_NAME = 'Guided Turns';
export const EXTENSION_LOG_PREFIX = `[${EXTENSION_DISPLAY_NAME}]`;

export function resolveExtensionLocation(moduleUrl) {
    const rootUrl = new URL('../', moduleUrl);
    const directory = decodeURIComponent(rootUrl.pathname.split('/').filter(Boolean).at(-1));
    return {
        directory,
        templatePath: `third-party/${directory}`,
        settingsTemplateUrl: new URL('settings.html', rootUrl).href,
    };
}

const extensionLocation = resolveExtensionLocation(import.meta.url);
export const EXTENSION_DIRECTORY = extensionLocation.directory;
export const EXTENSION_TEMPLATE_PATH = extensionLocation.templatePath;
export const SETTINGS_TEMPLATE_URL = extensionLocation.settingsTemplateUrl;
export const PROMPT_CAPTURE_TIMEOUT_MS = 30_000;
export const CURRENT_PROFILE = '__current__';

export const PERSPECTIVES = Object.freeze({
    FIRST: 'first',
    SECOND: 'second',
    THIRD: 'third',
});

function createImpersonationPrompt(perspectiveRule) {
    return [
        'Draft exactly one role-play message for {{user}}.',
        '',
        perspectiveRule,
        '',
        'Write only {{user}}\'s dialogue, thoughts, perceptions, and intentional actions. Do not write dialogue, thoughts, actions, reactions, decisions, or outcomes for {{char}} or any other character. Do not continue the scene beyond {{user}}\'s turn; leave other characters free to respond.',
        '',
        'Use the current conversation only as context. Follow the outline below while remaining consistent with established facts and {{user}}\'s persona.',
        '',
        '<outline>',
        '{{input}}',
        '</outline>',
        '',
        'Return only the role-play message body. Do not include a speaker label, analysis, commentary, OOC text, headings, choices, summaries, status blocks, trackers, statistics, inventories, metadata, or code fences. Do not wrap the entire response in quotation marks.',
    ].join('\n');
}

export const DEFAULT_PROMPTS = Object.freeze({
    impersonateFirst: createImpersonationPrompt(
        'Narrate {{user}}\'s actions, thoughts, and perceptions in first person using I/me/my.',
    ),
    impersonateSecond: createImpersonationPrompt(
        'Narrate {{user}}\'s actions, thoughts, and perceptions in second person using you/your.',
    ),
    impersonateThird: createImpersonationPrompt(
        'Narrate {{user}}\'s actions, thoughts, and perceptions in third person using {{user}}\'s appropriate name and pronouns.',
    ),
    impersonateEmpty: 'No outline was provided. Infer one natural next turn for {{user}} from the current scene, persona, goals, and relationship dynamics. Prefer a grounded reaction, action, statement, or question that gives the other characters room to respond. Do not control another character, resolve their response, introduce unsupported facts, or advance the scene beyond {{user}}\'s turn.',
    guidedSwipe: [
        'Regenerate the last assistant response while following this guidance:',
        '',
        '{{input}}',
        '',
        'Return only the replacement response.',
    ].join('\n'),
    guidedRevision: [
        'Revise the assistant response below according to the requested changes.',
        'Preserve its wording, tone, structure, details, and intent wherever the request does not require a change. Do not continue the scene beyond the original response.',
        '',
        '<response>',
        '{{message}}',
        '</response>',
        '',
        '<requested_changes>',
        '{{input}}',
        '</requested_changes>',
        '',
        'Return only the revised replacement response. Do not include analysis, commentary, labels, or code fences.',
    ].join('\n'),
});

export const PERSPECTIVE_PROMPT_KEYS = Object.freeze({
    [PERSPECTIVES.FIRST]: 'impersonateFirst',
    [PERSPECTIVES.SECOND]: 'impersonateSecond',
    [PERSPECTIVES.THIRD]: 'impersonateThird',
});

export const DEFAULT_SETTINGS = Object.freeze({
    debugMode: false,
    profileIds: Object.freeze({
        impersonate: CURRENT_PROFILE,
        swipe: CURRENT_PROFILE,
        revision: CURRENT_PROFILE,
    }),
    perspective: PERSPECTIVES.FIRST,
    prompts: DEFAULT_PROMPTS,
});
