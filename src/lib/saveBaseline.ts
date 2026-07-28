// Bridge for out-of-band snapshot writers (e.g. the transaction-inbox drain):
// DataSync registers how to record such a write so the anti-clobber baseline
// treats it as OUR OWN save instead of flagging it as a foreign conflict.
//
// The caller passes the JSON it actually WROTE. Re-collecting here would pick
// up whatever the user typed during the network round-trip and mark it as
// saved — those keystrokes would then never be persisted, and the write's own
// echo would not match the recorded baseline (a bogus conflict prompt).
let bump: ((writtenJson: string) => void) | null = null

export function registerSaveBaselineBump(fn: ((writtenJson: string) => void) | null) {
  bump = fn
}

/** Call right after a successful direct saveUserData() outside DataSync. */
export function bumpSaveBaseline(writtenJson: string) {
  bump?.(writtenJson)
}
