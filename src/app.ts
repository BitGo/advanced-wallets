import { config, isEnclavedConfig, isMasterExpressConfig } from './config';
import * as enclavedApp from './enclavedApp';
import * as masterExpressApp from './masterExpressApp';

/**
 * Main application entry point that determines the mode and starts the appropriate app
 */
export async function init(): Promise<void> {
  const cfg = config();

  if (isEnclavedConfig(cfg)) {
    console.log('Starting in Enclaved mode...');
    await enclavedApp.init();
  } else if (isMasterExpressConfig(cfg)) {
    console.log('Starting in Master Express mode...');
    await masterExpressApp.init();
  } else {
    throw new Error(`Unknown app mode: ${(cfg as any).appMode}`);
  }
}

// Export the individual app modules for direct access if needed
export { enclavedApp, masterExpressApp };
