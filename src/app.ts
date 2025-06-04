import { determineAppMode, AppMode } from './config';
import * as enclavedApp from './enclavedApp';
import * as masterExpressApp from './masterExpressApp';

/**
 * Main application entry point that determines the mode and starts the appropriate app
 */
export async function init(): Promise<void> {
  const appMode = determineAppMode();

  if (appMode === AppMode.ENCLAVED) {
    console.log('Starting in Enclaved mode...');
    await enclavedApp.init();
  } else if (appMode === AppMode.MASTER_EXPRESS) {
    console.log('Starting in Master Express mode...');
    await masterExpressApp.init();
  } else {
    throw new Error(`Unknown app mode: ${appMode}`);
  }
}

// Export the individual app modules for direct access if needed
export { enclavedApp, masterExpressApp };
