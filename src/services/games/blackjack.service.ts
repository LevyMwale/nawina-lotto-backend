// ============================================================================
// Blackjack — single-player, dealer-stands-on-17, 6-deck shoe
//
// Card source: deckofcardsapi.com (free, no key). The deck_id is persisted
// in `game_plays.bet_data` so a player can resume a hand after a refresh.
//
// State machine:
//   deal    → server creates the deck, draws 4 cards (2 player + 2 dealer),
//             deducts the stake, and either returns the in-progress hand
//             (player's turn) or auto-settles a natural 21.
//   hit     → server draws one card for the player. If the player busts,
//             the hand settles immediately; otherwise it returns with the
//             player's turn open.
//   stand   → server reveals the dealer's hidden card, draws to 17, judges,
//             credits the payout, and returns the final state.
//   double  → server draws exactly one card, doubles the effective stake,
//             and settles (whether the player busts or not).
//
// Wallet ops are wrapped in `transaction()` so a Deck-of-Cards outage
// rolls back the stake deduction. Same pattern as DiceRollService.
// ============================================================================

import { transaction } from 'objection';
import { WalletService } from '../wallet.service';
import { RNGService } from '../rng.service';
import { GamePlay } from '../../models/GamePlay';

const DECK_BASE = 'https://deckofcardsapi.com/api/deck';
const TIMEOUT_MS = 8000;

// Stake bounds. Matches the dice service for consistency; the seed row
// in 001_game_configs.ts carries the same numbers.
const MIN_STAKE = 5;
const MAX_STAKE = 100;

// Payouts: natural blackjack 3:2 (i.e. bet + 1.5x net → total return 2.5x),
// regular win 1:1 (total return 2x), push returns the stake (total return 1x).
const BLACKJACK_MULTIPLIER = 2.5;
const REGULAR_WIN_MULTIPLIER = 2;
const PUSH_MULTIPLIER = 1;

type Action = 'deal' | 'hit' | 'stand' | 'double';
type Suit = 'SPADES' | 'HEARTS' | 'DIAMONDS' | 'CLUBS';
type Status = 'in_progress' | 'blackjack' | 'win' | 'lose' | 'push' | 'bust' | 'dealer_bust';

interface Card {
  code: string;   // e.g. 'AS', '0H', 'KC'
  image: string;  // full URL to the card PNG
  suit: Suit;
  value: string;  // 'ACE' | '2'..'10' | 'JACK' | 'QUEEN' | 'KING'
}

interface DeckInfo { deck_id: string; remaining: number; }
interface DrawResult { cards: Card[]; remaining: number; deck_id: string; }

export interface BlackjackState {
  deck_id: string;
  deck_remaining: number;      // tracks the shoe depth; updated on every draw
  player: Card[];
  dealer: Card[];
  player_total: number;
  dealer_total: number;        // up-card only during play; full hand after settle
  status: Status;
  wasNatural: boolean;         // true if dealt 21 on the first 2 cards
  doubled: boolean;            // true if the player doubled down
}

export interface BlackjackResult {
  success: true;
  game_id: string;
  player: Card[];
  dealer: Card[];
  player_total: number;
  dealer_total: number;
  isPlayerTurn: boolean;
  canDouble: boolean;
  status: Status;
  payout: number;
  stake: number;               // reflects the doubled stake after a double-down
  balance: number;
  seed: string;
}

// ----------------------------------------------------------------------------
// External HTTP helper (mirrors soccer.service.ts:107-120 `fetchFD` pattern).
// ----------------------------------------------------------------------------

async function docFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${DECK_BASE}${path}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`deckofcards ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

async function newDeck(deckCount = 6): Promise<DeckInfo> {
  const data = await docFetch<{ deck_id: string; remaining: number; success: boolean }>(
    `/new/shuffle/?deck_count=${deckCount}`,
  );
  if (!data.success || !data.deck_id) {
    throw new Error('deckofcards: failed to create a new deck');
  }
  return { deck_id: data.deck_id, remaining: data.remaining };
}

async function drawFromDeck(deckId: string, count: number): Promise<DrawResult> {
  const data = await docFetch<{ success: boolean; deck_id: string; cards: Card[]; remaining: number }>(
    `/${deckId}/draw/?count=${count}`,
  );
  if (!data.success || !Array.isArray(data.cards) || data.cards.length !== count) {
    throw new Error('deckofcards: draw returned an unexpected payload');
  }
  return { cards: data.cards, remaining: data.remaining, deck_id: data.deck_id };
}

// ----------------------------------------------------------------------------
// Hand total — Aces count 11 first, demote one at a time while bust.
// ----------------------------------------------------------------------------

function computeTotal(cards: Card[]): number {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.value === 'ACE') { aces++; total += 11; }
    else if (c.value === 'JACK' || c.value === 'QUEEN' || c.value === 'KING') total += 10;
    else total += Number(c.value);
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

function isNatural(cards: Card[]): boolean {
  return cards.length === 2 && computeTotal(cards) === 21;
}

// ----------------------------------------------------------------------------
// Service
// ----------------------------------------------------------------------------

export class BlackjackService {
  private walletService: WalletService;
  private rngService: RNGService;

  constructor() {
    this.walletService = new WalletService();
    this.rngService = new RNGService();
  }

  async play(userId: string, stake: number, action: Action, gameId?: string): Promise<BlackjackResult> {
    if (stake < MIN_STAKE || stake > MAX_STAKE) {
      throw new Error(`Stake must be between K${MIN_STAKE} and K${MAX_STAKE}`);
    }
    if (!['deal', 'hit', 'stand', 'double'].includes(action)) {
      throw new Error('Valid action is required');
    }

    if (action === 'deal') return await this.deal(userId, stake);
    if (!gameId) throw new Error('gameId is required for hit/stand/double');
    return await this.resume(userId, stake, action, gameId);
  }

  // -------------------------------------------------------------------------
  // Deal — first action, creates a new GamePlay row.
  // -------------------------------------------------------------------------
  private async deal(userId: string, stake: number): Promise<BlackjackResult> {
    return await transaction(GamePlay.knex(), async (trx) => {
      // 1. Deduct the stake
      await this.walletService.deduct(userId, stake, 'bet', { game_type: 'blackjack' });

      // 2. New deck + initial draw
      const deck = await newDeck(6);
      const initial = await drawFromDeck(deck.deck_id, 4);
      const player: Card[] = initial.cards.slice(0, 2);
      const dealer: Card[] = initial.cards.slice(2, 4);
      const playerTotal = computeTotal(player);
      const dealerUpTotal = computeTotal([dealer[0]]);
      const wasNatural = isNatural(player);

      // 3. Persist the initial state
      const { seed } = this.rngService.generateRandom();
      const inserted = await GamePlay.query(trx).insert({
        user_id: userId,
        game_type: 'blackjack',
        stake,
        bet_data: {
          deck_id: deck.deck_id,
          deck_remaining: initial.remaining,
          player,
          dealer,
          player_total: playerTotal,
          dealer_total: dealerUpTotal,
          status: wasNatural ? 'blackjack' : 'in_progress',
          wasNatural,
          doubled: false,
        } as BlackjackState,
        result: { outcome: wasNatural ? 'blackjack' : 'in_progress' },
        payout: 0,
        rng_seed: seed,
      });

      // 4. Natural 21 → settle immediately. Otherwise hand back to the player.
      if (wasNatural) {
        return await this.settleHand(trx, userId, stake, inserted.id);
      }
      // Build the snapshot from the in-memory `inserted` row + a fresh
      // wallet balance read. We deliberately do NOT re-read via
      // GamePlay.query().findById() here — that query would run on a
      // different connection and not see the uncommitted insert, causing
      // 'Game not found after settle'. The inserted row IS the source
      // of truth for this hand.
      return this.buildSnapshot(inserted, /*isPlayerTurn*/ true, stake, /*doubled*/ false, /*payout*/ 0);
    });
  }

  // -------------------------------------------------------------------------
  // Resume — hit/stand/double on an existing hand.
  // -------------------------------------------------------------------------
  private async resume(userId: string, stake: number, action: Action, gameId: string): Promise<BlackjackResult> {
    return await transaction(GamePlay.knex(), async (trx) => {
      const play = await GamePlay.query(trx).findById(gameId);
      if (!play || play.user_id !== userId) throw new Error('Game not found');
      if (play.result?.outcome !== 'in_progress') throw new Error('Game already settled');
      // game_plays.stake is decimal(10,2) in Postgres, which Knex returns
      // as a string like "10.00". Coerce both sides to Number so the
      // comparison doesn't false-positive on a 1-decimal display value.
      if (Number(play.stake) !== Number(stake)) throw new Error('Stake mismatch');

      const state = play.bet_data as BlackjackState;
      const deckId = state.deck_id;
      let { player, dealer, deck_remaining } = state;
      let effectiveStake = stake;
      const doubled = state.doubled || action === 'double';

      if (action === 'hit' || action === 'double') {
        const draw = await drawFromDeck(deckId, 1);
        player = [...player, ...draw.cards];
        deck_remaining = draw.remaining;
        if (action === 'double') effectiveStake = stake * 2;
      }

      const playerTotal = computeTotal(player);

      // Bust or double: settle immediately
      if (action === 'double' || playerTotal > 21) {
        // Persist the new player hand and forced stand
        await GamePlay.query(trx).patchAndFetchById(gameId, {
          bet_data: {
            ...state,
            player,
            player_total: playerTotal,
            deck_remaining,
            doubled,
          } as BlackjackState,
        });
        return await this.settleHand(trx, userId, effectiveStake, gameId, doubled);
      }

      // Hit and not bust: save state, hand back to player
      const updated = await GamePlay.query(trx).patchAndFetchById(gameId, {
        bet_data: {
          ...state,
          player,
          player_total: playerTotal,
          deck_remaining,
          doubled,
        } as BlackjackState,
      });
      return this.buildSnapshot(updated, /*isPlayerTurn*/ true, effectiveStake, doubled, /*payout*/ 0);
    });
  }

  // -------------------------------------------------------------------------
  // Settle — reveal dealer, draw to 17, judge, credit payout.
  // -------------------------------------------------------------------------
  private async settleHand(
    trx: any,
    userId: string,
    stake: number,
    gameId: string,
    doubled: boolean = false,
  ): Promise<BlackjackResult> {
    const play = await GamePlay.query(trx).findById(gameId);
    if (!play) throw new Error('Game not found');
    const state = play.bet_data as BlackjackState;
    const deckId = state.deck_id;

    // Dealer reveals hidden card and draws to 17 (soft 17 stands).
    let dealer: Card[] = state.dealer;
    let deckRemaining = state.deck_remaining;
    while (computeTotal(dealer) < 17) {
      const draw = await drawFromDeck(deckId, 1);
      dealer = [...dealer, ...draw.cards];
      deckRemaining = draw.remaining;
    }

    const playerTotal = computeTotal(state.player);
    const dealerTotal = computeTotal(dealer);
    const { status, multiplier } = judgeHand(state, playerTotal, dealerTotal, doubled);
    const payout = status === 'in_progress' ? 0 : Math.floor(stake * multiplier);

    if (payout > 0) {
      await this.walletService.credit(userId, payout, 'win', {
        game_type: 'blackjack',
        player_total: playerTotal,
        dealer_total: dealerTotal,
        status,
      });
    }

    const finalState: BlackjackState = {
      ...state,
      dealer,
      player_total: playerTotal,
      dealer_total: dealerTotal,
      deck_remaining: deckRemaining,
      status,
      doubled,
    };

    const updated = await GamePlay.query(trx).patchAndFetchById(gameId, {
      bet_data: finalState,
      result: {
        outcome: status,
        player_total: playerTotal,
        dealer_total: dealerTotal,
        multiplier,
        doubled,
      },
      payout,
    });

    return this.buildSnapshot(updated, /*isPlayerTurn*/ false, stake, doubled, payout);
  }

  // -------------------------------------------------------------------------
  // Build the public response from an in-memory GamePlay row + fresh
  // wallet balance. The previous implementation re-queried GamePlay
  // outside the active transaction, which couldn't see the just-inserted
  // row and threw 'Game not found after settle' on every deal. We now
  // take the row directly so the response is built from committed state
  // without an extra round trip.
  // -------------------------------------------------------------------------
  private async buildSnapshot(
    play: GamePlay,
    isPlayerTurn: boolean,
    stake: number,
    doubled: boolean,
    payout: number,
  ): Promise<BlackjackResult> {
    const state = play.bet_data as BlackjackState;
    const walletInfo = await this.walletService.getBalance(play.user_id);
    const canDouble =
      isPlayerTurn &&
      !doubled &&
      state.player.length === 2 &&
      computeTotal(state.player) <= 11;
    return {
      success: true,
      game_id: play.id,
      player: state.player,
      dealer: isPlayerTurn ? [state.dealer[0]] : state.dealer,
      player_total: computeTotal(state.player),
      dealer_total: isPlayerTurn ? computeTotal([state.dealer[0]]) : computeTotal(state.dealer),
      isPlayerTurn,
      canDouble,
      status: state.status,
      payout,
      stake: doubled ? stake * 2 : stake,
      balance: walletInfo.balance,
      seed: play.rng_seed,
    };
  }
}

// ----------------------------------------------------------------------------
// Hand judgement. Doubling/bust/loss/etc. Returns the status + payout multiplier.
// ----------------------------------------------------------------------------

function judgeHand(
  state: BlackjackState,
  playerTotal: number,
  dealerTotal: number,
  doubled: boolean,
): { status: Status; multiplier: number } {
  if (playerTotal > 21) return { status: 'bust', multiplier: 0 };
  if (dealerTotal > 21) return { status: 'dealer_bust', multiplier: REGULAR_WIN_MULTIPLIER };
  if (state.wasNatural && !doubled) return { status: 'blackjack', multiplier: BLACKJACK_MULTIPLIER };
  if (playerTotal > dealerTotal) return { status: 'win', multiplier: REGULAR_WIN_MULTIPLIER };
  if (playerTotal < dealerTotal) return { status: 'lose', multiplier: 0 };
  return { status: 'push', multiplier: PUSH_MULTIPLIER };
}
