export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.DATABASE_URL) {
    const { startEngine } = await import('./lib/engine');
    await startEngine();
  }
}
