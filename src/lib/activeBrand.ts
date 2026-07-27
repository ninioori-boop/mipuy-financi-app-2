import { BRAND, type Brand } from '@/lib/brand'

// Runtime handle to the resolved brand for non-React consumers (PDF export,
// future exports) that run long after login. BrandProvider keeps it current;
// until it does, the deployment default applies.
let active: Brand = BRAND

export function setActiveBrand(b: Brand) {
  active = b
}

export function getActiveBrand(): Brand {
  return active
}
