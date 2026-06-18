// The client intake questionnaire — mirrors the advisor's Google Form
// "שאלון הכנה לפגישה". Each question is either a text/choice answer (stored in
// Firestore intake/{uid}.answers) or a file upload (stored in Storage, tagged
// with the question id). Edit this one list to change the form.

export type IntakeQType = 'phone' | 'text' | 'paragraph' | 'choice' | 'file'

export interface IntakeQuestion {
  id:        string
  type:      IntakeQType
  label:     string
  hint?:     string
  required?: boolean
  choices?:  string[]   // for type 'choice'
}

export const INTAKE_TITLE = 'שאלון הכנת מסמכים למיפוי'
export const INTAKE_INTRO =
  'אנא מלאו את השאלון הבא לפני הפגישה שלנו. המידע והמסמכים יעזרו לנו להתכונן ולבנות לכם מיפוי מדויק. ' +
  'התשובות נשמרות אוטומטית — אפשר לחזור ולהשלים בכל זמן.'

export const INTAKE_QUESTIONS: IntakeQuestion[] = [
  { id: 'phone',              type: 'phone',     label: 'טלפון', required: true },
  { id: 'fullNames',          type: 'text',      label: 'השמות המלאים שלכם', required: true },

  { id: 'payslips',           type: 'file',      label: 'צרפו 3 תלושי שכר אחרונים',
    hint: 'במקרה של עצמאים — פרטו את ההכנסה החודשית בשאלה הבאה' },
  { id: 'selfEmployedIncome', type: 'text',      label: 'פירוט הכנסה (עצמאים)' },

  { id: 'securitiesPortfolio',type: 'file',      label: 'תיק ניירות ערך בבנק (צילום מסך)' },
  { id: 'bankId',             type: 'file',      label: 'דוח תעודת הזהות הבנקאית (מסמך)' },

  { id: 'bankAccounts',       type: 'text',      label: 'כמה חשבונות בנק יש לכם, ובאילו בנקים?', required: true },
  { id: 'oshBalance',         type: 'text',      label: 'מה היתרה בעו"ש ברגע זה בכל חשבון?' },
  { id: 'oshReports',         type: 'file',      label: 'דוח עו"ש שלושה חודשים אחורה לכל חשבון (אקסל)' },

  { id: 'creditCardsCount',   type: 'text',      label: 'כמה כרטיסי אשראי יש לכם?' },
  { id: 'creditLimits',       type: 'text',      label: 'מה מסגרת האשראי בכל כרטיס?' },
  { id: 'creditReports',      type: 'file',      label: 'דוחות אשראי משלושת החודשים האחרונים (אקסל)' },

  { id: 'hasLoans',           type: 'choice',    label: 'האם יש לכם הלוואות / משכנתאות פעילות?', choices: ['כן', 'לא'] },
  { id: 'loanSchedules',      type: 'file',      label: 'לוח סילוקין של כל הלוואה/משכנתא (צילום/מסמך)' },

  { id: 'checkedHarHaKesef',  type: 'choice',    label: 'האם בדקתם בהר הכסף אם יש כספים על שמכם?', choices: ['כן', 'לא'] },
  { id: 'harHaKesefReports',  type: 'file',      label: 'אם כן — צרפו את הדוחות של כל הקופות שגיליתם' },

  { id: 'otherAssets',        type: 'file',      label: 'תיקי מסחר / נכסים (קרן כספית, פיקדון, מטבעות דיגיטליים, נדל"ן, פוליסת חיסכון)',
    hint: 'אם יש — צרפו צילום מסך של חשבון המסחר/הפוליסה. נדל"ן ומטבעות — פרטו בשאלות הבאות' },
  { id: 'realEstateDetails',  type: 'paragraph', label: 'פירוט נכס נדל"ן (מתי נרכש, באיזה מחיר)' },
  { id: 'cryptoDetails',      type: 'text',      label: 'מטבעות דיגיטליים — סוג מטבע וסכום' },

  { id: 'checkedHarHaBituach',type: 'choice',    label: 'האם בדקתם בהר הביטוח אילו ביטוחים יש לכם?', choices: ['כן', 'לא'] },
  { id: 'harHaBituachReport', type: 'file',      label: 'אם כן — צילום מסך של דוח הר הביטוח' },

  { id: 'creditScore',        type: 'file',      label: 'תמונה של דירוג האשראי שלכם' },
]

export const INTAKE_FILE_QUESTIONS = INTAKE_QUESTIONS.filter(q => q.type === 'file')
export const intakeQuestionLabel = (id: string): string =>
  INTAKE_QUESTIONS.find(q => q.id === id)?.label ?? id
