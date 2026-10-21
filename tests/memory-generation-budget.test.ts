import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('真实生成脚本默认拒绝运行，不能因普通测试或执行命令而自动收费', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/check-memory-generation.ts'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /需要用户另行授权真实生成测试/u);
  assert.equal(result.stdout, '');
});

test('真实生成授权参数不能绕过限定模型/端点预算', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/check-memory-generation.ts', '--allow-paid'], {
    encoding: 'utf8', env: { ...process.env, LLM_BASE_URL: 'https://api.siliconflow.cn/v1', LLM_MODEL: 'outside-approved-budget', LLM_API_KEY: 'fake-test-key' },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /此验收预算仅覆盖硅基流动 DeepSeek-V4.1-Flash/u);
  assert.equal(result.stdout, '');
});
