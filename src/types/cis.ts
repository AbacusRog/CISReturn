export type SubcontractorType = 'sole_trader' | 'partnership' | 'company' | 'trust'
export type VerificationStatus = 'unverified' | 'verified' | 'matched_higher_rate' | 'not_matched'
export type DeductionRate = 0 | 20 | 30
export type ReturnStatus = 'draft' | 'ready' | 'submitted' | 'accepted' | 'rejected'

export interface Contractor {
  id: string
  name: string
  utr: string | null
  accounts_office_reference: string | null
  employer_paye_reference: string | null
  address_line1: string | null
  address_line2: string | null
  town: string | null
  postcode: string | null
  contact_name: string | null
  contact_email: string | null
  active: boolean
  created_at: string
  updated_at: string
}

export interface Subcontractor {
  id: string
  contractor_id: string
  subcontractor_type: SubcontractorType
  business_name: string
  trading_name: string | null
  first_name: string | null
  last_name: string | null
  utr: string | null
  ni_number: string | null
  company_reg_number: string | null
  partnership_utr: string | null
  email: string | null
  phone: string | null
  address_line1: string | null
  address_line2: string | null
  town: string | null
  postcode: string | null
  deduction_rate: DeductionRate
  verification_number: string | null
  verification_status: VerificationStatus
  verified_at: string | null
  vat_registered: boolean
  start_date: string | null
  active: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Payment {
  id: string
  contractor_id: string
  subcontractor_id: string
  tax_month_start: string
  basic_pay: number
  materials_amount: number
  materials_on_top: boolean
  vat_amount: number
  gross_amount: number
  deduction_rate: DeductionRate
  deduction_amount: number
  net_amount: number
  finalised: boolean
  finalised_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface MonthlyReturn {
  id: string
  contractor_id: string
  tax_month_start: string
  nil_return: boolean
  inactivity_indicator: boolean
  status: ReturnStatus
  submitted_at: string | null
  correlation_id: string | null
  hmrc_response: unknown | null
  is_sandbox: boolean
  filed_externally: boolean
  created_at: string
  updated_at: string
}

export interface ReturnLine {
  id: string
  monthly_return_id: string
  payment_id: string | null
  subcontractor_id: string
  business_name: string
  utr: string | null
  ni_number: string | null
  verification_number: string | null
  gross_amount: number
  materials_amount: number
  deduction_rate: DeductionRate
  deduction_amount: number
}

export interface VerificationRequest {
  id: string
  subcontractor_id: string
  contractor_id: string
  requested_at: string
  request_payload: unknown | null
  response_payload: unknown | null
  status: 'pending' | 'sent' | 'verified' | 'matched_higher_rate' | 'not_matched' | 'error'
  correlation_id: string | null
  error_message: string | null
}
