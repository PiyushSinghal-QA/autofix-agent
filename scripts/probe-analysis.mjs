// Quick offline check of AnalysisService mapping (no server). Uses the built dist.
import { AnalysisService } from '../dist/analysis/analysis.service.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const bugs = JSON.parse(readFileSync(join(root, '..', '..', 'checkout-service', 'bugs', 'registry.json'), 'utf8')).bugs;
const stub = { repository: 'checkout-service', list: () => bugs };

const a = new AnalysisService(stub);
const r = a.ingest({
  suite: 'checkout-e2e',
  failures: ['applies 20% VAT to the taxable total', 'returns 404 when the cart does not exist', 'totally unknown test'],
  stats: { passed: 5, failed: 3, total: 8 },
});
console.log('\nSUMMARY :', r.summary);
console.log('DETECTED:', r.detected.map((d) => `${d.bugId}[${d.severity}]`).join(', '));
console.log('UNMAPPED:', r.unmapped.join(', '));
