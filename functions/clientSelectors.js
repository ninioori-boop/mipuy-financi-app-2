/**
 * Pure financial selectors over a client's snapshot (`users/{uid}.data`), mirrored
 * from the weekly-digest selectors in functions/index.js. Used by clientBot.js to
 * answer budget/spend questions from AGGREGATES ONLY — never raw transactions or
 * merchant names (privacy red line: detail stays behind the app link).
 *
 * Kept as a separate module so both index.js (later) and clientBot.js can share
 * one implementation instead of drifting.
 */

const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0);
const ils = (n) => "₪" + Math.round(num(n)).toLocaleString("he-IL");
const sumAmt = (rows) => (Array.isArray(rows) ? rows.reduce((s, r) => s + num(r && r.amount), 0) : 0);

/** Current UTC year-month, e.g. "2026-07". */
function ymNowUTC() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Monthly income / expenses / cashflow from the client's mapping (budget model). */
function clientTotals(data) {
  const m = (data && data.mapping) || {};
  const varMonths = Math.max(1, num(m.varMonths) || 1);
  const income = sumAmt(m.income);
  const varMo = sumAmt(m.variable) / varMonths;
  const annMo = (Array.isArray(m.annual) ? m.annual.reduce((s, r) => s + num(r && r.annualAmount), 0) : 0) / 12;
  const debtMo = Array.isArray(m.debts) ? m.debts.reduce((s, r) => s + num(r && r.monthlyPayment), 0) : 0;
  const instMo = Array.isArray(m.installments) ? m.installments.reduce((s, r) => s + num(r && r.monthlyPayment), 0) : 0;
  const expenses = sumAmt(m.fixed) + sumAmt(m.sub) + sumAmt(m.ins) + varMo + annMo + debtMo + instMo;
  return { income: Math.round(income), expenses: Math.round(expenses), cashflow: Math.round(income - expenses) };
}

/**
 * This-month budget standing from the real-time expense log.
 * Extends the index.js version by also returning `spentByCat` + `budgets` so the
 * bot can report "how much is left" per category.
 */
function budgetActivity(data) {
  const ym = ymNowUTC();
  const entries = (data && data.expenseLog && Array.isArray(data.expenseLog.entries)) ? data.expenseLog.entries : [];
  const budgets = (data && data.categoryBudgets && data.categoryBudgets.budgets) || {};

  let monthSpent = 0;
  const spentByCat = {};
  for (const e of entries) {
    if (!e || typeof e.date !== "string") continue;
    if (e.date.slice(0, 7) !== ym) continue;
    const amt = num(e.amount);
    monthSpent += amt;
    spentByCat[e.category] = (spentByCat[e.category] || 0) + amt;
  }
  const overCats = [];
  for (const cat of Object.keys(spentByCat)) {
    const cap = num(budgets[cat]);
    if (cap > 0 && spentByCat[cat] > cap) overCats.push({ cat, spent: Math.round(spentByCat[cat]), cap: Math.round(cap) });
  }
  const totalBudget = Object.keys(budgets).reduce((s, k) => s + num(budgets[k]), 0);
  return {
    monthSpent: Math.round(monthSpent),
    totalBudget: Math.round(totalBudget),
    overCats,
    spentByCat,
    budgets,
    hasBudget: totalBudget > 0,
  };
}

/**
 * Compact Hebrew AGGREGATE summary for grounding the bot's answers. Lists totals,
 * per-category budget standing (spent / cap / remaining), and goals. No merchant
 * names, no individual transactions — this is what may be sent to the model.
 */
function summaryText(data) {
  const t = clientTotals(data);
  const ba = budgetActivity(data);
  const m = (data && data.mapping) || {};
  const L = [];
  L.push(`הכנסה חודשית: ${ils(t.income)} · הוצאות חודשיות (לפי התקציב): ${ils(t.expenses)} · תזרים: ${ils(t.cashflow)}`);
  L.push(ba.hasBudget
    ? `תקציב חודשי כולל: ${ils(ba.totalBudget)} · סה"כ הוצאת החודש (יומן): ${ils(ba.monthSpent)}`
    : "עדיין לא הוגדר תקציב חודשי.");
  if (ba.hasBudget) {
    const lines = Object.keys(ba.budgets)
      .filter((c) => num(ba.budgets[c]) > 0)
      .map((c) => {
        const cap = num(ba.budgets[c]);
        const spent = num(ba.spentByCat[c]);
        const left = Math.round(cap - spent);
        return `  ${c}: הוצאת ${ils(spent)} מתוך ${ils(cap)}, נשאר ${ils(left)}`;
      });
    if (lines.length) L.push("סטטוס קטגוריות החודש:\n" + lines.join("\n"));
  }
  const savingsMo = Array.isArray(m.savings) ? m.savings.reduce((s, r) => s + num(r && r.monthlyContribution), 0) : 0;
  const savingsBal = Array.isArray(m.savings) ? m.savings.reduce((s, r) => s + num(r && r.accumulated), 0) : 0;
  if (savingsMo || savingsBal) L.push(`חיסכון חודשי: ${ils(savingsMo)} · נצבר: ${ils(savingsBal)}`);
  // Total only — account NAMES are free-text (a user may name one "לאומי 12-345")
  // so they never go to the model/WhatsApp; per-account detail stays in the app.
  const bankTotal = Array.isArray(m.bankAccounts) ? m.bankAccounts.reduce((s, b) => s + num(b && b.balance), 0) : 0;
  if (Array.isArray(m.bankAccounts) && m.bankAccounts.length) L.push(`יתרת עו"ש (סה"כ): ${ils(bankTotal)}`);
  const goals = [];
  const g = (data && data.goals) || {};
  for (const h of ["short", "medium", "long"]) {
    if (Array.isArray(g[h])) for (const goal of g[h]) {
      if (goal && (goal.name || num(goal.required) > 0)) goals.push(`${goal.name || "יעד"} (${ils(goal.current)}/${ils(goal.required)})`);
    }
  }
  if (goals.length) L.push(`יעדים: ${goals.join(", ")}`);
  return L.join("\n");
}

module.exports = { num, ils, sumAmt, ymNowUTC, clientTotals, budgetActivity, summaryText };
