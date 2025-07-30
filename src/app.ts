import { determineAppMode } from './initConfig';
import { AppMode } from './shared/types';
import * as advancedWalletManagerApp from './advancedWalletManagerApp';
import * as masterExpressApp from './masterExpressApp';
import logger from './logger';

/**
 * Main application entry point that determines the mode and starts the appropriate app
 */
export async function init(): Promise<void> {
  const appMode = determineAppMode();

  if (appMode === AppMode.ADVANCED_WALLET_MANAGER) {
    logger.info('Starting in Enclaved mode...');
    await advancedWalletManagerApp.init();
  } else if (appMode === AppMode.MASTER_EXPRESS) {
    logger.info('Starting in Master Express mode...');
    await masterExpressApp.init();
  } else {
    throw new Error(`Unknown app mode: ${appMode}`);
  }
}

// Export the individual app modules for direct access if needed
export { advancedWalletManagerApp, masterExpressApp };
