# Guided Turns

Guided Turns gives you precise, profile-aware control over the next turn in a SillyTavern role-play. Draft the user’s response from an outline, regenerate an assistant reply with direction, or revise the latest reply without continuing the scene.

It adds three focused actions beside the composer:

- **Guided Impersonation** turns an optional outline into a complete user message, ready for review before sending.
- **Guided Swipe** streams a new Swipe for the latest assistant response, optionally following guidance from the composer.
- **Guided Revision** rewrites the latest assistant response according to a specific correction while preserving everything else.

Each action can use the active Connection Manager profile or its own dedicated profile and preset.

![Guided Turns action bar with Guided Impersonation, Guided Swipe, and Guided Revision](docs/screenshots/guided-turns-action-bar.jpg)

## Requirements

- SillyTavern **1.18.0 or newer**.
- The built-in **Connection Manager** extension enabled.
- A Connection Manager profile with a bound generation preset.
- A **single-character chat**. Group chats are not supported yet.

The selected guided profile must use the same completion mode as the current chat: Chat Completion profiles for Chat Completion chats, and Text Completion profiles for Text Completion chats.

## Installation

In SillyTavern, open **Extensions → Install extension**, then paste:

```text
https://github.com/JJack921/GuidedTurns
```

Reload SillyTavern after installation.

For a manual development install, clone or symlink the repository to:

```text
SillyTavern/public/scripts/extensions/third-party/guided-turns
```

## Configuration

Open **Extensions → Guided Turns**.

1. Choose a profile for Guided Impersonation, Guided Swipe, and Guided Revision. Leave an action on **Use current Connection Manager profile** if it should follow the active profile.
2. Choose first-, second-, or third-person narration for Guided Impersonation.
3. Optionally open **Advanced prompts** to customize any action prompt. Each prompt has its own reset button, and **Reset All** restores every default.

Profile summaries show the resolved profile, completion mode, API, model, and preset. Missing, unsupported, or disabled profiles are reported before generation begins.

## Usage

### Guided Impersonation

Write a short outline in the composer, such as:

```text
hesitates, admits she found the letter, then asks him to explain
```

Select **Guided Impersonation**. The generated user turn replaces the outline in the composer, where you can edit or send it normally.

You may also leave the composer empty. In that case, Guided Turns asks the model for one natural next user turn based on the current scene and persona. Use **Restore Outline** to recover the previous composer text after a successful impersonation. The restore option is cleared when you send a message or switch chats.

### Guided Swipe

Put optional direction in the composer:

```text
make the response more guarded and reveal less
```

Select **Guided Swipe**. Guided Turns creates and streams a new Swipe for the latest assistant response. With an empty composer, it performs an unguided regeneration through the selected profile.

### Guided Revision

Write a concrete edit request:

```text
keep the dialogue, but change the narration to past tense
```

Select **Guided Revision**. The latest assistant response is supplied to the revision prompt and the replacement streams into a new Swipe. The composer instruction is required and is not cleared.

## Profiles, prompts, and perspectives

The three actions have independent profile settings. A dedicated profile is useful when you want a smaller model for drafting, a more precise model for revision, or different presets for user and assistant turns. Guided Turns uses the resolved profile's bound preset both to assemble the prompt (including its system-prompt templates and prompt order) and to set generation parameters. It restores the active SillyTavern preset settings immediately after prompt assembly, without changing the visible preset selection. **Use current** resolves the Connection Manager selection when the action starts and uses that profile's bound preset in the same way.

Guided Impersonation supports:

- **First person** — uses I/me/my.
- **Second person** — uses you/your.
- **Third person** — uses the user persona’s name and pronouns.

Advanced prompts support standard SillyTavern macros. `{{input}}` represents composer guidance; Guided Revision also provides `{{message}}`, the assistant response being edited. The empty-input impersonation prompt is inserted as `{{input}}` when no outline is supplied.

## Cancellation and failure behavior

While an action is running, its button becomes an obvious cancel control. Select it again to stop generation.

- A cancelled Guided Impersonation leaves the composer unchanged.
- A Swipe or Revision with partial streamed output keeps that partial result as an interrupted Swipe.
- A Swipe or Revision cancelled before any output rolls back cleanly.
- Results are rejected if the chat, composer, source message, or selected Swipe changes while generation is running.
- Guided actions do not start during a native SillyTavern generation.

These safeguards are designed to avoid silently applying output to the wrong chat or message.

## Troubleshooting

**The profile is missing or unavailable**

Open Connection Manager and confirm that the selected profile still exists and that Connection Manager is enabled.

**The profile has no preset**

Edit the Connection Manager profile and bind a generation preset. Guided Turns uses the profile's preset prompt templates while assembling the request and includes its generation preset and instruct settings when sending it.

**The completion modes do not match**

Choose a Chat Completion profile for an OpenAI-compatible chat, or a Text Completion profile for a Text Completion chat.

**Guided Swipe or Revision is unavailable**

The latest message must be a swipeable assistant response, and native Swipe controls must currently be available.

**A group chat is rejected**

Group support is under investigation. Native group generation depends on active-speaker and prompt-routing behavior that independent guided profiles do not currently reproduce safely.

## Development

This is a native browser ES-module extension with no build step or runtime dependency bundle.

```bash
npm install
npm test
npm run test:watch
```

Tests use Vitest and jsdom. For manual validation, install the working tree under the `guided-turns` extension path, reload SillyTavern, and verify both Chat Completion and Text Completion profiles at desktop and narrow widths.

## License and attribution

Guided Turns is available under the [MIT License](LICENSE).

The extension was behaviorally inspired by [GuidedGenerations](https://github.com/Samueras/GuidedGenerations-Extension). Guided Turns is an independent implementation with its own architecture and source code.
