import { readPatternFamilies, readVocabulary, type Pattern, type VocabularyDocument } from '../../src/procedural/library.ts';
import vocab from '../../../../../research/story-engine/composite/vocabulary.json';
import tensions from '../../../../../research/story-engine/composite/patterns/tensions.json';
import turns from '../../../../../research/story-engine/composite/patterns/turns.json';
import closures from '../../../../../research/story-engine/composite/patterns/closures.json';
import shapes from '../../../../../research/story-engine/composite/patterns/shapes.json';
export const vocabulary = readVocabulary(vocab as unknown as VocabularyDocument);
export const library = readPatternFamilies([tensions, turns, closures, shapes] as unknown as Array<{ patterns: Pattern[] }>);
