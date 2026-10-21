import { Temporal } from '@js-temporal/polyfill';
import { validateTimeZone } from './config.js';

const help = '时间无法确定。请使用“明天上午9点”“10分钟后”或带偏移的 ISO 时间，例如 2026-10-21T09:00:00+08:00。';

function chineseNumber(text: string): number {
  if (/^\d+$/.test(text)) return Number(text);
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (text === '十') return 10;
  if (text.includes('十')) {
    const parts = text.split('十');
    if (parts.length !== 2) return NaN;
    const [tens, ones] = parts;
    return (tens ? digits[tens]! : 1) * 10 + (ones ? digits[ones]! : 0);
  }
  return digits[text] ?? NaN;
}

// 有界语法，不用 Date.parse 解析本地时间，也不让 LLM 换算用户时区。
export function parseTaskTime(input: string, timeZone: string, now = new Date()): string {
  validateTimeZone(timeZone);
  const text = input.trim().replace(/\s+/g, '').replace(/之后$/u, '后').replace(/^过(.+?)(?:后)?$/u, '$1后')
    .replace(/^明早/u, '明天早上').replace(/^(凌晨|早上|上午|中午|下午|晚上)/u, '今天$1');
  const instant = Temporal.Instant.from(now.toISOString());
  let result: Temporal.Instant;
  try {
    if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(text)) {
      result = Temporal.Instant.from(text);
    } else {
      const relative = text.match(/^(\d+|[一二两三四五六七八九十]+)(秒|分钟|小时|天)后$/);
      if (relative) {
        const amount = chineseNumber(relative[1]!);
        const unit = relative[2]!;
        if (!Number.isSafeInteger(amount) || amount < 1) throw new Error(help);
        // “N天后”按用户当地日历；分钟、小时按实际经过时长。
        result = unit === '天'
          ? instant.toZonedDateTimeISO(timeZone).toPlainDateTime().add({ days: amount })
            .toZonedDateTime(timeZone, { disambiguation: 'reject' }).toInstant()
          : instant.add({ seconds: amount * ({ 秒: 1, 分钟: 60, 小时: 3600 }[unit]!) });
      } else {
        const local = text.match(/^(\d{4}-\d{2}-\d{2})[T ]?(\d{2}):(\d{2})(?::(\d{2}))?$/);
        const natural = text.match(/^(今天|明天|后天)(凌晨|早上|上午|中午|下午|晚上)?([\d零一二两三四五六七八九十]+)[点时](?:(半)|([\d零一二两三四五六七八九十]+)分?)?$/);
        let date: string;
        let hour: number;
        let minute: number;
        let second = 0;
        if (local) {
          date = local[1]!;
          hour = Number(local[2]);
          minute = Number(local[3]);
          second = Number(local[4] ?? 0);
        } else if (natural) {
          const today = instant.toZonedDateTimeISO(timeZone).toPlainDate();
          date = today.add({ days: { 今天: 0, 明天: 1, 后天: 2 }[natural[1]!]! }).toString();
          hour = chineseNumber(natural[3]!);
          minute = natural[4] ? 30 : natural[5] ? chineseNumber(natural[5]) : 0;
          const period = natural[2];
          if (!period) throw new Error(help); // “明天9点”不猜上午或晚上。
          if (hour > 12 || hour < 0) throw new Error(help);
          // “晚上12点/1点”等存在跨日歧义，要求日期和偏移明确。
          if (period === '晚上' && (hour === 12 || hour < 6)) throw new Error(help);
          if (['下午', '晚上'].includes(period) && hour < 12) hour += 12;
          if (period === '凌晨' && hour === 12) hour = 0;
          if (['早上', '上午'].includes(period) && hour === 12) throw new Error(help);
          if (period === '中午' && hour >= 1 && hour <= 2) hour += 12;
          if (period === '中午' && ![11, 12, 13, 14].includes(hour)) throw new Error(help);
        } else {
          throw new Error(help);
        }
        const plain = Temporal.PlainDateTime.from(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`);
        // DST 重叠/不存在的本地时间要求用户补偏移，绝不自动挪动。
        result = plain.toZonedDateTime(timeZone, { disambiguation: 'reject' }).toInstant();
      }
    }
  } catch {
    throw new Error(help + ' 夏令时重复或不存在的时间请显式提供 UTC 偏移。');
  }
  if (Temporal.Instant.compare(result, instant) <= 0) throw new Error('执行时间必须晚于当前时间');
  return new Date(Number(result.epochMilliseconds)).toISOString();
}

// 仅用于筛选已有任务；“明天早上”不能作为新任务的精确执行时间。
export function taskTimeRange(input: string, timeZone: string, now = new Date()): [string, string] {
  const text = input.replace(/\s+/gu, '').replace(/^明早/u, '明天早上');
  const match = /^(今天|明天|后天)(早上|上午|下午|晚上)?$/u.exec(text);
  if (!match) {
    const time = parseTaskTime(input, timeZone, now);
    return [time, new Date(Date.parse(time) + 1000).toISOString()];
  }
  const date = Temporal.Instant.from(now.toISOString()).toZonedDateTimeISO(timeZone).toPlainDate()
    .add({ days: { 今天: 0, 明天: 1, 后天: 2 }[match[1]!]! });
  const [start, end] = ({ 早上: [6, 12], 上午: [6, 12], 下午: [12, 18], 晚上: [18, 24] }[match[2] ?? ''] ?? [0, 24]) as [number, number];
  const at = (hour: number) => date.toPlainDateTime().add({ hours: hour }).toZonedDateTime(timeZone, { disambiguation: 'reject' }).toInstant().toString();
  return [new Date(at(start)).toISOString(), new Date(at(end)).toISOString()];
}
