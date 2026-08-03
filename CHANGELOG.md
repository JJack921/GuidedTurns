# Changelog

All notable changes to Guided Turns are documented here.

## [0.6.2] - 2026-08-03

### Added

- Add a Guided Revision setting that can omit earlier chat history while retaining the response being revised and the usual preset context.

### Fixed

- Fall back to the active SillyTavern preset when **Use current Connection Manager profile** resolves to a profile without a bound preset.
- Keep the literal `{{user}}` and `{{char}}` examples in Advanced prompts help text from being expanded by SillyTavern.

## [0.6.1] - 2026-08-02

### Fixed

- Display the mobile action bar as a compact, single-row set of icon-only buttons while preserving accessible action labels.

## [0.6.0] - 2026-08-02

### Added

- Group-chat support for Guided Impersonation, Guided Swipe, and Guided Revision.
- Safe group-speaker resolution for recorded avatars and unambiguous legacy speaker names.

## [0.5.3] - 2026-08-01

### Fixed

- Assemble Guided Impersonation, Guided Swipe, and Guided Revision prompts with the resolved Connection Manager profile's bound preset, instead of combining that profile's generation parameters with the currently selected SillyTavern preset's system prompts.
- Restore live Chat Completion or Text Completion settings after prompt capture succeeds, fails, or is cancelled, without changing the visible preset selection.

## [0.5.2] - 2026-07-20

### Added

- First public version.

## [0.5.1] - 2026-07-20

### Fixed

- Resolve the settings template from the extension's actual installation directory instead of assuming the directory matches the `guided-turns` settings namespace.
- Support installations from the existing `guided-impersonation` repository name, the future `guided-turns` name, and renamed forks without template-loading errors.

## [0.5.0] - 2026-07-20

### Added

- Guided Revision for targeted rewrites of the latest assistant response.
- Independent Connection Manager profiles for impersonation, swipes, and revisions.
- A responsive action group with accessible cancel and busy states.
- Per-prompt resets and a collapsed Advanced prompts settings drawer.
- Automated tests on GitHub Actions.

### Changed

- Renamed the extension from Guided Impersonation to Guided Turns.
- Kept Guided Impersonation, Guided Swipe, Guided Revision, and Restore Outline as action names.
- Replaced the legacy settings namespace with the clean `guided-turns` schema.
- Refreshed settings, profile summaries, documentation, and publication metadata.
- Changed the project license to MIT.

### Known limitations

- Existing `guided-impersonation` installations and settings are not migrated; reinstall Guided Turns as a new extension.
