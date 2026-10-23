import { Temporal } from '@js-temporal/polyfill';
import { validateTimeZone } from './config.js';
import type { GoalSchedule } from './goal-policy-types.js';

export function utc(value: string): void {
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('必须使用规范 UTC ISO 时间');
}

// 每个本地日期最多一次；DST 重叠/缺口跳过该日期，不猜偏移、不集中补跑历史周期。
export function nextWake(schedule: GoalSchedule, after: string): string | null {
  utc(after); validateTimeZone(schedule.timeZone);
  if (schedule.kind === 'once') { utc(schedule.at); return schedule.at > after ? schedule.at : null; }
  if (!['daily', 'weekly'].includes(schedule.kind) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time)
    || schedule.kind === 'weekly' && (!Number.isInteger(schedule.weekday) || schedule.weekday! < 1 || schedule.weekday! > 7)) throw new Error('仅支持每日或每周固定 HH:mm；周一为1');
  const instant = Temporal.Instant.from(after);
  const start = instant.toZonedDateTimeISO(schedule.timeZone).toPlainDate();
  for (let day = 0; day < 370; day++) {
    const date = start.add({ days: day });
    if (schedule.kind === 'weekly' && date.dayOfWeek !== schedule.weekday) continue;
    try {
      const at = date.toPlainDateTime(Temporal.PlainTime.from(schedule.time))
        .toZonedDateTime(schedule.timeZone, { disambiguation: 'reject' }).toInstant();
      if (Temporal.Instant.compare(at, instant) > 0) return new Date(Number(at.epochMilliseconds)).toISOString();
    } catch { /* DST 当日不触发；后续日期继续按本地时钟。 */ }
  }
  throw new Error('一年内没有合法触发时间');
}
