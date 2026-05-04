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
}

export interface ColumnMap {
  descCol: number
  amountCol: number
  chargeAmountCol: number
  transactionAmountCol: number
  notesCol: number
  dateCol: number
}
