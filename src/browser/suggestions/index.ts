import { storageSuggestionSources } from './storage-sources';
import { SuggestionService } from './suggestion.service';

export type {
  OmniboxSuggestion,
  RankableCandidate,
  SuggestionKind,
  SuggestionProvider,
  SuggestionQueryContext,
  SuggestionSource,
} from './types';

export {
  SUGGESTION_DEBOUNCE_MS,
  SUGGESTION_LIMIT,
  SUGGESTION_BASE_SCORES,
} from './constants';

export { searchRankingEngine, rankSuggestions, scoreCandidate } from './ranking.engine';
export { suggestionCache, SuggestionCache } from './suggestion.cache';
export { SuggestionService, type SuggestionSources } from './suggestion.service';

export const suggestionService = new SuggestionService(storageSuggestionSources);
