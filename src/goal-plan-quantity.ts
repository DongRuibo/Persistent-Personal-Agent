// 只识别可逐字核对的数量口径；一项安排、一个任务、一道题都不是一个正式Step的同义词。
const number = '[0-9零〇一二两三四五六七八九十百]+';
const stepUnit = '(?:个)?(?:步骤|步|Step)(?![a-z])';
const planPrefix = '(?<!子)(?:正式)?(?:计划|Plan)(?:的)?(?:步骤数量|步骤数|总步数|Step数)?[：:]?(?:(?:只|仅)(?:能)?(?:包含|保留|有)?|包含|保留|设为|分为|分成|有)?';
const clauses = (text: string): string[] => text.normalize('NFKC')
  .replace(/「[^」]*」|『[^』]*』|“[^”]*”|‘[^’]*’|"[^"]*"|'[^']*'|`[^`]*`/gu, ' ')
  .split(/[。；;，,\n]/u).map(s => s.replace(/\s+/gu, ''))
  .filter(s => !/如果|假如|假设|例如|示例|他说|她说|不是|不等于|不要把|别把/u.test(s));
function count(value: string): number {
  if (/^\d+$/u.test(value)) return Number(value);
  const digits = '零一二三四五六七八九';
  if (value === '两') return 2;
  if (/^[一二三四五六七八九]$/u.test(value)) return digits.indexOf(value);
  if (/^[一二三四五六七八九]?十[一二三四五六七八九]?$/u.test(value)) {
    const [tens, units] = value.split('十');
    return (tens ? digits.indexOf(tens) : 1) * 10 + (units ? digits.indexOf(units) : 0);
  }
  return NaN;
}

export class GoalPlanQuantityError extends Error {}

export function planQuantity(objective: string): { min: number; max: number; arrangements: number[]; evidence: string[] } {
  let min = 1, max = 12;
  const arrangements: number[] = [], evidence: string[] = [];
  for (const clause of clauses(objective)) {
    const range = new RegExp(`${planPrefix}(${number})(?:至|到|-)(${number})${stepUnit}`, 'giu');
    for (const match of clause.matchAll(range)) {
      const low = count(match[1]!), high = count(match[2]!); evidence.push(match[0]);
      if (!Number.isSafeInteger(low) || !Number.isSafeInteger(high) || low < 1 || low > high) min = 13;
      else { min = Math.max(min, low); max = Math.min(max, high); }
    }
    const formal = new RegExp(`${planPrefix}(最多|至多|不超过|不得超过|不要超过|至少|不少于|恰好|正好|总共|一共|只|仅)?(?:包含|保留|有)?(${number})${stepUnit}(以内|之内)?`, 'giu');
    for (const match of clause.matchAll(formal)) {
      const n = count(match[2]!); evidence.push(match[0]);
      if (!Number.isSafeInteger(n) || n < 1) { min = 13; continue; }
      if (match[3] || /最多|至多|不超过|不得超过|不要超过/u.test(match[1] ?? '')) max = Math.min(max, n);
      else if (/至少|不少于/u.test(match[1] ?? '')) min = Math.max(min, n);
      else { min = Math.max(min, n); max = Math.min(max, n); }
    }
    const arrangement = new RegExp(`(?:计划(?:只|仅)?(?:包含|安排|有)?|(?:只|仅)安排)(${number})项(?!项|步骤|Step)`, 'giu');
    for (const match of clause.matchAll(arrangement)) {
      const n = count(match[1]!); if (Number.isSafeInteger(n) && n > 0) arrangements.push(n);
    }
  }
  return { min, max, arrangements: [...new Set(arrangements)], evidence };
}

export function validatePlanQuantity(objective: string, steps: number): void {
  const { min, max, evidence } = planQuantity(objective);
  if (min > max || steps < min || steps > max) throw new GoalPlanQuantityError(
    `计划数量约束不符：原话「${evidence.join('；')}」，草稿为${steps}个正式Step；请澄清或调整草稿，不自动裁剪或重试`);
}

export function planQuantityQuestion(objective: string, steps: number): string | undefined {
  try { validatePlanQuantity(objective, steps); }
  catch (error) { if (error instanceof GoalPlanQuantityError) return error.message; throw error; }
  const { arrangements, evidence } = planQuantity(objective);
  // 用户已分别给出正式Step边界时，安排和Step的数量口径已经分开，不再把二者强行对齐。
  if (evidence.length) return undefined;
  if (arrangements.length && steps > 1) return `数量口径待确认：原话限定${arrangements.join('/')}项安排，草稿有${steps}个正式Step。一项安排可含子步骤，但宿主不能证明这些Step仍属于原安排；请核对完整内容。若接受拆解，请明确说“批准计划，允许将${arrangements[0]}项安排拆成${steps}步”；否则调整草稿。短确认不能代替该决定。`;
  return undefined;
}

export function validateQuantityApproval(objective: string, steps: number, text: string): void {
  validatePlanQuantity(objective, steps);
  const question = planQuantityQuestion(objective, steps);
  if (!question) return;
  const { arrangements } = planQuantity(objective);
  const acknowledged = arrangements.length === 1 && clauses(text).some(clause => {
    const match = clause.match(new RegExp(`^允许(?:将|把)(${number})项安排(?:拆成|分成)(${number})${stepUnit}$`, 'iu'));
    return match && count(match[1]!) === arrangements[0] && count(match[2]!) === steps;
  });
  if (!acknowledged) throw new GoalPlanQuantityError(question);
}
