// Stand-in for wxt/browser in unit tests: modules that import it load, but nothing here runs.
export const browser: any = { tabs: {}, runtime: {}, alarms: {}, storage: {} };
export type Browser = any;
