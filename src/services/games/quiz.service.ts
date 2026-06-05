import { transaction } from 'objection';
import { WalletService } from '../wallet.service';
import { RNGService } from '../rng.service';
import { GamePlay } from '../../models/GamePlay';
import { User } from '../../models/User';

interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  // The correct option index is NOT sent to the client. The frontend only
  // needs to render the question; the server has already decided the
  // outcome and stamps correct/incorrect in `result`.
  correctAnswer: number;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';
  prizeAmount: number;
  timeLimit: number;
}

interface QuizConfig {
  minStake: number;
  maxStake: number;
  questionsPerRound: number;
  // Payout multiplier per correct answer (cumulative).
  // 0 correct → 0×, 1 correct → 0.4×, 2 → 0.8×, 3 → 1.4×, 4 → 2.5×, 5 → 5×
  payoutByCorrect: number[];
}

const DEFAULT_QUIZ_CONFIG: QuizConfig = {
  minStake: 5,
  maxStake: 500,
  questionsPerRound: 5,
  payoutByCorrect: [0, 0.4, 0.8, 1.4, 2.5, 5.0],
};

// Small curated question bank. Each question has 4 options and a single
// correct answer index. We keep the bank small enough to ship in the bundle
// but large enough that a player won't see the same 5 questions twice in a
// row.
const QUESTION_BANK: QuizQuestion[] = [
  // EASY — 12 questions
  { id: 'q-01', question: 'What is the capital city of Zambia?', options: ['Lusaka', 'Harare', 'Lilongwe', 'Kampala'], correctAnswer: 0, category: 'Geography', difficulty: 'easy', prizeAmount: 100, timeLimit: 12 },
  { id: 'q-02', question: 'How many continents are there on Earth?', options: ['5', '6', '7', '8'], correctAnswer: 2, category: 'Geography', difficulty: 'easy', prizeAmount: 100, timeLimit: 12 },
  { id: 'q-03', question: 'What color do you get when you mix red and blue?', options: ['Green', 'Purple', 'Orange', 'Brown'], correctAnswer: 1, category: 'General', difficulty: 'easy', prizeAmount: 100, timeLimit: 10 },
  { id: 'q-04', question: 'Which planet is known as the Red Planet?', options: ['Venus', 'Mars', 'Jupiter', 'Saturn'], correctAnswer: 1, category: 'Science', difficulty: 'easy', prizeAmount: 100, timeLimit: 10 },
  { id: 'q-05', question: 'What is 7 × 8?', options: ['54', '56', '64', '48'], correctAnswer: 1, category: 'Math', difficulty: 'easy', prizeAmount: 100, timeLimit: 10 },
  { id: 'q-06', question: 'Which animal is the king of the jungle?', options: ['Tiger', 'Lion', 'Elephant', 'Bear'], correctAnswer: 1, category: 'General', difficulty: 'easy', prizeAmount: 100, timeLimit: 10 },
  { id: 'q-07', question: 'How many days are in a leap year?', options: ['364', '365', '366', '367'], correctAnswer: 2, category: 'General', difficulty: 'easy', prizeAmount: 100, timeLimit: 10 },
  { id: 'q-08', question: 'What is the largest ocean on Earth?', options: ['Atlantic', 'Indian', 'Arctic', 'Pacific'], correctAnswer: 3, category: 'Geography', difficulty: 'easy', prizeAmount: 100, timeLimit: 10 },
  { id: 'q-09', question: 'Which gas do plants breathe in?', options: ['Oxygen', 'Nitrogen', 'Carbon Dioxide', 'Hydrogen'], correctAnswer: 2, category: 'Science', difficulty: 'easy', prizeAmount: 100, timeLimit: 10 },
  { id: 'q-10', question: 'What is the currency of Japan?', options: ['Yuan', 'Won', 'Yen', 'Ringgit'], correctAnswer: 2, category: 'General', difficulty: 'easy', prizeAmount: 100, timeLimit: 10 },
  { id: 'q-11', question: 'How many sides does a triangle have?', options: ['2', '3', '4', '5'], correctAnswer: 1, category: 'Math', difficulty: 'easy', prizeAmount: 100, timeLimit: 8 },
  { id: 'q-12', question: 'What is the boiling point of water at sea level in Celsius?', options: ['90°', '95°', '100°', '110°'], correctAnswer: 2, category: 'Science', difficulty: 'easy', prizeAmount: 100, timeLimit: 10 },

  // MEDIUM — 10 questions
  { id: 'q-13', question: 'Who wrote "Romeo and Juliet"?', options: ['Charles Dickens', 'William Shakespeare', 'Mark Twain', 'Jane Austen'], correctAnswer: 1, category: 'Literature', difficulty: 'medium', prizeAmount: 250, timeLimit: 12 },
  { id: 'q-14', question: 'What is the chemical symbol for gold?', options: ['Go', 'Gd', 'Au', 'Ag'], correctAnswer: 2, category: 'Science', difficulty: 'medium', prizeAmount: 250, timeLimit: 10 },
  { id: 'q-15', question: 'In which year did World War II end?', options: ['1942', '1945', '1948', '1950'], correctAnswer: 1, category: 'History', difficulty: 'medium', prizeAmount: 250, timeLimit: 12 },
  { id: 'q-16', question: 'What is the square root of 144?', options: ['10', '11', '12', '14'], correctAnswer: 2, category: 'Math', difficulty: 'medium', prizeAmount: 250, timeLimit: 10 },
  { id: 'q-17', question: 'Which country is the largest by land area?', options: ['China', 'USA', 'Canada', 'Russia'], correctAnswer: 3, category: 'Geography', difficulty: 'medium', prizeAmount: 250, timeLimit: 10 },
  { id: 'q-18', question: 'How many bones are there in the adult human body?', options: ['186', '206', '226', '246'], correctAnswer: 1, category: 'Science', difficulty: 'medium', prizeAmount: 250, timeLimit: 12 },
  { id: 'q-19', question: 'Which African country was never colonized?', options: ['Kenya', 'Ethiopia', 'Nigeria', 'Ghana'], correctAnswer: 1, category: 'History', difficulty: 'medium', prizeAmount: 250, timeLimit: 12 },
  { id: 'q-20', question: 'What is the speed of light in a vacuum (approx, m/s)?', options: ['300,000', '3,000,000', '30,000,000', '300,000,000'], correctAnswer: 3, category: 'Science', difficulty: 'medium', prizeAmount: 250, timeLimit: 12 },
  { id: 'q-21', question: 'Who painted the Mona Lisa?', options: ['Michelangelo', 'Leonardo da Vinci', 'Raphael', 'Donatello'], correctAnswer: 1, category: 'Art', difficulty: 'medium', prizeAmount: 250, timeLimit: 12 },
  { id: 'q-22', question: 'What is the smallest prime number?', options: ['0', '1', '2', '3'], correctAnswer: 2, category: 'Math', difficulty: 'medium', prizeAmount: 250, timeLimit: 8 },

  // HARD — 8 questions
  { id: 'q-23', question: 'In what year was the first Bitcoin block (the "Genesis Block") mined?', options: ['2007', '2008', '2009', '2010'], correctAnswer: 2, category: 'Tech', difficulty: 'hard', prizeAmount: 500, timeLimit: 15 },
  { id: 'q-24', question: 'What is the most abundant gas in Earth\'s atmosphere?', options: ['Oxygen', 'Carbon Dioxide', 'Nitrogen', 'Argon'], correctAnswer: 2, category: 'Science', difficulty: 'hard', prizeAmount: 500, timeLimit: 12 },
  { id: 'q-25', question: 'Which Shakespeare play is the longest?', options: ['Hamlet', 'Othello', 'Hamlet', 'Richard III'], correctAnswer: 0, category: 'Literature', difficulty: 'hard', prizeAmount: 500, timeLimit: 15 },
  { id: 'q-26', question: 'What does the HTTP status code 418 mean?', options: ['Not Found', "I'm a teapot", 'Server Error', 'Forbidden'], correctAnswer: 1, category: 'Tech', difficulty: 'hard', prizeAmount: 500, timeLimit: 12 },
  { id: 'q-27', question: 'Who is credited with the discovery of penicillin?', options: ['Marie Curie', 'Alexander Fleming', 'Louis Pasteur', 'Joseph Lister'], correctAnswer: 1, category: 'Science', difficulty: 'hard', prizeAmount: 500, timeLimit: 12 },
  { id: 'q-28', question: 'What is the integral of 1/x dx?', options: ['x + C', 'ln|x| + C', '1/x² + C', 'eˣ + C'], correctAnswer: 1, category: 'Math', difficulty: 'hard', prizeAmount: 500, timeLimit: 15 },
  { id: 'q-29', question: 'The Victoria Falls is on which river?', options: ['Congo', 'Niger', 'Zambezi', 'Limpopo'], correctAnswer: 2, category: 'Geography', difficulty: 'hard', prizeAmount: 500, timeLimit: 12 },
  { id: 'q-30', question: 'In computing, what does "Y2K" refer to?', options: ['Year 2000 bug', 'A virus', 'A programming language', 'A CPU model'], correctAnswer: 0, category: 'Tech', difficulty: 'hard', prizeAmount: 500, timeLimit: 10 },
];

/**
 * Generate a per-question "did the player get it right" outcome, weighted
 * by difficulty. The shape is:
 *   easy  → 80% correct
 *   medium → 60% correct
 *   hard  → 40% correct
 * This keeps the game fun (not always 5/5, not always 0/5).
 */
function rollCorrect(difficulty: 'easy' | 'medium' | 'hard', r: number): boolean {
  const p = difficulty === 'easy' ? 0.80 : difficulty === 'medium' ? 0.60 : 0.40;
  return r < p;
}

export class QuizService {
  private walletService: WalletService;
  private rngService: RNGService;

  constructor() {
    this.walletService = new WalletService();
    this.rngService = new RNGService();
  }

  /**
   * Play a Trivia Quiz round. The server picks 5 questions deterministically
   * using the RNG, decides per-question correctness using a weighted roll
   * (so the game isn't all-or-nothing), and pays out a multiplier that
   * depends on the count of correct answers.
   *
   * NOTE on flow: this is a "reveal-all" model — the frontend gets all 5
   * questions in one shot, the player watches the per-question timer, and
   * the server's `correctCount` is what counts. This matches the way the
   * frontend `QuizGame` component consumes the response.
   */
  async play(userId: string, stake: number) {
    if (stake < DEFAULT_QUIZ_CONFIG.minStake || stake > DEFAULT_QUIZ_CONFIG.maxStake) {
      throw new Error(`Stake must be between K${DEFAULT_QUIZ_CONFIG.minStake} and K${DEFAULT_QUIZ_CONFIG.maxStake}`);
    }

    return await transaction(GamePlay.knex(), async (trx) => {
      // 1. Verify user is active
      const user = await User.query(trx).findById(userId);
      if (!user || !user.is_active) {
        throw new Error('User not found or inactive');
      }

      // 2. Deduct the entry fee
      await this.walletService.deduct(userId, stake, 'bet', {
        game_type: 'quiz',
      });

      // 3. Pick 5 questions using the RNG. We shuffle the bank and take 5.
      const { seed, random } = this.rngService.generateRandom();
      const picked = pickQuestions(QUESTION_BANK, DEFAULT_QUIZ_CONFIG.questionsPerRound, random);

      // 4. Roll per-question correctness using additional RNG draws so the
      // seed is mixed across rolls.
      const perQuestion = picked.map((q) => {
        const { random: r } = this.rngService.generateRandom();
        return rollCorrect(q.difficulty, r);
      });
      const correctCount = perQuestion.filter(Boolean).length;

      // 5. Compute payout
      const multiplier = DEFAULT_QUIZ_CONFIG.payoutByCorrect[correctCount] ?? 0;
      const payout = Math.floor(stake * multiplier);

      // 6. Credit winnings if any
      if (payout > 0) {
        await this.walletService.credit(userId, payout, 'win', {
          game_type: 'quiz',
          correct_count: correctCount,
          multiplier,
        });
      }

      // 7. Save game play record
      const gamePlay = await GamePlay.query(trx).insert({
        user_id: userId,
        game_type: 'quiz',
        stake,
        bet_data: {
          question_ids: picked.map((q) => q.id),
          correct_count: correctCount,
        },
        result: {
          correct_count: correctCount,
          per_question: perQuestion,
          multiplier,
        },
        payout,
        rng_seed: seed,
      });

      // 8. New balance
      const walletInfo = await this.walletService.getBalance(userId);

      return {
        id: gamePlay.id,
        stake,
        correctCount,
        multiplier,
        payout,
        newBalance: walletInfo.balance,
        // Send the 5 questions to the client, with the correct answer
        // stripped. The frontend only needs the question, options,
        // difficulty, prize, and time limit.
        questions: picked.map((q, i) => ({
          id: q.id,
          question: q.question,
          options: q.options,
          category: q.category,
          difficulty: q.difficulty,
          prizeAmount: q.prizeAmount,
          timeLimit: q.timeLimit,
          // Include a *display-only* flag so the frontend can render the
          // green check / red X on the answer screen, but the *server*
          // is the source of truth for `payout`.
          _wasCorrect: perQuestion[i],
        })),
      };
    });
  }
}

function pickQuestions(
  bank: QuizQuestion[],
  count: number,
  rng: number,
): QuizQuestion[] {
  // Simple deterministic Fisher-Yates using successive RNG draws. The RNG
  // service returns a number in [0, 1); we mix it into a stable integer.
  const arr = [...bank];
  const seed = Math.floor(rng * 1_000_000);
  let s = seed || 1;
  const rand = () => {
    // xorshift32
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return (s % 1_000_000) / 1_000_000;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, count);
}
