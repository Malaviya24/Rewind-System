import { useEffect, useState } from "react";
import { migrate } from "./schema";

export function useAppDatabase() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function boot() {
      try {
        await migrate();
        if (mounted) {
          setReady(true);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Database setup failed");
        }
      }
    }
    boot();
    return () => {
      mounted = false;
    };
  }, []);

  return { ready, error };
}
