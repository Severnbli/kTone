import { describe, expect, it } from 'vitest';
import { audioInput, fakeMediaDevices } from '../test/fakes';
import { listAudioInputs, resolveDeviceId } from './devices';

describe('listAudioInputs', () => {
  it('keeps audio inputs only and drops the `default` alias', async () => {
    const md = fakeMediaDevices([
      audioInput('default', 'Default – Built-in'),
      audioInput('a', 'Built-in'),
      { deviceId: 'out', kind: 'audiooutput', label: 'Speakers' },
      { deviceId: 'cam', kind: 'videoinput', label: 'Camera' },
      audioInput('b', 'USB'),
    ]);
    expect(await listAudioInputs(md)).toEqual({
      inputs: [
        { deviceId: 'a', label: 'Built-in' },
        { deviceId: 'b', label: 'USB' },
      ],
      locked: false,
    });
  });

  it('reports a locked list before permission (empty ids)', async () => {
    const md = fakeMediaDevices([audioInput(''), audioInput('')]);
    expect(await listAudioInputs(md)).toEqual({ inputs: [], locked: true });
  });

  it('keeps inputs with hidden labels', async () => {
    const md = fakeMediaDevices([audioInput('a'), audioInput('b')]);
    expect((await listAudioInputs(md)).inputs).toHaveLength(2);
  });

  it('handles no inputs at all', async () => {
    expect(await listAudioInputs(fakeMediaDevices())).toEqual({ inputs: [], locked: false });
  });
});

describe('resolveDeviceId', () => {
  const list = { inputs: [{ deviceId: 'a', label: '' }], locked: false };

  it('keeps a present device and the default', () => {
    expect(resolveDeviceId('a', list)).toBe('a');
    expect(resolveDeviceId('', list)).toBe('');
  });

  it('falls back to the default for a device that is gone', () => {
    expect(resolveDeviceId('gone', list)).toBe('');
    expect(resolveDeviceId('gone', { inputs: [], locked: false })).toBe('');
  });

  it('keeps the saved id while the list is locked', () => {
    expect(resolveDeviceId('a', { inputs: [], locked: true })).toBe('a');
  });
});
