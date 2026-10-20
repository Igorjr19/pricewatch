import { type Command, ConfigError, loadConfig } from '../config/config.js';

/** REQ-CFG-002: list every invalid variable and exit 1. */
export function loadConfigOrExit(command: Command) {
  try {
    return loadConfig(process.env, command);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}
