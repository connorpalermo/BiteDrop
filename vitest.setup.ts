import path from 'node:path';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: path.join(import.meta.dirname, '.env.local'), quiet: true });
