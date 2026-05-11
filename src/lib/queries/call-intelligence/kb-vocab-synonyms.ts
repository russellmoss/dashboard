/**
 * Curated synonym map for kb_vocab_topics matching. Each canonical vocab value
 * maps to lowercase substrings that the cluster query ILIKEs against
 * knowledge_gaps[].text and rep_deferrals.topic.
 *
 * RULES for synonym entries:
 * - All lowercase.
 * - Substrings, not regex — the SQL is `LOWER(text) LIKE ('%' || syn || '%')`.
 * - Avoid stop words / short substrings that cause false positives.
 *   BAD:  'pers' → matches "person", "perspective". GOOD: 'pers retirement', 'public employee'
 *   BAD:  'firm' alone. GOOD: 'firm-specific', 'specific to the firm'
 * - Include common paraphrases the AI is likely to use.
 *
 * MAINTENANCE: review false matches monthly; tighten or expand as needed.
 * If kb_vocab_topics adds a new value, add an entry here. (Defaults to single
 * substring of the snake_case→space-replaced value if absent.)
 */
export const KB_VOCAB_SYNONYMS: Record<string, string[]> = {
  affiliation_model:        ['affiliation', 'how to affiliate', 'affiliation type'],
  aum_qualification:        ['aum qualif', 'minimum aum', 'aum threshold', 'qualify aum'],
  book_ownership:           ['book ownership', 'own the book', 'who owns'],
  candidate_persona:        ['candidate persona', 'persona', 'ideal candidate'],
  client_data_portability:  ['client data', 'data portability', 'transfer client'],
  client_onboarding:        ['client onboarding', 'onboarding client', 'transition client'],
  client_origin:            ['client origin', 'source of client'],
  comp_modeling:            ['comp modeling', 'compensation model', 'comp structure'],
  compliance:               ['compliance', 'regulatory', 'finra', 'sec '],
  culture_fit:              ['culture fit', 'firm culture'],
  disclosures:              ['disclosure', 'u4', 'broker check', 'brokercheck'],
  discovery_call_structure: ['discovery call', 'discovery structure', 'how to run discovery'],
  equity_structure:         ['equity structure', 'equity grant', 'partner equity'],
  firm_specific_risk:       ['firm specific risk', 'risk of the firm', 'firm risk', 'specific risk'],
  firm_types:               ['firm type', 'types of firm', 'kind of firm'],
  garden_leave:             ['garden leave', 'garden-leave', 'non-compete period'],
  investment_management:    ['investment management', 'manage investments', 'portfolio mgmt'],
  kickers:                  ['kicker', 'bonus kicker', 'performance bonus'],
  legal_protocol:           ['legal protocol', 'protocol', 'broker protocol'],
  marketing_program:        ['marketing program', 'marketing support', 'lead generation program'],
  meeting_sequencing:       ['meeting sequencing', 'meeting order', 'meeting cadence'],
  move_mindset:             ['move mindset', 'why move', 'reason to move'],
  objection_handling:       ['objection', 'pushback', 'concern about'],
  operations_support:       ['operations support', 'ops support', 'operational support'],
  pers:                     ['pers retirement', 'public employee retirement', 'pers system'],
  qualification_decision:   ['qualification decision', 'qualify decision', 'decide to qualify'],
  revenue_split:            ['revenue split', 'rev split', 'rev share', 'split with savvy'],
  sgm_handoff:              ['sgm handoff', 'handoff to sgm', 'hand off to sgm'],
  tech_partners:            ['tech partner', 'technology partner', 'integration partner'],
  tech_platform:            ['tech platform', 'technology platform', 'platform we use'],
  transition_timeline:      ['transition timeline', 'timeline to transition', 'move timeline'],
  annuity:                  ['annuity', 'annuities'],
};

/**
 * Returns synonyms for a topic. Defaults to the snake_case→space-replaced topic
 * itself if no curated entry exists, matching v1 naive behavior as a fallback.
 */
export function getSynonymsForTopic(topic: string): string[] {
  return KB_VOCAB_SYNONYMS[topic] ?? [topic.replace(/_/g, ' ')];
}
