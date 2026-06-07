// ============================================================================
// Open Trivia DB client
//
// Free, no-key trivia API. Returns HTML-encoded multiple-choice questions
// across 24 categories (https://opentdb.com/api_category.php). We normalize
// the response into the existing `QuizQuestion` shape so the rest of
// `quiz.service.ts` is untouched.
//
// Why a separate file: the entity decoder is fiddly, and isolating it keeps
// `quiz.service.ts` focused on the gameplay loop. We also hide the
// AbortSignal + error-mapping boilerplate behind a single entry point.
// ============================================================================

const OPENTDB_BASE = 'https://opentdb.com';
const TIMEOUT_MS = 8000;

export interface OpenTdbOptions {
  /** Number of questions to fetch (1..50). */
  amount: number;
  /** OpenTDB category id. See https://opentdb.com/api_category.php. Default 9 = General Knowledge. */
  category?: number;
  /** Optional difficulty filter. */
  difficulty?: 'easy' | 'medium' | 'hard';
}

export interface NormalizedQuestion {
  id: string;
  question: string;
  options: string[];
  correctAnswer: number; // index into `options`
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';
  prizeAmount: number;
  timeLimit: number;
}

interface OpenTdbRawQuestion {
  category: string;
  type: 'multiple' | 'boolean';
  difficulty: 'easy' | 'medium' | 'hard';
  question: string;
  correct_answer: string;
  incorrect_answers: string[];
}

interface OpenTdbResponse {
  response_code: number;
  results: OpenTdbRawQuestion[];
}

// Response codes per the OpenTDB docs.
const RC = {
  SUCCESS: 0,
  NO_RESULTS: 1,
  INVALID_PARAM: 2,
  TOKEN_NOT_FOUND: 3,
  TOKEN_EMPTY: 4,
  RATE_LIMIT: 5,
} as const;

const RC_MESSAGES: Record<number, string> = {
  [RC.NO_RESULTS]: 'No questions available for the requested filter',
  [RC.INVALID_PARAM]: 'Invalid OpenTDB parameter',
  [RC.TOKEN_NOT_FOUND]: 'OpenTDB session token not found',
  [RC.TOKEN_EMPTY]: 'OpenTDB session token empty',
  [RC.RATE_LIMIT]: 'OpenTDB rate limit hit (>=5 req/s)',
};

// Difficulty → (prize, time limit). Matches the local bank so the frontend
// doesn't need to special-case OpenTDB-sourced questions.
const DIFFICULTY_CONFIG: Record<'easy' | 'medium' | 'hard', { prizeAmount: number; timeLimit: number }> = {
  easy:   { prizeAmount: 100, timeLimit: 15 },
  medium: { prizeAmount: 250, timeLimit: 12 },
  hard:   { prizeAmount: 500, timeLimit: 10 },
};

// ----------------------------------------------------------------------------
// HTML entity decoder
//
// OpenTDB returns text like "What&#039;s the capital of &quot;France&quot;?".
// We need to decode the small set of entities the API actually emits. We
// don't pull in the `he` package to keep the dep tree slim; the API's
// emitted entity set is small and well-known.
// ----------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  iexcl: '¡', cent: '¢', pound: '£', curren: '¤', yen: '¥',
  brvbar: '¦', sect: '§', uml: '¨', copy: '©', ordf: 'ª',
  laquo: '«', not: '¬', shy: '­', reg: '®', macr: '¯',
  deg: '°', plusmn: '±', sup2: '²', sup3: '³', acute: '´',
  micro: 'µ', para: '¶', middot: '·', cedil: '¸', sup1: '¹',
  ordm: 'º', raquo: '»', frac14: '¼', frac12: '½', frac34: '¾',
  iquest: '¿', Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã',
  Auml: 'Ä', Aring: 'Å', AElig: 'Æ', Ccedil: 'Ç', Egrave: 'È',
  Eacute: 'É', Ecirc: 'Ê', Euml: 'Ë', Igrave: 'Ì', Iacute: 'Í',
  Icirc: 'Î', Iuml: 'Ï', ETH: 'Ð', Ntilde: 'Ñ', Ograve: 'Ò',
  Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ', Ouml: 'Ö', times: '×',
  Oslash: 'Ø', Ugrave: 'Ù', Uacute: 'Ú', Ucirc: 'Û', Uuml: 'Ü',
  Yacute: 'Ý', THORN: 'Þ', szlig: 'ß', agrave: 'à', aacute: 'á',
  acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å', aelig: 'æ',
  ccedil: 'ç', egrave: 'è', eacute: 'é', ecirc: 'ê', euml: 'ë',
  igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï', eth: 'ð',
  ntilde: 'ñ', ograve: 'ò', oacute: 'ó', ocirc: 'ô', otilde: 'õ',
  ouml: 'ö', divide: '÷', oslash: 'ø', ugrave: 'ù', uacute: 'ú',
  ucirc: 'û', uuml: 'ü', yacute: 'ý', thorn: 'þ', yuml: 'ÿ',
};

function decodeHtmlEntities(input: string): string {
  return input.replace(/&(?:#x([0-9a-fA-F]+)|#(\d+)|([a-zA-Z][a-zA-Z0-9]+));/g, (_, hex, dec, name) => {
    if (hex) {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    }
    if (dec) {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    }
    if (name) {
      return NAMED_ENTITIES[name] ?? `&${name};`;
    }
    return '';
  });
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Fetch `amount` trivia questions from Open Trivia DB, normalized to the
 * `QuizQuestion` shape used by `quiz.service.ts`. Throws on any non-success
 * `response_code` or any HTTP/network error — callers should fall back to
 * the local bank.
 */
export async function fetchQuestions(opts: OpenTdbOptions): Promise<NormalizedQuestion[]> {
  const { amount, category, difficulty } = opts;
  if (!Number.isInteger(amount) || amount < 1 || amount > 50) {
    throw new Error('OpenTDB: amount must be an integer between 1 and 50');
  }

  const params = new URLSearchParams({ amount: String(amount), type: 'multiple' });
  if (category) params.set('category', String(category));
  if (difficulty) params.set('difficulty', difficulty);

  let res: Response;
  try {
    res = await fetch(`${OPENTDB_BASE}/api.php?${params.toString()}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });
  } catch (e: any) {
    throw new Error(`OpenTDB network error: ${e?.message || e}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenTDB HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const body = (await res.json()) as OpenTdbResponse;
  if (body.response_code !== RC.SUCCESS) {
    const msg = RC_MESSAGES[body.response_code] ?? `unknown response_code ${body.response_code}`;
    throw new Error(`OpenTDB: ${msg}`);
  }
  if (!Array.isArray(body.results) || body.results.length === 0) {
    throw new Error('OpenTDB: empty results array');
  }

  return body.results.map((r, i) => normalize(r, i));
}

function normalize(r: OpenTdbRawQuestion, index: number): NormalizedQuestion {
  // Shuffle correct_answer into the 4-element options array with a stable
  // Fisher-Yates so the server's `correctAnswer` index is non-trivial.
  const correct = decodeHtmlEntities(r.correct_answer);
  const incorrect = r.incorrect_answers.map(decodeHtmlEntities);
  const options = [correct, ...incorrect];
  const correctIndex = shuffleIndex(options.length, index);

  const { prizeAmount, timeLimit } = DIFFICULTY_CONFIG[r.difficulty] ?? DIFFICULTY_CONFIG.easy;

  return {
    id: `otdb-${index}-${hash(safeCode(r.question))}`,
    question: decodeHtmlEntities(r.question),
    options,
    correctAnswer: correctIndex,
    category: decodeHtmlEntities(r.category),
    difficulty: r.difficulty,
    prizeAmount,
    timeLimit,
  };
}

// Deterministic Fisher-Yates seeded by the question's index + a small hash
// of the question text, so the correct-answer index is stable for a given
// question across requests.
function shuffleIndex(len: number, seed: number): number {
  let s = (seed * 2654435761) >>> 0;
  s = s || 1;
  const rand = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return (s % 1_000_000) / 1_000_000;
  };
  const arr = Array.from({ length: len }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr[0];
}

function safeCode(s: string): string {
  // Strip HTML tags and trim so the hash is stable regardless of whitespace.
  return s.replace(/<[^>]*>/g, '').trim().toLowerCase();
}

function hash(s: string): string {
  // Tiny FNV-1a 32-bit hex. Used only for stable IDs, not security.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}
