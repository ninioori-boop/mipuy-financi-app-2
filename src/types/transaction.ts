export interface InstallmentInfo {
  current: number
  total: number
}

export interface Transaction {
  desc: string
  amount: number           // monthly charge (סכום חיוב)
  originalAmount: number | null  // total purchase (סכום עסקה) — only for installments
  category: string
  source: string
  notes: string
  date: string
  installment: InstallmentInfo | null
  isStandingOrder: boolean
  isRefund: boolean
  id?: string              // runtime-only stable id; lets in-flight AI/UI ops survive concurrent deletes (optional for back-compat)
}

export interface ColumnMap {
  descCol: number
  amountCol: number
  chargeAmountCol: number
  transactionAmountCol: number
  notesCol: number
  dateCol: number
}
