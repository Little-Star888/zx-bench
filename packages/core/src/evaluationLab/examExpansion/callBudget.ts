import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const MODEL_CALL_LIMIT = 16;
/** Reserve BEFORE the request. Errors/stops consume their slot too; no free retries.
 * All exports of this version share the same directory in the CLI.
 * Exclusive creation also makes concurrent runners obey the combined limit.
 */
export function reserveModelCall(directory: string, metadata: Record<string, unknown>): number {
  mkdirSync(directory, { recursive: true });
  for (let i = 1; i <= MODEL_CALL_LIMIT; i++) {
    try {
      writeFileSync(join(directory, `${String(i).padStart(2, '0')}.json`), JSON.stringify({ ...metadata, reservedAt: new Date().toISOString() }) + '\n', { flag: 'wx' });
      return i;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }
  throw new Error('The shared 16-call screening budget is exhausted; no model request sent.');
}
export function remainingModelCalls(directory: string) {
  return Array.from({ length: MODEL_CALL_LIMIT }, (_, i) => join(directory, `${String(i + 1).padStart(2, '0')}.json`)).filter(p => !existsSync(p)).length;
}
