import { registerServiceWorker, SKIP_WAITING } from './registerSW';

function setup({ controlled, waiting }: { controlled: boolean; waiting: boolean }) {
  const container = new EventTarget() as EventTarget & {
    controller: object | null;
    register: ReturnType<typeof vi.fn>;
  };
  const worker = { postMessage: vi.fn() };
  const registration = {
    waiting: waiting ? worker : null,
    update: vi.fn(async () => undefined),
  };
  container.controller = controlled ? {} : null;
  container.register = vi.fn(async () => registration);
  const reload = vi.fn();
  const run = (base = '/app/') =>
    registerServiceWorker({
      container: container as unknown as ServiceWorkerContainer,
      base,
      reload,
    });
  return { container, worker, registration, reload, run };
}

describe('registerServiceWorker', () => {
  it('registers sw.js under the Vite base with a matching scope', async () => {
    const { container, run } = setup({ controlled: false, waiting: false });
    await run('/app/');
    expect(container.register).toHaveBeenCalledWith('/app/sw.js', { scope: '/app/' });
  });

  it('applies a waiting update at startup and reloads once', async () => {
    const { container, worker, reload, run } = setup({ controlled: true, waiting: true });
    await run();
    expect(worker.postMessage).toHaveBeenCalledWith(SKIP_WAITING);
    expect(reload).not.toHaveBeenCalled();
    container.dispatchEvent(new Event('controllerchange'));
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload on the first install', async () => {
    const { container, worker, reload, run } = setup({ controlled: false, waiting: true });
    await run();
    container.dispatchEvent(new Event('controllerchange'));
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('does nothing when no update is waiting', async () => {
    const { container, reload, run } = setup({ controlled: true, waiting: false });
    await run();
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).not.toHaveBeenCalled();
  });

  it('checks for updates when the app returns to the foreground', async () => {
    const { registration, run } = setup({ controlled: true, waiting: false });
    await run();
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(registration.update).not.toHaveBeenCalled();
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(registration.update).toHaveBeenCalledTimes(1);
    visibility.mockRestore();
  });
});
