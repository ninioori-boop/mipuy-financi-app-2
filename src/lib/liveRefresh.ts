// Bridge so UI outside DataSync (the impersonation banner's "load the latest
// version" button in advisor VIEW mode) can trigger a refresh that must run
// INSIDE DataSync, where the sync refs live. Same shape as saveBaseline.ts.
let handler: (() => void) | null = null

export function registerLiveRefresh(fn: (() => void) | null) { handler = fn }

/** True when DataSync is mounted and listening — the button hides otherwise. */
export function liveRefreshReady(): boolean { return handler !== null }

export function requestLiveRefresh() { handler?.() }
