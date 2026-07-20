// SPDX-License-Identifier: MIT

import { extension_settings } from '../../../extensions.js';
import {
    addOneMessage,
    cleanUpMessage,
    ensureSwipes,
    getStoppingStrings,
    saveSettingsDebounced,
    syncMesToSwipe,
} from '../../../../script.js';
import { ReasoningHandler } from '../../../reasoning.js';
import { EXTENSION_DISPLAY_NAME, EXTENSION_LOG_PREFIX } from './src/constants.js';
import { initializeExtension } from './src/runtime.js';

async function init() {
    try {
        await initializeExtension({
            extensionSettings: extension_settings,
            saveSettings: saveSettingsDebounced,
            core: {
                addOneMessage,
                cleanUpMessage,
                ensureSwipes,
                getStoppingStrings,
                ReasoningHandler,
                syncMesToSwipe,
            },
        });
    } catch (error) {
        console.error(`${EXTENSION_LOG_PREFIX} Failed to initialize.`, error);
        globalThis.toastr?.error?.('The extension failed to initialize. Check the browser console.', EXTENSION_DISPLAY_NAME);
    }
}

if (typeof globalThis.jQuery === 'function') {
    globalThis.jQuery(init);
} else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
    init();
}
