export interface ClockPort {
  now(): Date;
  nowIso(): string;
}

export class SystemClock implements ClockPort {
  now(): Date {
    return new Date();
  }
  nowIso(): string {
    return new Date().toISOString();
  }
}
