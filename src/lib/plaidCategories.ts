/**
 * Maps Plaid's personal_finance_category slugs to ordered keyword arrays.
 *
 * Each array is a priority-ordered list of fragments to look for in a user's
 * category names (case-insensitive substring match).  The first matching
 * category wins, so put the most-specific keyword first.
 *
 * Plaid docs: https://plaid.com/docs/api/products/transactions/#categoriesget
 */

const DETAILED_HINTS: Record<string, string[]> = {
  // Food & Drink
  FOOD_AND_DRINK_GROCERIES:            ['groceries', 'grocery', 'food'],
  FOOD_AND_DRINK_RESTAURANTS:          ['dining', 'restaurant', 'eating'],
  FOOD_AND_DRINK_FAST_FOOD:            ['dining', 'fast food', 'restaurant'],
  FOOD_AND_DRINK_COFFEE:               ['coffee', 'dining'],
  FOOD_AND_DRINK_ALCOHOL_AND_BAR:      ['dining', 'entertainment'],
  FOOD_AND_DRINK_FOOD_DELIVERY_APPS:   ['dining', 'groceries'],
  FOOD_AND_DRINK_VENDING_MACHINES:     ['dining'],

  // Transportation
  TRANSPORTATION_GAS_STATIONS:         ['gas', 'fuel', 'transportation'],
  TRANSPORTATION_PUBLIC_TRANSIT:        ['transit', 'transportation'],
  TRANSPORTATION_TAXIS_AND_RIDE_SHARES: ['transportation', 'transit'],
  TRANSPORTATION_PARKING:              ['parking', 'transportation'],
  TRANSPORTATION_AUTOMOTIVE:           ['car', 'auto', 'transportation'],
  TRANSPORTATION_CAR_RENTAL:           ['transportation'],
  TRANSPORTATION_FLIGHTS:              ['travel', 'transportation'],

  // Rent & Utilities
  RENT_AND_UTILITIES_RENT:             ['rent', 'mortgage'],
  RENT_AND_UTILITIES_MORTGAGE:         ['mortgage', 'rent'],
  RENT_AND_UTILITIES_ELECTRICITY:      ['electric', 'utilities', 'utility'],
  RENT_AND_UTILITIES_WATER:            ['water', 'utilities', 'utility'],
  RENT_AND_UTILITIES_GAS:              ['gas', 'utilities', 'utility'],
  RENT_AND_UTILITIES_INTERNET_AND_CABLE: ['internet', 'cable', 'utilities'],
  RENT_AND_UTILITIES_TELEPHONE:        ['phone', 'telephone', 'utilities'],
  RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT: ['utilities', 'utility'],
  RENT_AND_UTILITIES_INSURANCE:        ['home insurance', 'insurance'],

  // Entertainment
  ENTERTAINMENT_MUSIC_AND_AUDIO:       ['entertainment', 'subscriptions'],
  ENTERTAINMENT_TV_AND_MOVIES:         ['entertainment', 'subscriptions'],
  ENTERTAINMENT_VIDEO_GAMES:           ['entertainment'],
  ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS: ['entertainment'],
  ENTERTAINMENT_CASINOS_AND_GAMBLING:  ['entertainment'],
  ENTERTAINMENT_MUSEUMS_AND_THEATERS:  ['entertainment'],

  // Medical
  MEDICAL_DOCTOR_SERVICES:            ['medical', 'health'],
  MEDICAL_PHARMACIES_AND_SUPPLEMENTS: ['medical', 'health'],
  MEDICAL_DENTAL_CARE:                ['medical', 'dental', 'health'],
  MEDICAL_VISION_CARE:                ['medical', 'health'],
  MEDICAL_VETERINARY_SERVICES:        ['medical', 'health'],
  MEDICAL_INSURANCE:                  ['medical', 'health', 'insurance'],

  // Personal Care
  PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS: ['gym', 'fitness', 'personal care'],
  PERSONAL_CARE_HAIR_AND_BEAUTY:       ['personal care'],
  PERSONAL_CARE_LAUNDRY_AND_DRY_CLEANING: ['personal care'],

  // General Merchandise / Shopping
  GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES: ['clothing', 'shopping'],
  GENERAL_MERCHANDISE_DEPARTMENT_STORES:        ['shopping', 'clothing'],
  GENERAL_MERCHANDISE_ONLINE_MARKETPLACES:      ['shopping', 'clothing'],
  GENERAL_MERCHANDISE_DISCOUNT_STORES:          ['shopping'],
  GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS: ['entertainment', 'shopping'],
  GENERAL_MERCHANDISE_ELECTRONICS:              ['shopping'],
  GENERAL_MERCHANDISE_SPORTING_GOODS:           ['shopping', 'entertainment'],

  // Home Improvement
  HOME_IMPROVEMENT_HARDWARE:           ['home maintenance', 'home improvement'],
  HOME_IMPROVEMENT_FURNITURE:          ['home maintenance', 'home improvement'],
  HOME_IMPROVEMENT_CONTRACTORS:        ['home maintenance', 'home improvement'],
  HOME_IMPROVEMENT_SECURITY:           ['home maintenance'],

  // Loan Payments
  LOAN_PAYMENTS_CREDIT_CARD_PAYMENT:  ['credit card', 'debt'],
  LOAN_PAYMENTS_AUTO_LOAN:            ['car', 'auto loan', 'debt'],
  LOAN_PAYMENTS_MORTGAGE:             ['mortgage', 'rent'],
  LOAN_PAYMENTS_STUDENT_LOAN:         ['student loan', 'debt'],

  // Income
  INCOME_WAGES:                        ['income', 'salary'],
  INCOME_DIVIDENDS:                    ['income', 'investment'],
  INCOME_TAX_REFUND:                   ['income'],
  INCOME_FREELANCE:                    ['income'],

  // Subscriptions (common pattern across multiple Plaid categories)
  GENERAL_SERVICES_SUBSCRIPTION:      ['subscriptions', 'entertainment'],

  // Insurance
  GENERAL_SERVICES_INSURANCE:         ['insurance'],
  GENERAL_SERVICES_CHILDCARE:         ['personal care'],

  // Travel
  TRAVEL_LODGING:                     ['travel'],
  TRAVEL_FLIGHTS:                     ['travel', 'transportation'],

  // Bank / transfers — don't auto-categorize, leave as uncategorized
  BANK_FEES_ATM_FEES:                 [],
  BANK_FEES_OTHER_BANK_FEES:          [],
  TRANSFER_IN_ACCOUNT_TRANSFER:       [],
  TRANSFER_OUT_ACCOUNT_TRANSFER:      [],
}

const PRIMARY_HINTS: Record<string, string[]> = {
  FOOD_AND_DRINK:          ['groceries', 'dining', 'food'],
  TRANSPORTATION:          ['transportation', 'gas'],
  RENT_AND_UTILITIES:      ['utilities', 'rent'],
  ENTERTAINMENT:           ['entertainment'],
  MEDICAL:                 ['medical', 'health'],
  PERSONAL_CARE:           ['personal care'],
  GENERAL_MERCHANDISE:     ['shopping', 'clothing'],
  HOME_IMPROVEMENT:        ['home maintenance', 'home improvement'],
  LOAN_PAYMENTS:           ['debt', 'credit card'],
  INCOME:                  ['income'],
  TRAVEL:                  ['travel'],
  GENERAL_SERVICES:        ['subscriptions'],
  // Intentionally no hints for TRANSFER_IN, TRANSFER_OUT, BANK_FEES
}

/**
 * Returns an ordered list of keyword fragments to search for in category names.
 * Tries the detailed slug first, falls back to primary.
 * Returns an empty array when the category should not be auto-assigned.
 */
export function getPlaidCategoryHints(primary: string, detailed: string): string[] {
  return DETAILED_HINTS[detailed] ?? PRIMARY_HINTS[primary] ?? []
}
