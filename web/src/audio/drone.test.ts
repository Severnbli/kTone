import { describe, expect, it, vi } from 'vitest';
import { FakeAudioContext } from '../test/fakes';
import { Drone } from './drone';

function setup() {
  const ctx = new FakeAudioContext();
  const drone = new Drone(() => ctx.asAudioContext());
  return { ctx, drone };
}

describe('Drone', () => {
  it('plays after start and reports a system pause', async () => {
    const { ctx, drone } = setup();
    const onPause = vi.fn();
    drone.onPause = onPause;
    await drone.start(220, 0.3);
    expect(drone.playing).toBe(true);
    expect(drone.paused).toBe(false);
    expect(ctx.oscillators.every((o) => o.started)).toBe(true);

    ctx.setState('interrupted');
    expect(drone.paused).toBe(true);
    expect(onPause).toHaveBeenCalledTimes(1);

    expect(await drone.resume()).toBe(true);
    expect(drone.paused).toBe(false);
  });

  it('resume() fails when the system keeps the audio', async () => {
    const { ctx, drone } = setup();
    await drone.start(220, 0.3);
    ctx.resumeWorks = false;
    ctx.setState('suspended');
    expect(await drone.resume()).toBe(false);
  });

  it('does not report pauses while stopped', async () => {
    const { ctx, drone } = setup();
    const onPause = vi.fn();
    drone.onPause = onPause;
    await drone.start(220, 0.3);
    drone.stop();
    ctx.setState('suspended');
    expect(onPause).not.toHaveBeenCalled();
    expect(await drone.resume()).toBe(false);
  });

  it('a stop during a pending start keeps it silent', async () => {
    const { ctx, drone } = setup();
    const started = drone.start(220, 0.3);
    drone.stop();
    await started;
    expect(drone.playing).toBe(false);
    expect(ctx.oscillators).toHaveLength(0);
  });

  it('is a no-op without AudioContext', async () => {
    const drone = new Drone(() => null);
    await drone.start(220, 0.3);
    expect(drone.playing).toBe(false);
  });
});
