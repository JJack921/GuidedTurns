# Changelog

All notable changes to Guided Turns are documented here.

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

- Guided actions support single-character chats only. Group-chat behavior remains under investigation.
- Existing `guided-impersonation` installations and settings are not migrated; reinstall Guided Turns as a new extension.
