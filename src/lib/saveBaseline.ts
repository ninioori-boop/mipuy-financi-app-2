// Bridge for out-of-band snapshot writers (e.g. the transaction-inbox drain):
// DataSync registers how to record such a write so the anti-clobber baseline
// treats it as OUR OWN save instead of flagging it as a foreign conflict.
let bump: (() => void) | null = null

export function registerSaveBaselineBump(fn: (() => void) | null) {
  bump = fn
}

/** Call right after a successful direct saveUserData() outside DataSync. */
export function bumpSaveBaseline() {
  bump?.()
}
