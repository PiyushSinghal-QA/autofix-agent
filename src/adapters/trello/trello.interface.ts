import { TrelloCard } from '../../common/types';

export const TRELLO_ADAPTER = Symbol('TRELLO_ADAPTER');

export interface CreateCardInput {
  name: string;
  desc: string;
  labels: string[];
}

export interface TrelloAdapter {
  readonly mode: 'dry-run' | 'real';
  createCard(input: CreateCardInput): Promise<TrelloCard>;
  addComment(cardId: string, text: string): Promise<void>;
  moveCard(cardId: string, listName: string): Promise<void>;
}
