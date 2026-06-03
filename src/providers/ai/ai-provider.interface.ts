import { FixRequest, FixResponse } from '../../common/types';

/** DI token for the active AI provider (mock or claude). */
export const AI_PROVIDER = Symbol('AI_PROVIDER');

export interface AIProvider {
  readonly name: 'mock' | 'claude';
  generateFix(request: FixRequest): Promise<FixResponse>;
}
