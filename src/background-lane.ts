// 单进程后台执行门。等待用户和前台排队不占数据库事务；不抢占已运行的片段。
export class BackgroundLane {
  private busy = false;
  private foregroundCount = 0;

  foreground(): () => void {
    this.foregroundCount++;
    let released = false;
    return () => { if (!released) { released = true; this.foregroundCount--; } };
  }

  acquire(goal = false): (() => void) | undefined {
    if (this.busy || goal && this.foregroundCount > 0) return undefined;
    this.busy = true;
    return () => { this.busy = false; };
  }
}
