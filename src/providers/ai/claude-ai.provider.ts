import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentConfig } from '../../config/agent-config';
import { FixRequest, FixResponse } from '../../common/types';
import { extractUnifiedDiff, parseDiffPaths } from '../../common/diff';
import { MAX_FILES } from '../../common/diff-policy';
import { AIProvider } from './ai-provider.interface';

const SYSTEM_PROMPT = [
  'You are AutoFix, an autonomous senior engineer. You receive a failing test and the',
  'relevant source files, and you return a single minimal fix.',
  'Hard constraints:',
  `- Change at most ${MAX_FILES} files.`,
  '- Do NOT modify any test file, and do NOT change dependencies (package.json/lockfiles).',
  '- Keep the diff minimal and behaviour-preserving beyond the fix.',
  '- Respond with ONLY a unified diff that applies cleanly with `git apply` (a/ and b/ prefixes).',
].join('\n');

/**
 * Real Anthropic implementation. Only constructed/used when AI_PROVIDER=claude and
 * a key is present (see ai.module). The SDK is dynamically imported so it never
 * loads — and never needs installing — in the default offline demo.
 */
@Injectable()
export class ClaudeAIProvider implements AIProvider {
  readonly name = 'claude' as const;
  private readonly logger = new Logger(ClaudeAIProvider.name);

  constructor(private readonly config: AgentConfig) {}

  async generateFix(request: FixRequest): Promise<FixResponse> {
    const start = Date.now();
    const { bug, repoPath } = request;
    request.onReasoning?.(`Calling ${this.config.anthropicModel} with the failing test + source context…`);

    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: this.config.anthropicApiKey });

    const fileContext = bug.files
      .map((f) => `===== ${f} =====\n${readFileSync(join(repoPath, f), 'utf8')}`)
      .join('\n\n');

    const userPrompt = [
      `Repository: ${bug.repository}`,
      `Bug: ${bug.title}`,
      `Category: ${bug.category}`,
      `Failing test: ${bug.failingTest}`,
      '',
      'Failing test output:',
      bug.logs,
      '',
      'Source files:',
      fileContext,
      '',
      'Return ONLY the unified diff that fixes the failing test.',
    ].join('\n');

    const message = await client.messages.create({
      model: this.config.anthropicModel,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = (message.content || [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n');
    const diff = extractUnifiedDiff(text);

    const input = message.usage?.input_tokens ?? 0;
    const output = message.usage?.output_tokens ?? 0;

    return {
      diff,
      reasoning: [`Claude (${this.config.anthropicModel}) returned a ${diff.split('\n').length}-line patch.`],
      filesChanged: parseDiffPaths(diff),
      model: this.config.anthropicModel,
      provider: 'claude',
      tokenUsage: { input, output, total: input + output },
      latencyMs: Date.now() - start,
    };
  }
}
