// One-shot Firestore rules deployer via firebase-admin.
//
// The firebase CLI needs interactive `firebase login`; this script instead
// authenticates with the service-account-key.json (same one used by
// scripts/allow-email.ts) and pushes the current firestore.rules file to
// production. Additive rule changes only — the caller is expected to have
// diffed the file first.
//
// Run:  npx tsx scripts/deploy-firestore-rules.ts

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getSecurityRules } from 'firebase-admin/security-rules'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const RULES     = join(REPO_ROOT, 'firestore.rules')
const KEY       = join(REPO_ROOT, 'service-account-key.json')

async function main() {
  const sa = JSON.parse(readFileSync(KEY, 'utf8')) as {
    project_id: string; client_email: string; private_key: string
  }
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId:   sa.project_id,
        clientEmail: sa.client_email,
        privateKey:  sa.private_key,
      }),
    })
  }

  const source = readFileSync(RULES, 'utf8')
  console.log(`Deploying Firestore rules to project: ${sa.project_id}`)
  console.log(`Rules file: ${RULES} (${source.length} bytes)`)

  const rules = getSecurityRules()
  const ruleset = await rules.releaseFirestoreRulesetFromSource(source)
  console.log(`✅ Deployed. Ruleset name: ${ruleset.name}`)
  console.log(`   Created at: ${ruleset.createTime}`)
}

main().catch(err => {
  console.error('❌ Deploy failed:', err)
  process.exit(1)
})
