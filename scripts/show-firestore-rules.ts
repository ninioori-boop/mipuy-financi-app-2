// Read whatever ruleset is currently LIVE for the Firestore instance and
// print its source. Used to confirm that a deploy actually landed and that
// we're not looking at a stale editor draft in the Firebase Console.
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getSecurityRules } from 'firebase-admin/security-rules'

const __dirname = dirname(fileURLToPath(import.meta.url))
const KEY = join(__dirname, '..', 'service-account-key.json')

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
  const rules = getSecurityRules()
  const current = await rules.getFirestoreRuleset()
  console.log(`Currently LIVE ruleset for ${sa.project_id}`)
  console.log(`Name:       ${current.name}`)
  console.log(`Created at: ${current.createTime}`)
  console.log(`─────── source ───────`)
  for (const f of current.source) {
    console.log(f.content)
  }
  console.log(`─────── end ───────`)
}

main().catch(err => { console.error(err); process.exit(1) })
