// SPDX-License-Identifier: MIT

const PLACEHOLDER_PATTERN = /{{\s*([a-z][a-z0-9_]*)\s*}}/gi;

/**
 * Expands SillyTavern macros in a prompt before inserting protected values.
 * Macro-like text supplied through a protected placeholder remains literal.
 */
export function expandPromptTemplate(template, values = {}, substituteParams = value => value) {
    const normalizedValues = new Map(Object.entries(values).map(([key, value]) => [
        key.toLowerCase(),
        String(value ?? ''),
    ]));
    const replacements = [];
    const safeTemplate = String(template ?? '').replace(PLACEHOLDER_PATTERN, (match, key) => {
        const normalizedKey = key.toLowerCase();
        if (!normalizedValues.has(normalizedKey)) return match;
        const sentinel = `\uE000GUIDED_PROMPT_VALUE_${replacements.length}\uE001`;
        replacements.push([sentinel, normalizedValues.get(normalizedKey)]);
        return sentinel;
    });
    let expandedTemplate = String(substituteParams(safeTemplate) ?? safeTemplate);
    for (const [sentinel, value] of replacements) {
        expandedTemplate = expandedTemplate.replaceAll(sentinel, value);
    }
    return expandedTemplate;
}

/**
 * Expands SillyTavern macros in a prompt without evaluating macro-like text
 * supplied by the user in the composer.
 */
export function expandPrompt(template, input, substituteParams = value => value) {
    return expandPromptTemplate(template, { input }, substituteParams);
}
