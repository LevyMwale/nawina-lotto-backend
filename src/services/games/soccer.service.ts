import { transaction } from 'objection';
import { WalletService } from '../wallet.service';
import { GamePlay } from '../../models/GamePlay';
import { GameConfig } from '../../models/GameConfig';
import { HousePoolService } from './house-pool.service';

// ============================================================================
// Soccer service
//
// Two responsibilities:
//   1. Proxy football-data.org for the lobby widget (live / upcoming / recent
//      fixtures) — fixes the CORS error the frontend was hitting when calling
//      football-data.org directly from the browser. Also keeps the API key
//      server-side.
//   2. Generate + settle "soccer quiz" rounds: a single multiple-choice
//      question derived from the current league standings of the two teams
//      in a chosen fixture. Stake → answer → 2× payout on correct.
//
// League coverage: top 5 European + Champions League + AFCON + CAF Champions
// League. (Zambian Super League is not available on the football-data.org
// free tier — see SoccerWidget in the frontend for the stubbed section.)
// ============================================================================

const FD_BASE = 'https://api.football-data.org/v4';
const FD_KEY = process.env.FOOTBALL_DATA_API_KEY || '';

// League codes (football-data.org IDs)
export const LEAGUE_CODES = {
  PREMIER_LEAGUE:   'PL',
  LA_LIGA:          'PD',
  BUNDESLIGA:       'BL1',
  SERIE_A:          'SA',
  LIGUE_1:          'FL1',
  CHAMPIONS_LEAGUE: 'CL',
  EUROPA_LEAGUE:    'EL',
  // Africa Cup of Nations — code is "AC" on football-data.org, not
  // "AFCN" (we used a custom shorthand; the API didn't recognize it,
  // silently returning empty African match data). The frontend
  // LEAGUE_CODES map mirrors this same correct value.
  AFCON:            'AC',
  // CAF Champions League — same code as AFC Asian Champions League
  // on the upstream; the API just reuses "ACL" for both.
  CAF_CL:           'ACL',
  // Summer-active leagues — included so the lobby widget has fixtures
  // during the European off-season (mid-May to mid-August), when PL/PD/
  // BL1/SA/FL1/CL are all dark. Both MLS and Brazilian Serie A run
  // roughly April–December with regular midweek + weekend fixtures.
  MLS:              'MLS',  // Major League Soccer (US/Canada)
  BRAZILIAN_SERIE_A: 'BSA', // Campeonato Brasileiro Série A
} as const;
export type LeagueCode = (typeof LEAGUE_CODES)[keyof typeof LEAGUE_CODES];

const LEAGUE_LABEL: Record<LeagueCode, string> = {
  PL: 'Premier League',
  PD: 'La Liga',
  BL1: 'Bundesliga',
  SA: 'Serie A',
  FL1: 'Ligue 1',
  CL: 'Champions League',
  EL: 'Europa League',
  AC: 'Africa Cup of Nations',
  ACL: 'CAF Champions League',
  MLS: 'Major League Soccer',
  BSA: 'Brasileirão',
};

const LEAGUES = Object.values(LEAGUE_CODES);

// ---------------------------------------------------------------------------
// In-memory cache. football-data.org free tier is 10 req/min. We share the
// 60s/6h/1h TTL strategy with the frontend's lib/soccer.ts so server and
// client stay aligned. (We could centralize this but the duplication is
// small and the server has different concerns: it doesn't need the ZSL
// stub, and it doesn't need the full Match normalization.)
// ---------------------------------------------------------------------------
type CacheKey = 'live' | 'upcoming' | 'recent' | `standings:${LeagueCode}`;
const CACHE_TTL: Record<string, number> = {
  live: 60 * 1000,
  upcoming: 6 * 60 * 60 * 1000,
  recent: 60 * 60 * 60 * 1000,
  'standings:': 5 * 60 * 1000,
};
const cache = new Map<string, { data: any; ts: number }>();

function getCached<T>(key: CacheKey): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  const ttl = CACHE_TTL[key.startsWith('standings:') ? 'standings:' : key] ?? 60_000;
  if (Date.now() - hit.ts > ttl) return null;
  return hit.data as T;
}
function setCached(key: CacheKey, data: any) {
  cache.set(key, { data, ts: Date.now() });
}

// ---------------------------------------------------------------------------
// Public types (returned to the frontend)
// ---------------------------------------------------------------------------
export interface Team {
  id: number;
  name: string;
  shortName?: string;
  tla?: string;
  crest?: string;
}

export interface Match {
  id: number;
  utcDate: string;
  status: string;
  minute?: number | null;
  matchday?: number | null;
  stage?: string;
  competition: string;
  competitionCode: LeagueCode;
  homeTeam: Team;
  awayTeam: Team;
  score: { fullTime: { home: number | null; away: number | null } };
}

// ---------------------------------------------------------------------------
// Low-level fetcher
// ---------------------------------------------------------------------------
async function fetchFD(path: string): Promise<any> {
  if (!FD_KEY) {
    throw new Error('FOOTBALL_DATA_API_KEY is not configured on the server');
  }
  const res = await fetch(`${FD_BASE}${path}`, {
    headers: { 'X-Auth-Token': FD_KEY },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`football-data.org ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function normalize(m: any, code: LeagueCode): Match {
  return {
    id: m.id,
    utcDate: m.utcDate,
    status: m.status,
    minute: m.minute ?? null,
    matchday: m.matchday ?? null,
    stage: m.stage,
    competition: m.competition?.name ?? LEAGUE_LABEL[code] ?? '',
    competitionCode: code,
    homeTeam: {
      id: m.homeTeam?.id,
      name: m.homeTeam?.name ?? 'TBD',
      shortName: m.homeTeam?.shortName,
      tla: m.homeTeam?.tla,
      crest: m.homeTeam?.crest,
    },
    awayTeam: {
      id: m.awayTeam?.id,
      name: m.awayTeam?.name ?? 'TBD',
      shortName: m.awayTeam?.shortName,
      tla: m.awayTeam?.tla,
      crest: m.awayTeam?.crest,
    },
    score: {
      fullTime: {
        home: m.score?.fullTime?.home ?? null,
        away: m.score?.fullTime?.away ?? null,
      },
    },
  };
}

async function fetchMatches(status: 'LIVE' | 'TIMED' | 'FINISHED', dateFrom?: string, dateTo?: string): Promise<Match[]> {
  // football-data.org rejects date ranges over 10 days with HTTP 400
  // ("Specified period must not exceed 10 days"). For ranges up to 10
  // days, we issue a single call. For wider ranges, we chunk the
  // window into ≤10-day slices and merge.
  if (!dateFrom || !dateTo) {
    const data = await fetchMatchesChunk(status, dateFrom, dateTo);
    return data;
  }
  const from = new Date(dateFrom + 'T00:00:00Z');
  const to   = new Date(dateTo   + 'T00:00:00Z');
  const dayMs = 24 * 60 * 60 * 1000;
  const totalDays = Math.floor((to.getTime() - from.getTime()) / dayMs);
  if (totalDays <= 10) {
    return await fetchMatchesChunk(status, dateFrom, dateTo);
  }
  // Chunk into 10-day windows, fire in parallel, dedupe by match id.
  const chunks: Array<{ from: string; to: string }> = [];
  let cursor = new Date(from);
  while (cursor < to) {
    const end = new Date(Math.min(cursor.getTime() + 10 * dayMs, to.getTime()));
    chunks.push({ from: cursor.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) });
    cursor = new Date(end.getTime() + dayMs);
  }
  const results = await Promise.all(chunks.map((c) => fetchMatchesChunk(status, c.from, c.to)));
  const seen = new Set<number>();
  const merged: Match[] = [];
  for (const list of results) {
    for (const m of list) {
      if (!seen.has(m.id)) { seen.add(m.id); merged.push(m); }
    }
  }
  return merged;
}

async function fetchMatchesChunk(status: 'LIVE' | 'TIMED' | 'FINISHED', dateFrom?: string, dateTo?: string): Promise<Match[]> {
  const params = new URLSearchParams();
  params.set('competitions', LEAGUES.join(','));
  if (status !== 'LIVE') params.set('status', status);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo)   params.set('dateTo',   dateTo);
  const data = await fetchFD(`/matches?${params.toString()}`);
  const matches = (data.matches || []).map((m: any) => normalize(m, m.competition?.code as LeagueCode));
  if (matches.length === 0) {
    // eslint-disable-next-line no-console
    console.log(`[soccer] upstream returned 0 matches for status=${status} window=${dateFrom ?? '-'}..${dateTo ?? '-'} leagues=${LEAGUES.length}`);
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Public API: fixtures for the lobby widget
// ---------------------------------------------------------------------------
export async function getLiveMatches(): Promise<Match[]> {
  const key: CacheKey = 'live';
  const hit = getCached<Match[]>(key);
  if (hit) return hit;
  const matches = await fetchMatches('LIVE');
  const filtered = matches.filter((m) => m.status === 'IN_PLAY' || m.status === 'PAUSED' || m.status === 'LIVE');
  setCached(key, filtered);
  return filtered;
}

export async function getUpcomingMatches(): Promise<Match[]> {
  const key: CacheKey = 'upcoming';
  const hit = getCached<Match[]>(key);
  if (hit) return hit;
  const today = new Date();
  // 30 days ahead so the lobby shows Copa América, Gold Cup, pre-season
  // tournaments, and summer leagues (MLS / Brasileirão) that fill the
  // European off-season gap (mid-May → mid-August). fetchMatches() chunks
  // the call into ≤10-day slices to stay under football-data.org's hard
  // limit ("Specified period must not exceed 10 days").
  const window = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const matches = await fetchMatches('TIMED', fmt(today), fmt(window));
  setCached(key, matches);
  return matches;
}

export async function getRecentResults(): Promise<Match[]> {
  const key: CacheKey = 'recent';
  const hit = getCached<Match[]>(key);
  if (hit) return hit;
  const today = new Date();
  // 14 days back so the lobby still shows the final weeks of the
  // European season (last-day-of-PL, UCL final, relegation playoffs)
  // even a week or two after they happen. Still chunks into ≤10-day
  // slices server-side.
  const window = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const matches = await fetchMatches('FINISHED', fmt(window), fmt(today));
  setCached(key, matches);
  return matches;
}

// ---------------------------------------------------------------------------
// Standings — used by quiz question generation
// ---------------------------------------------------------------------------
interface StandingsRow {
  position: number;
  team: { id: number; name: string; shortName?: string; tla?: string };
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  playedGames: number;
}

async function getStandings(code: LeagueCode): Promise<StandingsRow[]> {
  const key: CacheKey = `standings:${code}`;
  const hit = getCached<StandingsRow[]>(key);
  if (hit) return hit;
  const data = await fetchFD(`/competitions/${code}/standings`);
  // football-data.org returns a `standings` array; we want the TOTAL
  // standings table (type === "TOTAL") and the `table` array inside it.
  const total = (data.standings || []).find((s: any) => s.type === 'TOTAL') || data.standings?.[0];
  const table: StandingsRow[] = (total?.table || []).map((r: any) => ({
    position: r.position,
    team: { id: r.team.id, name: r.team.name, shortName: r.team.shortName, tla: r.team.tla },
    points: r.points,
    goalsFor: r.goalsFor,
    goalsAgainst: r.goalsAgainst,
    playedGames: r.playedGames,
  }));
  setCached(key, table);
  return table;
}

// ---------------------------------------------------------------------------
// Soccer Quiz
// ---------------------------------------------------------------------------
interface SoccerQuizConfig {
  minStake: number;
  maxStake: number;
  /** Multiplier applied to the stake on a correct answer. */
  correctMultiplier: number;
}

const DEFAULT_CONFIG: SoccerQuizConfig = {
  minStake: 2,
  maxStake: 500,
  correctMultiplier: 2,
};

async function getQuizConfig(): Promise<SoccerQuizConfig> {
  const dbConfig = await GameConfig.query()
    .findOne({ game_type: 'soccer_quiz', is_active: true });
  if (dbConfig) {
    return {
      minStake: Number(dbConfig.min_stake) || DEFAULT_CONFIG.minStake,
      maxStake: Number(dbConfig.max_stake) || DEFAULT_CONFIG.maxStake,
      correctMultiplier: DEFAULT_CONFIG.correctMultiplier,
    };
  }
  return DEFAULT_CONFIG;
}

export interface QuizQuestion {
  /** The fixture this question is about. */
  fixtureId: number;
  homeTeam: { id: number; name: string; shortName?: string; tla?: string };
  awayTeam: { id: number; name: string; shortName?: string; tla?: string };
  competition: string;
  competitionCode: LeagueCode;
  /** The prompt the player sees. */
  prompt: string;
  /** 4 multiple-choice options, in display order. */
  options: string[];
  /** Index (0–3) of the correct option. The frontend echoes this back. */
  correctIndex: number;
}

export interface QuizResolution {
  question: QuizQuestion;
  /** What the player chose (0–3). */
  selectedIndex: number;
  correct: boolean;
  payout: number;
  newBalance: number;
  correctAnswer: string;
}

/**
 * Build a quiz question for a given fixture. The frontend passes the fixture
 * data it already has (it came from /matches); we use it to look up standings
 * and generate the question.
 *
 * The only question type we can reliably generate from the free-tier API is
 * "who is higher in the table?" — the standing data is rich enough for that.
 * We can extend to more templates later (recent form, head-to-head) by
 * pulling from /teams/{id}/matches.
 */
export async function generateQuizQuestion(fixture: {
  id: number;
  competitionCode: LeagueCode;
  homeTeam: { id: number; name: string; shortName?: string; tla?: string };
  awayTeam: { id: number; name: string; shortName?: string; tla?: string };
  competition: string;
}): Promise<QuizQuestion> {
  const standings = await getStandings(fixture.competitionCode);
  const homeRow = standings.find((r) => r.team.id === fixture.homeTeam.id);
  const awayRow = standings.find((r) => r.team.id === fixture.awayTeam.id);

  if (!homeRow || !awayRow) {
    throw new Error('One or both teams are not in the current standings for this league');
  }

  // We need a 4-option multiple choice. Two of the options are always
  // the two teams. The other two are the teams immediately above and
  // below the lower of the two, so the player can't just memorise
  // "these two are correct". We shuffle the 4 options at the end.
  const homePos = homeRow.position;
  const awayPos = awayRow.position;
  const lowerPos = Math.max(homePos, awayPos);

  const neighbourAbove = standings.find((r) => r.position === lowerPos - 1);
  const neighbourBelow = standings.find((r) => r.position === lowerPos + 1);
  if (!neighbourAbove || !neighbourBelow) {
    throw new Error('Not enough standings data to build a quiz question for this fixture');
  }

  // Determine the correct answer: the team with the LOWER position number
  // (position 1 = top of the table).
  const correctTeamId = homePos < awayPos ? fixture.homeTeam.id : fixture.awayTeam.id;
  const correctTeam = homePos < awayPos ? fixture.homeTeam : fixture.awayTeam;

  const teamLabel = (t: { name: string; shortName?: string; tla?: string }) => t.shortName || t.tla || t.name;
  const options = [
    teamLabel(fixture.homeTeam),
    teamLabel(fixture.awayTeam),
    teamLabel(neighbourAbove.team),
    teamLabel(neighbourBelow.team),
  ];

  // Shuffle options deterministically using a stable seeded shuffle so the
  // question is the same on the question-preview call and the answer-submit
  // call. (Otherwise the frontend and the validation could disagree on
  // which index is correct.) Seed on the fixture id.
  const shuffled = shuffleSeeded(options, fixture.id);
  const correctIndex = shuffled.findIndex((o) => o === teamLabel(correctTeam));

  return {
    fixtureId: fixture.id,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    competition: fixture.competition,
    competitionCode: fixture.competitionCode,
    prompt: `${teamLabel(fixture.homeTeam)} vs ${teamLabel(fixture.awayTeam)} — who is higher in the ${fixture.competition} table right now?`,
    options: shuffled,
    correctIndex,
  };
}

function shuffleSeeded<T>(arr: T[], seed: number): T[] {
  const out = [...arr];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    // simple LCG
    s = (s * 1664525 + 1013904223) | 0;
    const j = Math.abs(s) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Play a soccer quiz round.
 *
 * Frontend flow:
 *   1. Player taps a fixture in the lobby widget.
 *   2. Frontend calls `generateQuizQuestion(fixture)` to get the question +
 *      4 options + the correct index (for client-side preview only — we
 *      never trust the client; the index is sent back in `selectedIndex`
 *      and validated here).
 *   3. Player picks an option.
 *   4. Frontend calls `play(userId, fixture, selectedIndex, stake)`. This
 *      debits the stake, validates the answer, credits the payout if
 *      correct, and returns the resolution.
 */
export class SoccerService {
  private walletService = new WalletService();
  private housePoolService = new HousePoolService();

  async play(
    userId: string,
    fixture: {
      id: number;
      competitionCode: LeagueCode;
      homeTeam: { id: number; name: string; shortName?: string; tla?: string };
      awayTeam: { id: number; name: string; shortName?: string; tla?: string };
      competition: string;
    },
    selectedIndex: number,
    stake: number,
  ): Promise<QuizResolution> {
    const config = await getQuizConfig();
    if (!Number.isFinite(stake) || stake < config.minStake || stake > config.maxStake) {
      throw new Error(`Stake must be between K${config.minStake} and K${config.maxStake}`);
    }
    if (selectedIndex < 0 || selectedIndex > 3) {
      throw new Error('Invalid option selected');
    }

    // Generate the question server-side (the frontend may have a preview,
    // but we don't trust it). The question generation also doubles as a
    // validation that the fixture is playable.
    const question = await generateQuizQuestion(fixture);
    let correct = selectedIndex === question.correctIndex;

    return await transaction(GamePlay.knex(), async (trx) => {
      // Debit the stake first (always — the round is played regardless of
      // correct/wrong, just like spin wheel).
      await this.walletService.deduct(userId, stake, 'bet', {
        game_type: 'soccer_quiz',
        fixture_id: fixture.id,
      });

      let payout = correct ? Math.floor(stake * config.correctMultiplier) : 0;

      // Global house pool enforcement — cap to budget, never force to zero
      payout = await this.housePoolService.capPayout(payout);
      if (payout <= 0) {
        correct = false;
      }

      if (payout > 0) {
        await this.walletService.credit(userId, payout, 'win', {
          game_type: 'soccer_quiz',
          fixture_id: fixture.id,
          fixture: `${question.homeTeam.name} vs ${question.awayTeam.name}`,
        });
      }

      // Persist a GamePlay row for history.
      await GamePlay.query(trx).insert({
        user_id: userId,
        game_type: 'soccer_quiz',
        stake,
        bet_data: {
          fixture_id: fixture.id,
          home_team: question.homeTeam.name,
          away_team: question.awayTeam.name,
          competition: question.competition,
          selected_index: selectedIndex,
          correct_index: question.correctIndex,
          prompt: question.prompt,
        },
        result: {
          correct,
          selected_index: selectedIndex,
          correct_index: question.correctIndex,
        },
        payout,
        rng_seed: String(fixture.id),
      });

      const walletInfo = await this.walletService.getBalance(userId);

      return {
        question,
        selectedIndex,
        correct,
        payout,
        newBalance: walletInfo.balance,
        correctAnswer: question.options[question.correctIndex],
      };
    });
  }
}
