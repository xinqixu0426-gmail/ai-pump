type Entry = { refresh: () => Promise<boolean | void>; revision: string | null; generation: number };

export function createRevisionRefresh(readRevision: () => Promise<string>) {
  const entries = new Set<Entry>();
  let pending: Promise<void> | null = null;
  return {
    subscribe(refresh: Entry['refresh']) {
      const entry: Entry = { refresh, revision: null, generation: 0 };
      entries.add(entry);
      return () => { entries.delete(entry); };
    },
    invalidate() {
      for (const entry of entries) { entry.revision = null; entry.generation += 1; }
    },
    tick(): Promise<void> {
      if (pending) return pending;
      if (!entries.size) return Promise.resolve();
      pending = (async () => {
        const revision = await readRevision();
        if (typeof revision !== 'string' || !revision) throw new Error('Invalid revision');
        await Promise.allSettled([...entries].map(async entry => {
          if (entry.revision === revision) return;
          const generation = entry.generation;
          const success = await entry.refresh();
          if (success !== false && entries.has(entry) && generation === entry.generation) entry.revision = revision;
        }));
      })().catch(() => {
        // Revalidate resources after a server/network interruption even if the
        // returned revision is unchanged (for example after a restart).
        for (const entry of entries) { entry.revision = null; entry.generation += 1; }
      }).finally(() => { pending = null; });
      return pending;
    },
  };
}
