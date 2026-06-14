import '../src/app';
import { GameConfig } from '../src/models/GameConfig';
import { GameEconomyService } from '../src/services/game-economy.service';
import { BonusService } from '../src/services/bonus.service';

async function main() {
  const configs = await GameConfig.query();
  const svc = new GameEconomyService();
  const bonusService = new BonusService();

  console.log('\n=== Game configs ===');
  for (const c of configs) {
    const info = await svc.getDisplayInfo(c.game_type).catch(() => null);
    console.log(
      c.game_type,
      '-> RTP:',
      info?.rtp,
      'House:',
      info?.house_margin,
      'MaxMult:',
      info?.max_multiplier,
      'Stake:',
      `K${c.min_stake}-K${c.max_stake}`
    );
  }

  const settings = await bonusService.getSettings();
  console.log('\n=== Onboarding bonus settings ===');
  console.log(settings);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
