type Evt = Event & { prompt: () => Promise<void>; userChoice: Promise<unknown> };

const subs = new Set<() => void>();

export const installPrompt = {
  event: null as Evt | null,
  subscribe(f: () => void) {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  },
  async prompt() {
    const e = installPrompt.event;
    if (!e) return;
    await e.prompt();
    installPrompt.event = null;
    subs.forEach((f) => f());
  }
};

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt.event = e as Evt;
    subs.forEach((f) => f());
  });
}
