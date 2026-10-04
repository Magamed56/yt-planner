/**
 * Title recipes — "ONE GAME → MANY VIDEOS". Each recipe is a different video
 * concept built from the same game: a scenario + take + generator flags +
 * hook caption + metadata. Recipes change WHAT happens on screen, not just
 * the title.
 */
import type { VideoScenario } from '@engine/video/VideoConfig';

export interface VideoRecipe {
  id: string;
  title: string;
  hook: string;
  scenario: VideoScenario;
  take: number;
  difficulty?: 'EASY' | 'NORMAL' | 'HARD' | 'INSANE' | 'IMPOSSIBLE';
  specialEvents?: string[];
  cameraStyle?: 'dynamic' | 'smooth' | 'classic' | 'shorts';
  /** which moment the highlight finder should centre on */
  focus: 'chase' | 'nearDeath' | 'fail' | 'boss' | 'finish' | 'surprise';
  /** caption shown at the climax */
  climax?: string;
  /** caption shown at the end */
  outro?: string;
  tags: string[];
  description: string;
}

export const RECIPES: VideoRecipe[] = [
  {
    id: 'CAN_I_ESCAPE',
    title: 'Can I Escape The Factory?',
    hook: 'CAN I ESCAPE?!',
    scenario: 'CHASE',
    take: 1,
    focus: 'chase',
    climax: 'RUN!!!',
    outro: 'I ESCAPED!',
    tags: ['escape', 'obby', 'chase', 'monster'],
    description: 'Pip wakes up inside a giant factory… and Grumbo is coming. Can Pip escape?',
  },
  {
    id: 'MONSTER_FASTER',
    title: 'The Monster Got Faster!',
    hook: 'HE GOT FASTER?!',
    scenario: 'CHASE',
    take: 6,
    difficulty: 'HARD',
    specialEvents: ['doubleChase'],
    focus: 'chase',
    climax: 'TOO FAST!',
    tags: ['chase', 'monster', 'hard mode'],
    description: 'Grumbo had extra coal today. Every lunge gets closer…',
  },
  {
    id: 'ALMOST_DIED',
    title: 'I Almost Died!',
    hook: 'I ALMOST DIED…',
    scenario: 'NEAR_DEATH',
    take: 3,
    difficulty: 'NORMAL',
    focus: 'nearDeath',
    climax: 'SO CLOSE!',
    tags: ['near death', 'close call', 'obby'],
    description: 'Crushers, lasers and spinners — every single one missed by centimetres.',
  },
  {
    id: 'ONE_JUMP',
    title: 'Only One Jump Saved Me!',
    hook: 'ONE JUMP…',
    scenario: 'NEAR_DEATH',
    take: 3,
    specialEvents: ['more:JUMP', 'more:MOVING_PLATFORM'],
    focus: 'nearDeath',
    climax: 'JUMP!!!',
    tags: ['parkour', 'jump', 'clutch'],
    description: 'One perfectly timed jump was the only thing between Pip and Grumbo.',
  },
  {
    id: 'FLOOR_DISAPPEARED',
    title: 'The Floor Disappeared!',
    hook: 'THE FLOOR!!',
    scenario: 'CHAOS',
    take: 5,
    specialEvents: ['more:TRAP', 'more:DISAPPEARING_PLATFORM', 'floorCollapse', 'debris'],
    focus: 'surprise',
    climax: "DON'T STOP!",
    tags: ['floor is lava', 'trap', 'chaos'],
    description: 'The factory floor started falling apart behind Pip. Keep running!',
  },
  {
    id: 'IMPOSSIBLE_ESCAPE',
    title: 'Impossible Factory Escape!',
    hook: 'IMPOSSIBLE MODE',
    scenario: 'IMPOSSIBLE',
    take: 4,
    difficulty: 'IMPOSSIBLE',
    focus: 'nearDeath',
    climax: 'NO WAY!',
    outro: 'IMPOSSIBLE?!',
    tags: ['impossible', 'hardest', 'speedrun'],
    description: 'The hardest settings the factory has. Is it even possible?',
  },
  {
    id: 'RIGHT_BEHIND_ME',
    title: 'The Monster Was RIGHT Behind Me!',
    hook: "DON'T LOOK BACK",
    scenario: 'CHASE',
    take: 6,
    cameraStyle: 'shorts',
    focus: 'chase',
    climax: 'HE IS RIGHT THERE!',
    tags: ['monster', 'jumpscare', 'chase'],
    description: 'Grumbo was one step away the whole time…',
  },
  {
    id: 'EVERYTHING_WRONG',
    title: 'Everything Went Wrong!',
    hook: 'EVERYTHING WENT WRONG',
    scenario: 'CHAOS',
    take: 2,
    specialEvents: ['chaos', 'more:FALLING_OBJECT', 'alarm', 'lightsFlicker'],
    focus: 'fail',
    climax: 'NOOO!',
    tags: ['fail', 'chaos', 'funny'],
    description: 'Alarms, falling crates, a collapsing floor… and then Grumbo showed up.',
  },
  {
    id: 'BOSS_ESCAPE',
    title: 'I Escaped The Factory Boss!',
    hook: 'BOSS FIGHT!',
    scenario: 'BOSS_ESCAPE',
    take: 1,
    difficulty: 'NORMAL',
    focus: 'boss',
    climax: 'DODGE!',
    outro: 'HE FELL!',
    tags: ['boss fight', 'escape', 'monster'],
    description: 'Grumbo blocks the exit and starts smashing the floor. Only one way out.',
  },
  {
    id: 'PERFECT_RUN',
    title: 'Perfect Run — No Deaths!',
    hook: 'NO DEATHS?',
    scenario: 'PERFECT_RUN',
    take: 1,
    focus: 'finish',
    outro: 'PERFECT!',
    tags: ['perfect run', 'no death', 'satisfying'],
    description: 'Not a single mistake from start to finish.',
  },
  {
    id: 'CAUGHT',
    title: 'He Caught Me…',
    hook: 'WAIT… NO!',
    scenario: 'FAIL',
    take: 2,
    specialEvents: ['doubleChase'],
    focus: 'fail',
    climax: 'CAUGHT!',
    tags: ['fail', 'caught', 'monster'],
    description: 'One tiny mistake and Grumbo got Pip. Will Pip try again?',
  },
  {
    id: 'PICK_A_DOOR',
    title: 'Pick The Right Door!',
    hook: 'WHICH DOOR?',
    scenario: 'CHASE',
    take: 2,
    specialEvents: ['more:DOOR', 'more:WALL'],
    focus: 'surprise',
    climax: 'WRONG DOOR!',
    tags: ['choose', 'doors', 'puzzle'],
    description: 'Three doors. Two slam shut. Grumbo is waiting behind one of them.',
  },
];

export function recipe(id: string): VideoRecipe | undefined {
  return RECIPES.find((r) => r.id === id.toUpperCase());
}
