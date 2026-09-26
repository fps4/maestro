// The console renders on request and caches nothing: no ISR, no tag cache (console/README.md,
// "Say what the console is"). The build then produces neither a cache directory nor a seeder.
const config = {
  default: {},
  dangerous: { disableIncrementalCache: true, disableTagCache: true },
};
export default config;
