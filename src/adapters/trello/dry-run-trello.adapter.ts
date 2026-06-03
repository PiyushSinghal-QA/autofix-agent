import { Injectable, Logger } from '@nestjs/common';
import { TrelloCard } from '../../common/types';
import { nextId } from '../../common/util';
import { CreateCardInput, TrelloAdapter } from './trello.interface';

/** Simulates Trello: logs every action it *would* perform and returns a fake card. */
@Injectable()
export class DryRunTrelloAdapter implements TrelloAdapter {
  readonly mode = 'dry-run' as const;
  private readonly logger = new Logger('Trello[dry-run]');

  async createCard(input: CreateCardInput): Promise<TrelloCard> {
    const id = nextId('card');
    const card: TrelloCard = {
      id,
      url: `https://trello.com/c/${id}`,
      name: input.name,
      labels: input.labels,
      listName: 'Triage',
    };
    this.logger.log(`createCard → "${input.name}" [${input.labels.join(', ')}] (${card.url})`);
    return card;
  }

  async addComment(cardId: string, text: string): Promise<void> {
    this.logger.log(`addComment → ${cardId}: ${text.split('\n')[0]}`);
  }

  async moveCard(cardId: string, listName: string): Promise<void> {
    this.logger.log(`moveCard → ${cardId} to list "${listName}"`);
  }
}
