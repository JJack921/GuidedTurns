// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';
import { expandPrompt, expandPromptTemplate } from '../src/prompts.js';

describe('expandPrompt', () => {
    it('expands SillyTavern macros before inserting user input', () => {
        const substituteParams = vi.fn(value => value.replace('{{user}}', 'Alice').replace('{{char}}', 'Bryn'));
        const result = expandPrompt(
            '{{user}} answers {{char}}: {{input}} / {{input}}',
            'Keep {{user}} literal',
            substituteParams,
        );
        expect(result).toBe('Alice answers Bryn: Keep {{user}} literal / Keep {{user}} literal');
        expect(substituteParams.mock.calls[0][0]).not.toContain('Keep {{user}} literal');
    });

    it('accepts whitespace and case variants of the input placeholder', () => {
        expect(expandPrompt('A {{ INPUT }} B', 'value')).toBe('A value B');
    });

    it('protects multiple inserted values from SillyTavern macro expansion', () => {
        const substituteParams = vi.fn(value => value
            .replaceAll('{{user}}', 'Alice')
            .replaceAll('{{char}}', 'Bryn'));
        const result = expandPromptTemplate(
            '{{user}} revises <response>{{ MESSAGE }}</response> using <request>{{input}}</request>',
            {
                message: 'Keep {{char}} and {{user}} literal.',
                input: 'Only change {{char}}.',
            },
            substituteParams,
        );

        expect(result).toBe('Alice revises <response>Keep {{char}} and {{user}} literal.</response> using <request>Only change {{char}}.</request>');
        expect(substituteParams.mock.calls[0][0]).not.toContain('Keep {{char}}');
        expect(substituteParams.mock.calls[0][0]).not.toContain('Only change {{char}}');
    });
});
