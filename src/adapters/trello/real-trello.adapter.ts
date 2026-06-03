import { Injectable, Logger } from '@nestjs/common';
import { AgentConfig } from '../../config/agent-config';
import { TrelloCard } from '../../common/types';
import { CreateCardInput, TrelloAdapter } from './trello.interface';

/**
 * Real Trello REST implementation (uses global fetch — no extra dependency).
 * Only constructed when DRY_RUN=false; inert in the default demo.
 */
@Injectable()
export class RealTrelloAdapter implements TrelloAdapter {
  readonly mode = 'real' as const;
  private readonly logger = new Logger('Trello[real]');
  private readonly base = 'https://api.trello.com/1';

  constructor(private readonly config: AgentConfig) {}

  private auth(): string {
    const { apiKey, token } = this.config.trello;
    return `key=${encodeURIComponent(apiKey || '')}&token=${encodeURIComponent(token || '')}`;
  }

  async createCard(input: CreateCardInput): Promise<TrelloCard> {
    const { listId } = this.config.trello;
    const url = `${this.base}/cards?${this.auth()}&idList=${encodeURIComponent(listId || '')}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: input.name, desc: input.desc }),
    });
    if (!res.ok) throw new Error(`Trello createCard failed: ${res.status} ${await res.text()}`);
    const card: any = await res.json();
    // Labels would be created/attached here via POST /cards/{id}/labels.
    return {
      id: card.id,
      url: card.shortUrl || card.url,
      name: card.name,
      labels: input.labels,
      listName: 'Triage',
    };
  }

  async addComment(cardId: string, text: string): Promise<void> {
    const url = `${this.base}/cards/${cardId}/actions/comments?${this.auth()}&text=${encodeURIComponent(text)}`;
    const res = await fetch(url, { method: 'POST' });
    if (!res.ok) this.logger.warn(`addComment failed: ${res.status}`);
  }

  async moveCard(cardId: string, listName: string): Promise<void> {
    // Real impl would resolve the list id by name then PUT idList. Left as a stub.
    this.logger.log(`moveCard(${cardId} → "${listName}") — wire up list-id resolution to enable.`);
  }
}
