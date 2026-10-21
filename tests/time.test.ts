import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseTaskTime, taskTimeRange } from '../src/time.js';

const now = new Date('2026-10-20T00:00:00.000Z');

for (const [input, expected] of [
  ['明天上午 9 点', '2026-10-21T01:00:00.000Z'],
  ['明天上午九点', '2026-10-21T01:00:00.000Z'],
  ['后天下午三点半', '2026-10-22T07:30:00.000Z'],
  ['今天晚上八点十分', '2026-10-20T12:10:00.000Z'],
  ['今天中午十二点', '2026-10-20T04:00:00.000Z'],
  ['10分钟后', '2026-10-20T00:10:00.000Z'],
  ['两小时后', '2026-10-20T02:00:00.000Z'],
  ['2026-10-21T09:00:00+08:00', '2026-10-21T01:00:00.000Z'],
  ['2026-10-21 09:00', '2026-10-21T01:00:00.000Z'],
] as const) {
  test(`时间解析 ${input}`, () => assert.equal(parseTaskTime(input, 'Asia/Taipei', now), expected));
}

test('服务器 TZ 不影响用户的“明天”', () => {
  const previous = process.env.TZ;
  try {
    for (const serverZone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
      process.env.TZ = serverZone;
      assert.equal(parseTaskTime('明天上午9点', 'Asia/Taipei', now), '2026-10-21T01:00:00.000Z');
    }
    assert.equal(parseTaskTime('明天上午9点', 'America/New_York', now), '2026-10-20T13:00:00.000Z');
  } finally {
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
});

test('拒绝时间歧义、过去时间和非法日期', () => {
  for (const input of ['明天9点', '过一会儿', '0分钟后', '今天上午7点', '2026-02-30T12:00:00Z', '明天下午25点', '明天上午9点60分', '明天晚上12点', '明天晚上零点', '明天晚上1点']) {
    assert.throws(() => parseTaskTime(input, 'Asia/Taipei', now), Error, input);
  }
  assert.throws(() => parseTaskTime('明天上午9点', '+08:00', now));
  assert.throws(() => parseTaskTime('明天上午9点', 'Invalid/Zone', now));
});

test('夏令时重叠和不存在的时间必须显式指定偏移', () => {
  const before = new Date('2026-01-01T00:00:00Z');
  assert.throws(() => parseTaskTime('2026-03-08 02:30', 'America/New_York', before), /夏令时/);
  assert.throws(() => parseTaskTime('2026-11-01 01:30', 'America/New_York', before), /夏令时/);
  assert.equal(parseTaskTime('2026-11-01T01:30:00-04:00', 'America/New_York', before), '2026-11-01T05:30:00.000Z');
  assert.throws(() => parseTaskTime('1天后', 'America/New_York', new Date('2026-03-07T07:30:00Z')), /夏令时/);
  assert.throws(() => parseTaskTime('明天凌晨两点半', 'America/New_York', new Date('2026-03-07T07:30:00Z')), /夏令时/);
});

test('常见自然时间别名与筛选时段：不为含糊提醒补造几点', () => {
  for (const input of ['过两分钟', '过两分钟后', '过两分钟之后', '两分钟之后']) assert.equal(parseTaskTime(input, 'Asia/Shanghai', now), '2026-10-20T00:02:00.000Z');
  assert.equal(parseTaskTime('晚上8点', 'Asia/Shanghai', now), '2026-10-20T12:00:00.000Z');
  assert.equal(parseTaskTime('明早九点', 'Asia/Shanghai', now), '2026-10-21T01:00:00.000Z');
  assert.deepEqual(taskTimeRange('明天早上', 'Asia/Shanghai', now), ['2026-10-20T22:00:00.000Z', '2026-10-21T04:00:00.000Z']);
  assert.throws(() => parseTaskTime('明天早上', 'Asia/Shanghai', now));
  assert.throws(() => parseTaskTime('洗完澡', 'Asia/Shanghai', now));
});
